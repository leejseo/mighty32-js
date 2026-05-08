# Mighty AI Research Notes

## Strategy Notes Used

The public strategy material points to a few concrete fixes for this codebase:

- Bidding should care about first-lead stability and trump length together. A strong side ace/top card plus a 5-card trump suit is a practical 15-point shape; no first lead should lower confidence.
- Declarer should normally draw trump after tempo is secured, but with joker-friend shape it is often better to lead a low trump first so the friend can win with joker and return trump.
- Friend should not hide for identity value. If declarer is losing a low lead or low trump lead, friend should usually spend mighty/joker early, then return trump or the suit declarer exposed.
- Defense should avoid leading trump for declarer. When defense wins tempo, spade attack against mighty, joker-call checks, first-trick ruffing, and protecting one weak suit are high-value ideas.
- Joker is not always a treasure. It can be thrown away when powerless or when preserving high trump/point trump is more valuable.

Sources:

- Integral, "5. 마이티 기본전략 - 선거, 프렌드 부르기": https://mightyfriend.net/?p=86
- Integral, "6. 마이티 기본전략 - 주공편": https://mightyfriend.net/?p=95
- Integral, "7. 마이티 기본전략 - 프렌드편": https://mightyfriend.net/?p=119
- Integral, "8. 마이티 기본전략 - 반주공편": https://mightyfriend.net/?p=147
- Integral, "9. 마이티 기본전략 - 노 기루다": https://mightyfriend.net/?p=181
- Integral, "10. 마이티 고급전략 - 조커 활용법": https://mightyfriend.net/?p=207
- WING Board Game rules reference: https://www.wingboardgame.com/2023/08/blog-post_30.html

## Implemented Fixes

- Fixed joker-call suit selection. Joker call is club 3 by default, and spade 3 only when clubs are trump. Heart trump no longer changes joker call to diamond 3.
- Added a small learned policy layer over the existing rulebase. It does not replace the hand-built AI; it adds bounded bid/play score adjustments.
- Added `tools/train-ai.js`, a headless simulator that seats one learned agent against four rulebase agents and plays the whole flow: deal, bidding, contract, friend, discard, and 10 tricks.
- Added static model artifacts:
  - `assets/models/mighty-policy-v1.js`
  - `assets/models/mighty-policy-v1.bin`
  - `assets/models/mighty-mlp-policy-v2.js`
  - `assets/models/mighty-mlp-policy-v2.bin`
- Added `tools/ai-pipeline.js` to run baseline evaluation, candidate training, holdout evaluation, and automatic rollback if the candidate fails the acceptance gate.
- Added `tools/train-mlp-ai.js` for Monte-Carlo return training of bid/play MLP heads from self-play trajectories.

## Current Model

The runtime model is still small enough for static hosting, but no longer just a linear scorer:

- Bid head: 16 linear features.
- Play head: 28 linear features.
- Linear binary size: 188 bytes.
- MLP bid head: 16 inputs, 64 hidden units.
- MLP play head: 28 inputs, 128 hidden units.
- MLP binary size: about 20 KB.
- Browser runtime: plain JavaScript plus optional static binary fetch.

Latest validation command:

```bash
node tools/train-ai.js --eval --games=10000 --seed=20261101
```

Observed result:

```text
eval: score=0.0709 win=50.9% bid=18.0% dec=47.2% def=53.3% games=10000
```

This is a modest edge, not a solved AI. The main gain is defensive play and more disciplined bidding. Declarer play remains the largest weakness.

Training scripts and model artifacts should be committed. Pipeline run logs under `data/training-runs/` are intermediate local data and are ignored.

Latest accepted pipeline run:

```text
baseline holdout:  score=0.0700 win=51.0% bid=21.8% dec=45.9% def=54.6% games=9000
candidate holdout: score=0.0736 win=50.8% bid=21.5% dec=46.0% def=54.0% games=9000
accepted: score delta 0.0036, win delta -0.17pp
```

Latest accepted MLP run:

```text
baseline holdout:  score=0.0384 win=50.0% bid=20.2% dec=45.6% def=53.0% games=15000
candidate holdout: score=0.1083 win=51.5% bid=18.3% dec=48.7% def=53.3% games=15000
accepted: score delta 0.0699, win delta 1.47pp
```

## GitHub Pages Feasibility

GitHub Pages is static hosting for HTML/CSS/JavaScript and repository files, so a browser-side model file is feasible as long as inference runs in the client. Official GitHub docs describe Pages as static hosting that serves files from the repository.

For larger future models:

- TensorFlow.js supports a JSON model file plus a binary weights file (`.weights.bin`), which matches GitHub Pages well.
- ONNX Runtime Web can run model files in the browser and requires JavaScript plus WebAssembly assets and model files.

Sources:

- GitHub Pages docs: https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages
- TensorFlow.js save/load docs: https://www.tensorflow.org/js/guide/save_load
- ONNX Runtime Web deployment docs: https://onnxruntime.ai/docs/tutorials/web/deploy.html

## Next AI Work

- Stop letting every AI use the true hidden friend owner before reveal. The current game logic still uses omniscient team lookup in many scoring paths.
- Add sampled hidden-hand rollout beyond the current trick. The current app only searches inside the current trick.
- Train separate bid, declarer-play, friend-play, and defense-play heads. A single play head is too blunt.
- Add scenario tests for common expert patterns: low trump to joker friend, friend immediate mighty support, defense spade attack, joker-call timing, and no-trump suit return.
