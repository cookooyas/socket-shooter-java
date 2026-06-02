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
        if (sessions.size() >= 2) {
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

            case "JUMP": // JUMP
                gameRoom.handleJump(player.getId());
                break;

            case "SHOOT": // SHOOT,dirX,dirY,dirZ (3차원 조준선 벡터 직접 수신)
                try {
                    double dx = Double.parseDouble(tokens[1]);
                    double dy = Double.parseDouble(tokens[2]);
                    double dz = Double.parseDouble(tokens[3]);
                    gameRoom.createBullet(player.getId(), dx, dy, dz);
                } catch (Exception ignored) {}
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