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

// FPS 시선 제어 변수
let yaw = 0;
let pitch = 0;
const cameraDirection = new THREE.Vector3();

// ==========================================
// ⭐️ [3D 마스터 모델 로드 파트]
// ==========================================
const gltfLoader = new GLTFLoader();
const modelUrl = '/Astronaut.glb'; // 로컬 서버 정적 경로
let masterAstronautModel = null;   // 모든 플레이어가 복사해서 쓸 원본 모델 보관함

console.log("[3D 로더] 로컬 서버에서 우주비행사 원본 모델 로드 시작...");
gltfLoader.load(
    modelUrl,
    (gltf) => {
        masterAstronautModel = gltf.scene;
        // ⭐️ 모델 크기를 기존 0.4에서 0.6으로 조금 더 키워 듬직하게 만듭니다.
        masterAstronautModel.scale.set(0.6, 0.6, 0.6);
        masterAstronautModel.position.set(0, 0, 0);
        console.log("[3D 로더] 원본 스킨 준비 완료!");
    },
    undefined,
    (error) => console.error("[3D 로더] 에러 발생:", error)
);

// ==========================================
// 2. 웹소켓 실시간 데이터 수신 및 캐릭터 스와프
// ==========================================
const socket = new WebSocket(`ws://${window.location.host}/ws/game`);

socket.onmessage = (event) => {
    const payload = event.data;

    if (payload.startsWith("INIT")) {
        const tokens = payload.split(',');
        myClientId = tokens[1].trim();
        document.getElementById('my-id').innerText = `내 ID: ${myClientId} (접속 완료)`;
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

                // A. 처음 접속한 플레이어라면 뼈대 그룹 생성
                if (!remotePlayers.has(id)) {
                    const playerGroup = new THREE.Group();

                    // ⭐️ 모델이 아직 로드 중일 때 보여줄 임시 상자 박스
                    const dummyGeo = new THREE.BoxGeometry(1.0, 1.8, 1.0);
                    const dummyMat = new THREE.MeshStandardMaterial({
                        color: id === myClientId ? 0x00ff00 : 0xff0000,
                        wireframe: true
                    });
                    const dummyMesh = new THREE.Mesh(dummyGeo, dummyMat);
                    dummyMesh.position.y = 0.9;
                    dummyMesh.name = "skin"; // 나중에 지우기 쉽게 이름표 부착
                    playerGroup.add(dummyMesh);

                    scene.add(playerGroup);
                    remotePlayers.set(id, playerGroup);
                }

                const targetGroup = remotePlayers.get(id);

                // ⭐️ [이동/회전 동기화] 이제 우주비행사(혹은 임시 박스)가 내 조작대로 움직입니다!
                targetGroup.position.set(posX, posY, posZ);

                // 3D 모델의 실제 앞방향과 맞추기 위해 180도(Math.PI) 회전 오프셋 추가
                targetGroup.rotation.y = playerYaw;

                // ⭐️ [실시간 스와프 핵심]
                // 마스터 모델 다운로드가 끝났고, 아직 이 캐릭터가 임시 상자(wireframe)를 들고 있다면?
                if (masterAstronautModel && targetGroup.getObjectByName("skin") && targetGroup.getObjectByName("skin").isMesh) {
                    // 1. 기존 임시 상자 제거
                    const oldSkin = targetGroup.getObjectByName("skin");
                    targetGroup.remove(oldSkin);

                    // 2. 원본 우주비행사 모델을 똑같이 복사(Clone)
                    const newSkin = masterAstronautModel.clone();
                    newSkin.name = "skin";

                    // 3. 내 1인칭 화면에서는 내 몸통 모델이 눈을 가리지 않게 투명 처리 (상대방 화면엔 잘 보임)
                    if (id === myClientId) {
                        newSkin.traverse((child) => {
                            if (child.isMesh) {
                                child.layers.set(1); // 내 카메라 레이어에서 숨기기
                            }
                        });
                    }

                    // 4. 캐릭터 그룹에 진짜 우주비행사 스킨 주입!
                    targetGroup.add(newSkin);
                    console.log(`[스킨 엔진] 유저 [${id.substring(0,5)}]에게 우주비행사 슈트를 장착했습니다.`);
                }

                // 1인칭 카메라 위치 고정 (눈높이 보정)
                if (id === myClientId) {
                    camera.position.set(posX, posY + 1.6, posZ);
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

        // 가비지 컬렉터
        for (const id of remotePlayers.keys()) {
            if (!activePlayerIds.has(id)) { scene.remove(remotePlayers.get(id)); remotePlayers.delete(id); }
        }
        for (const id of remoteBullets.keys()) {
            if (!activeBulletIds.has(id)) { scene.remove(remoteBullets.get(id)); remoteBullets.delete(id); }
        }
        document.getElementById('players-info').innerHTML = infoText;
    }
};

// ==========================================
// 3. Pointer Lock (FPS 마우스 시선 연동)
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
// 4. 키보드 입력 관리 (WASD & Space)
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
// 5. FPS 발사 연산 패킷 전송
// ==========================================
renderer.domElement.addEventListener('mousedown', (event) => {
    if (document.pointerLockElement !== renderer.domElement) return;
    if (socket.readyState !== WebSocket.OPEN || !myClientId) return;

    camera.getWorldDirection(cameraDirection);
    socket.send(`SHOOT,${cameraDirection.x.toFixed(4)},${cameraDirection.y.toFixed(4)},${cameraDirection.z.toFixed(4)}`);
});

// ==========================================
// 6. 메인 프레임 애니메이션 루프
// ==========================================
function animate() {
    requestAnimationFrame(animate);
    renderer.render(scene, camera);
}
animate();

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});