# agent-workboard (한국어 소개)

> 여러 AI 코딩 에이전트(Claude Code·Codex·Gemini)가 같은 코드베이스를 동시에 작업할 때 서로 충돌하지 않게 막아주는 **claim 보드**.

[English README](README.md)

## 어떤 문제를 푸나

에이전트를 두세 개 동시에 굴리는 게 흔해진 지금, 같은 저장소를 동시에 건드리면 파일이 조용히 덮어써지거나 작업이 꼬입니다. 파일 락은 소용없습니다 — 에이전트는 턴 사이에 파일 핸들을 들고 있지 않으니까요. 해법은 세션 단위 규약입니다: **편집 전에 출근 체크(claim), 끝나면 퇴근 체크(release)**, 그리고 모두가 보는 보드.

## 핵심 기능

- **REST 서버 + 실시간 대시보드** — 누가 어디서 무엇을 작업 중인지 한눈에, 충돌·만료(stale) 경고
- **CLI** (`workboard claim/release/list/check`) — 셸 명령을 쓸 수 있는 에이전트면 무엇이든 참여 가능
- **Claude Code 통합 킷** — 핵심 차별점:
  - `PreToolUse` 훅이 다른 에이전트가 claim 한 리소스 편집을 **실제로 차단**(누가 점유 중인지 표시)
  - 세션 시작/종료 시 자동 claim/release, `/claim` `/release` `/board` 슬래시 명령
  - `install-claude` 한 번으로 설치
- **TTL 자동 회수** — 죽은 세션의 claim 은 일정 시간 뒤 자동 해제

## 기술 스택

Node.js · Express · better-sqlite3 · MCP-friendly · 의존성 최소, 포트 1개, 로컬 전용

## 이 프로젝트의 핵심 포인트

claim 보드 자체는 단순합니다. 진짜 가치는 **"규약"을 "강제"로 끌어올린 통합 레이어**예요 — 문서로 "claim 하세요"라고 적어두면 에이전트가 까먹지만, `PreToolUse` 훅을 쓰면 어기는 순간 편집이 막힙니다. 멀티 에이전트 협업이라는 최신 문제를, 도구를 강제하는 방식으로 푼 점이 차별점입니다.
