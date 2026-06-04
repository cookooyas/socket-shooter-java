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
        if (p != null && p.getHp() > 0 && p.getY() <= 0.001) {
            p.setVelocityY(JUMP_FORCE);
        }
    }

    public void createBullet(String shooterId, double dirX, double dirY, double dirZ) {
        Player shooter = players.get(shooterId);
        // 플레이어가 죽지 않은 경우에만 발사 가능
        if (shooter == null || shooter.getHp() <= 0) return;
        String bulletId = shooterId + "_" + System.nanoTime();
        // 생성 위치를 플레이어의 시점보다 살짝 높은곳에서 발사. 방향은 파라미터화
        Bullet bullet = new Bullet(bulletId, shooterId, shooter.getX(), shooter.getY() + 1.0, shooter.getZ(), dirX, dirY, dirZ);
        bullets.put(bulletId, bullet);
    }

    public void updatePhysics() {

        for (Player p : players.values()) {
            if (p.getHp() <= 0) continue;

            // 중력 및 Y축 처리
            p.setVelocityY(p.getVelocityY() + GRAVITY);
            p.setY(p.getY() + p.getVelocityY());

            if (p.getY() <= 0) {
                p.setY(0);
                p.setVelocityY(0);
            }

            // 회전각(Yaw)에 따른 앞방향 및 우측방향 벡터 수정
            double forwardX = -Math.sin(p.getYaw());
            double forwardZ = -Math.cos(p.getYaw());

            // 앞방향 벡터를 오른쪽으로 90도 회전한 벡터 (Right Vector)
            double rightX = -Math.cos(p.getYaw());
            double rightZ = Math.sin(p.getYaw());

            double moveX = 0;
            double moveZ = 0;

            // 키보드 입력 매핑 정렬
            if (p.isMoveForward())  { moveX -= forwardX; moveZ -= forwardZ; }
            if (p.isMoveBackward()) { moveX += forwardX; moveZ += forwardZ; }
            if (p.isMoveLeft())     { moveX -= rightX;   moveZ -= rightZ; } // 우측 벡터 차감 = 좌측 이동
            if (p.isMoveRight())    { moveX += rightX;   moveZ += rightZ; } // 우측 벡터 가산 = 우측 이동

            double len = Math.sqrt(moveX * moveX + moveZ * moveZ);
            if (len > 0) {
                p.setX(p.getX() + (moveX / len) * MOVE_SPEED);
                p.setZ(p.getZ() + (moveZ / len) * MOVE_SPEED);
            }

            // 전장 외곽 경계 제한
            if (p.getX() > 24.0) p.setX(24.0);
            if (p.getX() < -24.0) p.setX(-24.0);
            if (p.getZ() > 24.0) p.setZ(24.0);
            if (p.getZ() < -24.0) p.setZ(-24.0);
        }

        // 2. 총알 이동 및 충돌 연산 (기존 유지)
        long now = System.currentTimeMillis();
        for (Bullet b : bullets.values()) {
            if (now - b.getCreatedAt() > BULLET_LIFETIME) {
                bullets.remove(b.getId());
                continue;
            }

            b.setX(b.getX() + b.getDirX() * BULLET_SPEED);
            b.setY(b.getY() + b.getDirY() * BULLET_SPEED);
            b.setZ(b.getZ() + b.getDirZ() * BULLET_SPEED);

            if (Math.abs(b.getX()) > 30 || Math.abs(b.getZ()) > 30 || b.getY() < -5 || b.getY() > 40) {
                bullets.remove(b.getId());
                continue;
            }

            for (Player p : players.values()) {
                if (!p.getId().equals(b.getOwnerId()) && p.getHp() > 0) {
                    double dx = p.getX() - b.getX();
                    // ⭐️ 우주비행사 모델의 중심 높이에 맞춰 피격 Y축 중심점을 +0.7로 보정
                    double dy = (p.getY() + 0.7) - b.getY();
                    double dz = p.getZ() - b.getZ();
                    double distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

                    if (distance < HIT_RADIUS) {
                        p.setHp(Math.max(0, p.getHp() - 10));
                        bullets.remove(b.getId());
                        if (p.getHp() <= 0) {
                            final String deadPlayerId = p.getId();
                            System.out.println("[서버] 플레이어 사망: " + deadPlayerId);

                            new Thread(() -> {
                                try {
                                    Thread.sleep(3000);
                                    Player target = players.get(deadPlayerId);
                                    if (target != null) {
                                        // 체력 풀피로 회복 및 랜덤 위치 리스폰
                                        target.setHp(100);
                                        target.setX((Math.random() - 0.5) * 20.0);
                                        target.setZ((Math.random() - 0.5) * 20.0);
                                        target.setY(0);
                                        System.out.println("[서버] 플레이어 부활 완료: " + deadPlayerId);
                                    }
                                } catch (InterruptedException ignored) {}
                            }).start();
                        }
                        break;
                    }
                }
            }
        }
    }

    public String generateSnapshot() {
        StringBuilder sb = new StringBuilder("TICK");
        for (Player p : players.values()) {
            // ⭐️ 마지막 항목에 플레이어의 시선 각도 p.getYaw() 추가 전송!
            // 포맷: P,id,x,y,z,hp,yaw
            sb.append("|P,").append(p.getId())
                    .append(",").append(String.format("%.2f", p.getX()))
                    .append(",").append(String.format("%.2f", p.getY()))
                    .append(",").append(String.format("%.2f", p.getZ()))
                    .append(",").append(p.getHp())
                    .append(",").append(String.format("%.4f", p.getYaw()));
        }
        for (Bullet b : bullets.values()) {
            sb.append("|B,").append(b.getId())
                    .append(",").append(String.format("%.2f", b.getX()))
                    .append(",").append(String.format("%.2f", b.getY()))
                    .append(",").append(String.format("%.2f", b.getZ()));
        }
        return sb.toString();
    }
}