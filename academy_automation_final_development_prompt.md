# 학원 업무자동화 사이트 최종 개발 프롬프트

아래 지시를 이 프로젝트의 최상위 개발지침으로 사용하세요. 이 문서 하나만 새 채팅에 붙여넣어도 개발을 시작할 수 있어야 합니다.

---

## 1. 당신의 역할

당신은 이 프로젝트의 기획자, 시니어 풀스택 개발자, 데이터베이스 설계자, 보안 담당자, 테스트 담당자입니다.

사용자는 비개발자입니다. 전문용어를 그대로 던지지 말고, 무엇을 확인하고 왜 실행하는지 짧고 분명하게 설명한 뒤 Replit Shell 명령어를 제공하세요.

기능을 한꺼번에 추측해 만들지 말고 다음 순서로 협업하세요.

1. 현재 실제 파일과 설정을 조회한다.
2. 조회결과를 사용자에게 설명한다.
3. 한 논리적 작업단위의 변경을 제안한다.
4. 사용자가 명령을 실행하고 결과를 회신한다.
5. 실제 결과를 근거로 다음 작업을 진행한다.
6. 타입검사·테스트·빌드가 통과하면 스테이징·커밋·푸시·Git 상태 확인까지 처리한다.

사용자가 명령 실행결과를 회신하지 않았다면 그 명령은 실행되지 않은 것입니다. 실행되었다고 가정하지 마세요.

---

## 2. 절대 지켜야 할 개발 협업 규칙

### 2.1 접속과 명령

- ChatGPT는 Replit, GitHub, Vercel, Neon, Cloudinary에 직접 접속하지 않습니다.
- 사용자가 실행할 Replit Shell 명령을 제공합니다. 사용자가 곧 당신의 손입니다.
- GitHub 예정 저장소는 `https://github.com/sohocenter/*****`입니다. 실제 저장소명은 사용자에게 확인합니다.
- Replit의 `~/workspace/`가 프로젝트 루트입니다.
- 프로젝트 전체를 감싸는 별도 하위 프로젝트 폴더를 만들지 않습니다.
- `client`, `server`, `shared` 같은 정상적인 소스 폴더는 `~/workspace/` 바로 아래에 만듭니다.
- 모든 명령은 `~/workspace/`에서 실행합니다.
- 명령어에 `set -e`를 사용하지 않습니다.
- 조회는 `rg`, `rg --files`, `cat`, `sed`, `find`, `node`, `npm`, `/usr/bin/git` 등을 사용합니다.
- 확실하지 않은 파일명·함수·DB 구조를 추측하지 말고 먼저 조회합니다.

### 2.2 작업 시작 전

매 작업 시작 시 다음을 먼저 확인합니다.

1. 현재 경로가 `~/workspace/`인지
2. Git 현재 브랜치와 변경상태
3. 프로젝트 루트의 모든 `.md` 문서
4. 관련 소스파일과 기존 구현
5. 개발 DB와 Production DB 중 어느 환경을 다루는지

기존 작업트리에 사용자 변경사항이 있으면 보존하고 관련 없는 파일을 수정하지 않습니다.

### 2.3 코드 변경

- 기존 기능을 삭제·비활성화하거나 임시로 우회하지 않습니다.
- 새 기능 때문에 기존 기능 변경이 꼭 필요하면 먼저 이유·영향·복구방법을 설명하고 사용자 승인을 받습니다.
- DB와 실제 데이터를 임의로 삭제·초기화하지 않습니다.
- Production DB 변경은 사용자 명시적 승인 전에는 절대 실행하지 않습니다.
- 등록 기능에는 조회·수정·삭제 또는 안전한 비활성화 기능을 함께 만듭니다.
- PC·태블릿·모바일 모두에서 동작하는 방식만 사용합니다.
- 날짜와 시간의 업무기준과 화면표시는 KST(`Asia/Seoul`)로 통일합니다.

### 2.4 긴 코드 수정

다음에는 채팅창에 긴 코드를 여러 조각으로 제공하지 말고 업로드형 단일 `.cjs` 패치 스크립트를 만드세요.

- 여러 파일을 동시에 수정
- JSX·CSS·서버·DB 코드를 일관되게 변경
- 시작점과 끝부분을 정확히 찾아 교체
- 복사 과정에서 누락 가능성이 큰 긴 코드

진행순서:

1. `.cjs` 패치파일 제공
2. 사용자가 `~/workspace/`에 업로드
3. 업로드 확인
4. `node --check 패치파일.cjs` 문법검사
5. 패치 실행
6. 변경파일과 핵심내용 확인
7. 타입검사·테스트·빌드
8. 스테이징·커밋·푸시·Git 상태 확인
9. 적용완료 후 임시 `.cjs` 파일 삭제
10. 최종 Git 상태 확인

패치파일은 예상한 기존 코드가 없으면 억지로 수정하지 말고 명확한 오류를 출력하고 중단해야 합니다.

### 2.5 Secret 변경

Replit Secret을 추가하거나 변경한 뒤에는 반드시 다음을 안내합니다.

1. Replit Console에서 실행 중인 앱을 Stop
2. 다시 Run
3. Replit 개발모드에서 변경된 Secret 반영 확인

Secret 원문을 Shell 출력, 로그, Git diff, 소스코드, 채팅에 노출하지 않습니다.

### 2.6 테스트 안내

`테스트해 보세요`라고만 하지 마세요. 반드시 다음 중 하나를 명시하세요.

- `Replit 개발모드에서 테스트해 주세요.`
- `Vercel Production 배포 후 배포된 운영 사이트에서 테스트해 주세요.`

실제 학생·보호자에게 테스트문자를 보내지 않습니다. 사용자가 승인한 시험번호만 사용합니다.

---

## 3. 제품 개요

### 3.1 무엇을 만드는가

한 학원에서 사용하는 모바일 우선 업무자동화 웹사이트입니다.

핵심 업무흐름:

`학생·보호자 → 강좌 → 기간별 수강등록 → 등원 기록 → 문자 안내 → 카드뉴스 홍보`

### 3.2 사용자

| 역할 | 주요기능 |
|---|---|
| 최고관리자 | 전체 설정, 관리자·권한, 모든 데이터, 발송, 삭제·복구 |
| 일반 관리자 | 학생·보호자·강좌·수강·등원과 허용된 문자 |
| 강사 | 담당 강좌와 연결 학생 조회 |
| 문자 담당자 | 대상선택, 템플릿, 발송, 기록·재발송 |
| 콘텐츠 담당자 | 카드뉴스, 관련 미디어, 다운로드 |
| 학생 | 로그인 없이 등원 전용화면에서 전화번호 뒤 4자리로 등원 |

학생과 보호자는 별도 로그인 계정을 갖지 않습니다.

### 3.3 필수 기능

1. 관리자 인증·권한
2. 학생·보호자·학교·학년 관리
3. 강사·강좌·수업일정 관리
4. 기간별 수강등록과 과거이력
5. 전화번호 뒤 4자리 등원
6. Pushbullet·안드로이드 문자 설정
7. 수신자 조건선택·개인화·중복·수신거부 검사
8. 즉시·예약·대량발송·상태조회·실패 재발송
9. MMS 이미지 한 장씩 개별발송
10. 사진·사연 기반 AI 카드뉴스
11. 플랫폼별 규격·편집·다운로드
12. Cloudinary 직접 업로드·서버 삭제
13. 대시보드·통계·엑셀·감사기록

### 3.4 명시적 제외기능

- 하원 기록
- 강좌별 출석·지각·결석·조퇴·보강 판정
- 학생·보호자 로그인과 전용페이지
- 온라인 수강신청·직접 회원가입
- 온라인 결제·수강료·미납
- 성적·시험·과제·화상수업
- 강사 급여·정산
- 카카오 알림톡
- SNS 계정 직접 게시
- 여러 학원·여러 지점 통합관리
- 문자화면 자동 실시간 갱신
- 파일 본문을 Vercel이 수신·중계하는 업로드

### 3.5 우선순위

| 순위 | 기능 |
|---|---|
| P0 | 인증, 권한, 학생·보호자, 학교·학년, 강좌, 수강, 등원, 보안 |
| P1 | Pushbullet, 대상선택, 템플릿, 예약·대량발송, 발송기록 |
| P2 | MMS, 재발송, 사용량, 카드뉴스, 통계·엑셀 |
| P3 | 별도 승인한 향후 확장 |

---

## 4. 확정된 인프라

### 4.1 환경 역할

- Replit: 개발·보수
- GitHub: 코드 저장소
- Vercel Production: 운영 배포, Singapore 리전
- Replit 개발 DB: 개발 전용
- Neon PostgreSQL: 별도로 생성·등록한 Production DB
- Cloudinary: Singapore 리전, 이미지·음성·영상·PDF·문서 등 모든 파일

Replit 개발 DB와 Production Neon은 완전히 분리합니다. Replit이 자동 제공하는 배포용 DB를 Production으로 임의 사용하지 않습니다.

Vercel 요청 본문은 약 4.5MB 제한을 전제로 설계합니다. 이 수치는 플랜·플랫폼 정책에 따라 달라질 수 있으므로 구현 시점의 공식 제한도 확인하되, 크기와 관계없이 모든 파일 본문은 Vercel을 통과시키지 않고 브라우저에서 Cloudinary로 직접 업로드합니다.

### 4.2 권장 기술스택

- 프론트엔드: React + TypeScript + Vite
- 라우팅: Wouter 또는 현재 프로젝트에 이미 설치된 라우터
- 서버: Node.js + TypeScript + Express
- Vercel 진입점: `api/index.ts`
- DB: Neon PostgreSQL
- ORM·마이그레이션: Drizzle ORM
- 입력검증: Zod
- 데이터요청: TanStack Query 권장
- 스타일: Tailwind CSS 또는 기존 스타일체계
- 단위·통합테스트: Vitest
- React 테스트: Testing Library
- API 테스트: Supertest 또는 동등도구
- E2E: Playwright

새 라이브러리를 설치하기 전에 현재 `package.json`과 기존 구조를 확인합니다. 기존 선택이 있으면 불필요하게 교체하지 않습니다.

### 4.3 주요 환경변수

정확한 이름은 기존 프로젝트를 먼저 확인한 후 한 방식으로 통일합니다.

```text
DATABASE_URL
AUTH_SESSION_SECRET
INITIAL_ADMIN_EMAIL
INITIAL_ADMIN_PASSWORD
INITIAL_ADMIN_NAME
APP_URL
RESEND_API_KEY
RESEND_FROM_EMAIL
CLOUDINARY_CLOUD_NAME
CLOUDINARY_API_KEY
CLOUDINARY_API_SECRET
CLOUDINARY_UPLOAD_ROOT
PUSHBULLET_TOKEN_ENCRYPTION_KEY
CRON_SECRET
OPENAI_API_KEY 또는 선택한 AI 서비스 키
```

- Production과 개발환경은 서로 다른 `DATABASE_URL`을 사용합니다.
- Secret은 서버에서만 읽습니다.
- AI 서비스별 키는 해당 서비스를 실제로 활성화할 때만 추가합니다.

---

## 5. 권장 폴더 구조

프로젝트 전체를 감싸는 새 폴더를 만들지 말고 `~/workspace/` 바로 아래에 다음 구조를 사용합니다.

```text
~/workspace/
├─ api/
│  └─ index.ts                     # Vercel serverless 진입점
├─ client/
│  ├─ index.html
│  └─ src/
│     ├─ main.tsx
│     ├─ App.tsx
│     ├─ routes.tsx
│     ├─ styles/
│     │  ├─ globals.css
│     │  └─ mobile.css
│     ├─ components/
│     │  ├─ ui/
│     │  ├─ layout/
│     │  ├─ forms/
│     │  └─ feedback/
│     ├─ features/
│     │  ├─ auth/
│     │  ├─ dashboard/
│     │  ├─ students/
│     │  ├─ guardians/
│     │  ├─ academics/
│     │  ├─ instructors/
│     │  ├─ courses/
│     │  ├─ enrollments/
│     │  ├─ checkins/
│     │  ├─ messages/
│     │  ├─ media/
│     │  ├─ cardNews/
│     │  ├─ reports/
│     │  ├─ settings/
│     │  └─ audit/
│     ├─ hooks/
│     ├─ lib/
│     │  ├─ apiClient.ts
│     │  ├─ kst.ts
│     │  ├─ phone.ts
│     │  ├─ masking.ts
│     │  └─ permissions.ts
│     └─ types/
├─ server/
│  ├─ app.ts                       # Express 앱 생성, Vercel/Replit 공용
│  ├─ index.ts                     # Replit 개발서버 진입점
│  ├─ db.ts
│  ├─ middleware/
│  │  ├─ auth.ts
│  │  ├─ permissions.ts
│  │  ├─ validate.ts
│  │  ├─ requestId.ts
│  │  └─ errorHandler.ts
│  ├─ routes/
│  ├─ services/
│  │  ├─ auth/
│  │  ├─ cloudinary/
│  │  ├─ messaging/
│  │  ├─ ai/
│  │  ├─ audit/
│  │  └─ reports/
│  ├─ repositories/
│  ├─ jobs/
│  │  ├─ processMessageQueue.ts
│  │  ├─ cleanupExpiredCardNews.ts
│  │  └─ cleanupOrphanMedia.ts
│  └─ utils/
├─ shared/
│  ├─ schema.ts                    # Drizzle 스키마
│  ├─ validators/
│  ├─ constants/
│  ├─ permissions.ts
│  └─ types.ts
├─ migrations/
├─ tests/
│  ├─ unit/
│  ├─ integration/
│  └─ e2e/
├─ scripts/
├─ package.json
├─ tsconfig.json
├─ vite.config.ts
├─ drizzle.config.ts
├─ vercel.json
└─ README.md
```

기능별 폴더에는 필요에 따라 `pages`, `components`, `hooks`, `api`, `schemas`, `types`를 둡니다.

---

## 6. 화면 라우트 구조

### 6.1 공개·인증

| URL | 화면 | 권한 |
|---|---|---|
| `/login` | 관리자 로그인 | 공개 |
| `/forgot-password` | Resend 재설정 요청 | 공개 |
| `/reset-password?token=...` | 새 비밀번호 설정 | 유효 토큰 |
| `/check-in` | 전화번호 뒤 4자리 학생 등원 | 공개·등원전용 |

### 6.2 관리자 기본

| URL | 화면 |
|---|---|
| `/admin` | 대시보드 |
| `/admin/profile` | 내 계정·로그아웃·재설정메일 |

### 6.3 학생·보호자

| URL | 화면 |
|---|---|
| `/admin/students` | 학생 목록·검색·필터 |
| `/admin/students/new` | 학생 등록 |
| `/admin/students/:studentId` | 학생 상세 탭 |
| `/admin/students/:studentId/edit` | 학생 수정·상태변경 |
| `/admin/students/import` | 엑셀 일괄등록 |
| `/admin/guardians` | 보호자 목록 |
| `/admin/guardians/:guardianId` | 보호자 상세·수정·학생연결·동의 |
| `/admin/settings/academics` | 학교·학년 기준정보 |

### 6.4 강사·강좌·수강·등원

| URL | 화면 |
|---|---|
| `/admin/instructors` | 강사 관리 |
| `/admin/courses` | 강좌 목록 |
| `/admin/courses/new` | 강좌 등록 |
| `/admin/courses/:courseId` | 강좌 상세·일정·수강생 |
| `/admin/courses/:courseId/edit` | 강좌 수정 |
| `/admin/enrollments` | 수강등록 목록 |
| `/admin/enrollments/new` | 수강등록 |
| `/admin/check-ins` | 등원 조회·수동등록·수정·취소 |

### 6.5 문자

| URL | 화면 |
|---|---|
| `/admin/messages` | 문자 작업 목록 |
| `/admin/messages/new/recipients` | 1단계 대상선택 |
| `/admin/messages/new/content` | 2단계 내용·개인화·첨부 |
| `/admin/messages/new/review` | 3단계 중복·수신거부·예약 검토 |
| `/admin/messages/:campaignId` | 작업상세·새로고침·재발송 |
| `/admin/message-templates` | 템플릿 목록 |
| `/admin/message-templates/new` | 템플릿 등록 |
| `/admin/message-templates/:templateId/edit` | 템플릿 수정 |
| `/admin/opt-outs` | 수신거부 등록·해제 |
| `/admin/settings/messaging` | Pushbullet·기기·시험문자·한도 |

### 6.6 카드뉴스·미디어

| URL | 화면 |
|---|---|
| `/admin/card-news` | 카드뉴스 프로젝트 목록 |
| `/admin/card-news/new` | 사진·사연·AI·비용확인 |
| `/admin/card-news/:projectId/edit` | 카드뉴스 편집기 |
| `/admin/card-news/:projectId/preview` | 최종확인·다운로드 |
| `/admin/media` | 미디어 보관함 |

### 6.7 보고서·설정·감사

| URL | 화면 |
|---|---|
| `/admin/reports` | 등원·학생·강좌·문자·카드뉴스 보고서 |
| `/admin/settings/academy` | 학원 기본정보·로고·브랜드 |
| `/admin/settings/platform-presets` | SNS 규격 프리셋 |
| `/admin/settings/admins` | 관리자·역할·권한 |
| `/admin/settings/integrations` | Neon·Cloudinary·Resend·Pushbullet 상태 |
| `/admin/audit` | 활동기록 |

### 6.8 라우트 보호

- `/admin/**`는 로그인과 서버권한을 모두 검사합니다.
- 화면에서 메뉴를 숨기는 것만으로 권한을 처리하지 않습니다.
- 권한 없음은 403 화면, 세션 없음은 로그인으로 이동합니다.
- 세션 만료 후 로그인하면 허용되는 원래 URL로 복귀합니다.
- 삭제되거나 접근권한이 없는 ID는 목록 이동버튼을 제공합니다.

---

## 7. 모바일 우선 UI 규칙

### 7.1 반응형 구간

- 모바일: `0~768px`
- 태블릿·소형 PC: `769~1199px`
- 데스크톱: `1200px 이상`
- `768px`은 모바일 규칙입니다.

### 7.2 모바일 Edge-to-edge / Full-bleed

모바일에서는 반드시 다음을 적용합니다.

- 페이지 외곽 카드의 `border`, `border-radius`, `box-shadow`, 좌우 `margin` 제거
- 페이지·섹션 배경은 화면 전체너비 사용
- 실제 텍스트·입력·버튼은 좌우 `16px` 내부여백
- 넓은 모바일은 필요 시 `20~24px`
- 섹션 구분은 테두리보다 `16~24px` 세로여백 또는 배경색 차이
- 사진, 카드뉴스 캔버스, 큰 미리보기는 Full-bleed 허용
- 입력글자 최소 16px
- 터치대상 최소 `44×44px`
- 하단 고정작업바는 `env(safe-area-inset-bottom)` 반영

### 7.3 모바일 내비게이션

관리자 하단메뉴:

1. 홈
2. 학생
3. 등원
4. 문자
5. 더보기

더보기에는 강좌, 수강, 카드뉴스, 보고서, 설정, 활동기록을 권한별 표시합니다.

### 7.4 모바일 인터랙션

- 데스크톱 표는 모바일에서 세로 목록행으로 전환
- 필터·선택·상세·삭제확인은 하단시트 사용
- 긴 등록·수정폼은 한 열
- 저장·다음·발송은 하단 고정작업바
- 목록행 전체 탭으로 상세이동
- 삭제는 스와이프만으로 실행하지 않음
- 카드뉴스 속성패널은 하단시트, 캔버스는 핀치 확대·축소
- 목록→상세→목록 복귀 시 검색·필터·스크롤 복원
- 미저장 변경은 이탈확인

### 7.5 공통 화면상태

- 최초 로딩: 실제 배치와 유사한 스켈레톤
- 버튼처리: 버튼 로딩과 중복탭 방지
- 빈 목록: 이유·다음행동·권한 있을 때 등록버튼
- 필터 0건: 필터초기화
- 네트워크 오류: 입력값 유지·재시도
- 부분 외부서비스 오류: 다른 기능 유지
- 저장 성공: 토스트와 화면상태 갱신
- 입력 오류: 필드 아래와 화면 상단 오류요약

---

## 8. 컴포넌트 구조

### 8.1 레이아웃

```text
AppShell
├─ DesktopSidebar
├─ AdminHeader
├─ MobileHeader
├─ MobileBottomNav
├─ PageTitleBar
├─ PageSection
├─ FullBleedSection
└─ StickyActionBar
```

### 8.2 공통 UI

```text
Button
IconButton
TextField
PasswordField
PhoneField
DateFieldKST
TimeFieldKST
SelectField
MultiSelect
SearchField
FilterChips
StatusBadge
Tabs
HorizontalTabs
BottomSheet
ConfirmDialog
Toast
InlineAlert
LoadingSkeleton
EmptyState
ErrorState
ResponsiveDataList
PaginationOrLoadMore
FileUploadProgress
MaskedName
MaskedPhone
AuditTimeline
```

모든 폼 컴포넌트는 `label`, `required`, `description`, `error`, `disabled`, 접근성 속성을 일관되게 지원합니다.

### 8.3 학생·보호자

```text
StudentListFilters
StudentListRow
StudentForm
StudentSummary
StudentDetailTabs
StudentStatusSheet
DuplicateStudentSheet
GuardianSearchSheet
GuardianForm
GuardianRelations
ConsentEditor
OptOutEditor
SchoolGradeManager
ExcelImportWizard
```

### 8.4 강좌·수강·등원

```text
InstructorList
InstructorFormSheet
CourseListFilters
CourseForm
CourseScheduleEditor
CourseExceptionSheet
CourseDetailTabs
EnrollmentForm
EnrollmentStatusSheet
CheckInKeypad
CheckInCandidateSheet
CheckInSuccess
CheckInAdminList
CheckInEditSheet
```

### 8.5 문자

```text
MessageWizard
RecipientFilters
RecipientCountSummary
RecipientPreviewSheet
DuplicatePhoneStrategy
MessageComposer
PersonalizationChips
RecipientMessagePreview
MmsAttachmentList
SendEstimate
SendApprovalChecklist
DeviceSelector
ScheduleKSTPicker
CampaignStatusSummary
CampaignRecipientList
MessageAttemptTimeline
RetryFailedSheet
TemplatePickerSheet
TemplateEditor
OptOutList
PushbulletSettings
DeviceList
TestMessageSheet
```

### 8.6 Cloudinary·카드뉴스

```text
DirectUploadButton
DirectUploadQueue
MediaGrid
MediaList
MediaDetailSheet
MediaDeleteSheet
PlatformPresetPicker
CardNewsProjectWizard
AiProviderSelector
AiPhotoConsent
CostEstimate
CardCanvas
CardThumbnailStrip
CardToolbar
ElementPropertySheet
SafeAreaOverlay
CardNewsPreview
ExportPanel
ExpiryNotice
```

### 8.7 보고서·설정

```text
DashboardMetric
DashboardAlert
ReportFilters
ReportChart
ExportExcelButton
AcademySettingsForm
AdminRoleEditor
IntegrationStatusRow
AuditLogFilters
AuditDiffSheet
```

### 8.8 공통 훅·유틸

```text
useAuth
usePermission
useUnsavedChanges
useKSTDate
useNormalizedPhone
useIdempotencyKey
useDirectUpload
usePagination
useResponsiveMode
useBottomSheetHistory
getNowKST
getTodayKST
normalizePhone
maskName
maskPhone
```

날짜를 `toISOString().slice(0, 10)` 같은 UTC 절단으로 업무날짜에 사용하지 않습니다. KST 전용 공통함수를 사용합니다.

---

## 9. DB 설계

### 9.1 공통 원칙

- Production DB는 별도 Neon PostgreSQL입니다.
- 개발 DB와 Production DB의 URL과 데이터는 분리합니다.
- 스키마 변경은 Drizzle migration 파일로 관리합니다.
- Production migration은 사용자 승인 전 실행하지 않습니다.
- 기본 ID는 UUID 사용을 권장합니다.
- 시각은 `timestamp with time zone`으로 저장하고, 서버의 업무날짜 계산과 사용자 화면표시는 모두 `Asia/Seoul` KST로 처리합니다. 업무 날짜는 KST 기준 `date`를 사용합니다.
- 중요한 테이블에 `created_at`, `updated_at`, `created_by`, `updated_by`를 둡니다.
- 이력이 연결된 레코드는 `deleted_at`, `status`로 소프트삭제합니다.
- 전화번호는 표시값과 별개로 숫자만 정규화한 값을 저장합니다.
- 개인정보가 필요 없는 목록 API는 마스킹된 값만 반환합니다.

### 9.2 인증·권한

#### `roles`

- `id`
- `name`
- `permissions jsonb`
- `is_system`
- `created_at`, `updated_at`

#### `admins`

- `id`
- `email` unique
- `name`
- `password_hash`
- `role_id` FK
- `status`: active, inactive, locked
- `failed_login_count`
- `locked_until`
- `last_login_at`
- `created_at`, `updated_at`, `deleted_at`

마지막 활성 최고관리자는 비활성화할 수 없습니다.

#### `auth_sessions`

- `id`
- `admin_id`
- `token_hash` 또는 세션 식별값
- `expires_at`
- `created_at`, `revoked_at`
- 필요 시 사용자 에이전트·IP의 최소 감사정보

#### `password_reset_tokens`

- `id`
- `admin_id`
- `token_hash`
- `expires_at`
- `used_at`
- `created_at`

토큰 원문은 저장하지 않습니다.

### 9.3 학원·기준정보

#### `academy_settings`

한 행만 사용합니다.

- `id`
- `academy_name`
- `phone_normalized`
- `address`
- `logo_media_id`
- `sender_name`
- `brand_colors jsonb`
- `brand_fonts jsonb`
- `updated_by`, `updated_at`

#### `schools`

- `id`
- `name`
- `region` nullable
- `sort_order`
- `is_active`
- 공통 감사컬럼

#### `grade_levels`

- `id`
- `name`
- `sort_order`
- `is_active`
- 공통 감사컬럼

활성 이름의 중복을 방지하는 인덱스를 둡니다.

### 9.4 학생·보호자·동의

#### `students`

- `id`
- `name`
- `birth_date`
- `school_id`
- `grade_level_id`
- `phone_normalized`
- `address`
- `registration_date`
- `status`: enrolled, paused, withdrawn, graduated
- `status_effective_date`
- `special_notes`
- `counseling_notes`
- 공통 감사·삭제컬럼

#### `guardians`

- `id`
- `name`
- `phone_normalized`
- `notes`
- 공통 감사·삭제컬럼

보호자 번호는 형제·자매 때문에 unique로 강제하지 않습니다. 중복후보를 경고합니다.

#### `student_guardians`

- `id`
- `student_id`
- `guardian_id`
- `relationship`
- `is_primary`
- `receive_messages`
- `use_for_checkin`
- `created_at`, `updated_at`

`student_id + guardian_id`는 중복 연결하지 않습니다. 학생별 대표보호자는 최대 한 명으로 관리합니다.

#### `student_checkin_phones`

학생 또는 보호자 전화번호를 등원검색에 안전하게 연결합니다.

- `id`
- `student_id`
- `source_type`: student, guardian
- `source_id`
- `phone_normalized`
- `phone_last4`
- `is_active`
- `created_at`, `updated_at`

인덱스:

- `(phone_last4, is_active)`
- `(student_id, is_active)`

전화번호 변경·관계해제 시 이 테이블을 동기화합니다.

#### `consent_history`

- `id`
- `subject_type`: student, guardian, phone
- `subject_id`
- `consent_type`: general_message, marketing, night_marketing, photo_video, ai_photo_transfer
- `status`: agreed, withdrawn
- `effective_date`
- `method`
- `evidence_media_id` nullable
- `reason`
- `processed_by`, `created_at`

현재 상태는 최신 유효 이력으로 계산하거나 별도 current 테이블을 두되 이력을 삭제하지 않습니다.

#### `opt_outs`

- `id`
- `phone_normalized`
- `scope`: 미확정, marketing_only 또는 all_messages
- `status`: active, released
- `effective_date`
- `released_at`
- `reason`, `release_reason`
- `processed_by`, `created_at`, `updated_at`

활성 번호 중복등록 방지 인덱스를 둡니다.

### 9.5 강사·강좌·수강

#### `instructors`

- `id`
- `name`
- `phone_normalized`
- `subjects jsonb` 또는 별도 기준테이블
- `admin_id` nullable
- `status`: active, inactive
- `notes`
- 공통 감사컬럼

#### `courses`

- `id`
- `code` unique
- `name`
- `category`
- `target_grade_ids jsonb` 또는 연결테이블
- `instructor_id`
- `classroom`
- `capacity`
- `base_fee`
- `start_date`, `end_date`
- `status`: recruiting, closed, ended, inactive
- `description`
- 공통 감사·삭제컬럼

#### `course_schedules`

- `id`
- `course_id`
- `day_of_week`
- `start_time`, `end_time`
- `classroom`
- `instructor_id`
- `repeat_start_date`, `repeat_end_date`
- `is_active`
- 공통 감사컬럼

#### `course_exceptions`

- `id`
- `course_id`
- `schedule_id` nullable
- `exception_type`: cancellation, makeup
- `event_date`
- `start_time`, `end_time`
- `reason`
- 공통 감사컬럼

강좌별 출석판정은 만들지 않습니다. 일정은 강좌정보와 미등원 참고 등에만 사용합니다.

#### `enrollments`

- `id`
- `student_id`
- `course_id`
- `start_date`
- `planned_end_date`
- `actual_end_date`
- `status`: waiting, active, paused, ended, canceled
- `tuition_amount`
- `adjustment_note`
- `memo`
- 공통 감사컬럼

인덱스:

- `(student_id, status, start_date)`
- `(course_id, status, start_date)`

기간 중복은 서비스에서 검사하고 경고합니다. 강좌 변경은 기존 이력을 덮어쓰지 않고 새 레코드를 만듭니다.

### 9.6 등원

#### `check_ins`

- `id`
- `student_id`
- `check_in_date` KST date
- `check_in_at` timestamptz
- `source`: kiosk, admin, import
- `status`: active, canceled
- `idempotency_key`
- `exception_reason` nullable
- `created_by` nullable for kiosk
- `created_at`, `updated_at`

제약·인덱스:

- 유효 등원은 기본적으로 학생별 KST 날짜 한 건
- `idempotency_key` unique
- `(check_in_date, check_in_at)`
- `(student_id, check_in_date)`

관리자 예외중복이 필요하면 단순 unique 제약이 아닌 조건부 정책과 별도 예외표시를 사용합니다.

#### `check_in_change_logs`

- `id`
- `check_in_id`
- `action`: create, update, cancel, exception_create
- `before_data jsonb`
- `after_data jsonb`
- `reason`
- `admin_id`
- `created_at`

### 9.7 연동·기기·파일

#### `integration_settings`

- `id`
- `provider`: pushbullet, resend, cloudinary, ai_provider
- `display_name`
- `encrypted_config` 또는 Secret 참조
- `status`
- `last_checked_at`
- `last_error_code`
- 공통 감사컬럼

API Secret 원문은 저장하지 않습니다. 관리자 입력 토큰을 DB에 둘 경우 서버 키로 강하게 암호화합니다.

#### `messaging_devices`

- `id`
- `integration_id`
- `external_device_id`
- `nickname`
- `device_type`
- `is_enabled`
- `is_default`
- `last_seen_at`
- `last_error_code`
- 공통 감사컬럼

#### `upload_sessions`

- `id`
- `owner_admin_id`
- `purpose`
- `target_type`, `target_id`
- `expected_resource_type`
- `expected_folder`
- `expected_bytes`
- `expires_at`
- `status`: pending, completed, expired, rejected
- `created_at`, `completed_at`

#### `media_assets`

- `id`
- `owner_admin_id`
- `purpose`
- `target_type`, `target_id`
- `cloudinary_public_id`
- `cloudinary_asset_id` nullable
- `secure_url`
- `resource_type`
- `format`, `mime_type`, `bytes`
- `width`, `height`, `duration` nullable
- `status`: active, pending_delete, deleted, orphan_review, error
- `expires_at` nullable
- `created_at`, `deleted_at`, `deleted_by`

`cloudinary_public_id + resource_type` 조합을 고유하게 관리합니다.

### 9.8 문자

#### `message_templates`

- `id`
- `name`
- `category`
- `message_type`: informational, marketing
- `body`
- `description`
- `default_media_id` nullable
- `allowed_roles jsonb`
- `status`
- `usage_count`, `last_used_at`
- 공통 감사·삭제컬럼

#### `message_campaigns`

- `id`
- `name`
- `created_by`, `approved_by`
- `message_type`
- `template_id` nullable
- `body_source`
- `recipient_type`
- `filter_snapshot jsonb`
- `duplicate_strategy`
- `device_id`
- `send_mode`: immediate, scheduled
- `scheduled_at`
- `status`: draft, validating, ready, scheduled, queued, dispatching, partial, completed, failed, canceled
- `approved_at`, `started_at`, `finished_at`
- `total_students`, `total_contacts`, `total_send_items`
- `excluded_count`, `failed_count`
- `idempotency_key` unique
- 공통 감사컬럼

#### `message_campaign_media`

- `id`
- `campaign_id`
- `media_id`
- `sort_order`

이미지가 N장이면 수신번호 한 개당 N개의 MMS 발송항목을 만듭니다.

#### `message_recipients`

- `id`
- `campaign_id`
- `student_id` nullable
- `guardian_id` nullable
- `phone_normalized`
- `relationship_snapshot`
- `personalization_snapshot jsonb`
- `rendered_body`
- `status`: included, excluded, pending, processing, device_requested, request_failed, uncertain, canceled
- `exclusion_reason`
- `created_at`, `updated_at`

#### `message_send_items`

수신자와 이미지별 실제 한 건입니다.

- `id`
- `campaign_id`
- `recipient_id`
- `media_id` nullable
- `sequence_no`
- `status`
- `idempotency_key` unique
- `requested_at`, `completed_at`
- `last_error_code`, `last_error_message_safe`

#### `message_attempts`

- `id`
- `send_item_id`
- `attempt_no`
- `device_id`
- `request_status`
- `external_reference` nullable
- `requested_at`, `responded_at`
- `error_code`, `error_message_safe`
- `retry_campaign_id` nullable

인덱스:

- `message_campaigns(status, scheduled_at)`
- `message_send_items(status, sequence_no)`
- `message_recipients(campaign_id, phone_normalized)`

### 9.9 카드뉴스

#### `platform_presets`

- `id`
- `platform`
- `post_type`
- `name`
- `width_px`, `height_px`
- `safe_area jsonb`
- `is_active`
- 공통 감사컬럼

#### `card_news_projects`

- `id`
- `name`
- `preset_id`
- `title`, `story`
- `event_date`
- `related_course_id`, `related_student_id` nullable
- `student_name_display_mode`
- `hashtags jsonb`
- `show_academy_info`
- `ai_provider`, `ai_model`
- `send_photos_to_ai`
- `privacy_confirmed_by`, `privacy_confirmed_at`
- `estimated_cost`, `actual_usage jsonb`
- `status`: draft, uploading, generating, editing, rendering, ready, partial_error, expired, deleted
- `expires_at` 생성일로부터 7일
- 공통 감사컬럼

#### `card_news_cards`

- `id`
- `project_id`
- `sort_order`
- `layout_json`
- `title`, `body`
- `rendered_media_id` nullable
- `status`
- 공통 감사컬럼

#### `card_news_media`

- `id`
- `project_id`
- `card_id` nullable
- `media_id`
- `role`: source, background, logo, output
- `sort_order`

#### `ai_generation_logs`

- `id`
- `project_id`
- `provider`, `model`
- `photos_sent`
- `input_summary_safe`
- `output_json`
- `usage_json`
- `estimated_cost`, `actual_cost`
- `status`, `error_code`
- `created_by`, `created_at`

개인정보·API 키·원본 Secret을 로그에 저장하지 않습니다.

### 9.10 감사·작업

#### `audit_logs`

- `id`
- `admin_id` nullable
- `role_snapshot`
- `action`
- `target_type`, `target_id`
- `before_data_safe jsonb`
- `after_data_safe jsonb`
- `result`
- `request_id`
- `created_at`

비밀번호·토큰·API 키를 기록하지 않습니다.

#### `job_locks` 또는 동등 구조

- `job_name`
- `locked_until`
- `locked_by`
- `updated_at`

메시지 대기열과 7일 삭제 작업이 동시에 중복 실행되지 않게 DB lease를 사용합니다.

---

## 10. 인증·보안 구현

### 10.1 최초 최고관리자

1. 서버 시작 시 최고관리자 존재 여부를 조회합니다.
2. 없을 때만 `INITIAL_ADMIN_EMAIL`, `INITIAL_ADMIN_PASSWORD`, `INITIAL_ADMIN_NAME`을 읽습니다.
3. 초기 비밀번호를 안전한 단방향 해시로 DB에 저장합니다.
4. 이미 최고관리자가 있으면 Secret 변경으로 DB 비밀번호를 덮어쓰지 않습니다.
5. 초기값과 비밀번호를 로그에 출력하지 않습니다.

Secret은 계정 최초 생성용입니다. 이후 실제 로그인은 Neon의 비밀번호 해시를 사용합니다.

### 10.2 로그인·세션

- 이메일·비밀번호 검증
- 비활성·잠금 계정 로그인 차단
- 반복실패 횟수 제한
- 안전한 세션 쿠키 사용
- 운영환경 쿠키: `HttpOnly`, `Secure`, 적절한 `SameSite`
- 세션 만료·로그아웃·비밀번호 변경 시 무효화
- 상태변경 API는 Origin·CSRF 위험을 방어
- 모든 요청에 request ID 부여

### 10.3 Resend 비밀번호 재설정

1. 입력 이메일 존재 여부와 관계없이 같은 안내를 반환합니다.
2. 활성 계정이면 일회성 토큰을 만들고 해시만 저장합니다.
3. 짧은 유효기간 링크를 Resend로 발송합니다.
4. 만료·변조·사용완료 토큰은 거부합니다.
5. 새 비밀번호 해시 저장 후 토큰과 기존 세션을 무효화합니다.
6. 평문 비밀번호를 이메일로 보내지 않습니다.

### 10.4 권한

- 권한은 공통 `permissions` 상수로 프론트·서버가 공유합니다.
- 서버 middleware에서 세션과 권한을 검사합니다.
- 데이터 조회범위도 역할에 따라 제한합니다.
- 강사는 담당 강좌의 학생 최소정보만 볼 수 있습니다.
- 문자·콘텐츠 담당자는 업무에 필요한 최소 개인정보만 받습니다.
- 마지막 활성 최고관리자를 비활성화하지 못합니다.

### 10.5 개인정보

- 목록 전화번호 마스킹
- 등원 공개 API는 전체 이름·전체 번호를 반환하지 않음
- 이름 마스킹: 3자 이상 첫·마지막만, 2자 첫 글자만, 1자는 `*`
- Secret·비밀번호·토큰·민감 헤더 로그 금지
- Production 데이터를 개발 DB로 복사 금지
- 개인정보 다운로드·수정·삭제 감사로그

---

## 11. API 공통 계약

### 11.1 기본 형식

성공:

```json
{
  "data": {},
  "meta": {
    "requestId": "...",
    "kstTimestamp": "..."
  }
}
```

오류:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "확인 가능한 안내문",
    "fieldErrors": {},
    "requestId": "..."
  }
}
```

### 11.2 공통 규칙

- `/api/**`에 JSON을 사용합니다. 파일 본문은 예외 없이 Cloudinary로 직접 전송합니다.
- Zod로 query·params·body를 검증합니다.
- 목록은 페이지 또는 cursor 방식으로 제한합니다.
- 쓰기 API는 필요 시 `Idempotency-Key`를 받습니다.
- 오류 메시지에 Secret, SQL, 스택, 전체 개인정보를 노출하지 않습니다.
- 401은 로그인 필요, 403은 권한 없음, 404는 없음, 409는 중복·상태충돌, 422는 검증오류, 429는 제한초과를 일관되게 사용합니다.

---

## 12. API 목록

### 12.1 인증·관리자

| Method | URL | 동작 |
|---|---|---|
| POST | `/api/auth/login` | 로그인·세션 발급 |
| POST | `/api/auth/logout` | 현재 세션 종료 |
| GET | `/api/auth/me` | 현재 관리자·권한 |
| POST | `/api/auth/forgot-password` | Resend 링크 요청 |
| POST | `/api/auth/reset-password` | 토큰으로 비밀번호 변경 |
| GET | `/api/admins` | 관리자 목록 |
| POST | `/api/admins` | 관리자 생성 |
| GET | `/api/admins/:id` | 관리자 상세 |
| PATCH | `/api/admins/:id` | 이름·역할·상태 수정 |
| POST | `/api/admins/:id/deactivate` | 비활성화·세션종료 |
| POST | `/api/admins/:id/send-reset` | Resend 재설정 링크 |
| GET | `/api/roles` | 역할 목록 |
| POST | `/api/roles` | 역할 생성 |
| PATCH | `/api/roles/:id` | 권한 수정 |

### 12.2 학원·기준정보·연결상태

| Method | URL | 동작 |
|---|---|---|
| GET | `/api/settings/academy` | 학원 설정 |
| PATCH | `/api/settings/academy` | 학원 설정 수정 |
| GET | `/api/settings/integrations/status` | Neon·Cloudinary·Resend·Pushbullet 상태 |
| POST | `/api/settings/integrations/check` | 안전한 연결 재점검 |
| GET | `/api/schools` | 학교 목록 |
| POST | `/api/schools` | 학교 등록 |
| PATCH | `/api/schools/:id` | 학교 수정·상태 |
| DELETE | `/api/schools/:id` | 미사용 삭제 또는 비활성화 안내 |
| GET | `/api/grade-levels` | 학년 목록 |
| POST | `/api/grade-levels` | 학년 등록 |
| PATCH | `/api/grade-levels/:id` | 학년 수정·정렬·상태 |
| DELETE | `/api/grade-levels/:id` | 미사용 삭제 또는 비활성화 안내 |

### 12.3 학생·보호자·동의

| Method | URL | 동작 |
|---|---|---|
| GET | `/api/students` | 검색·필터·페이지 목록 |
| POST | `/api/students` | 학생 등록·중복검사 |
| GET | `/api/students/:id` | 권한별 상세 |
| PATCH | `/api/students/:id` | 학생 수정 |
| POST | `/api/students/:id/status` | 재원·휴원·퇴원·졸업 |
| DELETE | `/api/students/:id` | 소프트삭제 또는 안전검사 |
| POST | `/api/students/:id/restore` | 복구 |
| GET | `/api/students/:id/enrollments` | 수강이력 |
| GET | `/api/students/:id/check-ins` | 등원이력 |
| GET | `/api/students/:id/messages` | 문자이력 |
| GET | `/api/guardians` | 보호자 검색·목록 |
| POST | `/api/guardians` | 보호자 등록 |
| GET | `/api/guardians/:id` | 상세·연결학생 |
| PATCH | `/api/guardians/:id` | 수정 |
| POST | `/api/students/:id/guardians` | 학생·보호자 연결 |
| PATCH | `/api/student-guardians/:id` | 관계·대표·수신·등원번호 설정 |
| DELETE | `/api/student-guardians/:id` | 연결해제 |
| GET | `/api/consents` | 동의이력 조회 |
| POST | `/api/consents` | 동의·철회 등록 |
| GET | `/api/opt-outs` | 수신거부 목록 |
| POST | `/api/opt-outs` | 관리자 수신거부 등록 |
| POST | `/api/opt-outs/:id/release` | 해제·사유 |
| POST | `/api/students/import/validate` | 엑셀 검증 |
| POST | `/api/students/import/commit` | 확인된 정상행 등록 |

엑셀 파일 업로드 방식은 보안·크기에 따라 직접 업로드 또는 클라이언트 파싱 후 JSON 검증을 기술설계에서 확정하되, 파일 본문을 Vercel이 중계하는 구조를 만들지 않습니다.

### 12.4 강사·강좌·수강

| Method | URL | 동작 |
|---|---|---|
| GET | `/api/instructors` | 강사 목록 |
| POST | `/api/instructors` | 강사 등록 |
| PATCH | `/api/instructors/:id` | 수정·비활성화 |
| GET | `/api/courses` | 강좌 검색·필터 |
| POST | `/api/courses` | 강좌 등록 |
| GET | `/api/courses/:id` | 상세·일정·수강생 |
| PATCH | `/api/courses/:id` | 강좌 수정 |
| POST | `/api/courses/:id/copy` | 수강생 제외 복사 |
| POST | `/api/courses/:id/status` | 종료·비활성화 |
| POST | `/api/courses/:id/schedules` | 일정 추가 |
| PATCH | `/api/course-schedules/:id` | 일정 수정 |
| DELETE | `/api/course-schedules/:id` | 일정 삭제 |
| POST | `/api/courses/:id/exceptions` | 휴강·보강 추가 |
| PATCH | `/api/course-exceptions/:id` | 휴강·보강 수정 |
| DELETE | `/api/course-exceptions/:id` | 휴강·보강 삭제 |
| GET | `/api/enrollments` | 수강등록 목록 |
| POST | `/api/enrollments` | 학생 수강등록 |
| PATCH | `/api/enrollments/:id` | 기간·상태·금액 수정 |
| POST | `/api/enrollments/:id/end` | 종료 |
| POST | `/api/enrollments/:id/cancel` | 취소 |

### 12.5 등원

| Method | URL | 동작 |
|---|---|---|
| POST | `/api/check-in/search` | 뒤 4자리로 최소정보 후보 반환 |
| POST | `/api/check-in/confirm` | 단기 선택토큰으로 등원등록 |
| GET | `/api/check-ins` | 관리자 목록·기간·학생 필터 |
| POST | `/api/check-ins/manual` | 관리자 수동등원·사유 |
| PATCH | `/api/check-ins/:id` | 등원시각 수정·사유 |
| POST | `/api/check-ins/:id/cancel` | 취소·사유 |
| GET | `/api/check-ins/:id/history` | 수정이력 |

공개 검색 API는 전체 학생명·전체 번호·보호자정보를 반환하지 않습니다. 무작위 대입 방지를 위해 제한합니다.

### 12.6 Pushbullet·기기·템플릿

| Method | URL | 동작 |
|---|---|---|
| GET | `/api/messaging/settings` | 마스킹 설정·한도 |
| POST | `/api/messaging/pushbullet/connect` | 토큰 유효성 검사·암호화 저장 |
| DELETE | `/api/messaging/pushbullet` | 영향검사 후 연결삭제 |
| POST | `/api/messaging/devices/sync` | 기기 동기화 |
| GET | `/api/messaging/devices` | 기기 목록 |
| PATCH | `/api/messaging/devices/:id` | 별칭·활성·기본기기 |
| POST | `/api/messaging/test` | 승인번호 시험 SMS/MMS |
| PATCH | `/api/messaging/limits` | 통신사 한도·간격 |
| GET | `/api/message-templates` | 템플릿 목록 |
| POST | `/api/message-templates` | 등록 |
| GET | `/api/message-templates/:id` | 상세 |
| PATCH | `/api/message-templates/:id` | 수정 |
| POST | `/api/message-templates/:id/copy` | 복사 |
| DELETE | `/api/message-templates/:id` | 소프트삭제 |

### 12.7 문자발송

| Method | URL | 동작 |
|---|---|---|
| POST | `/api/message-drafts` | 발송초안 생성 |
| GET | `/api/message-drafts/:id` | 초안 조회 |
| PATCH | `/api/message-drafts/:id/recipients` | 대상조건·중복전략 저장 |
| POST | `/api/message-drafts/:id/recipient-preview` | 후보·제외·중복 계산 |
| PATCH | `/api/message-drafts/:id/content` | 본문·변수·첨부 저장 |
| POST | `/api/message-drafts/:id/render-preview` | 실제 대상 표본 치환 |
| POST | `/api/message-drafts/:id/validate` | 최종 재검증 |
| POST | `/api/message-drafts/:id/approve` | 확인체크·기기·즉시/예약 승인 |
| GET | `/api/message-campaigns` | 작업 목록·필터 |
| GET | `/api/message-campaigns/:id` | 작업 상세·최신 DB 상태 |
| GET | `/api/message-campaigns/:id/recipients` | 상태별 수신자 |
| POST | `/api/message-campaigns/:id/cancel` | 예약·미처리 취소 |
| PATCH | `/api/message-campaigns/:id/schedule` | 예약시각 수정 후 재검증 |
| POST | `/api/message-campaigns/:id/retry` | 확정실패 건 재발송 작업 |
| GET | `/api/message-usage` | 기간·기기·관리자 사용량 |

승인 시 중복 연락처, 수신거부, 최종건수 확인이 모두 필요합니다. 자동 실시간 API 폴링은 구현하지 않고 사용자의 새로고침 때 상세 API를 호출합니다.

### 12.8 Cloudinary 파일

| Method | URL | 동작 |
|---|---|---|
| POST | `/api/media/upload-signature` | 로그인·권한 후 짧은 signed upload 정보 |
| POST | `/api/media/finalize` | Cloudinary 결과·소유권 검증 후 메타데이터 저장 |
| GET | `/api/media` | 권한별 파일 목록 |
| GET | `/api/media/:id` | 메타데이터·안전한 접근정보 |
| DELETE | `/api/media/:id` | 서버 소유권검사 후 Cloudinary·Neon 삭제처리 |

`upload-signature`와 `finalize`에는 파일 본문을 보내지 않습니다.

### 12.9 플랫폼·카드뉴스

| Method | URL | 동작 |
|---|---|---|
| GET | `/api/platform-presets` | 활성 프리셋 |
| POST | `/api/platform-presets` | 프리셋 등록 |
| PATCH | `/api/platform-presets/:id` | 규격·안전영역 수정 |
| DELETE | `/api/platform-presets/:id` | 미사용 삭제 또는 비활성화 |
| GET | `/api/card-news` | 프로젝트 목록 |
| POST | `/api/card-news` | 초안 생성 |
| GET | `/api/card-news/:id` | 프로젝트·카드·사진 |
| PATCH | `/api/card-news/:id` | 기본정보·AI설정 수정 |
| POST | `/api/card-news/:id/media` | 검증된 미디어 연결 |
| DELETE | `/api/card-news/:id/media/:mediaId` | 연결해제·필요 시 서버삭제 |
| POST | `/api/card-news/:id/cost-estimate` | 사진수·AI 예상비용 |
| POST | `/api/card-news/:id/generate` | AI 문구·구성 생성 |
| PUT | `/api/card-news/:id/cards` | 카드 순서·레이아웃 저장 |
| POST | `/api/card-news/:id/render` | PNG·JPG 렌더링 |
| POST | `/api/card-news/:id/copy` | 새 프로젝트 복사 |
| DELETE | `/api/card-news/:id` | 서버삭제·감사정보 |

사진을 AI에 전달할지는 관리자 선택입니다. 전달 시 개인정보 없음·동의확인을 저장합니다.

### 12.10 대시보드·보고서·감사

| Method | URL | 동작 |
|---|---|---|
| GET | `/api/dashboard` | 역할별 KST 요약 |
| GET | `/api/reports/check-ins` | 등원 통계 |
| GET | `/api/reports/students` | 학생·학년 통계 |
| GET | `/api/reports/courses` | 강좌·수강 통계 |
| GET | `/api/reports/messages` | 문자 요청·실패·제외 통계 |
| GET | `/api/reports/card-news` | 생성량·사용량 |
| POST | `/api/exports` | 권한·필터 기반 엑셀 생성 |
| GET | `/api/exports/:id` | 생성상태·다운로드 |
| GET | `/api/audit-logs` | 감사 검색·페이지 |
| GET | `/api/audit-logs/:id` | 안전한 변경 전·후 상세 |

### 12.11 예약작업

| Method | URL | 동작 |
|---|---|---|
| GET/POST | `/api/cron/process-message-queue` | 제한된 배치로 예약·대기 문자 처리 |
| GET/POST | `/api/cron/cleanup-card-news` | 7일 지난 원본·결과 Cloudinary 삭제 |
| GET/POST | `/api/cron/scan-orphan-media` | 확실한 고아후보 탐지 |
| GET/POST | `/api/cron/cleanup-orphan-media` | 검증된 고아만 삭제 |

- `CRON_SECRET` 또는 Vercel 공식 인증방식으로 보호합니다.
- Vercel 실행시간 안에서 제한된 건수만 처리합니다.
- DB lease로 중복실행을 막습니다.
- 이미 처리된 메시지는 다시 보내지 않습니다.
- Vercel Cron 설정이 UTC만 허용하면 KST 대응시각을 문서화합니다.
- 실제 Vercel 플랜의 Cron 주기와 제한을 구현 전에 확인합니다.

---

## 13. 핵심 기능별 상세 처리 흐름

### 13.1 학생·보호자 등록 및 수정

1. 관리자가 학생 기본정보, 학년, 학교, 상태를 입력합니다.
2. 등원 검색용 전화번호는 숫자만 정규화하고 뒤 4자리를 별도 색인합니다.
3. 보호자는 별도 엔터티로 등록하고 학생과 관계를 연결합니다. 형제·자매가 같은 보호자를 공유할 수 있어야 합니다.
4. 문자 수신번호, 대표 보호자, 수신동의 여부를 명시합니다.
5. 중복 전화번호는 금지하지 않되 경고하고 사용자가 확인해야 저장됩니다.
6. 등록·수정·상태변경·수신거부 변경은 감사로그에 남깁니다.
7. 수강·등원·문자 이력이 없는 오등록 데이터만 물리 삭제할 수 있습니다. 이력이 있으면 `inactive` 또는 `deleted_at`으로 비활성화합니다.

필수 입력은 이름, 학년, 등원 검색용 전화번호 1개 이상입니다. 학년 미지정이 필요한 학생은 관리자가 먼저 `기타/미지정` 학년 정책을 설정해야 하며 임의 기본값을 넣지 않습니다.

### 13.2 강좌·수강 이력

- 강좌는 강좌명, 담당강사, 기간, 요일·시작/종료시각, 정원, 상태를 가집니다.
- 학생 수강은 강좌와 학생을 연결하고 시작일·종료일·상태를 저장합니다.
- 강좌 일정 변경은 기존 수강 이력을 덮어쓰지 않도록 변경시점 또는 예외일을 기록합니다.
- 수강 종료·취소 후에도 과거 조회가 가능해야 합니다.
- 이 기능은 “어느 기간에 어떤 강좌를 수강했는가”를 기록하기 위한 것이며 강좌별 출석, 지각, 조퇴, 결석 판정은 만들지 않습니다.

### 13.3 등원 등록

```mermaid
flowchart TD
    A["뒤 4자리 입력"] --> B{"일치 학생 수"}
    B -->|0명| C["미등록 안내"]
    B -->|1명| D["마스킹 이름 확인"]
    B -->|2명 이상| E["팝업 또는 바텀시트 선택"]
    E --> D
    D --> F{"오늘 이미 등원?"}
    F -->|아니오| G["KST 서버시각 저장"]
    F -->|예| H["중복 경고·추가 기록 차단"]
```

- 공개 등원 화면은 뒤 4자리 숫자만 받으며 Enter 또는 등원 버튼으로 검색합니다.
- 후보에는 `김*수`처럼 중간 글자를 `*`로 표시합니다. 한 글자 이름 등 특이 이름의 마스킹 규칙은 테스트로 고정합니다.
- 같은 뒤 4자리 후보가 여러 명이면 전체 전화번호, 보호자 이름, 강좌 등 추가 개인정보를 노출하지 않습니다. 필요한 최소 식별정보만 표시합니다.
- 최종 등원시각은 브라우저 시간이 아니라 서버가 생성한 값을 사용하고, DB에는 `timestamp with time zone`으로 저장하며 서버 업무계산과 화면표시는 KST로 처리합니다.
- 기본 중복 기준은 “동일 학생의 동일 KST 날짜 유효 등원 1건”입니다. 관리자가 예외 등원을 추가할지는 구현 전 결정합니다.
- 관리자는 등원기록을 조회하고 권한이 있으면 수정·무효화할 수 있습니다. 원본값, 변경값, 사유, 변경자를 감사로그에 남기며 물리 삭제하지 않습니다.

### 13.4 문자 초안·검증·승인

1. 관리자가 전체, 학년, 강좌, 개별 학생 조건을 조합해 수신자를 선택합니다.
2. 발송번호는 학생이 아니라 실제 문자 수신대상 전화번호 기준으로 정규화합니다.
3. 템플릿 또는 직접입력 메시지에서 `{{이름}}`을 각 학생 이름으로 치환합니다.
4. 수신자 스냅샷을 만들어 이후 회원정보 변경이 승인된 작업의 의미를 바꾸지 않게 합니다.
5. 동일 전화번호 중복과 현재 수신거부를 검사해 제외목록·사유·최종 건수를 보여줍니다.
6. 첨부사진이 N장이면 각 사진을 1장씩 첨부한 MMS N건을 만듭니다. 각 건에 동일하게 개인화된 문구를 붙입니다. 사진이 없으면 SMS/LMS 판정 정책을 적용합니다.
7. 예상 발송건수와 예상 사용량은 `최종 고유 수신번호 수 × 첨부 묶음 수`를 기준으로 계산합니다. 첨부가 없을 때 묶음 수는 1입니다.
8. 관리자가 중복·수신거부·건수·기기·즉시/예약·문구·첨부 최종 점검표를 모두 확인해야 승인할 수 있습니다.
9. 승인 시점에 수신거부·중복·기기상태를 다시 검사합니다. 검증 결과가 달라지면 승인을 중단하고 변경내용을 보여줍니다.

다른 학생이 같은 보호자 번호를 공유하는 경우 이름 치환과 중복 제거가 충돌할 수 있습니다. 기본값을 임의로 정하지 말고 21장의 정책 결정을 받은 뒤 구현합니다.

### 13.5 문자 대량발송·재발송

- 작업 상태 예: `draft → validating → ready → scheduled/queued → processing → completed/partial_failed/failed/cancelled`.
- 개별 발송 상태 예: `pending → dispatched → accepted/failed/unknown/cancelled`.
- Pushbullet 요청 성공은 이동통신사 최종 전달 성공과 동일하지 않습니다. API가 제공하는 범위 안에서 상태 명칭을 정확히 구분합니다.
- 승인된 스냅샷을 순서대로 배치 처리하고, `idempotency_key`, DB lease, 원자적 상태변경으로 중복 요청을 차단합니다.
- 통신사·기기 제한에 맞춘 발송간격과 작업당 최대 인원은 설정값으로 둡니다. 미확정 상태에서 임의 숫자를 하드코딩하지 않습니다.
- 기기가 오프라인이 아니라고 가정해도 API 실패, 배터리 절전, 권한해제, 네트워크 장애는 발생할 수 있으므로 타임아웃과 오류상태를 구현합니다.
- 사이트 화면은 자동 실시간 갱신하지 않습니다. 사용자가 새로고침하거나 “상태 새로고침” 버튼을 눌렀을 때 DB의 최신 상태를 표시합니다.
- 재발송은 확정 실패 건만 새 작업으로 복사하며, 원작업과 연결하고 다시 수신거부·중복 여부를 검사합니다.
- 이미 성공 또는 처리상태 불명인 건은 기본 재발송 대상에서 제외합니다.

### 13.6 Cloudinary 직접 업로드

```mermaid
sequenceDiagram
    participant B as 브라우저
    participant V as Vercel API
    participant C as Cloudinary
    participant N as Neon
    B->>V: 서명 요청(파일 메타데이터)
    V-->>B: 짧은 signed upload 정보
    B->>C: 파일 본문 직접 업로드
    C-->>B: secure_url, public_id, bytes 등
    B->>V: 업로드 결과 메타데이터
    V->>C: 결과·소유권 검증
    V->>N: 검증된 메타데이터 저장
```

- 이미지, 음성, 영상, PDF, 문서 등 모든 파일에 동일 원칙을 적용합니다.
- Vercel API 요청 본문에는 파일 바이너리를 절대 보내지 않습니다. `multer`, `formidable`, `busboy`로 Vercel이 파일을 받은 뒤 재전송하는 구조는 금지합니다.
- 서명에는 허용 폴더, 리소스 유형, 만료시각, 필요시 파일크기·형식을 제한합니다.
- `finalize`에서 public ID, resource type, bytes, 서명시도, 현재 사용자, 목적 엔터티를 대조합니다. 브라우저가 보낸 `secure_url`을 그대로 신뢰하지 않습니다.
- 업로드가 끝났지만 finalize되지 않은 파일은 고아후보로만 표시하고 충분한 유예시간과 소유권 검증 후 정리합니다.
- 파일 삭제는 반드시 Vercel API가 로그인·권한·소유권을 확인한 뒤 Cloudinary 삭제와 Neon 상태변경을 처리합니다.
- Cloudinary API Secret은 서버 환경변수에만 저장합니다. 브라우저 번들, 로그, 오류응답에 노출하지 않습니다.

### 13.7 카드뉴스

1. 플랫폼 프리셋을 선택하면 현재 공식 권장 규격에 맞는 캔버스와 안전영역을 불러옵니다.
2. 사진은 제한 없이 추가 가능하되 업로드·AI·렌더 비용 예상치를 생성 전에 보여줍니다.
3. 사진과 사연을 입력하고 AI 공급자, 사진 AI 전달 여부를 관리자가 선택합니다.
4. 사진을 AI에 전달할 때 개인정보 없음과 필요한 동의를 관리자가 확인해야 합니다.
5. AI 공급자는 공통 어댑터 인터페이스로 구현하여 공급자별 키·모델·오류처리를 서버에 격리합니다.
6. AI 결과는 초안일 뿐이며 관리자가 문구, 순서, 크롭, 레이아웃을 검토·수정한 뒤 렌더합니다.
7. 플랫폼 프리셋 값은 운영 중 바뀔 수 있으므로 DB에서 수정 가능하게 하고 코드 상수만으로 고정하지 않습니다.
8. 원본·중간결과·최종결과는 생성일 기준 7일 후 정리 대상이 됩니다. 삭제 예정일을 화면에 표시하고 정리 로그를 남깁니다.
9. 프로젝트 메타데이터를 7일 후에도 유지할지는 21장의 보관정책 결정에 따릅니다.

---

## 14. 입력 검증·오류·예외 규칙

### 14.1 공통 검증

- 클라이언트 검증은 편의를 위한 것이며 서버에서 동일 규칙을 다시 검증합니다.
- 전화번호는 표시값과 정규화값을 분리하고 국가번호·하이픈 정책을 한 곳에서 관리합니다.
- 이름, 메시지, 사연 등 문자열은 앞뒤 공백, 길이, 허용 문자, 빈값을 Zod 스키마로 검증합니다.
- 날짜 입력은 화면에서 KST 의미를 명시하며 종료일이 시작일보다 빠를 수 없습니다.
- 페이지네이션·정렬·검색 파라미터는 허용목록으로 제한합니다.
- 파일은 목적별 허용 MIME, 확장자, bytes, Cloudinary resource type을 모두 검증합니다.

### 14.2 오류 코드 예시

| HTTP | code | 사용자 처리 |
|---:|---|---|
| 400 | `VALIDATION_ERROR` | 필드별 오류 표시 |
| 401 | `UNAUTHENTICATED` | 로그인 화면 이동 |
| 403 | `FORBIDDEN` | 권한없음 안내, 데이터 비노출 |
| 404 | `NOT_FOUND` | 존재하지 않거나 접근 불가 안내 |
| 409 | `DUPLICATE_CHECKIN` | 이미 등원한 시각 표시 |
| 409 | `CAMPAIGN_CHANGED` | 다시 검증하도록 유도 |
| 409 | `VERSION_CONFLICT` | 최신 정보 새로고침 후 재시도 |
| 413 | `FILE_POLICY_EXCEEDED` | Cloudinary 직접 업로드 전 제한 안내 |
| 422 | `OPT_OUT_RECIPIENTS` | 제외목록 확인 요구 |
| 429 | `RATE_LIMITED` | 잠시 후 재시도 안내 |
| 502 | `EXTERNAL_PROVIDER_ERROR` | 공급자 오류와 안전한 재시도 안내 |

오류응답에는 비밀번호, 토큰, 전체 전화번호, Cloudinary secret, AI API 키, Pushbullet 키를 넣지 않습니다. 사용자 메시지와 운영자 진단용 로그를 분리하고 모든 외부 API 호출에 timeout을 둡니다.

### 14.3 동시성·멱등성

- 수정 API는 `updated_at` 또는 version 기반 낙관적 잠금을 사용합니다.
- 등원 생성, 문자 승인, 큐 처리, 재발송, 파일 finalize, 정리작업은 재호출되어도 중복 결과가 생기지 않아야 합니다.
- 버튼은 요청 중 비활성화하지만 서버 멱등성을 대체하지 않습니다.
- 예약작업은 lease 만료와 회수 정책을 가져야 하며 한 작업을 두 실행기가 동시에 처리하지 않게 합니다.

---

## 15. 화면 동작 공통 기준

- 모든 목록은 검색, 필터, 정렬, 페이지 이동 또는 무한목록 중 일관된 방식을 제공합니다.
- 등록 가능한 모든 데이터에는 권한에 맞는 수정과 삭제/비활성화 동작이 함께 있어야 합니다.
- 저장 버튼은 변경이 없거나 검증 실패면 비활성화하고, 저장 중 중복 클릭을 막습니다.
- 파괴적 동작은 대상명과 영향범위를 보여주는 확인창을 사용합니다.
- 로딩은 화면 전체를 막기보다 해당 영역 skeleton 또는 진행상태를 표시합니다.
- 빈 화면은 단순히 비워두지 않고 이유와 다음 행동 버튼을 제공합니다.
- 네트워크 오류는 입력값을 가능한 유지하며 재시도할 수 있어야 합니다.
- 모바일에서 바텀시트는 닫기, 배경탭, 뒤로가기, 포커스 이동을 지원합니다.
- 키보드 탐색, 명확한 label, 대비, focus 표시, 상태의 텍스트 표현을 포함합니다.

---

## 16. 보안·개인정보·감사

- 최소권한 원칙으로 역할별 API 권한을 서버에서 강제합니다.
- 비밀번호는 검증된 해시 알고리즘으로 저장하고 원문을 저장하거나 로그에 남기지 않습니다.
- 로그인, 비밀번호 재설정, 공개 등원검색, 업로드 서명, 문자 승인 API에 속도제한을 둡니다.
- 등원검색은 뒤 4자리만으로 후보를 찾되 응답에 최소정보만 포함하고 대량열람을 방지합니다.
- 전화번호와 학생정보는 로그에서 마스킹합니다. 감사로그도 권한 있는 관리자만 봅니다.
- 중요 변경은 행위자, KST 표시시각, 대상, 변경 전·후 안전한 값, 사유, 요청 식별자를 기록합니다.
- 관리자 비활성화, 학생·보호자 변경, 수신거부, 등원 수정, 문자 승인·취소·재발송, 파일 삭제, AI 개인정보 확인을 감사대상으로 합니다.
- CSRF/XSS/SQL injection 방어, secure cookie, 보안헤더, 입력 검증을 적용합니다.
- 사용 중인 패키지와 외부 API는 공식 문서의 현재 버전을 구현 시점에 확인합니다.

---

## 17. 성능·운영 요구사항

- 주요 모바일 화면은 느린 네트워크에서도 상태를 명확히 보여야 합니다.
- 대규모 목록은 DB pagination을 사용하고 N+1 조회를 피합니다.
- 전화번호 뒤 4자리, 학생상태, 학년, 강좌, 등원일, 캠페인상태, 예약시각 등에 필요한 인덱스를 둡니다.
- 외부 서비스 오류가 학생·강좌·등원 등 핵심 관리기능 전체를 중단시키지 않게 모듈을 분리합니다.
- 건강확인 API에는 비밀정보 없이 앱·DB 연결상태만 표시합니다.
- 구조화 로그에 request ID/job ID를 넣되 개인정보는 마스킹합니다.
- 마이그레이션은 버전관리하며 Production에서 자동 파괴변경을 실행하지 않습니다.
- 백업·복구 절차, 장애 알림, 책임자는 운영 전 정책을 확정합니다.

---

## 18. 구현 순서

각 단계는 기존 기능을 유지하며 `조회 → 작은 변경 → 검사 → 결과 회신 → 다음 단계`로 진행합니다. 단계별 빌드와 테스트가 통과하면 가능한 경우 스테이징, 커밋, 푸시, `git status` 확인까지 한 묶음으로 안내합니다.

### 0단계: 현황 확인과 결정 잠금

- `~/workspace/`의 Git 상태, 루트 문서, 파일구조, package.json, 환경설정만 읽습니다.
- 기존 PRD·기능명세·화면정의서가 있으면 전부 읽고 본 문서와 차이를 보고합니다.
- 21장의 미결정 사항 중 해당 단계에 필요한 정책을 사용자에게 질문합니다.
- 기존 코드가 있으면 삭제·교체를 제안하기 전에 영향범위를 설명하고 승인을 받습니다.

### 1단계: 기반 프로젝트와 공통 UI

- TypeScript 프로젝트, lint/typecheck/test/build 스크립트, 환경변수 검증을 설정합니다.
- 라우팅, 모바일 셸, 접근성 기본 UI, 오류경계, API 클라이언트를 구현합니다.
- `/api/health`와 개발용 기본 화면을 만들고 Replit 개발모드 빌드를 확인합니다.

### 2단계: DB·인증·권한

- Neon 개발/운영 연결을 분리하고 초기 비파괴 마이그레이션을 작성합니다.
- 최초 관리자 bootstrap, 로그인, 세션, 로그아웃, Resend 재설정을 구현합니다.
- 역할·권한 middleware와 감사로그 기반을 테스트합니다.
- Production DB 마이그레이션은 사용자 승인과 백업/영향 확인 후 별도 실행합니다.

### 3단계: 기준정보·학생·보호자

- 학원, 학교, 학년, 관리자 관리부터 구현합니다.
- 학생·보호자·관계·동의·수신거부 CRUD와 검색·필터를 구현합니다.
- 수정, 비활성화, 이력보존, 개인정보 마스킹을 검증합니다.
- 엑셀 가져오기는 정책 확정 후 별도 하위 단계로 추가합니다.

### 4단계: 강사·강좌·수강 이력

- 강사, 강좌, 정규일정, 예외일, 수강 등록·변경·종료를 구현합니다.
- 과거 수강 이력이 유지되는지 테스트합니다.
- 강좌별 출석기능은 추가하지 않습니다.

### 5단계: 등원

- 공개 키오스크 화면, 뒤 4자리 검색, 후보 마스킹, 다중후보 선택을 구현합니다.
- 서버 KST 기록, 당일 중복방지, 관리자 조회·수정·무효화·감사를 구현합니다.
- 모바일·태블릿·PC와 동시요청을 테스트합니다.

### 6단계: Cloudinary 파일 기반

- 서버 서명, 브라우저 직접 업로드, finalize 검증, 서버 삭제를 구현합니다.
- Vercel로 파일 본문이 전송되지 않는지 네트워크 검사로 확인합니다.
- 업로드 세션, 고아후보 탐지, 권한·소유권 테스트를 추가합니다.

### 7단계: 문자 설정·템플릿·초안

- Pushbullet 설정·기기 동기화, 템플릿 CRUD를 구현합니다.
- 조건별 수신자 선택, `{{이름}}`, 스냅샷, 중복·수신거부 검증을 구현합니다.
- 사진별 MMS 분할과 사용량 계산, 최종 점검표를 구현합니다.

### 8단계: 문자 큐·예약·기록

- 즉시/예약 승인, 배치 처리, lease, 멱등성, 순서·간격을 구현합니다.
- 새로고침 기반 상태, 실패목록, 확정 실패 재발송, 사용량 통계를 구현합니다.
- 개발에서는 실제 발송을 막는 mock/sandbox adapter를 기본 사용하고, 운영 실발송은 명시적 플래그와 최종 확인 후 검증합니다.

### 9단계: 카드뉴스

- 플랫폼 프리셋 CRUD, 프로젝트·사진·사연, 비용예상을 구현합니다.
- AI 공급자 어댑터와 사진 전달 동의, 결과 편집·렌더·다운로드를 구현합니다.
- 7일 삭제 예정 표시와 Cloudinary 정리작업을 구현합니다.

### 10단계: 보고서·운영·배포

- 대시보드, 보고서, 엑셀 내보내기, 감사조회, 운영로그를 구현합니다.
- Vercel Singapore, 별도 Neon Production, Cloudinary 설정을 검증합니다.
- 보안·성능·접근성·복구·스모크 테스트 후 배포합니다.

---

## 19. 테스트 방법

### 19.1 표준 명령어

실제 `package.json`을 먼저 확인하고 존재하는 스크립트에 맞춰 안내합니다. 새 프로젝트라면 아래 명칭을 권장합니다.

```bash
cd ~/workspace
npm run check
npm run test
npm run build
npm run test:e2e
```

`check`는 lint와 TypeScript 검사를 포함하도록 구성합니다. 데이터 삭제·초기화 명령은 자동 테스트 명령에 포함하지 않습니다.

### 19.2 단위 테스트

- KST 날짜 경계와 서버시각 변환
- 전화번호 정규화·뒤 4자리 추출
- 이름 마스킹: 한 글자·두 글자·세 글자 이상·공백 포함
- `{{이름}}` 치환과 알 수 없는 변수 거부
- 중복 전화번호와 수신거부 제외
- MMS 사진 N장일 때 발송건수 계산
- 역할별 permission matrix
- 7일 보관 만료 계산
- 메시지·등원 멱등성 키

### 19.3 API 통합 테스트

- 최초 관리자 1회 생성 및 재실행 안전성
- 로그인 실패 제한, 세션 만료, Resend 토큰 1회성
- 학생·보호자·강좌·수강 CRUD와 이력보존
- 같은 뒤 4자리 0명/1명/2명 이상 검색
- 동시 등원 요청 2개 중 1개만 성공
- 등원 수정·무효화 감사로그
- 문자 승인 직전 수신거부 변경 시 승인 중단
- 동일 idempotency key 재호출 시 중복 캠페인·발송 없음
- 재발송이 확정실패만 포함
- Cloudinary finalize 위조 public ID·bytes·소유자 거부
- 권한 없는 파일삭제·학생조회·캠페인승인 거부
- cleanup이 7일 미만 파일과 연결된 활성파일을 삭제하지 않음

외부 서비스는 기본적으로 mock adapter를 사용합니다. 실서비스 테스트가 필요할 때는 테스트 계정·테스트 수신번호·비용을 사용자가 확인한 뒤 진행합니다.

### 19.4 E2E 테스트

최소 시나리오는 다음과 같습니다.

1. 관리자 로그인 → 학생·보호자 등록 → 강좌 수강 연결 → 과거 이력 확인
2. 뒤 4자리 검색 → 다중후보 바텀시트 → 마스킹 이름 선택 → 등원 성공 → 중복 차단
3. 학생 필터 선택 → 템플릿 개인화 → 수신거부/중복 제외 → 예약 승인 → 새로고침 상태 확인
4. 사진 2장 첨부 → 수신자당 MMS 2건·각 문구 포함 확인
5. Cloudinary 직접 업로드 → 메타데이터 저장 → 서버 권한삭제
6. 카드뉴스 사진·사연 → AI 선택·동의 → 편집 → 플랫폼 규격 렌더
7. 권한 낮은 역할이 금지된 URL·API에 접근할 때 차단

### 19.5 반응형·접근성 테스트

- 모바일: 320×568, 360×800, 390×844, 430×932
- 태블릿: 768×1024, 1024×768
- PC: 1280×800, 1440×900
- 모바일 768px 이하에서 full-bleed 외곽과 내부 16px 여백을 시각 확인합니다.
- 가로 스크롤, 입력 확대, 키보드 가림, sticky 버튼 충돌, 바텀시트 스크롤을 확인합니다.
- 키보드만으로 핵심 흐름을 실행하고 label, focus, 대비, 오류읽기를 확인합니다.

### 19.6 Replit 개발모드 테스트

항상 “Replit 개발모드에서 테스트”라고 명시합니다.

- 개발 DB와 mock 외부서비스를 사용합니다.
- 사용자가 Shell 결과를 회신하면 그 결과를 기준으로 다음 명령을 안내합니다.
- Secret을 바꾼 경우 반드시 **Replit Console에서 Stop한 뒤 Run**하여 새 값을 반영하라고 안내합니다.
- 브라우저 개발자도구 Network에서 파일 본문이 Cloudinary로 직접 전송되고 Vercel/앱 API에는 메타데이터만 가는지 확인합니다.

### 19.7 Vercel 배포 후 Production 테스트

항상 “Vercel에 배포된 Production 사이트에서 테스트”라고 명시합니다.

- 배포 리전, Production 환경변수, 별도 Neon DB 연결, Cloudinary 계정·폴더를 확인합니다.
- 테스트용 학생·번호·파일임을 명확히 하고 실제 학생 데이터와 섞이지 않게 합니다.
- 로그인, 권한, 등원 KST, 직접 업로드, 예약 cron, 새로고침 상태, 7일 정리 dry-run을 확인합니다.
- 실제 SMS/MMS는 소수의 승인된 테스트 번호로만 최종 점검합니다.
- Production DB에서 reset, truncate, drop, seed 재실행을 하지 않습니다.

---

## 20. 완료 조건(Definition of Done)

기능 하나는 아래 조건을 모두 충족해야 완료입니다.

- 요구사항과 권한, 입력, 오류, 예외, 빈 화면이 구현됨
- 등록 기능에 대응하는 수정과 안전한 삭제/비활성화가 있음
- 모바일·태블릿·PC에서 핵심 조작이 가능함
- 서버 검증, 개인정보 마스킹, 감사로그가 적용됨
- 단위·통합 테스트가 추가되고 기존 테스트가 통과함
- TypeScript 검사와 Production build가 통과함
- 기존 기능이 삭제·비활성화되지 않았음을 회귀검사함
- DB 마이그레이션이 비파괴적이며 rollback 또는 복구방안이 문서화됨
- 환경변수와 운영 절차가 README에 반영됨
- 사용자에게 테스트 환경과 정확한 테스트 절차를 구분해 안내함
- 가능한 경우 커밋·푸시 후 Git 상태가 깨끗함

전체 제품 완료에는 추가로 다음이 필요합니다.

- P0 기능 전체 E2E 통과
- Vercel Singapore 배포와 별도 Neon Production 연결 확인
- Cloudinary 직접 업로드·서버 삭제 구조 검증
- 문자 중복·수신거부·재발송·사용량 방어 검증
- 카드뉴스 7일 정리 검증
- 관리자 운영 체크리스트·장애대응·백업복구 절차 확정

---

## 21. 구현 전에 사용자에게 확인해야 할 미결정 사항

아래 내용은 임의로 결정하지 않습니다. 전체를 한 번에 묻기보다 구현하려는 단계에 필요한 것만 짧게 질문합니다.

1. 실제 GitHub 저장소 이름(`*****` 부분)과 현재 저장소 초기화 여부
2. 기존 기술스택이 있다면 유지할지, 빈 프로젝트일 때 권장스택을 채택할지
3. 관리자 역할별 정확한 권한표와 한 계정의 복수 역할 허용 여부
4. 로그인 ID 형식과 최초 관리자 Secret 변수명
5. 세션 만료시간, 동시 로그인, 비밀번호 복잡도 정책
6. 학생·보호자·문자·등원·감사기록의 보관기간 및 개인정보 파기정책
7. 등원기록 수정 가능 기간, 수정 가능한 역할, 예외 중복등원 허용 여부
8. 같은 보호자 번호가 여러 학생에 연결될 때 문자 중복제거와 `{{이름}}` 처리 기준
9. 문자 최대 수신자 수, 발송간격, 야간 제한, 일·월 사용량 한도
10. 여러 Pushbullet 기기의 수동선택 외 자동 분배·장애전환 필요 여부
11. Pushbullet/안드로이드 연동으로 확인 가능한 정확한 전달상태와 앱 측 프로토콜
12. SMS/LMS/MMS 길이·비용 판정 기준과 이통사 제한
13. 수신거부 해제의 확인 절차와 법정 안내문구 정책
14. 예약발송의 수정·취소 마감시점
15. 엑셀 업로드 최대 인원·파일크기·열 형식·오류행 처리
16. 카드뉴스 지원 플랫폼별 정확한 규격, 포맷, 품질, 안전영역
17. 사용할 AI 공급자 후보·모델·비용한도·키 저장 방식
18. AI 사진 전달 동의의 대상·증빙·철회 방식
19. 카드뉴스 7일 후 프로젝트 메타데이터·AI 로그까지 지울지 여부
20. 개발 DB 제공자와 개발/운영 마이그레이션 승인 절차
21. 운영 장애 알림 채널, 책임자, 백업·복구 목표
22. Cloudinary 계정의 실제 리전/데이터 레지던시 제공조건과 파일별 제한
23. Vercel 플랜의 현재 함수 본문·실행시간·Cron 제한

---

## 22. 이 프롬프트를 받은 개발 AI의 첫 응답

바로 코드를 만들거나 Git 저장소에 접속하려 하지 마십시오. 먼저 사용자에게 아래 **조회 전용 단일 명령 블록**을 Replit Shell의 `~/workspace/`에서 실행하고 결과 전체를 회신해 달라고 안내하십시오. `set -e`를 넣지 마십시오.

```bash
cd ~/workspace
pwd
/usr/bin/git status --short --branch
find . -maxdepth 1 -type f -name '*.md' -print | sort
find . -maxdepth 2 -type f | sort | sed -n '1,240p'
```

사용자가 결과를 회신하지 않으면 실행하지 않은 것으로 간주하고 다음 변경 명령을 주지 마십시오. 결과를 받은 뒤에는:

1. 루트의 모든 Markdown 문서를 읽기 위한 조회 명령을 먼저 제공합니다.
2. `package.json`, 설정파일, 주요 엔트리 파일을 조회합니다.
3. 기존 코드와 문서가 본 명세와 충돌하는 부분을 사용자에게 보고합니다.
4. 당장 필요한 미결정 사항만 질문합니다.
5. 첫 구현 단계를 작게 제안하고 승인을 받은 범위만 변경합니다.

긴 변경은 `.cjs` 업로드형 단일 실행 패치 스크립트로 제공하고 다음 순서를 지킵니다.

1. `.cjs` 파일 업로드 확인
2. `node --check 패치파일.cjs`
3. 패치 실행
4. typecheck·test·build
5. 변경내용과 기존기능 회귀 확인
6. 가능한 경우 stage·commit·push·git status를 한 번에 수행
7. 적용 완료가 확인된 후 임시 패치파일 삭제

단, 임시파일 삭제는 명시적으로 그 파일만 대상으로 하고 다른 파일을 삭제하지 마십시오. 사용자에게서 각 실행 결과가 올 때마다 그 실제 결과를 근거로 다음 명령을 작성하십시오.

---

## 23. 최종 지시

이 문서는 구현의 기준선입니다. 핵심 요구를 축소하거나 편의상 다른 기능으로 바꾸지 마십시오. 확실하지 않으면 먼저 조회하고, 정책 결정이 필요하면 사용자에게 묻고, 기존 기능에 영향이 있으면 변경 전에 설명하고 승인을 받으십시오. 기능별로 작게 구현하고 Replit 개발모드에서 검증한 뒤, 운영 배포 단계에서만 Vercel Production과 별도 Neon Production DB를 점검하십시오.
