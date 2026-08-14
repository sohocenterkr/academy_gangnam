# 학원 업무자동화 (academy_gangnam)

강남 학원 업무자동화 웹사이트. 전체 요구사항은
[`academy_automation_final_development_prompt.md`](./academy_automation_final_development_prompt.md)를 참고하세요.
개발 방식(로컬 환경, DB, 배포)은 [`CLAUDE.md`](./CLAUDE.md)에 정리되어 있습니다.

## 로컬 개발 시작하기

```bash
npm install
cp .env.example .env
npm run dev
```

`npm run dev`를 실행하면 브라우저 화면(5173번 포트)과 서버(8787번 포트)가 동시에 켜집니다.
브라우저에서 http://localhost:5173 을 열면 서버 연결 상태가 화면에 표시됩니다.

## 자주 쓰는 명령어

| 명령어 | 하는 일 |
|---|---|
| `npm run dev` | 로컬 개발 서버 실행 |
| `npm run check` | 코드 스타일 검사 + 타입 검사 |
| `npm run test` | 단위·통합 테스트 실행 |
| `npm run test:e2e` | 브라우저 자동화 테스트 실행 |
| `npm run build` | 배포용 정적 파일 생성 |

## 환경변수

`.env.example` 파일에 필요한 환경변수 목록이 있습니다. 이 단계(Stage 1)에서는 서버 포트와
접속 주소만 있으면 되고, DB·이메일·파일저장·문자발송·AI 관련 값은 해당 기능을 만드는 단계에서
채웁니다.
