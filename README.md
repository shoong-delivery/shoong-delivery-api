# shoong-delivery-api

Shoong 배달 서비스의 **배달(delivery) 마이크로서비스**입니다.
조리 완료된 주문의 배차·배달 완료를 처리하는 주문 흐름의 마지막 단계입니다.
외부에 노출되지 않고 서비스 간 내부 호출(ClusterIP)로만 동작합니다.

---

## Shoong 프로젝트

Shoong은 음식 배달 도메인을 여러 개의 마이크로서비스로 나눠 구현하고,
Kubernetes(EKS) 위에서 GitOps로 배포·운영하는 클라우드 인프라 프로젝트입니다.

주문 → 조리 → 배달 → 알림으로 이어지는 흐름을 서비스 단위로 분리하고,
그 아래 인프라(IaC) → 이미지 빌드(CI) → 배포(GitOps/CD)까지의 파이프라인을 직접 구성했습니다.

### 레포지토리 구성

전체 시스템은 역할별로 레포지토리가 나뉘어 있습니다.

**플랫폼 / 인프라**

| 레포 | 역할 |
| --- | --- |
| [shoong-terraform](https://github.com/shoong-delivery/shoong-terraform) | AWS 인프라 프로비저닝 (IaC) |
| [shoong-gitops](https://github.com/shoong-delivery/shoong-gitops) | ArgoCD 앱 정의 / Helm 차트 관리 (CD) |

**애플리케이션**

| 레포 | 역할 | 포트 |
| --- | --- | --- |
| [shoong-order-api](https://github.com/shoong-delivery/shoong-order-api) | 주문 서비스 | 3001 |
| [shoong-kitchen-api](https://github.com/shoong-delivery/shoong-kitchen-api) | 주방 서비스 | 3002 |
| [shoong-delivery-api](https://github.com/shoong-delivery/shoong-delivery-api) | 배달 서비스 | 3003 |
| [shoong-notification-api](https://github.com/shoong-delivery/shoong-notification-api) | 알림 서비스 | 3004 |
| [shoong-batch](https://github.com/shoong-delivery/shoong-batch) | 오래된 주문 정리 배치 (CronJob) | - |
| [shoong-frontend](https://github.com/shoong-delivery/shoong-frontend) | 프론트엔드 | - |

### 레포 간 관계

```
shoong-terraform ──(EKS / ECR / RDS / OIDC / SSM 생성)──┐
                                                        ▼
  앱 레포 (order·kitchen·delivery·notification·batch·frontend)
        └─ GitHub Actions(OIDC)로 이미지 빌드 → ECR push
                                                        ▼
                                                shoong-gitops
                                    (ArgoCD가 Helm 차트로 EKS에 배포)
```

- **shoong-terraform** 이 클러스터·레지스트리·DB·CI 인증 기반을 먼저 만든다.
- 각 **앱 레포**는 GitHub Actions에서 OIDC로 AWS에 인증해 이미지를 빌드하고 ECR에 푸시한다.
- **shoong-gitops** 의 ArgoCD가 변경을 감지해 EKS에 배포한다.

---

## 이 레포의 역할

배달 도메인을 담당합니다. 주방이 조리를 끝내면 `POST /assign` 으로 배차를 받고, 배달이 끝나면 `POST /complete` 로 주문 흐름을 종료합니다.

```
kitchen ─▶ delivery POST /assign ─┬─▶ order        (PATCH /:id/status : DELIVERING)
                                  └─▶ notification  (배달 시작 알림)

delivery POST /complete ─┬─▶ order        (PATCH /:id/status : DELIVERED)
                         └─▶ notification  (배달 완료 알림)
```

`DELIVERED` 가 주문 상태의 마지막 단계이며, 이 서비스가 흐름을 마무리합니다.

## 기술 스택

- **런타임** — Node.js 20, TypeScript, Express 5
- **DB** — PostgreSQL (Prisma ORM, `Delivery` 테이블)
- **서비스 간 호출** — axios
- **관측성** — pino(구조화 로그) · prom-client(메트릭) · OpenTelemetry(분산 트레이싱)

## API

서비스 간 내부 호출 전용이며 외부에 노출되지 않습니다(ClusterIP).

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| `GET` | `/health` | 헬스체크 |
| `GET` | `/metrics` | Prometheus 스크랩 엔드포인트 |
| `POST` | `/assign` | 배달 시작(배차) — body `{ order_id }` |
| `POST` | `/complete` | 배달 완료 — body `{ order_id }` |

### 멱등성 가드

`/complete` 는 이미 `DELIVERED` 인 주문이면 상태 변경·체이닝 호출 없이 즉시 반환합니다.
배치 재시도나 클라이언트 중복 호출 시 중복 알림을 막기 위한 처리입니다.

## 관측성 (Observability)

- **로그** — pino-http 구조화 로깅. `/health`·`/metrics` 제외, 4xx warn / 5xx error로 레벨 분기.
- **메트릭** — `/metrics` 에서 노출:
  - `delivery_assign_total{result}` — 배차 시작 성공/실패 카운터
  - `delivery_complete_total{result}` — 배달 완료 카운터 (멱등성 가드로 인한 `skipped` 포함)
  - `delivery_duration_seconds` — 배달 소요시간 히스토그램 (버킷 2·5·10·15·30·60분, 5분 임계값 분포 관찰용)
- **트레이싱** — `instrumentation.js` 를 `--require` 로 먼저 로드해 OTLP(gRPC)로 트레이스 전송.

## CI/CD

[.github/workflows/ci.yml](.github/workflows/ci.yml) — 브랜치 전략에 따라 동작합니다.

- **PR** → lint · typecheck · test 실행. `main` 대상 PR은 `develop` 에서만 머지 가능하도록 강제.
- **`develop` push** → Docker 빌드 → Trivy 스캔(CRITICAL/HIGH) → ECR push(`dev-{sha}`, 리포 `shoong-delivery`) → [shoong-gitops](https://github.com/shoong-delivery/shoong-gitops) 의 `envs/dev/shoong-delivery.yaml` 이미지 태그 갱신.
- **`main` push** → 동일 흐름으로 `prod-{sha}` 태그 배포.
- AWS 인증은 OIDC(`AWS_ROLE_ARN`)로 처리하며, 각 단계 결과를 Slack으로 통지.

## 로컬 실행

```bash
npm install
npx prisma generate

docker compose up      # 로컬 DB 포함
npm run dev            # 개발 모드 (별도 DB 필요)
```

### 주요 환경변수

| 변수 | 설명 |
| --- | --- |
| `PORT` | 서비스 포트 (기본 3003) |
| `DATABASE_URL` | PostgreSQL 접속 문자열 |
| `ORDER_API_URL` | 주문 서비스 base URL (상태 갱신) |
| `NOTIFICATION_API_URL` | 알림 서비스 base URL |

> 운영 환경에서는 위 값들이 SSM Parameter Store / Secrets Manager에 저장되고, External Secrets Operator가 Pod에 주입합니다.
