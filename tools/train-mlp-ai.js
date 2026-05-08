const engine = require("./train-ai.js");

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

  const rng = engine.createRng(seed);
  const baseModel = engine.loadModel();
  const mlp = options.fresh || !baseModel.mlp
    ? createMlpModel({ rng, bidHidden, playHidden })
    : engine.cloneMlpModel(baseModel.mlp);
  let workingModel = {
    ...baseModel,
    mlp,
  };
  let bestMlp = engine.cloneMlpModel(mlp);
  let bestResult = engine.evaluateModelSuite(workingModel, evalGames, seed + 700001, repeats);
  printEval("initial", bestResult);

  const history = [];
  for (let epoch = 1; epoch <= epochs; epoch += 1) {
    const samples = collectSamples({
      rng,
      model: workingModel,
      games: gamesPerEpoch,
      exploration,
    });
    const split = splitSamples(samples, rng, 0.88);
    const bidStats = trainHead(workingModel.mlp.bid, split.train.bid, {
      rng,
      learningRate,
      batchSize,
      passes: trainPasses,
      l2: 0.00008,
    });
    const playStats = trainHead(workingModel.mlp.play, split.train.play, {
      rng,
      learningRate,
      batchSize,
      passes: trainPasses,
      l2: 0.00005,
    });
    const validation = {
      bidLoss: lossForSamples(workingModel.mlp.bid, split.validation.bid),
      playLoss: lossForSamples(workingModel.mlp.play, split.validation.play),
    };
    const evalResult = engine.evaluateModelSuite(workingModel, evalGames, seed + 700001 + epoch * 8191, repeats);
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
      learningRate,
      batchSize,
      trainPasses,
      bestScore: bestResult.score,
      history,
      bidFeatures: engine.BID_FEATURES,
      playFeatures: engine.PLAY_FEATURES,
    },
    bid: bestMlp.bid,
    play: bestMlp.play,
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

function collectSamples({ rng, model, games, exploration }) {
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
      collector: (sample) => {
        const target = rewardToTarget(sample.reward);
        const row = {
          features: sample.features,
          target,
          weight: sampleWeight(sample),
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

function rewardToTarget(reward) {
  return clamp(reward / 2.6, -1.3, 1.3);
}

function sampleWeight(sample) {
  const absReward = Math.min(2.4, Math.abs(sample.reward || 0));
  const phaseWeight = sample.kind === "bid" ? 1.25 : sample.isLead ? 1.08 : 1;
  return phaseWeight * (0.55 + absReward * 0.32);
}

function splitSamples(samples, rng, trainRatio) {
  return {
    train: {
      bid: takeSplit(samples.bid, rng, trainRatio, true),
      play: takeSplit(samples.play, rng, trainRatio, true),
    },
    validation: {
      bid: takeSplit(samples.bid, rng, trainRatio, false),
      play: takeSplit(samples.play, rng, trainRatio, false),
    },
  };
}

function takeSplit(samples, rng, trainRatio, wantTrain) {
  return samples.filter(() => (rng() < trainRatio) === wantTrain);
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

main();
