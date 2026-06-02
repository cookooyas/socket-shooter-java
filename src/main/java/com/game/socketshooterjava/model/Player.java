package com.game.socketshooterjava.model;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class Player {
    private final String id;
    private double x;
    private double y; // ⭐️ 이제 Y축(높이)이 실시간으로 변합니다.
    private double z;
    private int hp;

    // 키보드 입력 상태 (FPS 조작을 위해 방향 벡터가 아닌 raw 입력 상태를 받음)
    private boolean moveForward;
    private boolean moveBackward;
    private boolean moveLeft;
    private boolean moveRight;

    private double yaw; // ⭐️ 플레이어가 바라보는 수평 회전 각도 (라디안)
    private double velocityY; // ⭐️ Y축 이동 속도 (중력 및 점프 가속도용)

    public Player(String id, double x, double y, double z) {
        this.id = id;
        this.x = x;
        this.y = y;
        this.z = z;
        this.hp = 100;
        this.velocityY = 0.0;
        this.yaw = 0.0;
    }
}