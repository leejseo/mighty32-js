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
- Added `tools/run-ai-campaign.js` for repeated pipeline runs that commit and push accepted model generations.
- Expanded the MLP dataset pipeline from learner-only rows to all five players' real decisions. Rewards are recalculated from each actor's side, then persisted as JSONL shards under `data/training-datasets/`.
- Added replay-buffer training over persisted shards, deterministic train/validation/test row splits, prior-generation opponent sampling, and `--train-bid=false` / `--train-play=false` ablation controls.
- Expanded training rows from selected actions to top candidate actions. Selected actions use played return, non-selected candidates use a low-weight score-delta target, and sampled play candidates can use full-game rollout reward labels.
- Added `tools/review-ai-game.js` and `npm run ai:review` for manual decision trace review with hands, current trick, selected action, and top alternatives.
- Added optional role-specific play heads: `playHeads.declarer`, `playHeads.friend`, and `playHeads.defense`. Runtime inference picks one role head, falling back to the shared play head for older models.

## Current Model

The runtime model is still small enough for static hosting, but no longer just a linear scorer:

- Bid head: 16 linear features.
- Play head: 28 linear features.
- Linear binary size: 188 bytes.
- MLP bid head: 16 inputs, 64 hidden units.
- MLP play head: 28 inputs, 128 hidden units.
- MLP binary size: about 20 KB for the shared-head model, about 66 KB when role-specific play heads are present.
- Browser runtime: plain JavaScript plus optional static binary fetch.

Latest validation command:

```bash
node tools/train-ai.js --eval --games=15000 --seed=20261109
```

Observed result:

```text
eval: score=0.0930 win=51.3% bid=18.7% dec=47.0% def=54.1% games=15000
```

This is a modest edge, not a solved AI. The main gain is defensive play and more disciplined bidding. Declarer play remains the largest weakness.

Training scripts and model artifacts should be committed. Pipeline run logs under `data/training-runs/` and replay shards under `data/training-datasets/` are intermediate local data and are ignored. The current local replay store is intentionally larger than the model artifact; after adding candidate-action, rollout, and role labels it reached 3.0 GB across 45 shard files plus one manifest.

To reduce overfitting to the current rulebase, the pipeline snapshots previous MLP generations under `data/training-runs/model-snapshots/` and mixes those older policies into non-learner seats during training and holdout evaluation. These snapshots are local intermediate data; only accepted runtime artifacts under `assets/models/` are committed.

Latest accepted pipeline run:

```text
baseline holdout:  score=0.0700 win=51.0% bid=21.8% dec=45.9% def=54.6% games=9000
candidate holdout: score=0.0736 win=50.8% bid=21.5% dec=46.0% def=54.0% games=9000
accepted: score delta 0.0036, win delta -0.17pp
```

Latest accepted MLP run:

```text
command: npm run ai:pipeline -- --mlp --epochs=5 --train-games=2400 --eval-games=6000 --inner-eval-games=2500 --repeats=6 --seed=20260714 --min-score-delta=0.002 --exploration=0.05 --learning-rate=0.00035 --batch-size=192 --train-passes=2 --opponent-generations=8 --replay-samples=160000 --replay-ratio=0.8 --validation-replay-samples=24000 --train-play=false
baseline holdout:  score=0.0827 win=51.3% bid=18.7% dec=48.0% def=53.4% games=18000
candidate holdout: score=0.0895 win=51.4% bid=18.7% dec=48.1% def=53.5% games=18000
accepted: score delta 0.0068, win delta 0.10pp
```

Latest candidate-action experiments:

```text
rollout candidate labels:
  command: npm run ai:pipeline -- --mlp --epochs=4 --train-games=1400 --eval-games=6000 --inner-eval-games=2200 --repeats=6 --seed=20260723 --candidate-limit=3 --play-rollout-samples=1 --play-rollout-rate=0.025
  dataset: about 164k rows/epoch, about 3k play-rollout labels/epoch
  holdout: baseline score=0.0686, candidate score=0.0698, reverted by gate at +0.0012
bid-only candidate labels:
  command: npm run ai:pipeline -- --mlp --epochs=5 --train-games=1800 --eval-games=6000 --inner-eval-games=2400 --repeats=6 --seed=20260724 --candidate-limit=3 --train-play=false
  dataset: about 211k rows/epoch
  holdout: baseline score=0.1069, candidate score=0.1065, reverted by gate at -0.0004
role-specific play heads:
  command: npm run ai:pipeline -- --mlp --epochs=5 --train-games=1800 --eval-games=6000 --inner-eval-games=2400 --repeats=6 --seed=20260812 --candidate-limit=2 --play-rollout-samples=1 --play-rollout-rate=0.015 --train-bid=false
  dataset: about 163k rows/epoch, about 2.3k play-rollout labels/epoch
  latest role split: declarer=32677, friend=31880, defense=91934 play rows
  holdout: baseline score=0.0888, candidate score=0.0888, reverted by gate at +0.0000
```

Manual trace review with `npm run ai:review -- --games=2 --seed=20260801 --limit=28` showed two useful patterns:

- The AI can find some friend-tempo lines, such as low suit leads that let the friend spend joker and return control.
- It still hesitates around the transition from tempo gain to trump cleanup and point cash-out. In one reviewed club-contract game, declarer-side play won early points but then led low hearts while still holding multiple high trump, giving defense tempo. This supports splitting the single play head into declarer, friend, and defense heads.

Latest 20-run campaign with prior-generation opponents:

```text
runs: 20
accepted: 4 (runs 4, 7, 8, 11)
reverted: 16
latest accepted commits:
- 200452a Improve MLP policy campaign run 4
- e4f1aa1 Improve MLP policy campaign run 7
- 7feed35 Improve MLP policy campaign run 8
- daaa1ba Improve MLP policy campaign run 11
final sanity eval: score=0.0573 win=50.6% bid=18.3% dec=47.0% def=52.9% games=10000
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
