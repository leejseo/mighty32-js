const engine = require("./train-ai.js");

function main() {
  const options = parseArgs(process.argv.slice(2));
  const seed = Number(options.seed || 20260731);
  const games = Number(options.games || 1);
  const limit = Number(options.limit || 36);
  const playerFilter = options.player === undefined ? null : Number(options.player);
  const phaseFilter = options.phase || "all";
  const rng = engine.createRng(seed);
  const model = engine.loadModel();

  for (let gameIndex = 0; gameIndex < games; gameIndex += 1) {
    const decisionLog = [];
    const result = engine.runGame({
      rng,
      learnerIndex: gameIndex % 5,
      model,
      opponentModels: [],
      decisionLog,
    });
    console.log(`game ${gameIndex + 1}/${games} seed=${seed} learner=${gameIndex % 5}`);
    console.log(
      `result reward=${result.reward.toFixed(3)} won=${result.learnerWon} declarerSide=${result.learnerDeclarerSide} declared=${result.learnerDeclared}`,
    );
    const filtered = decisionLog
      .filter((entry) => playerFilter === null || entry.playerIndex === playerFilter)
      .filter((entry) => phaseFilter === "all" || entry.phase === phaseFilter)
      .slice(0, limit);
    for (const entry of filtered) {
      printDecision(entry);
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

function printDecision(entry) {
  if (entry.phase === "bid") {
    console.log(
      `[bid] p${entry.playerIndex} current=${formatBid(entry.currentBid)} hand=${entry.hand.join(" ")} selected=${entry.selected.trump}${entry.selected.target} score=${entry.selected.score}`,
    );
    console.log(`      top ${entry.candidates.map((candidate) => `${candidate.trump}${candidate.target}:${candidate.score}`).join(" ")}`);
    return;
  }
  console.log(
    `[play] t${entry.trickNumber} p${entry.playerIndex} ${entry.side} trump=${entry.trump}${entry.target} trick=${formatTrick(entry.trick)} hand=${entry.hand.join(" ")}`,
  );
  console.log(
    `       selected=${entry.selected.cardId} score=${entry.selected.score} winner=p${entry.selected.winner} pts=${entry.selected.points}`,
  );
  console.log(`       top ${entry.candidates.map((candidate) => `${candidate.cardId}:${candidate.score}`).join(" ")}`);
}

function formatBid(bid) {
  return bid ? `p${bid.playerIndex}-${bid.trump}${bid.target}` : "none";
}

function formatTrick(trick) {
  if (!trick.length) {
    return "-";
  }
  return trick.map((entry) => `p${entry.playerIndex}:${entry.cardId}`).join(" ");
}

main();
