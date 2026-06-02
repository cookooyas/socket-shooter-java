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
                const [ , id, xStr, yStr, zStr, hpStr, yawStr] = data;
                const posX = parseFloat(xStr);
                const posY = parseFloat(yStr);
                const posZ = parseFloat(zStr);
                const playerYaw = parseFloat(yawStr);
                activePlayerIds.add(id);

                infoText += `플레이어 [${id.substring(0,5)}]: HP ${hpStr}<br/>`;

                if (!remotePlayers.has(id)) {
                    const playerGroup = new THREE.Group();

                    const dummyGeo = new THREE.BoxGeometry(1.0, 1.8, 1.0);
                    const dummyMat = new THREE.MeshStandardMaterial({
                        color: id === myClientId ? 0x00ff00 : 0xff0000,
                        wireframe: true
                    });
                    const dummyMesh = new THREE.Mesh(dummyGeo, dummyMat);
                    dummyMesh.position.y = 0.9;
                    dummyMesh.name = "skin";
                    playerGroup.add(dummyMesh);

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
                    console.log(`[애니메이션 엔진] 유저 [${id.substring(0,5)}] 전용 14종 상태머신 빌드 완료.`);
                }

                const actions = playerActions.get(id);
                if (actions) {
                    let targetState = "Idle";
                    if (distanceMoved > 0.02) {
                        targetState = actions["Walking"] ? "Walking" : "Running";
                    }

                    if (targetGroup.userData.currentGroupState !== targetState) {
                        const currentAction = actions[targetGroup.userData.currentGroupState];
                        const nextAction = actions[targetState];

                        if (currentAction && nextAction) {
                            nextAction.reset();
                            nextAction.play();
                            currentAction.crossFadeTo(nextAction, 0.15, true);
                        }
                        targetGroup.userData.currentGroupState = targetState;
                    }
                }

                // ⭐️ [시점 낮추기 핵심 보정]
                // 기존 posY + 1.5 (머리 위 허공) -> posY + 0.9 (모델 눈높이에 딱 맞춤)
                if (id === myClientId) {
                    camera.position.set(posX, posY + 0.9, posZ);
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
// 5. 키보드 입력 및 송신계 (WASD)
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
});

window.addEventListener('keyup', (e) => {
    const key = e.key.toLowerCase();
    if (['w','a','s','d'].includes(key)) {
        inputState[key] = 0;
        sendInput();
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