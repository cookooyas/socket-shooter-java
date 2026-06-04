import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// ==========================================
// 1. 전장 월드 공간 세팅 (바닥 및 입체 조명)
// ==========================================
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x141414);
scene.add(new THREE.GridHelper(60, 60, 0x00ff00, 0x333333));

const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
scene.add(ambientLight);
const dirLight = new THREE.DirectionalLight(0xffffff, 0.9);
dirLight.position.set(10, 20, 10);
scene.add(dirLight);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const remotePlayers = new Map();
const remoteBullets = new Map();
let myClientId = null;

// 애니메이션 믹서 및 액션 맵 관리 장부
let mixers = [];
const playerActions = new Map();
const clock = new THREE.Clock();

// FPS 마우스 시선 제어 변수
let yaw = 0;
let pitch = 0;
const cameraDirection = new THREE.Vector3();

// 앉기(Crouch) 제어용 글로벌 Hold 상태 변수 (Shift 기준)
let isShiftPressed = false;

// 가상 히트박스 기준 반경 상수
const BASE_HIT_RADIUS = 0.5;

// ==========================================
// 2. 3D 마스터 모델 로드 (모션 내장 스킨)
// ==========================================
const gltfLoader = new GLTFLoader();
const modelUrl = 'https://threejs.org/examples/models/gltf/RobotExpressive/RobotExpressive.glb';
let masterAstronautModel = null;

console.log("[3D 로더] 원격 서버에서 멀티 애니메이션 내장 모델 로드 시작...");
gltfLoader.load(
    modelUrl,
    (gltf) => {
        masterAstronautModel = gltf.scene;
        masterAstronautModel.scale.set(0.3, 0.3, 0.3);
        masterAstronautModel.position.set(0, 0, 0);

        if (gltf.animations && gltf.animations.length > 0) {
            masterAstronautModel.animations = gltf.animations;
            console.log("[3D 로더] 찾은 모션 리스트:", gltf.animations.map(a => a.name));
        }
        console.log("[3D 로더] 원본 마스터 스킨 준비 완료!");
    },
    undefined,
    (error) => console.error("[3D 로더] 모델 로딩 에러:", error)
);

// ==========================================
// 3. 웹소켓 데이터 수신 및 '실시간 상태 머신' 연산
// ==========================================
const socket = new WebSocket(`ws://${window.location.host}/ws/game`);

socket.onmessage = (event) => {
    const payload = event.data;

    if (payload.startsWith("INIT")) {
        const tokens = payload.split(',');
        myClientId = tokens[1].trim();
        document.getElementById('my-id').innerText = `내 ID: ${myClientId} (접속 및 인증 완료)`;
        return;
    }

    const tokens = payload.split('|');
    if (tokens[0] === 'TICK') {
        const activePlayerIds = new Set();
        const activeBulletIds = new Set();
        let infoText = "";

        for (let i = 1; i < tokens.length; i++) {
            const data = tokens[i].split(',');
            const type = data[0];

            if (type === 'P') {
                // 포맷: P,id,x,y,z,hp,yaw,isCrouching
                const [ , id, xStr, yStr, zStr, hpStr, yawStr, crouchStr] = data;
                const posX = parseFloat(xStr);
                const posY = parseFloat(yStr);
                const posZ = parseFloat(zStr);
                const playerYaw = parseFloat(yawStr);

                const isCrouching = (crouchStr && crouchStr.trim() === "1") && (posY <= 0.05);
                activePlayerIds.add(id);

                infoText += `플레이어 [${id.substring(0,5)}]: HP ${hpStr} ${isCrouching ? '<span style="color:#ffff00;">[앉음]</span>' : ''}<br/>`;

                if (!remotePlayers.has(id)) {
                    const playerGroup = new THREE.Group();

                    // 껍데기 더미 메쉬 (비활성화 유지)
                    const dummyGeo = new THREE.BoxGeometry(1.0, 1.8, 1.0);
                    const dummyMat = new THREE.MeshStandardMaterial({ visible: false });
                    const dummyMesh = new THREE.Mesh(dummyGeo, dummyMat);
                    dummyMesh.position.y = 0.9;
                    dummyMesh.name = "skin";
                    playerGroup.add(dummyMesh);

                    // ⭐️ [요청 반영] 히트박스 라인 비활성화 (visible: false)
                    const hitboxGeo = new THREE.CylinderGeometry(BASE_HIT_RADIUS, BASE_HIT_RADIUS, 1.4, 8, 1, true);
                    const hitboxMat = new THREE.MeshBasicMaterial({ color: 0xff0000, wireframe: true, visible: false });
                    const hitboxMesh = new THREE.Mesh(hitboxGeo, hitboxMat);
                    hitboxMesh.name = "hitbox_wire";
                    playerGroup.add(hitboxMesh);

                    scene.add(playerGroup);
                    remotePlayers.set(id, playerGroup);

                    playerGroup.userData = { lastX: posX, lastZ: posZ, currentGroupState: "Idle" };
                }

                const targetGroup = remotePlayers.get(id);

                const deltaX = posX - targetGroup.userData.lastX;
                const deltaZ = posZ - targetGroup.userData.lastZ;
                const distanceMoved = Math.sqrt(deltaX * deltaX + deltaZ * deltaZ);

                targetGroup.userData.lastX = posX;
                targetGroup.userData.lastZ = posZ;

                targetGroup.position.set(posX, posY, posZ);
                targetGroup.rotation.y = playerYaw;

                // 내부 가상 히트박스 데이터 위치 동기화 (화면엔 안 보임)
                const hitboxWire = targetGroup.getObjectByName("hitbox_wire");
                if (hitboxWire) {
                    if (isCrouching) {
                        hitboxWire.scale.set(1.1, 0.55, 1.1);
                        hitboxWire.position.set(0, 0.40, 0);
                    } else {
                        hitboxWire.scale.set(1.0, 1.0, 1.0);
                        hitboxWire.position.set(0, 0.85, 0);
                    }
                }

                if (masterAstronautModel && targetGroup.getObjectByName("skin") && targetGroup.getObjectByName("skin").isMesh) {
                    const oldSkin = targetGroup.getObjectByName("skin");
                    targetGroup.remove(oldSkin);

                    const newSkin = masterAstronautModel.clone();
                    newSkin.name = "skin";

                    if (id === myClientId) {
                        newSkin.traverse((child) => {
                            if (child.isMesh) child.layers.set(1);
                        });
                    }

                    targetGroup.add(newSkin);

                    if (masterAstronautModel.animations && masterAstronautModel.animations.length > 0) {
                        const mixer = new THREE.AnimationMixer(newSkin);
                        mixer.playerId = id;
                        mixers.push(mixer);

                        const actions = {};
                        masterAstronautModel.animations.forEach((clip) => {
                            actions[clip.name] = mixer.clipAction(clip);
                        });

                        playerActions.set(id, actions);
                        if (actions["Idle"]) actions["Idle"].play();
                    }
                }

                // 실시간 모션 믹서 제어 및 루프 제한 락킹
                const actions = playerActions.get(id);
                if (actions) {
                    let targetState = "Idle";

                    if (parseInt(hpStr) <= 0) {
                        targetState = "Death";
                        if (actions["Death"]) {
                            actions["Death"].setLoop(THREE.LoopOnce);
                            actions["Death"].clampWhenFinished = true;
                        }
                    }
                    else if (posY > 0.05) {
                        if (distanceMoved > 0.02) {
                            targetState = actions["WalkJump"] ? "WalkJump" : "Jump";
                        } else {
                            targetState = actions["Jump"] ? "Jump" : "Idle";
                        }

                        if (actions[targetState]) {
                            actions[targetState].setLoop(THREE.LoopOnce);
                            actions[targetState].clampWhenFinished = true;
                        }
                    }
                    else if (isCrouching) {
                        targetState = "Sitting";
                        if (actions["Sitting"]) {
                            actions["Sitting"].setLoop(THREE.LoopOnce);
                            actions["Sitting"].clampWhenFinished = true;
                        }
                    }
                    else {
                        if (distanceMoved > 0.02) {
                            targetState = actions["Walking"] ? "Walking" : "Running";
                        } else {
                            targetState = "Idle";
                        }

                        if (actions["Jump"]) actions["Jump"].paused = false;
                        if (actions["WalkJump"]) actions["WalkJump"].paused = false;
                        if (actions["Death"]) actions["Death"].paused = false;
                        if (actions["Sitting"]) actions["Sitting"].paused = false;
                    }

                    if (targetGroup.userData.currentGroupState !== targetState) {
                        const currentAction = actions[targetGroup.userData.currentGroupState];
                        const nextAction = actions[targetState];

                        if (currentAction && nextAction) {
                            nextAction.reset();
                            nextAction.play();
                            currentAction.crossFadeTo(nextAction, 0.12, true);
                        }
                        targetGroup.userData.currentGroupState = targetState;
                    }
                }

                // 1인칭 카메라 눈높이 시야 보정 (백엔드 실제 판정 높이 반영)
                if (id === myClientId) {
                    const currentEyeHeight = isCrouching ? 0.45 : 0.85;
                    camera.position.set(posX, posY + currentEyeHeight, posZ);
                }

                const currentSkin = targetGroup.getObjectByName("skin");
                if (currentSkin) {
                    currentSkin.traverse((child) => {
                        if (child.isMesh) {
                            child.material.transparent = true;
                            child.material.opacity = parseInt(hpStr) <= 0 ? 0.15 : 1.0;
                        }
                    });
                }
            }
            else if (type === 'B') {
                const [ , id, xStr, yStr, zStr] = data;
                const posX = parseFloat(xStr);
                const posY = parseFloat(yStr);
                const posZ = parseFloat(zStr);
                activeBulletIds.add(id);

                if (!remoteBullets.has(id)) {
                    const geometry = new THREE.SphereGeometry(0.15, 8, 8);
                    const material = new THREE.MeshBasicMaterial({ color: 0xffff00 });
                    const sphere = new THREE.Mesh(geometry, material);
                    scene.add(sphere);
                    remoteBullets.set(id, sphere);
                }
                remoteBullets.get(id).position.set(posX, posY, posZ);
            }
        }

        for (const id of remotePlayers.keys()) {
            if (!activePlayerIds.has(id)) {
                scene.remove(remotePlayers.get(id));
                remotePlayers.delete(id);
                mixers = mixers.filter(m => m.playerId !== id);
                playerActions.delete(id);
            }
        }
        for (const id of remoteBullets.keys()) {
            if (!activeBulletIds.has(id)) { scene.remove(remoteBullets.get(id)); remoteBullets.delete(id); }
        }
        document.getElementById('players-info').innerHTML = infoText;
    }
};

// ==========================================
// 4. Pointer Lock (FPS 마우스 시선 연동)
// ==========================================
renderer.domElement.addEventListener('click', () => {
    renderer.domElement.requestPointerLock();
});

document.addEventListener('mousemove', (event) => {
    if (document.pointerLockElement !== renderer.domElement) return;

    const sensitivity = 0.0022;
    yaw -= event.movementX * sensitivity;
    pitch -= event.movementY * sensitivity;

    pitch = Math.max(-Math.PI / 2.2, Math.min(Math.PI / 2.2, pitch));

    const target = new THREE.Vector3();
    target.x = Math.sin(yaw) * Math.cos(pitch);
    target.y = Math.sin(pitch);
    target.z = Math.cos(yaw) * Math.cos(pitch);

    camera.lookAt(camera.position.clone().add(target));

    if (socket.readyState === WebSocket.OPEN && myClientId) {
        socket.send(`LOOK,${yaw.toFixed(4)}`);
    }
});

// ==========================================
// 5. 키보드 입력 및 송신계 (WASD + Shift)
// ==========================================
const inputState = { w: 0, a: 0, s: 0, d: 0 };

const sendInput = () => {
    if (socket.readyState !== WebSocket.OPEN || !myClientId) return;
    socket.send(`INPUT,${inputState.w},${inputState.s},${inputState.a},${inputState.d}`);
};

window.addEventListener('keydown', (e) => {
    const key = e.key.toLowerCase();
    if (['w','a','s','d'].includes(key)) {
        inputState[key] = 1;
        sendInput();
    }
    if (e.key === ' ' || e.code === 'Space') {
        if (socket.readyState === WebSocket.OPEN) socket.send("JUMP");
    }

    if (e.key === 'Shift') {
        e.preventDefault();

        const myGroup = remotePlayers.get(myClientId);
        const isAirborne = myGroup && myGroup.position.y > 0.05;

        if (!isShiftPressed && !isAirborne) {
            isShiftPressed = true;
            if (socket.readyState === WebSocket.OPEN) {
                socket.send("CROUCH,1");
            }
        }
    }
});

window.addEventListener('keyup', (e) => {
    const key = e.key.toLowerCase();
    if (['w','a','s','d'].includes(key)) {
        inputState[key] = 0;
        sendInput();
    }

    if (e.key === 'Shift') {
        if (isShiftPressed) {
            isShiftPressed = false;
            if (socket.readyState === WebSocket.OPEN) {
                socket.send("CROUCH,0");
            }
        }
    }
});

// ==========================================
// 6. 슈팅 패킷 전송
// ==========================================
renderer.domElement.addEventListener('mousedown', (event) => {
    if (document.pointerLockElement !== renderer.domElement) return;
    if (socket.readyState !== WebSocket.OPEN || !myClientId) return;

    camera.getWorldDirection(cameraDirection);
    socket.send(`SHOOT,${cameraDirection.x.toFixed(4)},${cameraDirection.y.toFixed(4)},${cameraDirection.z.toFixed(4)}`);
});

// ==========================================
// 7. 메인 프레임 애니메이션 루프
// ==========================================
function animate() {
    requestAnimationFrame(animate);

    try {
        if (typeof clock !== 'undefined' && mixers.length > 0) {
            const delta = clock.getDelta();
            for (let i = 0; i < mixers.length; i++) {
                if (mixers[i] && typeof mixers[i].update === 'function') {
                    mixers[i].update(delta);
                }
            }
        }
    } catch (e) {
        console.error("애니메이션 프레임 업데이트 에러 가드:", e);
    }

    renderer.render(scene, camera);
}
animate();

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});