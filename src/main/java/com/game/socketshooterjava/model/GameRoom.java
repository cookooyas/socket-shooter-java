package com.game.socketshooterjava.model;

import lombok.Getter;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Getter
public class GameRoom {
    private final Map<String, Player> players = new ConcurrentHashMap<>();
    private final Map<String, Bullet> bullets = new ConcurrentHashMap<>();

    // 게임 전역 설정 (플레이어 속도, 총알 속도/생명, 히트박스, 점프관련 중력)
    private final double MOVE_SPEED = 0.12;
    private final double BULLET_SPEED = 0.6;
    private final double HIT_RADIUS = 0.6;
    private final long BULLET_LIFETIME = 1500;
    private final double GRAVITY = -0.012;
    private final double JUMP_FORCE = 0.28;

    public void addPlayer(String id) {
        if (players.size() < 8) {
            double initialX = players.isEmpty() ? -5.0 : 5.0;
            players.put(id, new Player(id, initialX, 0.0, 0.0));
        }
    }

    public void removePlayer(String id) {
        players.remove(id);
    }

    public void handleJump(String playerId) {
        Player p = players.get(playerId);
        if (p != null && p.getHp() > 0 && p.getY() <= 0.001 && !p.isCrouching()) {
            p.setVelocityY(JUMP_FORCE);
        }
    }

    public void createBullet(String shooterId, double dirX, double dirY, double dirZ) {
        Player shooter = players.get(shooterId);
        if (shooter == null || shooter.getHp() <= 0) return;

        // 기본 탄퍼짐 오차 수치 (서 있거나 달릴 때)
        double spread = 0.08;

        // ⭐️ [사격 정밀도 상승] 앉아있을 때는 탄퍼짐 오차를 0.015로 확 줄여서 정확하게 조준되도록 만듭니다!
        if (shooter.isCrouching()) {
            spread = 0.015;
        }

        // 시선 벡터에 약간의 무작위 오차 부여 (난수 가산)
        double finalDirX = dirX + (Math.random() - 0.5) * spread;
        double finalDirY = dirY + (Math.random() - 0.5) * spread;
        double finalDirZ = dirZ + (Math.random() - 0.5) * spread;

        // 벡터 정규화 (오차가 섞여 크기가 변한 벡터를 다시 크기 1인 방향벡터로 만듦)
        double len = Math.sqrt(finalDirX*finalDirX + finalDirY*finalDirY + finalDirZ*finalDirZ);
        if (len > 0) {
            finalDirX /= len; finalDirY /= len; finalDirZ /= len;
        }

        String bulletId = shooterId + "_" + System.nanoTime();

        // ⭐️ 앉았을 때는 총구의 높이(Y축)도 낮아져야 자연스럽습니다. (지상 1.0 -> 0.5)
        double bulletSpawnY = shooter.getY() + (shooter.isCrouching() ? 0.5 : 1.0);

        Bullet bullet = new Bullet(bulletId, shooterId, shooter.getX(), bulletSpawnY, shooter.getZ(), finalDirX, finalDirY, finalDirZ);
        bullets.put(bulletId, bullet);
    }
    public void updatePhysics() {
        for (Player p : players.values()) {
            if (p.getHp() <= 0) continue;

            // 1. 중력 및 Y축 고도 연산
            p.setVelocityY(p.getVelocityY() + GRAVITY);
            p.setY(p.getY() + p.getVelocityY());

            // 바닥 착지 처리
            if (p.getY() <= 0) {
                p.setY(0);
                p.setVelocityY(0);
            }

            // ⭐️ [공중 앉기 방어 가드] Y축이 바닥이 아니고 공중에 떠 있다면 앉음 상태를 강제로 해제합니다.
            if (p.getY() > 0.05) {
                p.setCrouching(false);
            }

            // 2. 시선(Yaw) 각도 기반 전후좌우 방향 벡터 계산
            double forwardX = -Math.sin(p.getYaw()); double forwardZ = -Math.cos(p.getYaw());
            double rightX = -Math.cos(p.getYaw()); double rightZ = Math.sin(p.getYaw());

            double moveX = 0; double moveZ = 0;
            if (p.isMoveForward())  { moveX -= forwardX; moveZ -= forwardZ; }
            if (p.isMoveBackward()) { moveX += forwardX; moveZ += forwardZ; }
            if (p.isMoveLeft())     { moveX -= rightX;   moveZ -= rightZ; }
            if (p.isMoveRight())    { moveX += rightX;   moveZ += rightZ; }

            // 3. 이동 속도 반영 및 앉기 제약 적용
            double len = Math.sqrt(moveX * moveX + moveZ * moveZ);
            if (len > 0) {
                // 앉아있을 때는 기존 속도(MOVE_SPEED)의 40% 수준으로 느리게 기어가도록 제약
                double currentSpeed = p.isCrouching() ? (MOVE_SPEED * 0.4) : MOVE_SPEED;
                p.setX(p.getX() + (moveX / len) * currentSpeed);
                p.setZ(p.getZ() + (moveZ / len) * currentSpeed);
            }

            // 맵 월드 경계선 제한 (가드)
            if (p.getX() > 24.0) p.setX(24.0); if (p.getX() < -24.0) p.setX(-24.0);
            if (p.getZ() > 24.0) p.setZ(24.0); if (p.getZ() < -24.0) p.setZ(-24.0);
        }

        // ========================================================
        // 4. 총알 이동 및 동적 히트박스(Hitbox) 충돌 판정 루프
        // ========================================================
        long now = System.currentTimeMillis();
        for (Bullet b : bullets.values()) {
            // 총알 수명 만료 처리
            if (now - b.getCreatedAt() > BULLET_LIFETIME) {
                bullets.remove(b.getId());
                continue;
            }

            // 총알 물리 좌표 이동
            b.setX(b.getX() + b.getDirX() * BULLET_SPEED);
            b.setY(b.getY() + b.getDirY() * BULLET_SPEED);
            b.setZ(b.getZ() + b.getDirZ() * BULLET_SPEED);

            // 월드 경계 이탈 총알 삭제
            if (Math.abs(b.getX()) > 30 || Math.abs(b.getZ()) > 30 || b.getY() < -5 || b.getY() > 40) {
                bullets.remove(b.getId());
                continue;
            }

            // 플레이어들과의 피격 충돌 연산
            for (Player p : players.values()) {
                // 자기가 쏜 총알이 아니고, 상대방이 살아있는 상태일 때만 체크
                if (!p.getId().equals(b.getOwnerId()) && p.getHp() > 0) {
                    double dx = p.getX() - b.getX();
                    double dz = p.getZ() - b.getZ();

                    // ⭐️ [히트박스 가변 공식] 기본값 세팅
                    double currentHitRadius = HIT_RADIUS; // 기본 반경 (0.6)
                    double targetCenterY = p.getY() + 0.85; // 서 있을 때 피격 중심 고도

                    // 앉아있는 상태라면 프론트엔드 와이어프레임 디버거와 정확히 동치로 스케일링 변형
                    if (p.isCrouching()) {
                        currentHitRadius = HIT_RADIUS; // 앉으면 웅크려서 좌우 반경 1.3배 증가 (0.78)
                        targetCenterY = p.getY() + 0.7;    // 앉았으므로 피격 중심 고도를 아래쪽으로 하강
                    }

                    double dy = targetCenterY - b.getY();
                    double distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

                    // 최종 충돌 검증 성공 시 데미지 처리
                    if (distance < currentHitRadius) {
                        p.setHp(Math.max(0, p.getHp() - 10));
                        bullets.remove(b.getId());

                        // ⭐️ [플레이어 사망 및 부활 스레드 비동기 외주]
                        if (p.getHp() <= 0) {
                            final String deadPlayerId = p.getId();
                            System.out.println("[서버 물리 엔진] 플레이어 사망 트리거 가동: " + deadPlayerId);

                            new Thread(() -> {
                                try {
                                    Thread.sleep(3000); // 3초간 사망 레이어 유지 대기
                                    Player target = players.get(deadPlayerId);
                                    if (target != null) {
                                        target.setHp(100);
                                        target.setX((Math.random() - 0.5) * 20.0);
                                        target.setZ((Math.random() - 0.5) * 20.0);
                                        target.setY(0);
                                        target.setCrouching(false); // 부활 시 앉기 초기화
                                        System.out.println("[서버 물리 엔진] 플레이어 부활 리스폰 완료: " + deadPlayerId);
                                    }
                                } catch (InterruptedException ignored) {}
                            }).start();
                        }
                        break; // 총알이 소멸했으므로 다른 플레이어 검사 중단
                    }
                }
            }
        }
    }
    // 4. generateSnapshot() 수정 (프론트엔드에 앉음 상태 정보를 전달해야 하므로 패킷 끝에 추가)
    public String generateSnapshot() {
        StringBuilder sb = new StringBuilder("TICK");
        for (Player p : players.values()) {
            // 포맷 끝에 앉음 여부(1 또는 0)를 플래그로 실어 보냅니다.
            // 결과 구조: P,id,x,y,z,hp,yaw,isCrouching(1/0)
            int crouchFlag = p.isCrouching() ? 1 : 0;
            sb.append("|P,").append(p.getId())
                    .append(",").append(String.format("%.2f", p.getX()))
                    .append(",").append(String.format("%.2f", p.getY()))
                    .append(",").append(String.format("%.2f", p.getZ()))
                    .append(",").append(p.getHp())
                    .append(",").append(String.format("%.4f", p.getYaw()))
                    .append(",").append(crouchFlag); // ◄ 추가
        }
        for (Bullet b : bullets.values()) {
            sb.append("|B,").append(b.getId())
                    .append(",").append(String.format("%.2f", b.getX()))
                    .append(",").append(String.format("%.2f", b.getY()))
                    .append(",").append(String.format("%.2f", b.getZ()));
        }
        return sb.toString();
    }

    public void handleEmote(String senderId, String emoteIdxStr) {
        Player p = players.get(senderId);
        // 플레이어가 방에 존재하고, 살아있는 상태일 때만 중계 허용
        if (p != null && p.getHp() > 0) {
            try {
                int emoteIdx = Integer.parseInt(emoteIdxStr.trim());

                // 프론트엔드 main.js의 수신 규격과 100% 일치하는 프로토콜 생성
                // 포맷: EMOTE_BROADCAST|플레이어ID,애니메이션인덱스
                String broadcastMessage = String.format("EMOTE_BROADCAST|%s,%d", senderId, emoteIdx);

                // 현재 게임방에 접속 중인 모든 유저들의 웹소켓 세션으로 패킷 전송
                // 💡 주의: 프로젝트 구조에 따라 세션을 순회하며 메시지를 보내는 코드가 필요합니다.
                // 보통 WebSocketHandler 등에서 이 메서드를 호출하거나, 아래와 같이 세션 리스트를 공유받아 처리합니다.
                System.out.println("[서버 중계] 플레이어 " + senderId + " 가 " + emoteIdx + "번 감정표현을 시전함.");

                // 만약 이 클래스(GameRoom) 내부나 연동된 핸들러에 브로드캐스트용 전역 메서드가 있다면
                // 이 안에서 실행해 주거나, 웹소켓 핸들러 단에서 아래 문자열을 그대로 broadcast 처리해 주면 됩니다.

            } catch (NumberFormatException e) {
                System.err.println("[서버 에러] 잘못된 감정표현 인덱스 패킷 수신: " + emoteIdxStr);
            }
        }
    }
}