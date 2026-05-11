const fs = require("node:fs");
const path = require("node:path");
const engine = require("./train-ai.js");

const ROOT = path.join(__dirname, "..");
const DATASET_DIR = path.join(ROOT, "data/training-datasets");
const SHARD_DIR = path.join(DATASET_DIR, "shards");
const MANIFEST_PATH = path.join(DATASET_DIR, "manifest.jsonl");

function main() {
  const options = parseArgs(process.argv.slice(2));
  const seed = Number(options.seed || 20260521);
  const epochs = Number(options.epochs || 8);
  const gamesPerEpoch = Number(options.games || 2500);
  const evalGames = Number(options.evalGames || 3000);
  const repeats = Number(options.repeats || 5);
  const exploration = Number(options.exploration || 0.12);
  const learningRate = Number(options.learningRate || 0.0025);
  const batchSize = Number(options.batchSize || 96);
  const trainPasses = Number(options.trainPasses || 3);
  const bidHidden = Number(options.bidHidden || 32);
  const playHidden = Number(options.playHidden || 64);
  const opponentModels = engine.loadOpponentModels(options.opponentMlpPaths);
  const saveDataset = options.saveDataset !== "false";
  const replaySamples = Number(options.replaySamples || 60000);
  const replayRatio = Number(options.replayRatio || 0.75);
  const validationReplaySamples = Number(options.validationReplaySamples || 12000);
  const trainBid = options.trainBid !== "false";
  const trainPlay = options.trainPlay !== "false";
  const candidateLimit = Number(options.candidateLimit || 3);
  const playRolloutSamples = Number(options.playRolloutSamples || 0);
  const rolloutCandidateLimit = Number(options.rolloutCandidateLimit || 2);
  const playRolloutRate = Number(options.playRolloutRate || 0);
  const rolloutExploration = Number(options.rolloutExploration || 0.025);
  const rolePlayHeads = options.rolePlayHeads !== "false";

  const rng = engine.createRng(seed);
  const baseModel = engine.loadModel();
  const mlp = options.fresh || !baseModel.mlp
    ? createMlpModel({ rng, bidHidden, playHidden })
    : engine.cloneMlpModel(baseModel.mlp);
  if (rolePlayHeads) {
    ensureRolePlayHeads(mlp);
  }
  let workingModel = {
    ...baseModel,
    mlp,
  };
  let bestMlp = engine.cloneMlpModel(mlp);
  let bestResult = engine.evaluateModelSuite(workingModel, evalGames, seed + 700001, repeats, opponentModels);
  printEval("initial", bestResult);

  const history = [];
  for (let epoch = 1; epoch <= epochs; epoch += 1) {
    const samples = collectSamples({
      rng,
      model: workingModel,
      games: gamesPerEpoch,
      exploration,
      opponentModels,
      seed: seed + epoch * 9176,
      epoch,
      candidateLimit,
      playRolloutSamples,
      rolloutCandidateLimit,
      playRolloutRate,
      rolloutExploration,
    });
    const replay = loadReplaySamples({
      rng,
      maxSamples: replaySamples,
      validationSamples: validationReplaySamples,
    });
    const split = splitSamples(samples, rng, 0.88);
    if (saveDataset) {
      writeDatasetShard(samples, {
        seed,
        epoch,
        games: gamesPerEpoch,
        exploration,
        modelVersion: workingModel.mlp.version || 0,
        opponentModels: opponentModels.length,
        candidateLimit,
        playRolloutSamples,
        rolloutCandidateLimit,
        playRolloutRate,
      });
    }
    const trainSamples = {
      bid: mergeReplay(split.train.bid, replay.train.bid, replayRatio, rng),
      play: mergeReplay(split.train.play, replay.train.play, replayRatio, rng),
    };
    const validationSamples = {
      bid: mergeReplay(split.validation.bid, replay.validation.bid, 0.35, rng),
      play: mergeReplay(split.validation.play, replay.validation.play, 0.35, rng),
    };
    const bidStats = trainBid
      ? trainHead(workingModel.mlp.bid, trainSamples.bid, {
          rng,
          learningRate,
          batchSize,
          passes: trainPasses,
          l2: 0.00008,
        })
      : skippedHeadStats(workingModel.mlp.bid, trainSamples.bid);
    const playStats = trainPlay
      ? trainPlayHeads(workingModel.mlp, trainSamples.play, {
          rng,
          learningRate,
          batchSize,
          passes: trainPasses,
          l2: 0.00005,
          rolePlayHeads,
        })
      : skippedPlayStats(workingModel.mlp, trainSamples.play, rolePlayHeads);
    const validation = {
      bidLoss: lossForSamples(workingModel.mlp.bid, validationSamples.bid),
      playLoss: lossForPlaySamples(workingModel.mlp, validationSamples.play, rolePlayHeads),
      replay: {
        trainBid: trainSamples.bid.length - split.train.bid.length,
        trainPlay: trainSamples.play.length - split.train.play.length,
        validationBid: validationSamples.bid.length - split.validation.bid.length,
        validationPlay: validationSamples.play.length - split.validation.play.length,
      },
    };
    const evalResult = engine.evaluateModelSuite(workingModel, evalGames, seed + 700001 + epoch * 8191, repeats, opponentModels);
    const improved = evalResult.score > bestResult.score + 0.002;
    if (improved) {
      bestMlp = engine.cloneMlpModel(workingModel.mlp);
      bestResult = evalResult;
    } else {
      workingModel.mlp = engine.cloneMlpModel(bestMlp);
    }
    history.push({
      epoch,
      samples: {
        bid: samples.bid.length,
        play: samples.play.length,
        replayBid: validation.replay.trainBid,
        replayPlay: validation.replay.trainPlay,
      },
      bidStats,
      playStats,
      validation,
      eval: evalResult,
      improved,
    });
    printEpoch(epoch, samples, bidStats, playStats, validation, evalResult, improved);
  }

  const finalModel = {
    name: "mighty-mlp-policy-v2",
    version: Number(bestMlp.version || 1) + 1,
    source: "mlp-self-play-monte-carlo",
    enabled: true,
    training: {
      generatedAt: new Date().toISOString(),
      seed,
      epochs,
      gamesPerEpoch,
      evalGames,
      repeats,
      exploration,
      opponentModels: opponentModels.length,
      learningRate,
      batchSize,
      trainPasses,
      saveDataset,
      replaySamples,
      replayRatio,
      validationReplaySamples,
      trainBid,
      trainPlay,
      rolePlayHeads,
      candidateLimit,
      playRolloutSamples,
      rolloutCandidateLimit,
      playRolloutRate,
      rolloutExploration,
      bestScore: bestResult.score,
      history,
      bidFeatures: engine.BID_FEATURES,
      playFeatures: engine.PLAY_FEATURES,
    },
    bid: bestMlp.bid,
    play: bestMlp.play,
    playHeads: bestMlp.playHeads || null,
  };
  engine.writeMlpModel(finalModel);
  printEval("best", bestResult);
}

function parseArgs(args) {
  return args.reduce((parsed, arg) => {
    if (arg === "--fresh") {
      parsed.fresh = true;
      return parsed;
    }
    const match = arg.match(/^--([^=]+)=(.*)$/);
    if (match) {
      parsed[toCamelCase(match[1])] = match[2];
    }
    return parsed;
  }, {});
}

function toCamelCase(value) {
  return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function createMlpModel({ rng, bidHidden, playHidden }) {
  return {
    name: "mighty-mlp-policy-v2",
    version: 1,
    source: "fresh",
    enabled: true,
    bid: createHead(engine.BID_FEATURES.length, bidHidden, 0.45, rng),
    play: createHead(engine.PLAY_FEATURES.length, playHidden, 0.28, rng),
  };
}

function ensureRolePlayHeads(mlp) {
  if (mlp.playHeads) {
    return;
  }
  mlp.playHeads = engine.PLAY_ROLES.reduce((heads, role) => {
    heads[role] = cloneHead(mlp.play);
    return heads;
  }, {});
}

function cloneHead(head) {
  return {
    ...head,
    w1: head.w1.slice(),
    b1: head.b1.slice(),
    w2: head.w2.slice(),
  };
}

function createHead(input, hidden, outputScale, rng) {
  const fanInScale = Math.sqrt(2 / input);
  return {
    input,
    hidden,
    outputScale,
    w1: Array.from({ length: input * hidden }, () => gaussian(rng) * fanInScale),
    b1: Array(hidden).fill(0),
    w2: Array.from({ length: hidden }, () => gaussian(rng) * Math.sqrt(2 / hidden)),
    b2: 0,
  };
}

function collectSamples({
  rng,
  model,
  games,
  exploration,
  opponentModels,
  seed,
  epoch,
  candidateLimit,
  playRolloutSamples,
  rolloutCandidateLimit,
  playRolloutRate,
  rolloutExploration,
}) {
  const samples = {
    bid: [],
    play: [],
  };
  for (let gameIndex = 0; gameIndex < games; gameIndex += 1) {
    const learnerIndex = gameIndex % 5;
    engine.runGame({
      rng,
      learnerIndex,
      model,
      exploration,
      opponentModels,
      candidateLimit,
      playRolloutSamples,
      rolloutCandidateLimit,
      playRolloutRate,
      rolloutExploration,
      collector: (sample) => {
        const target = targetForSample(sample);
        const row = {
          id: `${seed}:${epoch}:${gameIndex}:${sample.kind}:${samples.bid.length + samples.play.length}`,
          seed,
          epoch,
          gameIndex,
          learnerIndex,
          actorIndex: Number.isInteger(sample.actorIndex) ? sample.actorIndex : learnerIndex,
          kind: sample.kind,
          split: chooseSplit(seed, epoch, gameIndex, sample.kind, samples.bid.length + samples.play.length),
          features: sample.features,
          target,
          weight: sampleWeight(sample),
          reward: roundSampleNumber(sample.reward),
          rolloutReward: sample.rolloutReward === null || sample.rolloutReward === undefined
            ? null
            : roundSampleNumber(sample.rolloutReward),
          selected: sample.selected !== false,
          labelSource: sample.labelSource || "played-return",
          candidateRank: Number.isInteger(sample.candidateRank) ? sample.candidateRank : 0,
          selectedRank: Number.isInteger(sample.selectedRank) ? sample.selectedRank : 0,
          candidateCount: Number(sample.candidateCount || 1),
          scoreDelta: roundSampleNumber(sample.scoreDelta || 0),
          candidateScore: roundSampleNumber(sample.candidateScore || 0),
          chosenScore: roundSampleNumber(sample.chosenScore || 0),
          actorWon: Boolean(sample.actorWon),
          actorDeclarerSide: Boolean(sample.actorDeclarerSide),
          actorDeclared: Boolean(sample.actorDeclared),
          learnerWon: Boolean(sample.learnerWon),
          learnerDeclarerSide: Boolean(sample.learnerDeclarerSide),
          learnerDeclared: Boolean(sample.learnerDeclared),
          trickNumber: sample.trickNumber || 0,
          isLead: Boolean(sample.isLead),
          cardId: sample.cardId || null,
          playRole: sample.kind === "play" ? samplePlayRole(sample) : null,
          trump: sample.trump || null,
          contractTarget: sample.target || null,
        };
        if (sample.kind === "bid") {
          samples.bid.push(row);
        } else if (sample.kind === "play") {
          samples.play.push(row);
        }
      },
    });
  }
  return samples;
}

function chooseSplit(seed, epoch, gameIndex, kind, offset) {
  const value = hashString(`${seed}:${epoch}:${gameIndex}:${kind}:${offset}`) % 1000;
  if (value < 850) {
    return "train";
  }
  if (value < 950) {
    return "validation";
  }
  return "test";
}

function rewardToTarget(reward) {
  return clamp(reward / 2.6, -1.3, 1.3);
}

function targetForSample(sample) {
  if (Number.isFinite(sample.rolloutReward)) {
    return rewardToTarget(sample.rolloutReward);
  }
  const base = rewardToTarget(sample.reward);
  if (sample.selected !== false) {
    return base;
  }
  const deltaScale = sample.kind === "bid" ? 0.18 : 0.035;
  const adjustment = clamp((sample.scoreDelta || 0) * deltaScale, -0.55, 0.55);
  return clamp(base + adjustment, -1.3, 1.3);
}

function samplePlayRole(sample) {
  if (engine.PLAY_ROLES.includes(sample.playRole)) {
    return sample.playRole;
  }
  if (sample.actorDeclared) {
    return "declarer";
  }
  return sample.actorDeclarerSide ? "friend" : "defense";
}

function sampleWeight(sample) {
  const absReward = Math.min(2.4, Math.abs(sample.reward || 0));
  const phaseWeight = sample.kind === "bid" ? 1.25 : sample.isLead ? 1.08 : 1;
  const selectedWeight = sample.selected === false ? 0.34 : 1;
  const rolloutWeight = Number.isFinite(sample.rolloutReward) ? 1.25 : 1;
  return phaseWeight * selectedWeight * rolloutWeight * (0.55 + absReward * 0.32);
}

function splitSamples(samples, rng, trainRatio) {
  return {
    train: {
      bid: takeSplit(samples.bid, rng, trainRatio, true, "train"),
      play: takeSplit(samples.play, rng, trainRatio, true, "train"),
    },
    validation: {
      bid: takeSplit(samples.bid, rng, trainRatio, false, "validation"),
      play: takeSplit(samples.play, rng, trainRatio, false, "validation"),
    },
  };
}

function takeSplit(samples, rng, trainRatio, wantTrain, preferredSplit) {
  const splitRows = samples.filter((sample) => sample.split === preferredSplit);
  if (splitRows.length) {
    return splitRows;
  }
  return samples.filter(() => (rng() < trainRatio) === wantTrain);
}

function mergeReplay(current, replay, replayRatio, rng) {
  if (!replay.length || replayRatio <= 0) {
    return current.slice();
  }
  const replayLimit = Math.min(replay.length, Math.ceil(current.length * replayRatio));
  const selectedReplay = sampleRows(replay, replayLimit, rng);
  return current.concat(selectedReplay);
}

function sampleRows(rows, limit, rng) {
  if (rows.length <= limit) {
    return rows.slice();
  }
  const copy = rows.slice();
  shuffleInPlace(copy, rng);
  return copy.slice(0, limit);
}

function writeDatasetShard(samples, metadata) {
  fs.mkdirSync(SHARD_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "-");
  const shardName = `${stamp}-seed-${metadata.seed}-epoch-${String(metadata.epoch).padStart(2, "0")}.jsonl`;
  const shardPath = path.join(SHARD_DIR, shardName);
  const rows = samples.bid.concat(samples.play);
  const content = rows.map((row) => JSON.stringify(row)).join("\n");
  fs.writeFileSync(shardPath, `${content}\n`);
  const splitCounts = rows.reduce((counts, row) => {
    counts[row.kind] = counts[row.kind] || { train: 0, validation: 0, test: 0 };
    counts[row.kind][row.split] += 1;
    return counts;
  }, {});
  const labelCounts = rows.reduce((counts, row) => {
    const key = row.labelSource || "unknown";
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
  const manifest = {
    createdAt: new Date().toISOString(),
    shard: path.relative(ROOT, shardPath),
    rows: rows.length,
    splitCounts,
    labelCounts,
    metadata,
  };
  fs.mkdirSync(DATASET_DIR, { recursive: true });
  fs.appendFileSync(MANIFEST_PATH, `${JSON.stringify(manifest)}\n`);
}

function loadReplaySamples({ rng, maxSamples, validationSamples }) {
  const replay = {
    train: { bid: [], play: [] },
    validation: { bid: [], play: [] },
  };
  const shards = listDatasetShards();
  if (!shards.length || maxSamples <= 0) {
    return replay;
  }
  const trainLimitByKind = Math.floor(maxSamples / 2);
  const validationLimitByKind = Math.floor(validationSamples / 2);
  for (const shardPath of shards) {
    if (
      replay.train.bid.length >= trainLimitByKind &&
      replay.train.play.length >= trainLimitByKind &&
      replay.validation.bid.length >= validationLimitByKind &&
      replay.validation.play.length >= validationLimitByKind
    ) {
      break;
    }
    const lines = fs.readFileSync(shardPath, "utf8").split("\n").filter(Boolean);
    shuffleInPlace(lines, rng);
    for (const line of lines) {
      const row = parseReplayRow(line);
      if (!row) {
        continue;
      }
      const split = row.split === "validation" || row.split === "test" ? "validation" : "train";
      const limit = split === "train" ? trainLimitByKind : validationLimitByKind;
      const bucket = replay[split][row.kind];
      if (bucket.length < limit) {
        bucket.push(row);
      }
    }
  }
  return replay;
}

function listDatasetShards() {
  if (!fs.existsSync(SHARD_DIR)) {
    return [];
  }
  return fs
    .readdirSync(SHARD_DIR)
    .filter((name) => name.endsWith(".jsonl"))
    .map((name) => path.join(SHARD_DIR, name))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
}

function parseReplayRow(line) {
  try {
    const row = JSON.parse(line);
    if (
      !row ||
      (row.kind !== "bid" && row.kind !== "play") ||
      !Array.isArray(row.features) ||
      !Number.isFinite(row.target)
    ) {
      return null;
    }
    return {
      features: row.features.map((value) => Number(value) || 0),
      target: Number(row.target),
      weight: Number(row.weight || 1),
      split: row.split || "train",
      kind: row.kind,
      playRole: row.kind === "play" ? replayPlayRole(row) : null,
    };
  } catch {
    return null;
  }
}

function replayPlayRole(row) {
  if (engine.PLAY_ROLES.includes(row.playRole)) {
    return row.playRole;
  }
  if (row.actorDeclared) {
    return "declarer";
  }
  return row.actorDeclarerSide ? "friend" : "defense";
}

function trainHead(head, samples, options) {
  if (!samples.length) {
    return { loss: 0, samples: 0 };
  }
  let loss = 0;
  let updates = 0;
  for (let pass = 0; pass < options.passes; pass += 1) {
    shuffleInPlace(samples, options.rng);
    for (let start = 0; start < samples.length; start += options.batchSize) {
      const batch = samples.slice(start, start + options.batchSize);
      loss += trainBatch(head, batch, options.learningRate, options.l2);
      updates += 1;
    }
  }
  return {
    loss: loss / Math.max(1, updates),
    samples: samples.length,
    updates,
  };
}

function skippedHeadStats(head, samples) {
  return {
    loss: lossForSamples(head, samples),
    samples: samples.length,
    updates: 0,
  };
}

function trainPlayHeads(mlp, samples, options) {
  if (!options.rolePlayHeads || !mlp.playHeads) {
    return trainHead(mlp.play, samples, options);
  }
  const roles = {};
  let weightedLoss = 0;
  let totalSamples = 0;
  let totalUpdates = 0;
  for (const role of engine.PLAY_ROLES) {
    const roleSamples = samples.filter((sample) => sample.playRole === role);
    const stats = trainHead(mlp.playHeads[role], roleSamples, options);
    roles[role] = stats;
    weightedLoss += stats.loss * roleSamples.length;
    totalSamples += roleSamples.length;
    totalUpdates += stats.updates || 0;
  }
  return {
    loss: weightedLoss / Math.max(1, totalSamples),
    samples: totalSamples,
    updates: totalUpdates,
    roles,
  };
}

function skippedPlayStats(mlp, samples, rolePlayHeads) {
  if (!rolePlayHeads || !mlp.playHeads) {
    return skippedHeadStats(mlp.play, samples);
  }
  const roles = {};
  let weightedLoss = 0;
  let totalSamples = 0;
  for (const role of engine.PLAY_ROLES) {
    const roleSamples = samples.filter((sample) => sample.playRole === role);
    const stats = skippedHeadStats(mlp.playHeads[role], roleSamples);
    roles[role] = stats;
    weightedLoss += stats.loss * roleSamples.length;
    totalSamples += roleSamples.length;
  }
  return {
    loss: weightedLoss / Math.max(1, totalSamples),
    samples: totalSamples,
    updates: 0,
    roles,
  };
}

function trainBatch(head, batch, learningRate, l2) {
  const grad = {
    w1: Array(head.w1.length).fill(0),
    b1: Array(head.b1.length).fill(0),
    w2: Array(head.w2.length).fill(0),
    b2: 0,
  };
  let totalWeight = 0;
  let totalLoss = 0;
  for (const sample of batch) {
    const forward = forwardHead(head, sample.features);
    const weight = sample.weight || 1;
    const error = clamp(forward.output - sample.target, -3, 3);
    const huberGrad = Math.abs(error) <= 0.7 ? error : 0.7 * Math.sign(error);
    const dOutput = huberGrad * head.outputScale * weight;
    totalWeight += weight;
    totalLoss += huberLoss(error) * weight;
    for (let hiddenIndex = 0; hiddenIndex < head.hidden; hiddenIndex += 1) {
      const hiddenValue = forward.hidden[hiddenIndex];
      grad.w2[hiddenIndex] += dOutput * hiddenValue;
      const dHidden = dOutput * head.w2[hiddenIndex] * (1 - hiddenValue * hiddenValue);
      grad.b1[hiddenIndex] += dHidden;
      const rowOffset = hiddenIndex * head.input;
      for (let featureIndex = 0; featureIndex < head.input; featureIndex += 1) {
        grad.w1[rowOffset + featureIndex] += dHidden * (sample.features[featureIndex] || 0);
      }
    }
    grad.b2 += dOutput;
  }
  const scale = learningRate / Math.max(1e-9, totalWeight);
  for (let i = 0; i < head.w1.length; i += 1) {
    head.w1[i] -= scale * (grad.w1[i] + l2 * head.w1[i]);
  }
  for (let i = 0; i < head.b1.length; i += 1) {
    head.b1[i] -= scale * grad.b1[i];
  }
  for (let i = 0; i < head.w2.length; i += 1) {
    head.w2[i] -= scale * (grad.w2[i] + l2 * head.w2[i]);
  }
  head.b2 -= scale * grad.b2;
  return totalLoss / Math.max(1e-9, totalWeight);
}

function forwardHead(head, features) {
  const hidden = Array(head.hidden);
  let raw = head.b2;
  for (let hiddenIndex = 0; hiddenIndex < head.hidden; hiddenIndex += 1) {
    let activation = head.b1[hiddenIndex];
    const rowOffset = hiddenIndex * head.input;
    for (let featureIndex = 0; featureIndex < head.input; featureIndex += 1) {
      activation += head.w1[rowOffset + featureIndex] * (features[featureIndex] || 0);
    }
    hidden[hiddenIndex] = Math.tanh(activation);
    raw += head.w2[hiddenIndex] * hidden[hiddenIndex];
  }
  return {
    hidden,
    output: raw * head.outputScale,
  };
}

function lossForSamples(head, samples) {
  if (!samples.length) {
    return 0;
  }
  let total = 0;
  let weightTotal = 0;
  for (const sample of samples) {
    const error = forwardHead(head, sample.features).output - sample.target;
    const weight = sample.weight || 1;
    total += huberLoss(error) * weight;
    weightTotal += weight;
  }
  return total / Math.max(1e-9, weightTotal);
}

function lossForPlaySamples(mlp, samples, rolePlayHeads) {
  if (!rolePlayHeads || !mlp.playHeads) {
    return lossForSamples(mlp.play, samples);
  }
  let total = 0;
  let weightTotal = 0;
  for (const sample of samples) {
    const head = mlp.playHeads[sample.playRole] || mlp.play;
    const error = forwardHead(head, sample.features).output - sample.target;
    const weight = sample.weight || 1;
    total += huberLoss(error) * weight;
    weightTotal += weight;
  }
  return total / Math.max(1e-9, weightTotal);
}

function huberLoss(error) {
  const abs = Math.abs(error);
  if (abs <= 0.7) {
    return 0.5 * error * error;
  }
  return 0.7 * (abs - 0.35);
}

function printEpoch(epoch, samples, bidStats, playStats, validation, evalResult, improved) {
  console.log(
    `epoch ${epoch}: samples bid=${samples.bid.length} play=${samples.play.length} ` +
      `replay bid=${validation.replay.trainBid} play=${validation.replay.trainPlay} ` +
      `trainLoss bid=${bidStats.loss.toFixed(4)} play=${playStats.loss.toFixed(4)} ` +
      `valLoss bid=${validation.bidLoss.toFixed(4)} play=${validation.playLoss.toFixed(4)} ` +
      `score=${evalResult.score.toFixed(4)} win=${(evalResult.winRate * 100).toFixed(1)}% ` +
      `${improved ? "improved" : "rollback"}`,
  );
}

function printEval(label, result) {
  console.log(
    `${label}: score=${result.score.toFixed(4)} win=${(result.winRate * 100).toFixed(1)}% ` +
      `bid=${(result.bidRate * 100).toFixed(1)}% dec=${(result.declarerWinRate * 100).toFixed(1)}% ` +
      `def=${(result.defenseWinRate * 100).toFixed(1)}% games=${result.games}`,
  );
}

function shuffleInPlace(items, rng) {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
}

function gaussian(rng) {
  const u = Math.max(1e-9, rng());
  const v = Math.max(1e-9, rng());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function roundSampleNumber(value) {
  return Number((Number(value) || 0).toFixed(5));
}

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

main();
