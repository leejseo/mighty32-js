const { spawnSync } = require("node:child_process");

function main() {
  const options = parseArgs(process.argv.slice(2));
  const runs = Number(options.runs || 20);
  const baseSeed = Number(options.seed || 20260601);
  const push = options.push !== "false";
  const pipelineArgs = [
    "--mlp",
    `--epochs=${Number(options.epochs || 6)}`,
    `--train-games=${Number(options.trainGames || 2800)}`,
    `--eval-games=${Number(options.evalGames || 3600)}`,
    `--inner-eval-games=${Number(options.innerEvalGames || 1400)}`,
    `--repeats=${Number(options.repeats || 5)}`,
    `--min-score-delta=${Number(options.minScoreDelta || 0.004)}`,
    `--exploration=${Number(options.exploration || 0.1)}`,
    `--learning-rate=${Number(options.learningRate || 0.0014)}`,
    `--batch-size=${Number(options.batchSize || 192)}`,
    `--train-passes=${Number(options.trainPasses || 3)}`,
    `--opponent-generations=${Number(options.opponentGenerations || 8)}`,
    `--replay-samples=${Number(options.replaySamples || 60000)}`,
    `--replay-ratio=${Number(options.replayRatio || 0.75)}`,
    `--validation-replay-samples=${Number(options.validationReplaySamples || 12000)}`,
    `--candidate-limit=${Number(options.candidateLimit || 3)}`,
    `--play-rollout-samples=${Number(options.playRolloutSamples || 0)}`,
    `--rollout-candidate-limit=${Number(options.rolloutCandidateLimit || 2)}`,
    `--play-rollout-rate=${Number(options.playRolloutRate || 0)}`,
    `--rollout-exploration=${Number(options.rolloutExploration || 0.025)}`,
  ];
  if (options.trainBid === "false") {
    pipelineArgs.push("--train-bid=false");
  }
  if (options.trainPlay === "false") {
    pipelineArgs.push("--train-play=false");
  }

  for (let index = 1; index <= runs; index += 1) {
    const seed = baseSeed + index * 9973;
    console.log(`\n=== campaign run ${index}/${runs} seed=${seed} ===`);
    const result = run("node", ["tools/ai-pipeline.js", ...pipelineArgs, `--seed=${seed}`], {
      inherit: true,
    });
    if (result.status !== 0) {
      throw new Error(`pipeline failed at run ${index}`);
    }
    if (hasModelDiff()) {
      run("git", ["add", "assets/models/mighty-mlp-policy-v2.js", "assets/models/mighty-mlp-policy-v2.bin"], {
        inherit: true,
      });
      run("git", ["commit", "-m", `Improve MLP policy campaign run ${index}`], {
        inherit: true,
      });
      if (push) {
        run("git", ["push", "origin", "main"], {
          inherit: true,
        });
      }
    } else {
      console.log(`campaign run ${index}: no accepted model change`);
    }
  }
}

function parseArgs(args) {
  return args.reduce((parsed, arg) => {
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

function hasModelDiff() {
  const result = run(
    "git",
    ["status", "--short", "assets/models/mighty-mlp-policy-v2.js", "assets/models/mighty-mlp-policy-v2.bin"],
    { inherit: false },
  );
  return Boolean(result.stdout.trim());
}

function run(command, args, options) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: options.inherit ? "inherit" : "pipe",
    maxBuffer: 128 * 1024 * 1024,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0 && options.inherit) {
    return result;
  }
  return result;
}

main();
