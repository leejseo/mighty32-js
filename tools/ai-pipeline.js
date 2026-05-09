const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const TRAINER = path.join(ROOT, "tools/train-ai.js");
const MLP_TRAINER = path.join(ROOT, "tools/train-mlp-ai.js");
const MODEL_JS = path.join(ROOT, "assets/models/mighty-policy-v1.js");
const MODEL_BIN = path.join(ROOT, "assets/models/mighty-policy-v1.bin");
const MLP_MODEL_JS = path.join(ROOT, "assets/models/mighty-mlp-policy-v2.js");
const MLP_MODEL_BIN = path.join(ROOT, "assets/models/mighty-mlp-policy-v2.bin");
const RUN_DIR = path.join(ROOT, "data/training-runs");
const SNAPSHOT_DIR = path.join(RUN_DIR, "model-snapshots");

function main() {
  const options = parseArgs(process.argv.slice(2));
  const seed = Number(options.seed || 20260518);
  const trainGames = Number(options.trainGames || 1400);
  const evalGames = Number(options.evalGames || 4000);
  const iterations = Number(options.iterations || 10);
  const candidates = Number(options.candidates || 8);
  const repeats = Number(options.repeats || 6);
  const mutation = Number(options.mutation || 0.1);
  const minScoreDelta = Number(options.minScoreDelta || 0.01);
  const acceptNegative = Boolean(options.acceptNegative);
  const holdoutSeeds = parseSeedList(options.holdoutSeeds) || [
    seed + 31001,
    seed + 62003,
    seed + 93011,
  ];

  fs.mkdirSync(RUN_DIR, { recursive: true });
  fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
  const startedAt = new Date();
  const modelBackup = backupModel();
  const snapshotPath = snapshotCurrentMlp(startedAt, seed);
  const opponentPaths = collectOpponentSnapshots(snapshotPath, Number(options.opponentGenerations || 8));
  const run = {
    startedAt: startedAt.toISOString(),
    options: {
      seed,
      trainGames,
      evalGames,
      iterations,
      candidates,
      repeats,
      mutation,
      minScoreDelta,
      trainer: options.mlp ? "mlp" : "linear",
      opponentGenerations: opponentPaths.length,
      holdoutSeeds,
    },
    baseline: null,
    trainingOutput: "",
    candidate: null,
    accepted: false,
    reason: "",
  };

  try {
    console.log("== baseline holdout ==");
    run.baseline = evaluateSuite(evalGames, holdoutSeeds, opponentPaths);
    printSuite("baseline", run.baseline);

    console.log("== train candidate ==");
    const trainArgs = options.mlp
      ? buildMlpTrainArgs(options, { seed, trainGames, evalGames, repeats, opponentPaths })
      : buildLinearTrainArgs(options, { seed, trainGames, iterations, candidates, repeats, mutation, opponentPaths });
    run.trainingOutput = runNode(trainArgs);
    process.stdout.write(run.trainingOutput);

    console.log("== candidate holdout ==");
    run.candidate = evaluateSuite(evalGames, holdoutSeeds, opponentPaths);
    printSuite("candidate", run.candidate);

    const scoreDelta = run.candidate.average.score - run.baseline.average.score;
    const winDelta = run.candidate.average.winRate - run.baseline.average.winRate;
    const candidateIsPositive = run.candidate.average.score >= 0 || acceptNegative;
    run.accepted = scoreDelta >= minScoreDelta && winDelta >= -0.01 && candidateIsPositive;
    run.reason = run.accepted
      ? `accepted: score delta ${scoreDelta.toFixed(4)}, win delta ${(winDelta * 100).toFixed(2)}pp`
      : `reverted: score delta ${scoreDelta.toFixed(4)}, win delta ${(winDelta * 100).toFixed(2)}pp`;

    if (!run.accepted) {
      restoreModel(modelBackup);
    }

    run.finishedAt = new Date().toISOString();
    writeRunArtifact(run);
    console.log(run.reason);
  } catch (error) {
    restoreModel(modelBackup);
    run.finishedAt = new Date().toISOString();
    run.error = error.stack || String(error);
    writeRunArtifact(run);
    throw error;
  }
}

function parseArgs(args) {
  return args.reduce((parsed, arg) => {
    if (arg === "--fresh") {
      parsed.fresh = true;
      return parsed;
    }
    if (arg === "--mlp") {
      parsed.mlp = true;
      return parsed;
    }
    if (arg === "--accept-negative") {
      parsed.acceptNegative = true;
      return parsed;
    }
    const match = arg.match(/^--([^=]+)=(.*)$/);
    if (match) {
      parsed[toCamelCase(match[1])] = match[2];
    }
    return parsed;
  }, {});
}

function buildLinearTrainArgs(options, { seed, trainGames, iterations, candidates, repeats, mutation, opponentPaths }) {
  const args = [
    TRAINER,
    "--train",
    `--iterations=${iterations}`,
    `--candidates=${candidates}`,
    `--games=${trainGames}`,
    `--repeats=${repeats}`,
    `--seed=${seed}`,
    `--mutation=${mutation}`,
  ];
  if (options.fresh) {
    args.push("--fresh");
  }
  if (opponentPaths.length) {
    args.push(`--opponent-mlp-paths=${opponentPaths.join(",")}`);
  }
  return args;
}

function buildMlpTrainArgs(options, { seed, trainGames, evalGames, repeats, opponentPaths }) {
  const args = [
    MLP_TRAINER,
    `--epochs=${Number(options.epochs || 8)}`,
    `--games=${trainGames}`,
    `--eval-games=${Number(options.innerEvalGames || Math.max(600, Math.floor(evalGames / 3)))}`,
    `--repeats=${repeats}`,
    `--seed=${seed}`,
    `--exploration=${Number(options.exploration || 0.12)}`,
    `--learning-rate=${Number(options.learningRate || 0.0025)}`,
    `--batch-size=${Number(options.batchSize || 96)}`,
    `--train-passes=${Number(options.trainPasses || 3)}`,
    `--bid-hidden=${Number(options.bidHidden || 32)}`,
    `--play-hidden=${Number(options.playHidden || 64)}`,
    `--replay-samples=${Number(options.replaySamples || 60000)}`,
    `--replay-ratio=${Number(options.replayRatio || 0.75)}`,
    `--validation-replay-samples=${Number(options.validationReplaySamples || 12000)}`,
  ];
  if (options.saveDataset === "false") {
    args.push("--save-dataset=false");
  }
  if (options.trainBid === "false") {
    args.push("--train-bid=false");
  }
  if (options.trainPlay === "false") {
    args.push("--train-play=false");
  }
  if (options.fresh) {
    args.push("--fresh");
  }
  if (opponentPaths.length) {
    args.push(`--opponent-mlp-paths=${opponentPaths.join(",")}`);
  }
  return args;
}

function snapshotCurrentMlp(startedAt, seed) {
  if (!fs.existsSync(MLP_MODEL_JS)) {
    return null;
  }
  const stamp = startedAt.toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "-");
  const filePath = path.join(SNAPSHOT_DIR, `${stamp}-seed-${seed}.js`);
  fs.copyFileSync(MLP_MODEL_JS, filePath);
  return filePath;
}

function collectOpponentSnapshots(currentSnapshot, limit) {
  const snapshots = fs.existsSync(SNAPSHOT_DIR)
    ? fs
        .readdirSync(SNAPSHOT_DIR)
        .filter((name) => name.endsWith(".js"))
        .map((name) => path.join(SNAPSHOT_DIR, name))
        .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
    : [];
  const ordered = currentSnapshot
    ? [currentSnapshot, ...snapshots.filter((item) => item !== currentSnapshot)]
    : snapshots;
  return ordered.slice(0, Math.max(0, limit));
}

function toCamelCase(value) {
  return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function parseSeedList(value) {
  if (!value) {
    return null;
  }
  const seeds = String(value)
    .split(",")
    .map((item) => Number(item.trim()))
    .filter(Number.isFinite);
  return seeds.length ? seeds : null;
}

function backupModel() {
  return {
    js: fs.existsSync(MODEL_JS) ? fs.readFileSync(MODEL_JS) : null,
    bin: fs.existsSync(MODEL_BIN) ? fs.readFileSync(MODEL_BIN) : null,
    mlpJs: fs.existsSync(MLP_MODEL_JS) ? fs.readFileSync(MLP_MODEL_JS) : null,
    mlpBin: fs.existsSync(MLP_MODEL_BIN) ? fs.readFileSync(MLP_MODEL_BIN) : null,
  };
}

function restoreModel(backup) {
  if (backup.js) {
    fs.writeFileSync(MODEL_JS, backup.js);
  }
  if (backup.bin) {
    fs.writeFileSync(MODEL_BIN, backup.bin);
  }
  if (backup.mlpJs) {
    fs.writeFileSync(MLP_MODEL_JS, backup.mlpJs);
  } else if (fs.existsSync(MLP_MODEL_JS)) {
    fs.rmSync(MLP_MODEL_JS);
  }
  if (backup.mlpBin) {
    fs.writeFileSync(MLP_MODEL_BIN, backup.mlpBin);
  } else if (fs.existsSync(MLP_MODEL_BIN)) {
    fs.rmSync(MLP_MODEL_BIN);
  }
}

function evaluateSuite(games, seeds, opponentPaths = []) {
  const results = seeds.map((seed) => {
    const args = [TRAINER, "--eval", `--games=${games}`, `--seed=${seed}`];
    if (opponentPaths.length) {
      args.push(`--opponent-mlp-paths=${opponentPaths.join(",")}`);
    }
    const output = runNode(args);
    const result = parseEvalOutput(output);
    return {
      seed,
      output: output.trim(),
      ...result,
    };
  });
  return {
    results,
    average: averageResults(results),
  };
}

function parseEvalOutput(output) {
  const match = output.match(
    /score=([-\d.]+)\s+win=([-\d.]+)%\s+bid=([-\d.]+)%\s+dec=([-\d.]+)%\s+def=([-\d.]+)%\s+games=(\d+)/,
  );
  if (!match) {
    throw new Error(`Could not parse eval output:\n${output}`);
  }
  return {
    score: Number(match[1]),
    winRate: Number(match[2]) / 100,
    bidRate: Number(match[3]) / 100,
    declarerWinRate: Number(match[4]) / 100,
    defenseWinRate: Number(match[5]) / 100,
    games: Number(match[6]),
  };
}

function averageResults(results) {
  const totals = results.reduce(
    (sum, result) => {
      sum.games += result.games;
      sum.score += result.score * result.games;
      sum.winRate += result.winRate * result.games;
      sum.bidRate += result.bidRate * result.games;
      sum.declarerWinRate += result.declarerWinRate * result.games;
      sum.defenseWinRate += result.defenseWinRate * result.games;
      return sum;
    },
    { games: 0, score: 0, winRate: 0, bidRate: 0, declarerWinRate: 0, defenseWinRate: 0 },
  );
  return {
    games: totals.games,
    score: totals.score / totals.games,
    winRate: totals.winRate / totals.games,
    bidRate: totals.bidRate / totals.games,
    declarerWinRate: totals.declarerWinRate / totals.games,
    defenseWinRate: totals.defenseWinRate / totals.games,
  };
}

function printSuite(label, suite) {
  const average = suite.average;
  console.log(
    `${label}: score=${average.score.toFixed(4)} win=${(average.winRate * 100).toFixed(1)}% ` +
      `bid=${(average.bidRate * 100).toFixed(1)}% dec=${(average.declarerWinRate * 100).toFixed(1)}% ` +
      `def=${(average.defenseWinRate * 100).toFixed(1)}% games=${average.games}`,
  );
}

function runNode(args) {
  const result = spawnSync(process.execPath, args, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`Command failed: node ${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
  }
  return result.stdout;
}

function writeRunArtifact(run) {
  const stamp = run.startedAt.replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "-");
  const filename = `${stamp}-seed-${run.options.seed}.json`;
  const filePath = path.join(RUN_DIR, filename);
  fs.writeFileSync(filePath, `${JSON.stringify(run, null, 2)}\n`);
  console.log(`run artifact: ${path.relative(ROOT, filePath)}`);
}

main();
