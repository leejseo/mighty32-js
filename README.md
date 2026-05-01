# Mighty32 JS

가볍게 혼자 즐길 수 있는 5인 마이티 웹게임입니다. 레트로 데스크톱 UI, CPU 4명, 로컬 서버 기반 전적 저장을 포함합니다.

## Acknowledgements

이 프로젝트는 장문성 님(`sw6ueyz@hitel.net`)이 개발한 Windows 고전 마이티 게임 `마이티 네트워크 3.2`, 흔히 `Mighty32`라고 불리던 프로그램의 기억과 감성에서 많은 영향을 받았습니다.

`Mighty32 JS`는 원작의 네트워크 클라이언트나 소스 코드를 계승한 프로젝트가 아니라, 브라우저에서 가볍게 혼자 플레이할 수 있도록 새로 만든 오마주 구현입니다. 레트로 데스크톱 UI, 친숙한 캐릭터 구성, 부담 없이 한 판 돌리는 플레이 감각은 `마이티 네트워크 3.2`에 대한 존중을 담아 설계했습니다.

## Features

- 1인 대 4 CPU 마이티 진행
- 입찰, 주공 결정, 프렌드 지정, 바닥패 묻기, 10트릭 플레이, 결과 저장
- 스페이드 A 기본 마이티, 스페이드 기루일 때 다이아 A 마이티
- 노기루 입찰, 조커 문양 지정, 조커콜 선언/일반 리드 선택
- 첫 트릭 제한, 마이티 리드 시 스페이드 팔로우, 조커 첫/마지막 트릭 최약 처리
- CPU 캐릭터 이름/이미지 커스터마이즈
- 게임 기록을 `data/games.jsonl`에 JSON Lines 형식으로 저장

## Run

```bash
npm start
```

브라우저에서 다음 주소를 엽니다.

```text
http://127.0.0.1:4173/
```

포트를 바꾸려면 `PORT` 환경 변수를 지정합니다.

```bash
PORT=5173 npm start
```

## GitHub Pages

This repository includes a GitHub Actions workflow that deploys the static app to GitHub Pages on every push to `main`.

```text
https://leejseo.com/mighty32-js/
```

`https://leejseo.github.io/mighty32-js/` redirects to the same deployment.

On GitHub Pages, game records are not saved. The Pages workflow writes `pages-config.js` with `window.MIGHTY32_PAGES_MODE = true`, and the app disables the records API, IndexedDB, and localStorage record fallback in that mode. Forks can reuse the same workflow without editing any domain names.

## Data

완료된 게임 기록은 서버 실행 중 `data/games.jsonl`에 저장됩니다. 이 파일은 개인 플레이 기록이므로 Git에는 포함하지 않습니다.

`data/README.md`는 데이터 디렉터리 용도를 설명하기 위해 커밋합니다.

## Project Structure

```text
.
├── app.js
├── assets/avatars/
├── data/
├── index.html
├── server.js
├── styles.css
└── PRD.md
```

## License

MIT
