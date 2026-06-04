# 🚀 3D Socket FPS - Multi-Play Game

> **실시간 웹소켓(WebSocket) 기반의 3D 1인칭 멀티플레이어 슈팅 게임 프로젝트입니다.**
> 자바 스프링 부트와 Three.js를 결합하여 플레이어 간의 실시간 위치 동기화, 액션 애니메이션 및 상태 동기화를 구현했습니다.

👉 **[실시간 웹 라이브 데모 플레이하기]**(https://socket-shooter-java.onrender.com)
*(※ Render 무료 플랜 특성상 최초 접속 시 서버가 깨어나는 데 약 30초~1분 정도 소요될 수 있습니다.)*

---

## 🛠️ Tech Stacks (기술 스택)

### Backend
* **Language:** Java 21 (Toolchain)
* **Framework:** Spring Boot 4.0.6
* **Dependency Management:** Gradle
* **Protocol:** Spring WebSocket (ConcurrentWebSocketSessionDecorator를 통한 스레드 안전성 확보)

### Frontend
* **Graphics Library:** Three.js (r160)
* **Asset Loaders:** GLTFLoader + DRACOLoader (지형 데이터 압축 해제 및 고속 로딩)
* **Template Engine:** Thymeleaf

### DevOps / Deployment
* **Infrastructure:** Render.com (Web Service)
* **Containerization:** Docker (Multi-stage 빌드 최적화)
* **Security:** SSL/TLS 프록시 포워딩을 통한 **WSS(Secure WebSocket)** 연동

---

## ✨ Key Features (주요 기능)

### 1. 실시간 고속 동기화 (Server-Side Game Loop)
* 서버단에서 `Game-Tick-Thread`가 약 **33ms(30 FPS)** 주기로 물리를 연산하고, 룸 내부의 모든 세션에 스냅샷을 브로드캐스팅합니다.
* 클라이언트는 수신된 데이터를 바탕으로 실시간 상태 머신(State Machine)을 돌려 끊김 없는 멀티플레이를 구현합니다.

### 2. 드라코(Draco) 압축 기반 3D 오픈소스 지형 로드
* 정교한 3D 도시 건물 맵(`LittlestTokyo.glb`)을 `DRACOLoader`를 통해 실시간 압축 해제하며 고속으로 렌더링합니다.
* `THREE.Box3(바운딩 박스)` 수학적 연산을 활용하여, 맵 에셋의 고유 중심점과 상관없이 **지형 밑바닥이 플레이어 고도(Y=0)에 완벽하게 일치하도록 자동 정렬**됩니다.

### 3. 입체 조명 및 그림자 시스템
* `PCFSoftShadowMap` 기반의 다이렉셔널 라이트를 적용하여 지형 구조물과 실시간으로 움직이는 플레이어 모델 간에 정교한 **발그림자(Shadow)** 연동을 구현, 평면적인 느낌을 완전히 탈피했습니다.

### 4. 확장된 캐릭터 컨트롤 및 애니메이션 동기화
* **웅크리기(Crouch):** `Shift` 키 입력 시 1인칭 카메라 눈높이 보정($0.85 \rightarrow 0.45$) 및 디버그 히트박스 실시간 다운사이징이 동기화되며, `Sitting` 애니메이션으로 부드럽게 트랜지션됩니다.
* **라디알 감정표현 메뉴:** `G` 키를 눌러 활성화되는 UI 메뉴를 통해 Dance, No, ThumbsUp, Yes 모션을 즉시 타인에게 전파합니다. (모션 중 관성 이동 방지를 위해 서버 벡터 초기화 가드 처리)

---

## 🎮 How to Play (조작 방법)

| 입력 키 | 행동                              |
| :--- |:--------------------------------|
| **마우스 클릭** | 1인칭 시점 락(Pointer Lock) 활성화 및 공격 |
| **마우스 이동** | 시선 회전 (Yaw / Pitch 연동)          |
| **W, A, S, D** | 전후좌우 이동                         |
| **Space** | 점프                              |
| **Shift (Hold)** | 웅크리기 (앉기)                       |
| **마우스 좌클릭** | 슈팅 (총알 발사)                      |
| **G (Hold)** | 라디알 감정표현 메뉴 오픈 (호버링 후 키를 떼면 발동) |
| **ESC** | 마우스 락 해제 및 메뉴 탈출                |

---