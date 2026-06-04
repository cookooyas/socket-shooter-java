package com.game.socketshooterjava.model;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class Player {
    private final String id;
    private double x;
    private double y;
    private double z;
    private int hp;

    // 위변조 방지를 위해 boolean으로 입력 여부만을 받음
    private boolean moveForward;
    private boolean moveBackward;
    private boolean moveLeft;
    private boolean moveRight;
    private boolean isCrouching = false;

    // 좌우 시야 라디안 값
    private double yaw;
    // Y축 속도 (점프에 활용)
    private double velocityY;

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