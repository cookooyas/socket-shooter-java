package com.game.socketshooterjava.model;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class Bullet {
    private final String id;
    private final String ownerId;
    private double x, y, z;
    private final double dirX, dirY, dirZ; // ⭐️ Y축 발사 방향 추가
    private final long createdAt;

    public Bullet(String id, String ownerId, double x, double y, double z, double dirX, double dirY, double dirZ) {
        this.id = id;
        this.ownerId = ownerId;
        this.x = x;
        this.y = y;
        this.z = z;
        this.dirX = dirX;
        this.dirY = dirY;
        this.dirZ = dirZ;
        this.createdAt = System.currentTimeMillis();
    }
}