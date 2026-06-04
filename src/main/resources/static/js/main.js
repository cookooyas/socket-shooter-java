import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js'; // 🌟 DRACOLoader 추가 임포트

// ==========================================
// 1. 전장 월드 공간 세팅 (바닥 및 입체 조명)
// ==========================================
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x141414);

// 🌟 입체감을 주기 위한 렌더러 그림자 활성화
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

scene.add(new THREE.GridHelper(60, 60, 0x00ff00, 0x333333));

const ambientLight = new THREE.AmbientLight(0xffffff, 0.4); // 지형 대비 조명 밸런스 조정
scene.add(ambientLight);

// 🌟 그림자를 생성하는 직사 조명 스펙 확장
const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(30, 40, 20);
dirLight.castShadow = true;
dirLight.shadow.mapSize.width = 2048;
dirLight.shadow.mapSize.height = 2048;
dirLight.shadow.camera.near = 0.5;
dirLight.shadow.camera.far = 150;
const d = 40;
dirLight.shadow.camera.left = -d;
dirLight.shadow.camera.right = d;
dirLight.shadow.camera.top = d;
dirLight.shadow.camera.bottom = -d;
scene.add(dirLight);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);

const remotePlayers = new Map();
const remoteBullets = new Map();
let myClientId = null;

let mixers = [];
const playerActions = new Map();
const clock = new THREE.Clock();

let yaw = 0;
let pitch = 0;
const cameraDirection = new THREE.Vector3();

// 💡 [복구] 앉기(Crouch) 제어용 Hold 상태 변수 및 히트박스 반경
let isShiftPressed = false;
const BASE_HIT_RADIUS = 0.5;

// ==========================================
// 🎯 [라디알 메뉴 및 호버링 제어 변수]
// ==========================================
let isRadialMenuOpen = false;
let selectedSectorIndex = -1; // -1: 취소, 0:Dance(WHY?), 1:No, 2:ThumbsUp, 3:Yes

const radialMenuUI = document.getElementById('radial-menu');

// 💡 칼정렬 순서 매핑 테이블 (0:위, 1:우, 2:아래, 3:좌)
const EMOTE_CLIPS = ["Dance", "No", "ThumbsUp", "Yes"];

// 브라우저 호버링(Hover) 이벤트 바인딩
function setupRadialHoverEvents() {
    const targets = document.querySelectorAll('.radial-sector, .radial-center');

    targets.forEach(element => {
        element.addEventListener('mouseenter', () => {
            if (!isRadialMenuOpen) return;

            selectedSectorIndex = parseInt(element.getAttribute('data-index'));

            targets.forEach(el => el.classList.remove('active'));
            element.classList.add('active');
        });
    });
}
setupRadialHoverEvents();

// ==========================================
// 2. 3D 마스터 모델 및 오픈소스 지형 맵 로드
// ==========================================
const gltfLoader = new GLTFLoader();

// 🌟 드라코 압축 해제기 연결
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.5/');
gltfLoader.setDRACOLoader(dracoLoader);

// 오픈소스 맵 파일 경로 세팅
const MAP_URL = 'https://threejs.org/examples/models/gltf/LittlestTokyo.glb';
let mapModel = null;

gltfLoader.load(MAP_URL, (gltf) => {
    mapModel = gltf.scene;
    mapModel.scale.set(0.03, 0.03, 0.03); // 먼저 배율을 적용합니다.

    // 🌟 [핵심] 모델의 실제 3D 크기를 계산하는 바운딩 박스 생성
    const box = new THREE.Box3().setFromObject(mapModel);

    // 이 박스에서 최소 Y값(가장 밑바닥)과 최대 Y값(가장 꼭대기)을 뽑아냅니다.
    const minY = box.min.y;
    const maxY = box.max.y;

    // 모델의 실제 높이를 구합니다.
    const modelHeight = maxY - minY;

    // 🌟 모델의 가장 밑바닥(minY)이 정확히 월드의 Y=0 좌표에 오도록 Y축 위치를 조정합니다.
    // 기존 위치값에서 제일 밑바닥의 높이만큼 빼주면 정확히 수평선 위로 딱 올라옵니다.
    mapModel.position.y = mapModel.position.y - (minY * 0.9);

    // 지형 메쉬 전체에 입체 그림자 효과 강제 주입 (이하 동일)
    mapModel.traverse((child) => {
        if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
            if (child.material) child.material.roughness = 0.7;
        }
    });

    scene.add(mapModel);
    console.log("오픈소스 맵 로드 및 바운딩 박스 자동 바닥 정렬 완료!");
}, undefined, (error) => console.error("맵 로드 실패:", error));

// 마스터 로봇 스킨 모델 로드
const modelUrl = 'https://threejs.org/examples/models/gltf/RobotExpressive/RobotExpressive.glb';
let masterAstronautModel = null;

gltfLoader.load(modelUrl, (gltf) => {
    masterAstronautModel = gltf.scene;
    masterAstronautModel.scale.set(0.3, 0.3, 0.3);
    if (gltf.animations && gltf.animations.length > 0) {
        masterAstronautModel.animations = gltf.animations;
    }
}, undefined, (error) => console.error(error));

function playEmoteForPlayer(playerId, emoteIdx) {
    if (emoteIdx === -1) return;

    const targetClipName = EMOTE_CLIPS[emoteIdx];
    const targetGroup = remotePlayers.get(playerId);
    const actions = playerActions.get(playerId);

    if (targetGroup && actions && actions[targetClipName]) {
        const currentGroupState = targetGroup.userData.currentGroupState;
        if (currentGroupState === "Death" || currentGroupState === targetClipName) return;

        if (actions[currentGroupState]) actions[currentGroupState].fadeOut(0.1);

        const emoteAction = actions[targetClipName];
        emoteAction.reset().setLoop(THREE.LoopOnce);
        emoteAction.clampWhenFinished = true;
        emoteAction.fadeIn(0.1).play();

        targetGroup.userData.currentGroupState = targetClipName;
        targetGroup.userData.isEmoting = true;
    }
}

// ==========================================
// 3. 웹소켓 데이터 수신 및 '실시간 상태 머신' 연산
// ==========================================
// 🌟 HTTPS 도메인 혼합 콘텐츠 대응을 위한 프로토콜 가드 필터
const isSecure = window.location.protocol === 'https:';
const wsProtocol = isSecure ? 'wss://' : 'ws://';
const socket = new WebSocket(`${wsProtocol}${window.location.host}/ws/game`);

socket.onmessage = (event) => {
    const payload = event.data;

    if (payload.startsWith("INIT")) {
        const tokens = payload.split(',');
        myClientId = tokens[1].trim();
        document.getElementById('my-id').innerText = `내 ID: ${myClientId}`;
        return;
    }

    const tokens = payload.split('|');

    if (tokens[0] === 'EMOTE_BROADCAST') {
        const [playerId, emoteIdxStr] = tokens[1].split(',');
        const emoteIdx = parseInt(emoteIdxStr);
        if (playerId === myClientId) {
            const myGroup = remotePlayers.get(myClientId);
            if (myGroup && myGroup.userData.isEmoting) return;
        }
        playEmoteForPlayer(playerId, emoteIdx);
        return;
    }

    if (tokens[0] === 'TICK') {
        const activePlayerIds = new Set();
        const activeBulletIds = new Set();
        let infoText = "";

        for (let i = 1; i < tokens.length; i++) {
            const data = tokens[i].split(',');
            const type = data[0];

            // 👤 [플레이어 데이터 처리 분기]
            if (type === 'P') {
                const [ , id, xStr, yStr, zStr, hpStr, yawStr, crouchStr] = data;
                const posX = parseFloat(xStr);
                const posY = parseFloat(yStr);
                const posZ = parseFloat(zStr);
                const playerYaw = parseFloat(yawStr);

                // 💡 [복구] 서버의 crouchState 및 높이 기반 앉기 판정 동기화
                const isCrouching = (crouchStr && crouchStr.trim() === "1") && (posY <= 0.05);
                activePlayerIds.add(id);

                infoText += `플레이어 [${id.substring(0,5)}]: HP ${hpStr} ${isCrouching ? '<span style="color:#ffff00;">[앉음]</span>' : ''}<br/>`;

                if (!remotePlayers.has(id)) {
                    const playerGroup = new THREE.Group();

                    // 껍데기 메쉬 기본 설정
                    const dummyMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1.8, 1), new THREE.MeshStandardMaterial({ visible: false }));
                    dummyMesh.position.y = 0.9; dummyMesh.name = "skin"; playerGroup.add(dummyMesh);

                    // 💡 [복구] 앉기 대응 가상 히트박스 와이어프레임 구조 생성 (디버깅용)
                    const hitboxGeo = new THREE.CylinderGeometry(BASE_HIT_RADIUS, BASE_HIT_RADIUS, 1.4, 8, 1, true);
                    const hitboxMat = new THREE.MeshBasicMaterial({ color: 0xff0000, wireframe: true, visible: false });
                    const hitboxMesh = new THREE.Mesh(hitboxGeo, hitboxMat);
                    hitboxMesh.name = "hitbox_wire";
                    playerGroup.add(hitboxMesh);

                    scene.add(playerGroup);
                    remotePlayers.set(id, playerGroup);
                    playerGroup.userData = { lastX: posX, lastZ: posZ, currentGroupState: "Idle", isEmoting: false };
                }

                const targetGroup = remotePlayers.get(id);
                const deltaX = posX - targetGroup.userData.lastX;
                const deltaZ = posZ - targetGroup.userData.lastZ;
                const distanceMoved = Math.sqrt(deltaX * deltaX + deltaZ * deltaZ);

                targetGroup.userData.lastX = posX; targetGroup.userData.lastZ = posZ;
                targetGroup.position.set(posX, posY, posZ);

                if (!targetGroup.userData.isEmoting) targetGroup.rotation.y = playerYaw;

                // 💡 [복구] 앉기 상태에 따른 디버그용 히트박스 실시간 스케일/위치 다운사이징 제어
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
                    targetGroup.remove(targetGroup.getObjectByName("skin"));
                    const newSkin = masterAstronautModel.clone(); newSkin.name = "skin";

                    // 🌟 캐릭터 메쉬 복제 시 맵 지형 위에 발그림자가 떨어지도록 옵션 설정
                    newSkin.traverse(c => {
                        if (c.isMesh) {
                            c.castShadow = true;
                            c.receiveShadow = true;
                            if (id === myClientId) c.layers.set(1);
                        }
                    });
                    targetGroup.add(newSkin);

                    if (masterAstronautModel.animations && masterAstronautModel.animations.length > 0) {
                        const mixer = new THREE.AnimationMixer(newSkin); mixer.playerId = id;
                        mixer.addEventListener('finished', (e) => {
                            if (EMOTE_CLIPS.includes(e.action.getClip().name)) {
                                targetGroup.userData.isEmoting = false;
                                targetGroup.userData.currentGroupState = "Idle";
                                const actions = playerActions.get(id);
                                if (actions && actions["Idle"]) { e.action.fadeOut(0.1); actions["Idle"].reset().fadeIn(0.1).play(); }
                            }
                        });
                        mixers.push(mixer);
                        const actions = {}; masterAstronautModel.animations.forEach(c => actions[c.name] = mixer.clipAction(c));
                        playerActions.set(id, actions);
                        if (actions["Idle"]) actions["Idle"].play();
                    }
                }

                const actions = playerActions.get(id);
                if (actions) {
                    let targetState = "Idle";
                    if (parseInt(hpStr) <= 0) {
                        targetState = "Death"; targetGroup.userData.isEmoting = false;
                        if (actions["Death"]) { actions["Death"].setLoop(THREE.LoopOnce).clampWhenFinished = true; }
                    } else if (targetGroup.userData.isEmoting) {
                        targetState = targetGroup.userData.currentGroupState;
                    } else if (posY > 0.05) {
                        targetState = distanceMoved > 0.02 ? (actions["WalkJump"] ? "WalkJump" : "Jump") : (actions["Jump"] ? "Jump" : "Idle");
                        if (actions[targetState]) actions[targetState].setLoop(THREE.LoopOnce).clampWhenFinished = true;
                    }
                    // 💡 [복구] 상태 머신에서 앉은(Sitting) 애니메이션 정상 트랜지션 처리
                    else if (isCrouching) {
                        targetState = "Sitting";
                        if (actions["Sitting"]) actions["Sitting"].setLoop(THREE.LoopOnce).clampWhenFinished = true;
                    } else {
                        targetState = distanceMoved > 0.02 ? (actions["Walking"] ? "Walking" : "Running") : "Idle";
                    }

                    if (targetGroup.userData.currentGroupState !== targetState) {
                        const cur = actions[targetGroup.userData.currentGroupState]; const nxt = actions[targetState];
                        if (cur && nxt) { nxt.reset().play(); cur.crossFadeTo(nxt, 0.12, true); }
                        targetGroup.userData.currentGroupState = targetState;
                    }
                }

                // 💡 [복구] 1인칭 플레이어의 시점 카메라 눈높이 실시간 다운 버정 (앉았을 때 0.45, 서있을 때 0.85)
                if (id === myClientId) { camera.position.set(posX, posY + (isCrouching ? 0.45 : 0.85), posZ); }
            }
            // 🚀 총알 데이터 처리 분기
            else if (type === 'B') {
                const [ , bId, xStr, yStr, zStr] = data;
                const posX = parseFloat(xStr);
                const posY = parseFloat(yStr);
                const posZ = parseFloat(zStr);
                activeBulletIds.add(bId);

                if (!remoteBullets.has(bId)) {
                    const geometry = new THREE.SphereGeometry(0.15, 8, 8);
                    const material = new THREE.MeshBasicMaterial({ color: 0xffff00 });
                    const sphere = new THREE.Mesh(geometry, material);
                    scene.add(sphere);
                    remoteBullets.set(bId, sphere);
                }
                remoteBullets.get(bId).position.set(posX, posY, posZ);
            }
        }

        // 🧹 청소 루프
        for (const id of remotePlayers.keys()) {
            if (!activePlayerIds.has(id)) {
                scene.remove(remotePlayers.get(id)); remotePlayers.delete(id);
                mixers = mixers.filter(m => m.playerId !== id); playerActions.delete(id);
            }
        }
        for (const bId of remoteBullets.keys()) {
            if (!activeBulletIds.has(bId)) {
                scene.remove(remoteBullets.get(bId)); remoteBullets.delete(bId);
            }
        }
        document.getElementById('players-info').innerHTML = infoText;
    }
};

// ==========================================
// 4. Pointer Lock (FPS 마우스 시선 연동)
// ==========================================
renderer.domElement.addEventListener('click', () => {
    if (!isRadialMenuOpen) {
        renderer.domElement.requestPointerLock();
    }
});

document.addEventListener('mousemove', (event) => {
    if (isRadialMenuOpen) return;
    if (document.pointerLockElement !== renderer.domElement) return;

    const myGroup = remotePlayers.get(myClientId);
    if (myGroup && myGroup.userData.isEmoting) return;

    const sensitivity = 0.0022;
    yaw -= event.movementX * sensitivity;
    pitch -= event.movementY * sensitivity;
    pitch = Math.max(-Math.PI / 2.2, Math.min(Math.PI / 2.2, pitch));

    const target = new THREE.Vector3();
    target.x = Math.sin(yaw) * Math.cos(pitch); target.y = Math.sin(pitch); target.z = Math.cos(yaw) * Math.cos(pitch);
    camera.lookAt(camera.position.clone().add(target));

    if (socket.readyState === WebSocket.OPEN && myClientId) {
        socket.send(`LOOK,${yaw.toFixed(4)}`);
    }
});

// ==========================================
// 5. 키보드 입력 및 송신계 (WASD + Shift 웅크리기 완전 결합)
// ==========================================
const inputState = { w: 0, a: 0, s: 0, d: 0 };
const sendInput = () => {
    if (socket.readyState !== WebSocket.OPEN || !myClientId) return;
    const myGroup = remotePlayers.get(myClientId);
    if (myGroup && myGroup.userData.isEmoting) return;
    socket.send(`INPUT,${inputState.w},${inputState.s},${inputState.a},${inputState.d}`);
};

window.addEventListener('keydown', (e) => {
    const key = e.key.toLowerCase();

    if (key === 'g') {
        const myGroup = remotePlayers.get(myClientId);
        if (myGroup && myGroup.userData.isEmoting) return;

        if (!isRadialMenuOpen) {
            isRadialMenuOpen = true;
            selectedSectorIndex = -1;

            document.exitPointerLock();

            radialMenuUI.style.display = 'block';
            document.querySelectorAll('.radial-sector, .radial-center').forEach(el => el.classList.remove('active'));
        }
        return;
    }

    if (isRadialMenuOpen) return;

    const myGroup = remotePlayers.get(myClientId);
    if (myGroup && myGroup.userData.isEmoting) return;

    if (['w','a','s','d'].includes(key)) { inputState[key] = 1; sendInput(); }
    if (e.key === ' ' || e.code === 'Space') { if (socket.readyState === WebSocket.OPEN) socket.send("JUMP"); }

    // 💡 [복구 완료] Shift 누름 감지 시 공중 상태가 아닐 때 CROUCH,1 패킷 송신
    if (e.key === 'Shift') {
        e.preventDefault();
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

    if (key === 'g') {
        if (isRadialMenuOpen) {
            isRadialMenuOpen = false;
            radialMenuUI.style.display = 'none';

            if (selectedSectorIndex !== -1) {
                playEmoteForPlayer(myClientId, selectedSectorIndex);
                if (socket.readyState === WebSocket.OPEN && myClientId) {
                    socket.send(`EMOTE,${selectedSectorIndex}`);
                }
            } else {
                console.log("[라디알 메뉴] 조작 취소됨.");
            }

            renderer.domElement.requestPointerLock();
        }
        return;
    }

    if (['w','a','s','d'].includes(key)) { inputState[key] = 0; sendInput(); }

    // 💡 [복구 완료] Shift 키를 떼었을 때 CROUCH,0 패킷을 전송하여 정상 기립
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
// 6. 슈팅 및 루프
// ==========================================
renderer.domElement.addEventListener('mousedown', () => {
    if (isRadialMenuOpen) return;
    if (document.pointerLockElement !== renderer.domElement) return;
    const myGroup = remotePlayers.get(myClientId);
    if (myGroup && myGroup.userData.isEmoting) return;

    camera.getWorldDirection(cameraDirection);
    socket.send(`SHOOT,${cameraDirection.x.toFixed(4)},${cameraDirection.y.toFixed(4)},${cameraDirection.z.toFixed(4)}`);
});

function animate() {
    requestAnimationFrame(animate);
    if (mixers.length > 0) {
        const delta = clock.getDelta();
        for (let i = 0; i < mixers.length; i++) mixers[i].update(delta);
    }
    renderer.render(scene, camera);
}
animate();