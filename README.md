# Mighty32 JS

가볍게 혼자 즐길 수 있는 5인 마이티 웹게임입니다. 레트로 데스크톱 UI, CPU 4명, 로컬 서버 기반 전적 저장을 포함합니다.

## Acknowledgements

이 프로젝트는 장문성 님(`sw6ueyz@hitel.net`)이 개발한 Windows 고전 마이티 게임 `마이티 네트워크 3.2`, 흔히 `Mighty32`라고 불리던 프로그램의 기억과 감성에서 많은 영향을 받았습니다.

`Mighty32 JS`는 원작의 네트워크 클라이언트나 소스 코드를 계승한 프로젝트가 아니라, 브라우저에서 가볍게 혼자 플레이할 수 있도록 새로 만든 오마주 구현입니다. 레트로 데스크톱 UI, 친숙한 캐릭터 구성, 부담 없이 한 판 돌리는 플레이 감각은 `마이티 네트워크 3.2`에 대한 존중을 담아 설계했습니다.

## Features

- 1인 대 4 CPU 마이티 진행
- 입찰, 주공 결정, 바닥패 확인 후 공약 조정, 프렌드 지정, 바닥패 묻기, 10트릭 플레이, 결과 저장
- 스페이드 A 기본 마이티, 스페이드 기루일 때 다이아 A 마이티
- 노기루 입찰, 조커 문양 지정, 조커콜 선언/일반 리드 선택
- 첫 트릭 기루 제한, 마이티 리드 시 스페이드 팔로우, 조커 첫/마지막 트릭 최약 처리
- 현재 트릭 알파베타 탐색과 공개 카드 카운팅을 섞은 CPU 카드 선택
- 정적 소형 정책 모델(`assets/models/mighty-policy-v1.js`, `.bin`)을 입찰/플레이 점수 보정에 사용
- `tools/train-ai.js`로 학습 AI 1명과 룰베이스 AI 4명의 입찰부터 플레이까지 반복 대국 및 모델 갱신
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

## AI Training

현재 앱은 기존 룰베이스 평가에 선형 정책 모델과 작은 MLP 정책 모델을 더합니다. 모델은 GitHub Pages에서도 그대로 받을 수 있는 정적 JS/바이너리 파일입니다.

```bash
npm run ai:eval
npm run ai:train -- --iterations=12 --candidates=10 --games=1200 --repeats=6 --seed=20260513
npm run ai:pipeline -- --iterations=10 --candidates=8 --train-games=1400 --eval-games=4000 --repeats=6
npm run ai:pipeline -- --mlp --fresh --epochs=8 --train-games=2200 --eval-games=3000 --inner-eval-games=1000 --repeats=5
npm run ai:campaign -- --runs=20 --opponent-generations=8
```

검증 예시:

```text
node tools/train-ai.js --eval --games=10000 --seed=20261101
eval: score=0.0709 win=50.9% bid=18.0% dec=47.2% def=53.3% games=10000
```

관련 연구 노트는 `docs/ai-research.md`에 정리했습니다.

`tools/`의 학습 스크립트와 `assets/models/*.js`, `assets/models/*.bin`은 커밋 대상입니다. `data/training-runs/`에는 파이프라인 실행 로그와 후보 검증 결과가 저장되며 중간 데이터라서 Git에서는 제외합니다.

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
├── assets/models/
├── data/
├── docs/
├── index.html
├── server.js
├── styles.css
├── tools/train-ai.js
└── PRD.md
```

## License

MIT
