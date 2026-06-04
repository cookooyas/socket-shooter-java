package com.game.socketshooterjava.handler;

import com.game.socketshooterjava.model.GameRoom;
import com.game.socketshooterjava.model.Player;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;
import org.springframework.web.socket.handler.ConcurrentWebSocketSessionDecorator;

import java.io.IOException;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Slf4j
@Component
public class GameWebSocketHandler extends TextWebSocketHandler {

    private final Map<String, WebSocketSession> sessions = new ConcurrentHashMap<>();
    private final GameRoom gameRoom = new GameRoom();
    private boolean isGameRunning = false;

    public GameWebSocketHandler() {
        startGameLoop();
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession session) throws Exception {
        if (sessions.size() >= 8) {
            session.close(new CloseStatus(4001, "Room is full"));
            return;
        }
        WebSocketSession threadSafeSession = new ConcurrentWebSocketSessionDecorator(session, 1000, 512 * 1024);
        sessions.put(session.getId(), threadSafeSession);
        gameRoom.addPlayer(session.getId());

        log.info("[FPS 서버 - 유저 입장] ID: {}", session.getId());
        threadSafeSession.sendMessage(new TextMessage("INIT," + session.getId()));
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) throws Exception {
        String payload = message.getPayload();
        String[] tokens = payload.split(",");
        String header = tokens[0];

        Player player = gameRoom.getPlayers().get(session.getId());
        if (player == null || player.getHp() <= 0) return;

        switch (header) {
            case "INPUT": // INPUT,W,A,S,D 상태 업데이트 (1 또는 0)
                player.setMoveForward("1".equals(tokens[1]));
                player.setMoveBackward("1".equals(tokens[2]));
                player.setMoveLeft("1".equals(tokens[3]));
                player.setMoveRight("1".equals(tokens[4]));
                break;

            case "LOOK": // LOOK,yaw각도
                player.setYaw(Double.parseDouble(tokens[1]));
                break;

            case "CROUCH":
                player.setCrouching("1".equals(tokens[1]));
                break;

            case "JUMP": // JUMP
                gameRoom.handleJump(player.getId());
                break;

            case "SHOOT": // SHOOT,dirX,dirY,dirZ
                try {
                    double dx = Double.parseDouble(tokens[1]);
                    double dy = Double.parseDouble(tokens[2]);
                    double dz = Double.parseDouble(tokens[3]);
                    gameRoom.createBullet(player.getId(), dx, dy, dz);
                } catch (Exception ignored) {}
                break;

            // ========================================================
            // 🎯 [추가] 감정표현 패킷 수신 및 즉시 전체 중계 (Broadcasting)
            // ========================================================
            case "EMOTE": // EMOTE,인덱스 (0:춤, 1:아니오, 2:네, 3:엄지척)
                try {
                    String emoteIdxStr = tokens[1].trim();

                    // 1. [서버 동기화 가드] 감정표현 도중 관성 이동 방지를 위해 백엔드 상의 이동 속도 벡터 초기화
                    player.setMoveForward(false);
                    player.setMoveBackward(false);
                    player.setMoveLeft(false);
                    player.setMoveRight(false);

                    // 2. 프론트엔드 수신 양식 규격에 맞게 메시지 조립
                    // 포맷: EMOTE_BROADCAST|플레이어ID,애니메이션번호
                    String broadcastMessage = String.format("EMOTE_BROADCAST|%s,%s", player.getId(), emoteIdxStr);
                    TextMessage wsMessage = new TextMessage(broadcastMessage);

                    // 3. 서버 틱 스레드를 기다리지 않고 즉시 실시간 브로드캐스트로 룸 내 전원에게 뿌림
                    for (WebSocketSession s : sessions.values()) {
                        if (s != null && s.isOpen()) {
                            try {
                                s.sendMessage(wsMessage);
                            } catch (IOException ignored) {}
                        }
                    }

                    log.info("[FPS 서버 - 감정표현 중계] 유저 {} -> {}번 모션 전파 완료", player.getId().substring(0, 5), emoteIdxStr);
                } catch (Exception e) {
                    log.error("[FPS 서버 - 에러] 잘못된 EMOTE 패킷 포맷 수신 : {}", payload);
                }
                break;
        }
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) throws Exception {
        sessions.remove(session.getId());
        gameRoom.removePlayer(session.getId());
        log.info("[FPS 서버 - 유저 퇴장] ID: {}", session.getId());
    }

    private void startGameLoop() {
        isGameRunning = true;
        Thread gameThread = new Thread(() -> {
            final long targetDelay = 33;
            while (isGameRunning) {
                long startTime = System.currentTimeMillis();
                gameRoom.updatePhysics();
                String snapshot = gameRoom.generateSnapshot();
                TextMessage message = new TextMessage(snapshot);

                for (WebSocketSession session : sessions.values()) {
                    if (session != null && session.isOpen()) {
                        try { session.sendMessage(message); } catch (IOException ignored) {}
                    }
                }

                long elapsedTime = System.currentTimeMillis() - startTime;
                long sleepTime = targetDelay - elapsedTime;
                if (sleepTime > 0) {
                    try { Thread.sleep(sleepTime); } catch (InterruptedException e) { break; }
                }
            }
        });
        gameThread.setName("Game-Tick-Thread");
        gameThread.start();
    }
}