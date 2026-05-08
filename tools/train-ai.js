const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
const MODEL_JS = path.join(ROOT, "assets/models/mighty-policy-v1.js");
const MODEL_BIN = path.join(ROOT, "assets/models/mighty-policy-v1.bin");
const MODEL_MAGIC = "M32P";
const MLP_MODEL_JS = path.join(ROOT, "assets/models/mighty-mlp-policy-v2.js");
const MLP_MODEL_BIN = path.join(ROOT, "assets/models/mighty-mlp-policy-v2.bin");
const MLP_MODEL_MAGIC = "M32M";
const SUITS = ["S", "D", "H", "C"];
const BID_TRUMPS = ["S", "D", "H", "C", "NT"];
const MAX_TARGET = 20;
const TOTAL_POINT_CARDS = 20;
const MIN_TARGET = 13;
const MIN_NO_TRUMP_TARGET = 12;
const BID_FEATURES = [
  "bias",
  "targetNorm",
  "ceilingReserve",
  "expectedMargin",
  "confidence",
  "qualityNorm",
  "isNoTrump",
  "trumpLengthNorm",
  "hasMighty",
  "hasJoker",
  "hasTopTrump",
  "pointCountNorm",
  "targetPressure",
  "bidPressure",
  "hasFirstLead",
  "voidCountNorm",
];
const PLAY_FEATURES = [
  "bias",
  "isDeclarerSide",
  "isLead",
  "trickProgress",
  "cardIsPoint",
  "trickPointsBefore",
  "outcomePoints",
  "playerSideWins",
  "declarerNeedNorm",
  "defensePointsNorm",
  "cardIsMighty",
  "cardIsJoker",
  "cardIsTrump",
  "rankNorm",
  "cardIsControl",
  "legalCountNorm",
  "isFinalSeat",
  "currentWinnerAlly",
  "currentWinnerEnemy",
  "spendCostNorm",
  "cardIsJokerCall",
  "effectiveJokerLead",
  "winsCurrentTrick",
  "targetNorm",
  "handPointNorm",
  "suitLengthNorm",
  "knownDeclarerVoidSuit",
  "knownOpponentVoidSuit",
];

function main() {
  const options = parseArgs(process.argv.slice(2));
  const mode = options.train ? "train" : "eval";
  const seed = Number(options.seed || 20260508);
  const games = Number(options.games || (mode === "train" ? 96 : 400));
  const model = options.fresh ? seedModel() : loadModel();
  const opponentModels = loadOpponentModels(options.opponentMlpPaths);

  if (mode === "eval") {
    const result = evaluateModel(model, games, seed, opponentModels);
    printEval("eval", result);
    return;
  }

  const iterations = Number(options.iterations || 8);
  const candidates = Number(options.candidates || 6);
  const trained = trainModel(model, {
    seed,
    games,
    iterations,
    candidates,
    mutation: Number(options.mutation || 0.18),
    repeats: Number(options.repeats || 4),
    opponentModels,
  });
  writeModel(trained.model, trained.version + 1, trained.summary);
  printEval("trained", evaluateModelSuite(trained.model, Math.max(games * 2, 300), seed + 99991, Number(options.repeats || 4), opponentModels));
}

function parseArgs(args) {
  return args.reduce((parsed, arg) => {
    if (arg === "--train") {
      parsed.train = true;
      return parsed;
    }
    if (arg === "--eval") {
      parsed.train = false;
      return parsed;
    }
    const match = arg.match(/^--([^=]+)=(.+)$/);
    if (match) {
      parsed[match[1]] = match[2];
    }
    return parsed;
  }, {});
}

function loadModel() {
  const fallback = seedModel();
  try {
    const code = fs.readFileSync(MODEL_JS, "utf8");
    const context = { window: {} };
    vm.runInNewContext(code, context, { filename: MODEL_JS });
    const model = normalizeModel(context.window.MIGHTY32_AI_MODEL) || fallback;
    const mlp = loadMlpModel();
    return mlp ? { ...model, mlp } : model;
  } catch {
    const mlp = loadMlpModel();
    return mlp ? { ...fallback, mlp } : fallback;
  }
}

function loadMlpModel() {
  return loadMlpModelFromFile(MLP_MODEL_JS);
}

function loadMlpModelFromFile(filePath) {
  try {
    const code = fs.readFileSync(filePath, "utf8");
    const context = { window: {} };
    vm.runInNewContext(code, context, { filename: filePath });
    return normalizeMlpModel(context.window.MIGHTY32_MLP_MODEL);
  } catch {
    return null;
  }
}

function loadOpponentModels(pathsValue) {
  if (!pathsValue) {
    return [];
  }
  return String(pathsValue)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((filePath) => {
      const resolved = path.isAbsolute(filePath) ? filePath : path.join(ROOT, filePath);
      const mlp = loadMlpModelFromFile(resolved);
      return mlp ? { ...seedModel(), mlp } : null;
    })
    .filter(Boolean);
}

function seedModel() {
  return {
    name: "mighty-policy-v1",
    version: 1,
    source: "seed",
    bidScale: 0.85,
    playScale: 0.18,
    bidWeights: [
      0.0000, 0.0800, 0.2400, 0.7800, 0.3600, 0.2600, -0.0400, 0.1800,
      0.2200, 0.1800, 0.3000, 0.1400, -0.1600, -0.2600, 0.1200, 0.0800,
    ],
    playWeights: [
      0.0000, 0.0600, 0.0800, 0.1000, 0.2200, 0.2200, 0.6200, 0.7400,
      0.3800, 0.1200, -0.6200, -0.3600, 0.1600, 0.0800, 0.2200, -0.0600,
      0.2400, 0.3000, 0.4600, -0.5200, 0.1800, 0.1200, 0.4200, 0.1800,
      0.1600, 0.0800, -0.2400, -0.1800,
    ],
  };
}

function normalizeModel(model) {
  if (!model || !Array.isArray(model.bidWeights) || !Array.isArray(model.playWeights)) {
    return null;
  }
  if (model.bidWeights.length !== BID_FEATURES.length || model.playWeights.length !== PLAY_FEATURES.length) {
    return null;
  }
  return {
    name: String(model.name || "mighty-policy-v1"),
    version: Number(model.version || 1),
    source: String(model.source || "loaded"),
    bidScale: Number(model.bidScale || 0.85),
    playScale: Number(model.playScale || 0.18),
    bidWeights: model.bidWeights.map((value) => Number(value) || 0),
    playWeights: model.playWeights.map((value) => Number(value) || 0),
    mlp: normalizeMlpModel(model.mlp),
  };
}

function normalizeMlpModel(model) {
  if (!model || typeof model !== "object") {
    return null;
  }
  const bid = normalizeMlpHead(model.bid, BID_FEATURES.length);
  const play = normalizeMlpHead(model.play, PLAY_FEATURES.length);
  if (!bid || !play) {
    return null;
  }
  return {
    name: String(model.name || "mighty-mlp-policy-v2"),
    version: Number(model.version || 1),
    source: String(model.source || "loaded"),
    enabled: model.enabled !== false,
    bid,
    play,
    training: model.training || null,
  };
}

function normalizeMlpHead(head, expectedInput) {
  if (!head || typeof head !== "object") {
    return null;
  }
  const input = Number(head.input || expectedInput);
  const hidden = Number(head.hidden || head.b1?.length || 0);
  if (input !== expectedInput || hidden <= 0) {
    return null;
  }
  const w1 = normalizeNumberArray(head.w1, input * hidden);
  const b1 = normalizeNumberArray(head.b1, hidden);
  const w2 = normalizeNumberArray(head.w2, hidden);
  if (!w1 || !b1 || !w2) {
    return null;
  }
  return {
    input,
    hidden,
    outputScale: Number.isFinite(head.outputScale) ? Number(head.outputScale) : 0.3,
    w1,
    b1,
    w2,
    b2: Number(head.b2 || 0),
  };
}

function normalizeNumberArray(values, length) {
  if (!Array.isArray(values) || values.length !== length) {
    return null;
  }
  return values.map((value) => Number(value) || 0);
}

function trainModel(baseModel, options) {
  const rng = createRng(options.seed);
  let best = cloneModel(baseModel);
  let bestResult = evaluateModelSuite(best, options.games, options.seed, options.repeats, options.opponentModels);
  let accepted = 0;
  printEval("initial", bestResult);

  for (let iteration = 1; iteration <= options.iterations; iteration += 1) {
    let roundBest = best;
    let roundResult = bestResult;
    for (let candidateIndex = 0; candidateIndex < options.candidates; candidateIndex += 1) {
      const candidate = mutateModel(best, rng, options.mutation);
      const candidateSeed = options.seed + iteration * 10007 + candidateIndex * 997;
      const candidateResult = evaluateModelSuite(candidate, options.games, candidateSeed, options.repeats, options.opponentModels);
      if (candidateResult.score > roundResult.score + 0.015) {
        roundBest = candidate;
        roundResult = candidateResult;
      }
    }
    const improved = roundBest !== best;
    if (roundBest !== best) {
      accepted += 1;
      best = roundBest;
      bestResult = roundResult;
    }
    printEval(`iter ${iteration}/${options.iterations}${improved ? "" : " hold"}`, bestResult);
  }

  return {
    model: best,
    version: Number(baseModel.version || 1),
    summary: {
      accepted,
      iterations: options.iterations,
      gamesPerCandidate: options.games,
      seedRepeats: options.repeats,
    },
  };
}

function evaluateModelSuite(model, games, seed, repeats, opponentModels = []) {
  const perRepeat = Math.max(20, Math.floor(games / Math.max(1, repeats)));
  const aggregate = {
    games: 0,
    score: 0,
    winRate: 0,
    bidRate: 0,
    declarerWinRate: 0,
    defenseWinRate: 0,
  };
  for (let index = 0; index < repeats; index += 1) {
    const result = evaluateModel(model, perRepeat, seed + index * 104729, opponentModels);
    aggregate.games += result.games;
    aggregate.score += result.score * result.games;
    aggregate.winRate += result.winRate * result.games;
    aggregate.bidRate += result.bidRate * result.games;
    aggregate.declarerWinRate += result.declarerWinRate * result.games;
    aggregate.defenseWinRate += result.defenseWinRate * result.games;
  }
  if (!aggregate.games) {
    return aggregate;
  }
  return {
    games: aggregate.games,
    score: aggregate.score / aggregate.games,
    winRate: aggregate.winRate / aggregate.games,
    bidRate: aggregate.bidRate / aggregate.games,
    declarerWinRate: aggregate.declarerWinRate / aggregate.games,
    defenseWinRate: aggregate.defenseWinRate / aggregate.games,
  };
}

function mutateModel(model, rng, mutation) {
  const next = cloneModel(model);
  next.source = "trained";
  next.bidWeights = next.bidWeights.map((weight) => clamp(weight + gaussian(rng) * mutation * 0.55, -2.5, 2.5));
  next.playWeights = next.playWeights.map((weight) => clamp(weight + gaussian(rng) * mutation, -3.2, 3.2));
  return next;
}

function shrinkModel(model, factor) {
  const next = cloneModel(model);
  next.bidWeights = next.bidWeights.map((weight) => weight * factor);
  next.playWeights = next.playWeights.map((weight) => weight * factor);
  return next;
}

function cloneModel(model) {
  return {
    ...model,
    bidWeights: model.bidWeights.slice(),
    playWeights: model.playWeights.slice(),
    mlp: cloneMlpModel(model.mlp),
  };
}

function cloneMlpModel(model) {
  if (!model) {
    return null;
  }
  return {
    ...model,
    bid: cloneMlpHead(model.bid),
    play: cloneMlpHead(model.play),
    training: model.training ? { ...model.training } : null,
  };
}

function cloneMlpHead(head) {
  if (!head) {
    return null;
  }
  return {
    ...head,
    w1: head.w1.slice(),
    b1: head.b1.slice(),
    w2: head.w2.slice(),
  };
}

function evaluateModel(model, games, seed, opponentModels = []) {
  const rng = createRng(seed);
  let score = 0;
  let wins = 0;
  let bids = 0;
  let declarerGames = 0;
  let declarerWins = 0;
  let defenseGames = 0;
  let defenseWins = 0;

  for (let gameIndex = 0; gameIndex < games; gameIndex += 1) {
    const learnerIndex = gameIndex % 5;
    const result = runGame({ rng, learnerIndex, model, opponentModels });
    score += result.reward;
    wins += result.learnerWon ? 1 : 0;
    bids += result.learnerDeclared ? 1 : 0;
    if (result.learnerDeclarerSide) {
      declarerGames += 1;
      declarerWins += result.learnerWon ? 1 : 0;
    } else {
      defenseGames += 1;
      defenseWins += result.learnerWon ? 1 : 0;
    }
  }

  return {
    games,
    score: score / games,
    winRate: wins / games,
    bidRate: bids / games,
    declarerWinRate: declarerGames ? declarerWins / declarerGames : 0,
    defenseWinRate: defenseGames ? defenseWins / defenseGames : 0,
  };
}

function runGame({ rng, learnerIndex, model, collector = null, exploration = 0, opponentModels = [] }) {
  let game = null;
  for (let attempts = 0; attempts < 20; attempts += 1) {
    game = createGame(rng, learnerIndex, model, collector, exploration, opponentModels);
    if (!game.dealMiss) {
      break;
    }
  }
  conductBidding(game, rng);
  chooseContractAndFriend(game, rng);
  playRound(game, rng);
  const result = scoreGame(game);
  if (collector && game.decisionSamples?.length) {
    for (const sample of game.decisionSamples) {
      collector({
        ...sample,
        reward: result.reward,
        learnerWon: result.learnerWon,
        learnerDeclarerSide: result.learnerDeclarerSide,
        learnerDeclared: result.learnerDeclared,
      });
    }
  }
  return result;
}

function createGame(rng, learnerIndex, model, collector = null, exploration = 0, opponentModels = []) {
  const deck = shuffle(createDeck(), rng);
  const hands = [[], [], [], [], []];
  for (let i = 0; i < 50; i += 1) {
    hands[i % 5].push(deck[i]);
  }
  hands.forEach(sortHand);
  const opponentAssignments = Array(5).fill(null);
  if (opponentModels.length) {
    for (let index = 0; index < 5; index += 1) {
      if (index !== learnerIndex && rng() < 0.65) {
        opponentAssignments[index] = opponentModels[Math.floor(rng() * opponentModels.length)];
      }
    }
  }
  return {
    rng,
    learnerIndex,
    model,
    hands,
    kitty: deck.slice(50),
    buried: [],
    captured: [[], [], [], [], []],
    currentBid: null,
    passed: [false, false, false, false, false],
    declarerIndex: null,
    friendCardId: null,
    friendIndex: null,
    trump: "NT",
    target: MIN_TARGET,
    leaderIndex: 0,
    currentPlayer: 0,
    trick: [],
    jokerLeadSuit: null,
    jokerCallActive: false,
    trickNumber: 1,
    playHistory: [],
    dealMiss: hands.some((hand) => !hand.some(isPointCard)),
    collector,
    exploration,
    decisionSamples: [],
    opponentModels,
    opponentAssignments,
  };
}

function conductBidding(game, rng) {
  let currentPlayer = 0;
  let totalActions = 0;
  let passesSinceBid = 0;
  while (totalActions < 60) {
    if (!game.passed[currentPlayer]) {
      const decision = chooseBid(game, currentPlayer, getPolicyModelForPlayer(game, currentPlayer), rng);
      if (decision) {
        game.currentBid = { playerIndex: currentPlayer, trump: decision.trump, target: decision.target };
        passesSinceBid = 0;
      } else {
        game.passed[currentPlayer] = true;
        passesSinceBid += 1;
      }
      totalActions += 1;
    }
    if (shouldFinishBidding(game, totalActions, passesSinceBid)) {
      break;
    }
    currentPlayer = nextPlayer(currentPlayer);
  }
  if (!game.currentBid) {
    game.currentBid = fallbackBid(game);
  }
  game.declarerIndex = game.currentBid.playerIndex;
  game.trump = game.currentBid.trump;
  game.target = game.currentBid.target;
  game.hands[game.declarerIndex].push(...game.kitty);
  game.kitty = [];
  sortHand(game.hands[game.declarerIndex]);
}

function shouldFinishBidding(game, totalActions, passesSinceBid) {
  const passedCount = game.passed.filter(Boolean).length;
  if (!game.currentBid && totalActions >= 5 && passedCount === 5) {
    return true;
  }
  if (!game.currentBid) {
    return false;
  }
  return game.passed.every((passed, index) => index === game.currentBid.playerIndex || passed) || passesSinceBid >= 4;
}

function fallbackBid(game) {
  const evaluations = game.hands.map((hand, index) => {
    const best = evaluateBid(game, hand, index).candidates[0];
    return { index, best };
  });
  evaluations.sort((a, b) => b.best.raw - a.best.raw);
  const chosen = evaluations[0];
  return {
    playerIndex: chosen.index,
    trump: chosen.best.trump,
    target: getOpeningBidFloor(chosen.best.trump),
  };
}

function chooseBid(game, playerIndex, policyModel, rng) {
  const evaluation = evaluateBid(game, game.hands[playerIndex], playerIndex);
  const candidates = evaluation.candidates
    .map((candidate) => ({
      ...candidate,
      minTarget: getMinimumBid(game, candidate.trump),
    }))
    .filter((candidate) => candidate.minTarget <= MAX_TARGET && candidate.ceiling >= candidate.minTarget)
    .map((candidate) => {
      const target = chooseBidTarget(candidate, rng);
      const pressure = game.currentBid
        ? getBidPower({ trump: candidate.trump, target }) - getBidPower(game.currentBid)
        : target - getOpeningBidFloor(candidate.trump);
      const failure = evaluateBidFailureRisk(candidate, target);
      const enriched = { ...candidate, target, pressure, failure };
      const policyScore = policyModel ? evaluateModelBid(game, enriched, playerIndex, policyModel) : 0;
      return {
        ...enriched,
        score:
          candidate.confidence * 1.1 +
          (candidate.ceiling - target) * 0.22 +
          (failure.successChance - 0.5) * 0.9 -
          pressure * 0.14 -
          highBidRiskPenalty(target) -
          failure.penalty +
          policyScore,
      };
    })
    .filter((candidate) => !game.currentBid || bidBeats(candidate, game.currentBid))
    .sort((a, b) => b.score - a.score || getBidPower(b) - getBidPower(a));
  if (!candidates.length) {
    return null;
  }
  const best = candidates[0];
  const threshold = game.currentBid ? 0.38 + highBidRiskPenalty(best.target) * 0.45 : 0.2;
  if (best.score < threshold || best.failure.successChance < minimumBidSuccessChance(best.target)) {
    return null;
  }
  const chosen = policyModel ? selectExplorationCandidate(game, candidates, 0.55) : best;
  if (playerIndex === game.learnerIndex && game.collector) {
    game.decisionSamples.push({
      kind: "bid",
      features: buildBidFeatures(game, chosen, playerIndex),
      policyScore: evaluateModelBid(game, chosen, playerIndex, policyModel),
      ruleScore: chosen.score - evaluateModelBid(game, chosen, playerIndex, policyModel),
      target: chosen.target,
      trump: chosen.trump,
      trickNumber: 0,
    });
  }
  return { trump: chosen.trump, target: chosen.target };
}

function evaluateBid(game, hand) {
  const candidates = [];
  const points = hand.filter(isPointCard).length;
  const aces = hand.filter((card) => card.rank === 14).length;
  const voids = SUITS.filter((suit) => !hand.some((card) => card.suit === suit)).length;
  for (const trump of SUITS) {
    const suited = hand.filter((card) => card.suit === trump);
    const highCardScore = suited.reduce((sum, card) => sum + Math.max(0, card.rank - 10) * 0.34, 0);
    const shape = getBidShape(hand, trump);
    const raw =
      10.65 +
      points * 0.28 +
      aces * 0.18 +
      suited.length * 0.36 +
      highCardScore * 0.42 +
      (shape.hasMighty ? 1.45 : 0) +
      (shape.hasJoker ? 1.15 : 0) +
      (shape.hasTopTrump ? 0.85 : -1.1) +
      Math.max(0, suited.length - 3) * 0.24 +
      voids * 0.12;
    candidates.push(makeBidCandidate(game, trump, raw, hand));
  }
  const counts = SUITS.map((suit) => hand.filter((card) => card.suit === suit).length);
  const balanced = Math.max(...counts) - Math.min(...counts) <= 2;
  const ntRaw =
    10.25 +
    points * 0.34 +
    aces * 0.28 +
    (hand.some((card) => isMighty(card, "NT")) ? 1.55 : 0) +
    (hand.some((card) => card.joker) ? 1.25 : 0) +
    (balanced ? 0.45 : -1.15);
  candidates.push(makeBidCandidate(game, "NT", ntRaw, hand));
  candidates.sort((a, b) => b.ceiling - a.ceiling || b.confidence - a.confidence || b.raw - a.raw);
  return { candidates };
}

function makeBidCandidate(game, trump, raw, hand) {
  const floor = getOpeningBidFloor(trump);
  const quality = highBidQuality(hand, trump);
  const shape = getBidShape(hand, trump);
  const expectedPoints = estimateBidExpectedPoints(hand, trump, raw, quality);
  const initialCeiling = Math.max(floor - 1, Math.min(MAX_TARGET, Math.floor(raw)));
  const ceiling = capBidByRisk(capFragileBid(initialCeiling, trump, shape), floor, expectedPoints, quality, trump);
  return {
    trump,
    raw,
    ceiling,
    confidence: clamp((raw - floor + 0.7) / 6.2, 0, 1),
    expectedPoints,
    quality,
    shape,
    points: hand.filter(isPointCard).length,
  };
}

function chooseBidTarget(candidate, rng) {
  const headroom = candidate.ceiling - candidate.minTarget;
  if (headroom <= 0) {
    return candidate.minTarget;
  }
  const lift = candidate.confidence > 0.78 && rng() < 0.08 ? 1 : 0;
  return Math.min(candidate.ceiling, candidate.minTarget + lift);
}

function chooseContractAndFriend(game, rng) {
  const decision = chooseBid(game, game.declarerIndex, getPolicyModelForPlayer(game, game.declarerIndex), rng);
  if (decision && bidBeats(decision, game.currentBid)) {
    game.currentBid = { playerIndex: game.declarerIndex, trump: decision.trump, target: decision.target };
    game.trump = decision.trump;
    game.target = decision.target;
  }
  game.friendCardId = chooseFriendCard(game);
  game.friendIndex = findCardOwner(game, game.friendCardId);
  const discard = game.hands[game.declarerIndex].slice().sort((a, b) => discardValue(game, a) - discardValue(game, b)).slice(0, 3);
  game.buried = discard;
  game.hands[game.declarerIndex] = game.hands[game.declarerIndex].filter((card) => !discard.some((item) => item.id === card.id));
  sortHand(game.hands[game.declarerIndex]);
}

function chooseFriendCard(game) {
  const hand = game.hands[game.declarerIndex];
  const handIds = new Set(hand.map((card) => card.id));
  const mighty = createDeck().find((card) => isMighty(card, game.trump));
  const joker = createDeck().find((card) => card.joker);
  if (mighty && !handIds.has(mighty.id)) {
    return mighty.id;
  }
  if (joker && !handIds.has(joker.id)) {
    return joker.id;
  }
  const candidates = createDeck()
    .filter((card) => !handIds.has(card.id))
    .filter((card) => !card.joker)
    .sort((a, b) => friendPriority(game, b) - friendPriority(game, a));
  return candidates[0]?.id || null;
}

function friendPriority(game, card) {
  if (isMighty(card, game.trump)) {
    return 200;
  }
  if (card.joker) {
    return 180;
  }
  let score = card.rank + (isPointCard(card) ? 15 : 0);
  if (game.trump !== "NT" && card.suit === game.trump) {
    score += 32;
  }
  const declarerCounts = getSuitCounts(game.hands[game.declarerIndex]);
  if ((declarerCounts[card.suit] || 0) <= 1 && card.rank >= 13) {
    score += 15;
  }
  return score;
}

function playRound(game, rng) {
  game.leaderIndex = game.declarerIndex;
  game.currentPlayer = game.leaderIndex;
  for (game.trickNumber = 1; game.trickNumber <= 10; game.trickNumber += 1) {
    game.trick = [];
    game.jokerLeadSuit = null;
    game.jokerCallActive = false;
    let player = game.leaderIndex;
    for (let seat = 0; seat < 5; seat += 1) {
      const card = chooseCard(game, player, getPolicyModelForPlayer(game, player));
      if (!card) {
        throw new Error(`No legal card for player ${player}`);
      }
      if (game.trick.length === 0) {
        if (card.joker && isJokerEffective(game)) {
          game.jokerLeadSuit = chooseJokerLeadSuit(game, player);
        }
        game.jokerCallActive = isJokerCall(game, card) && shouldUseJokerCall(game, player, card);
      }
      game.hands[player] = game.hands[player].filter((item) => item.id !== card.id);
      game.trick.push({ playerIndex: player, card });
      recordPlay(game, player, card);
      player = nextPlayer(player);
    }
    const winner = getTrickWinner(game, game.trick);
    game.captured[winner].push(...game.trick.map((entry) => entry.card));
    game.leaderIndex = winner;
  }
}

function chooseCard(game, playerIndex, policyModel) {
  const legalCards = game.hands[playerIndex].filter((card) => isLegalPlay(game, playerIndex, card));
  if (!legalCards.length) {
    return null;
  }
  const candidates = legalCards
    .map((card) => {
      const outcome = simulateTrickAfterPlay(game, playerIndex, card);
      return {
        card,
        outcome,
        score: evaluateCardChoice(game, playerIndex, card, legalCards, outcome, policyModel),
      };
    })
    .sort((a, b) => b.score - a.score || aiCardSpendCost(game, a.card) - aiCardSpendCost(game, b.card));
  const chosen = policyModel ? selectExplorationCandidate(game, candidates, 2.2) : candidates[0];
  if (playerIndex === game.learnerIndex && game.collector) {
    game.decisionSamples.push({
      kind: "play",
      features: buildPlayFeatures(game, playerIndex, chosen.card, legalCards, chosen.outcome),
      policyScore: evaluateModelPlay(game, playerIndex, chosen.card, legalCards, chosen.outcome, policyModel),
      ruleScore: chosen.score - evaluateModelPlay(game, playerIndex, chosen.card, legalCards, chosen.outcome, policyModel),
      cardId: chosen.card.id,
      trickNumber: game.trickNumber,
      isLead: game.trick.length === 0,
    });
  }
  return chosen.card;
}

function evaluateCardChoice(game, playerIndex, card, legalCards, outcome, policyModel) {
  const playerSide = getSide(game, playerIndex);
  const winnerSide = getSide(game, outcome.winner);
  const trickPoints = game.trick.filter((entry) => isPointCard(entry.card)).length + (isPointCard(card) ? 1 : 0);
  const declarerPoints = getDeclarerTeamPoints(game);
  const declarerNeed = Math.max(0, game.target - declarerPoints);
  let score = 0;
  if (playerSide === "declarer") {
    score += winnerSide === "declarer" ? 18 + outcome.points * 7 : -11 - outcome.points * 7;
    score += winnerSide === "declarer" ? Math.min(outcome.points, declarerNeed) * 3 : -Math.min(outcome.points, declarerNeed) * 2.5;
  } else {
    score += winnerSide === "defense" ? 17 + outcome.points * 6.5 : -18 - outcome.points * 7.5;
    if (declarerNeed <= 4) {
      score += winnerSide === "defense" ? 7 : -10;
    }
  }
  if (game.trick.length > 0) {
    const currentWinner = getTrickWinner(game, game.trick);
    const currentWinnerSide = getSide(game, currentWinner);
    const winsWithCard = getTrickWinner(game, [...game.trick, { playerIndex, card }]) === playerIndex;
    if (currentWinnerSide === playerSide && winsWithCard && currentWinner !== playerIndex) {
      score -= isControlCard(game, card) ? 70 : 30;
    }
    if (currentWinnerSide === playerSide && !winsWithCard && isPointCard(card)) {
      score += 18;
    }
    if (currentWinnerSide !== playerSide && winsWithCard) {
      score += trickPoints > 0 || game.trick.length === 4 ? 15 : 5;
    }
  } else {
    score += evaluateLeadChoice(game, playerIndex, card, legalCards);
  }
  if (card.joker && !isJokerEffective(game)) {
    score -= 80;
  }
  if ((card.joker || isMighty(card, game.trump)) && outcome.points === 0 && game.trickNumber <= 7) {
    score -= 36;
  }
  score -= aiCardSpendCost(game, card) * (getSide(game, outcome.winner) === playerSide ? 0.07 : 0.16);
  if (policyModel) {
    score += evaluateModelPlay(game, playerIndex, card, legalCards, outcome, policyModel);
  }
  return score;
}

function evaluateLeadChoice(game, playerIndex, card) {
  const side = getSide(game, playerIndex);
  let score = 0;
  if (side === "defense" && isOrdinaryTrump(game, card)) {
    score -= 20;
  }
  if (side === "declarer" && game.trump !== "NT" && game.trickNumber > 1 && isOrdinaryTrump(game, card)) {
    score += 16 + Math.max(0, 14 - card.rank) * 0.8;
  }
  if (!isSpecial(game, card) && card.rank === 14 && card.suit !== game.trump) {
    score += 7;
  }
  if (!isSpecial(game, card) && !isPointCard(card)) {
    score += Math.max(0, 10 - card.rank) * 0.7;
  }
  if (isJokerCall(game, card) && shouldUseJokerCall(game, playerIndex, card)) {
    score += 28;
  }
  return score;
}

function simulateTrickAfterPlay(game, playerIndex, card) {
  const copy = cloneGameForTrick(game);
  let jokerLeadSuit = copy.jokerLeadSuit;
  let jokerCallActive = copy.jokerCallActive;
  if (!copy.trick.length) {
    if (card.joker && isJokerEffective(copy)) {
      jokerLeadSuit = chooseJokerLeadSuit(copy, playerIndex);
    }
    jokerCallActive = isJokerCall(copy, card) && shouldUseJokerCall(copy, playerIndex, card);
  }
  copy.trick.push({ playerIndex, card });
  copy.hands[playerIndex] = copy.hands[playerIndex].filter((item) => item.id !== card.id);
  copy.jokerLeadSuit = jokerLeadSuit;
  copy.jokerCallActive = jokerCallActive;
  let next = nextPlayer(playerIndex);
  while (copy.trick.length < 5) {
    const legal = copy.hands[next].filter((candidate) => isLegalPlay(copy, next, candidate));
    const response = chooseSimulatedResponse(copy, next, legal);
    copy.hands[next] = copy.hands[next].filter((item) => item.id !== response.id);
    copy.trick.push({ playerIndex: next, card: response });
    next = nextPlayer(next);
  }
  const winner = getTrickWinner(copy, copy.trick);
  return {
    winner,
    points: copy.trick.filter((entry) => isPointCard(entry.card)).length,
  };
}

function chooseSimulatedResponse(game, playerIndex, legalCards) {
  const playerSide = getSide(game, playerIndex);
  const currentWinner = getTrickWinner(game, game.trick);
  const currentWinnerSide = getSide(game, currentWinner);
  const trickPoints = game.trick.filter((entry) => isPointCard(entry.card)).length;
  return legalCards
    .slice()
    .sort((a, b) => {
      const scoreA = simulatedResponseScore(game, playerIndex, a, playerSide, currentWinnerSide, trickPoints);
      const scoreB = simulatedResponseScore(game, playerIndex, b, playerSide, currentWinnerSide, trickPoints);
      return scoreB - scoreA || aiCardSpendCost(game, a) - aiCardSpendCost(game, b);
    })[0];
}

function simulatedResponseScore(game, playerIndex, card, playerSide, currentWinnerSide, trickPoints) {
  const wins = getTrickWinner(game, [...game.trick, { playerIndex, card }]) === playerIndex;
  let score = 0;
  if (currentWinnerSide === playerSide) {
    score += isPointCard(card) ? 14 : 3;
    if (wins) {
      score -= isControlCard(game, card) ? 62 : 28;
    }
  } else if (wins) {
    score += trickPoints > 0 || game.trick.length === 4 ? 20 : 5;
  } else {
    score += isPointCard(card) ? -12 : 6;
  }
  score -= aiCardSpendCost(game, card) * 0.08;
  return score;
}

function selectExplorationCandidate(game, candidates, temperature = 1) {
  if (!game.exploration || candidates.length <= 1 || game.rng() >= game.exploration) {
    return candidates[0];
  }
  const pool = candidates.slice(0, Math.min(5, candidates.length));
  const bestScore = pool[0].score;
  const weights = pool.map((candidate) => Math.exp((candidate.score - bestScore) / Math.max(0.05, temperature)));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let roll = game.rng() * total;
  for (let i = 0; i < pool.length; i += 1) {
    roll -= weights[i];
    if (roll <= 0) {
      return pool[i];
    }
  }
  return pool[0];
}

function getPolicyModelForPlayer(game, playerIndex) {
  if (playerIndex === game.learnerIndex) {
    return game.model;
  }
  return game.opponentAssignments?.[playerIndex] || null;
}

function evaluateModelBid(game, candidate, playerIndex, model = game.model) {
  const features = buildBidFeatures(game, candidate, playerIndex);
  const linearScore = dot(model.bidWeights, features) * model.bidScale;
  const mlpScore = model.mlp?.enabled !== false && model.mlp?.bid
    ? evaluateMlpHead(model.mlp.bid, features)
    : 0;
  return clamp(linearScore + mlpScore, -3.4, 3.4);
}

function buildBidFeatures(game, candidate, playerIndex) {
  const hand = game.hands[playerIndex] || [];
  const shape = candidate.shape || getBidShape(hand, candidate.trump);
  const pointCount = hand.filter(isPointCard).length;
  const voidCount = SUITS.filter((suit) => !hand.some((card) => !card.joker && card.suit === suit)).length;
  const target = candidate.target ?? candidate.ceiling ?? getOpeningBidFloor(candidate.trump);
  const minTarget = candidate.minTarget ?? getMinimumBid(game, candidate.trump);
  const firstLeadCards = hand.filter((card) => isFirstLeadCandidate(card, candidate.trump));
  return [
    1,
    target / MAX_TARGET,
    clamp((candidate.ceiling - target) / 5, -1, 1),
    clamp(((candidate.expectedPoints ?? target) - target) / 5, -1.5, 1.5),
    candidate.confidence ?? 0,
    clamp((candidate.quality ?? 0) / 10, 0, 1.5),
    candidate.trump === "NT" ? 1 : 0,
    clamp((shape.trumpLength || 0) / 8, 0, 1),
    shape.hasMighty ? 1 : 0,
    shape.hasJoker ? 1 : 0,
    shape.hasTopTrump ? 1 : 0,
    pointCount / 10,
    clamp((target - minTarget) / 7, 0, 1),
    clamp((candidate.pressure || 0) / 6, -1, 1),
    firstLeadCards.length ? 1 : 0,
    voidCount / 4,
  ];
}

function evaluateModelPlay(game, playerIndex, card, legalCards, outcome, model = game.model) {
  const features = buildPlayFeatures(game, playerIndex, card, legalCards, outcome);
  const linearScore = dot(model.playWeights, features) * model.playScale;
  const mlpScore = model.mlp?.enabled !== false && model.mlp?.play
    ? evaluateMlpHead(model.mlp.play, features)
    : 0;
  return clamp(linearScore + mlpScore, -22, 22);
}

function buildPlayFeatures(game, playerIndex, card, legalCards, outcome) {
  const playerSide = getSide(game, playerIndex);
  const winnerSide = getSide(game, outcome.winner);
  const currentWinner = game.trick.length ? getTrickWinner(game, game.trick) : null;
  const currentWinnerSide = currentWinner === null ? null : getSide(game, currentWinner);
  const leadSuit = getLeadSuit(game, game.trick);
  const hand = game.hands[playerIndex] || [];
  const suitCounts = getSuitCounts(hand);
  const trickPointsBefore = game.trick.filter((entry) => isPointCard(entry.card)).length;
  const declarerNeed = Math.max(0, game.target - getDeclarerTeamPoints(game));
  const knownVoids = getKnownVoidSuitsByPlayer(game);
  const knownDeclarerVoidSuit = leadSuit && knownVoids[game.declarerIndex]?.has(leadSuit) ? 1 : 0;
  let knownOpponentVoidSuit = 0;
  if (leadSuit) {
    for (let index = 0; index < 5; index += 1) {
      if (index !== playerIndex && getSide(game, index) !== playerSide && knownVoids[index]?.has(leadSuit)) {
        knownOpponentVoidSuit = 1;
        break;
      }
    }
  }
  return [
    1,
    playerSide === "declarer" ? 1 : 0,
    game.trick.length === 0 ? 1 : 0,
    game.trickNumber / 10,
    isPointCard(card) ? 1 : 0,
    trickPointsBefore / 5,
    outcome.points / 5,
    playerSide === winnerSide ? 1 : 0,
    clamp(declarerNeed / MAX_TARGET, 0, 1),
    clamp(getDefenseTeamPoints(game) / TOTAL_POINT_CARDS, 0, 1),
    isMighty(card, game.trump) ? 1 : 0,
    card.joker ? 1 : 0,
    isOrdinaryTrump(game, card) ? 1 : 0,
    card.joker ? 0 : card.rank / 14,
    isControlCard(game, card) ? 1 : 0,
    legalCards.length / 10,
    game.trick.length === 4 ? 1 : 0,
    currentWinnerSide === playerSide ? 1 : 0,
    currentWinnerSide && currentWinnerSide !== playerSide ? 1 : 0,
    aiCardSpendCost(game, card) / 120,
    isJokerCall(game, card) ? 1 : 0,
    card.joker && game.trick.length === 0 && isJokerEffective(game) ? 1 : 0,
    game.trick.length === 0 ? 0 : getTrickWinner(game, [...game.trick, { playerIndex, card }]) === playerIndex ? 1 : 0,
    game.target / MAX_TARGET,
    hand.filter(isPointCard).length / 10,
    card.joker ? 0 : (suitCounts[card.suit] || 0) / 10,
    knownDeclarerVoidSuit,
    knownOpponentVoidSuit,
  ];
}

function scoreGame(game) {
  const buriedPoints = game.buried.filter(isPointCard).length;
  const declarerTeam = [game.declarerIndex];
  if (game.friendIndex !== null && game.friendIndex !== game.declarerIndex) {
    declarerTeam.push(game.friendIndex);
  }
  const declarerPoints = declarerTeam.reduce((sum, index) => sum + game.captured[index].filter(isPointCard).length, buriedPoints);
  const success = declarerPoints >= game.target;
  const learnerDeclarerSide = declarerTeam.includes(game.learnerIndex);
  const learnerWon = learnerDeclarerSide ? success : !success;
  const margin = success ? declarerPoints - game.target + 1 : game.target - declarerPoints + 1;
  const reward = (learnerWon ? 1 : -1) * (1 + margin * 0.32 + (game.target - 13) * 0.05);
  return {
    reward,
    learnerWon,
    learnerDeclarerSide,
    learnerDeclared: game.declarerIndex === game.learnerIndex,
  };
}

function createDeck() {
  const cards = [];
  for (const suit of SUITS) {
    for (let rank = 2; rank <= 14; rank += 1) {
      cards.push({ id: `${suit}${rank}`, suit, rank });
    }
  }
  cards.push({ id: "JOKER", suit: "J", rank: 0, joker: true });
  return cards;
}

function shuffle(cards, rng) {
  const copy = cards.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function cloneGameForTrick(game) {
  return {
    ...game,
    hands: game.hands.map((hand) => hand.slice()),
    trick: game.trick.slice(),
    captured: game.captured.map((cards) => cards.slice()),
  };
}

function recordPlay(game, playerIndex, card) {
  const leadSuit = getLeadSuit(game, game.trick);
  game.playHistory.push({
    playerIndex,
    cardId: card.id,
    leadSuit,
    isLead: game.trick.length === 1,
    joker: Boolean(card.joker),
  });
}

function getLegalLead(game, playerIndex, card) {
  if (game.trickNumber !== 1 || playerIndex !== game.declarerIndex) {
    return true;
  }
  if (!isOrdinaryTrump(game, card)) {
    return true;
  }
  return !game.hands[playerIndex].some((item) => !isOrdinaryTrump(game, item));
}

function isLegalPlay(game, playerIndex, card) {
  if (!game.trick.length) {
    return getLegalLead(game, playerIndex, card);
  }
  const leadSuit = getLeadSuit(game, game.trick);
  if (!leadSuit) {
    return true;
  }
  if (isMightyLead(game, game.trick) && playerHasFollowSuit(game, playerIndex, leadSuit)) {
    return !isSpecial(game, card) && card.suit === leadSuit;
  }
  if (isSpecial(game, card)) {
    return true;
  }
  if (isJokerCallLead(game, game.trick) && game.hands[playerIndex].some((item) => item.joker)) {
    return card.joker || isMighty(card, game.trump);
  }
  const hasLeadSuit = playerHasFollowSuit(game, playerIndex, leadSuit);
  return !hasLeadSuit || (!isSpecial(game, card) && card.suit === leadSuit);
}

function getTrickWinner(game, trick) {
  const leadSuit = getLeadSuit(game, trick);
  const jokerCalled = isJokerCallLead(game, trick);
  let winningEntry = trick[0];
  let winningPower = cardPower(game, winningEntry.card, leadSuit, jokerCalled);
  for (const entry of trick.slice(1)) {
    const power = cardPower(game, entry.card, leadSuit, jokerCalled);
    if (power > winningPower) {
      winningPower = power;
      winningEntry = entry;
    }
  }
  return winningEntry.playerIndex;
}

function getLeadSuit(game, trick) {
  if (trick.length > 0 && trick[0].card.joker && game.jokerLeadSuit) {
    return game.jokerLeadSuit;
  }
  if (isMightyLead(game, trick)) {
    return "S";
  }
  const lead = trick.find((entry) => !isSpecial(game, entry.card));
  return lead ? lead.card.suit : null;
}

function cardPower(game, card, leadSuit, jokerCalled) {
  if (isMighty(card, game.trump)) {
    return 1000;
  }
  if (card.joker) {
    if (jokerCalled) {
      return -100;
    }
    return isJokerEffective(game) ? 900 : -100;
  }
  if (game.trump !== "NT" && card.suit === game.trump) {
    return 600 + card.rank;
  }
  if (leadSuit && card.suit === leadSuit) {
    return 300 + card.rank;
  }
  return card.rank;
}

function isMightyLead(game, trick) {
  return trick.length > 0 && isMighty(trick[0].card, game.trump);
}

function isJokerCallLead(game, trick) {
  return Boolean(game.jokerCallActive) && trick.length > 0 && isJokerCall(game, trick[0].card);
}

function chooseJokerLeadSuit(game, playerIndex) {
  const counts = getSuitCounts(game.hands[playerIndex]);
  return SUITS.slice().sort((a, b) => (counts[a] || 0) - (counts[b] || 0))[0];
}

function shouldUseJokerCall(game, playerIndex, card) {
  if (!isJokerCall(game, card) || !isJokerEffective(game)) {
    return false;
  }
  if (game.hands[playerIndex].some((item) => item.joker)) {
    return false;
  }
  const jokerOwner = findCardOwner(game, "JOKER");
  return jokerOwner !== null && getSide(game, jokerOwner) !== getSide(game, playerIndex);
}

function findCardOwner(game, cardId) {
  if (!cardId) {
    return null;
  }
  for (let index = 0; index < 5; index += 1) {
    if (game.hands[index].some((card) => card.id === cardId)) {
      return index;
    }
  }
  if (game.buried.some((card) => card.id === cardId)) {
    return game.declarerIndex;
  }
  return null;
}

function getSide(game, playerIndex) {
  return playerIndex === game.declarerIndex || playerIndex === game.friendIndex ? "declarer" : "defense";
}

function getDeclarerTeamPoints(game) {
  return game.captured.reduce((sum, cards, index) => {
    if (index === game.declarerIndex || index === game.friendIndex) {
      return sum + cards.filter(isPointCard).length;
    }
    return sum;
  }, game.buried.filter(isPointCard).length);
}

function getDefenseTeamPoints(game) {
  return game.captured.reduce((sum, cards, index) => {
    if (index !== game.declarerIndex && index !== game.friendIndex) {
      return sum + cards.filter(isPointCard).length;
    }
    return sum;
  }, 0);
}

function getKnownVoidSuitsByPlayer(game) {
  const voids = Array.from({ length: 5 }, () => new Set());
  for (const entry of game.playHistory) {
    if (entry.isLead || !entry.leadSuit || entry.joker) {
      continue;
    }
    const card = getCardById(entry.cardId);
    if (!card || isMighty(card, game.trump)) {
      continue;
    }
    if (card.suit !== entry.leadSuit) {
      voids[entry.playerIndex].add(entry.leadSuit);
    }
  }
  return voids;
}

function getCardById(cardId) {
  return createDeck().find((card) => card.id === cardId) || null;
}

function playerHasFollowSuit(game, playerIndex, suit) {
  return game.hands[playerIndex].some((card) => !isSpecial(game, card) && card.suit === suit);
}

function isPointCard(card) {
  return !card.joker && card.rank >= 10;
}

function isMighty(card, trump) {
  return !card.joker && card.suit === getMightySuit(trump) && card.rank === 14;
}

function getMightySuit(trump) {
  return trump === "S" ? "D" : "S";
}

function getJokerCallSuit(trump) {
  return trump === "C" ? "S" : "C";
}

function isJokerCall(game, card) {
  return !card.joker && card.rank === 3 && card.suit === getJokerCallSuit(game.trump);
}

function isSpecial(game, card) {
  return card.joker || isMighty(card, game.trump);
}

function isOrdinaryTrump(game, card) {
  return !card.joker && !isMighty(card, game.trump) && game.trump !== "NT" && card.suit === game.trump;
}

function isJokerEffective(game) {
  return game.trickNumber !== 1 && game.trickNumber !== 10;
}

function isControlCard(game, card) {
  if (card.joker) {
    return isJokerEffective(game);
  }
  return isMighty(card, game.trump) || isOrdinaryTrump(game, card) && card.rank >= 12 || card.rank === 14;
}

function aiCardSpendCost(game, card) {
  if (card.joker) {
    return isJokerEffective(game) ? 92 : 8;
  }
  if (isMighty(card, game.trump)) {
    return 98;
  }
  if (isOrdinaryTrump(game, card)) {
    return 34 + card.rank * 1.7 + (isPointCard(card) ? 10 : 0);
  }
  if (card.rank === 14) {
    return 34;
  }
  return card.rank + (isPointCard(card) ? 24 : 0);
}

function discardValue(game, card) {
  if (card.joker) {
    return 990;
  }
  if (isMighty(card, game.trump)) {
    return 1000;
  }
  const trumpBonus = game.trump !== "NT" && card.suit === game.trump ? 36 : 0;
  const pointSafety = isPointCard(card) ? (card.rank <= 12 ? -13 : -5) : 0;
  return card.rank + trumpBonus + (card.rank === 14 ? 24 : 0) + pointSafety;
}

function getBidShape(hand, trump) {
  const cards = hand.filter((card) => !card.joker);
  const trumpCards = trump === "NT" ? [] : cards.filter((card) => card.suit === trump);
  const hasTrumpAce = trumpCards.some((card) => card.rank === 14);
  const hasTrumpKing = trumpCards.some((card) => card.rank === 13);
  return {
    trumpLength: trumpCards.length,
    hasTrumpAce,
    hasTrumpKing,
    hasTopTrump: hasTrumpAce || hasTrumpKing,
    hasBothTrumpAk: hasTrumpAce && hasTrumpKing,
    hasMighty: hand.some((card) => isMighty(card, trump)),
    hasJoker: hand.some((card) => card.joker),
  };
}

function highBidQuality(hand, trump) {
  const pointCards = hand.filter(isPointCard).length;
  const aces = hand.filter((card) => !card.joker && card.rank === 14).length;
  const mighty = hand.some((card) => isMighty(card, trump)) ? 2.1 : 0;
  const joker = hand.some((card) => card.joker) ? 1.7 : 0;
  if (trump === "NT") {
    return mighty + joker + aces * 0.75 + pointCards * 0.28;
  }
  const trumpCards = hand.filter((card) => !card.joker && card.suit === trump);
  const topTrump = trumpCards.reduce((sum, card) => sum + Math.max(0, card.rank - 10) * 0.3, 0);
  return mighty + joker + topTrump + Math.max(0, trumpCards.length - 3) * 0.55 + pointCards * 0.24;
}

function estimateBidExpectedPoints(hand, trump, raw, quality) {
  const pointCards = hand.filter(isPointCard).length;
  const aces = hand.filter((card) => !card.joker && card.rank === 14).length;
  const controls = (hand.some((card) => isMighty(card, trump)) ? 0.8 : 0) + (hand.some((card) => card.joker) ? 0.65 : 0);
  return clamp(raw - 1.85 + pointCards * 0.11 + aces * 0.1 + controls + Math.max(-0.5, (quality - 5.2) * 0.16), 10.2, 18.5);
}

function capFragileBid(ceiling, trump, shape) {
  if (trump === "NT") {
    return ceiling;
  }
  let capped = ceiling;
  if (!shape.hasTopTrump && capped >= 16) {
    capped = 15;
  }
  if (shape.trumpLength <= 3 && capped >= 16 && !shape.hasBothTrumpAk) {
    capped = 15;
  }
  if (capped >= 17 && !(shape.hasTopTrump && shape.trumpLength >= 4 && (shape.hasMighty || shape.hasJoker))) {
    capped = 16;
  }
  return capped;
}

function capBidByRisk(ceiling, floor, expectedPoints, quality, trump) {
  let capped = ceiling;
  while (capped >= floor) {
    const successChance = 0.45 + (expectedPoints - capped) * 0.16 + (quality - 5.3) * 0.07;
    const threshold = minimumBidSuccessChance(capped) - (trump === "NT" ? 0.02 : 0);
    if (successChance >= threshold && expectedPoints - capped >= requiredBidPointMargin(capped)) {
      break;
    }
    capped -= 1;
  }
  return Math.max(floor - 1, capped);
}

function evaluateBidFailureRisk(candidate, target) {
  const expectedPoints = candidate.expectedPoints ?? candidate.raw - 1.2;
  const qualityNeed = target >= 18 ? 7.0 + (target - 18) * 1.05 : 4.45 + Math.max(0, target - getOpeningBidFloor(candidate.trump)) * 0.55;
  const successChance = clamp(0.45 + (expectedPoints - target) * 0.16 + ((candidate.quality ?? 0) - qualityNeed) * 0.07 + (candidate.confidence ?? 0) * 0.12, 0.05, 0.95);
  const missBy = Math.max(0, target - expectedPoints);
  return {
    successChance,
    penalty: (1 - successChance) * (1.05 + Math.max(0, target - 13) * 0.28) + missBy * 0.5,
  };
}

function isFirstLeadCandidate(card, trump) {
  if (card.joker) {
    return false;
  }
  if (trump !== "NT" && card.suit === trump && !isMighty(card, trump)) {
    return false;
  }
  return card.rank >= 13 || isMighty(card, trump);
}

function getMinimumBid(game, trump) {
  const floor = getOpeningBidFloor(trump);
  if (!game.currentBid) {
    return floor;
  }
  for (let target = floor; target <= MAX_TARGET; target += 1) {
    if (bidBeats({ trump, target }, game.currentBid)) {
      return target;
    }
  }
  return MAX_TARGET + 1;
}

function getOpeningBidFloor(trump) {
  return trump === "NT" ? MIN_NO_TRUMP_TARGET : MIN_TARGET;
}

function bidBeats(candidate, current) {
  if (!current) {
    return true;
  }
  if (candidate.target !== current.target) {
    return candidate.target > current.target;
  }
  return candidate.trump === "NT" && current.trump !== "NT";
}

function getBidPower(bid) {
  return bid.target + (bid.trump === "NT" ? 0.1 : 0);
}

function minimumBidSuccessChance(target) {
  return clamp(0.45 + Math.max(0, target - 14) * 0.095 + Math.max(0, target - 16) * 0.12, 0.42, 0.9);
}

function requiredBidPointMargin(target) {
  if (target >= 17) {
    return 0.55;
  }
  if (target >= 16) {
    return 0.2;
  }
  return -0.85;
}

function highBidRiskPenalty(target) {
  if (target < 16) {
    return 0;
  }
  return (target - 15) * 0.38 + Math.max(0, target - 17) * 0.42;
}

function getSuitCounts(hand) {
  return SUITS.reduce((counts, suit) => {
    counts[suit] = hand.filter((card) => !card.joker && card.suit === suit).length;
    return counts;
  }, {});
}

function sortHand(hand) {
  const suitOrder = { S: 0, D: 1, H: 2, C: 3, J: 4 };
  hand.sort((a, b) => suitOrder[a.suit] - suitOrder[b.suit] || b.rank - a.rank);
}

function nextPlayer(playerIndex) {
  return (playerIndex + 1) % 5;
}

function dot(weights, features) {
  let sum = 0;
  for (let i = 0; i < weights.length && i < features.length; i += 1) {
    sum += weights[i] * features[i];
  }
  return sum;
}

function evaluateMlpHead(head, features) {
  if (!head) {
    return 0;
  }
  let output = head.b2;
  for (let hiddenIndex = 0; hiddenIndex < head.hidden; hiddenIndex += 1) {
    let activation = head.b1[hiddenIndex];
    const rowOffset = hiddenIndex * head.input;
    for (let featureIndex = 0; featureIndex < head.input; featureIndex += 1) {
      activation += head.w1[rowOffset + featureIndex] * (features[featureIndex] || 0);
    }
    output += head.w2[hiddenIndex] * Math.tanh(activation);
  }
  return output * head.outputScale;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function createRng(seed) {
  let value = seed >>> 0;
  return function rng() {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rng) {
  const u = Math.max(1e-9, rng());
  const v = Math.max(1e-9, rng());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function writeModel(model, version, summary) {
  fs.mkdirSync(path.dirname(MODEL_JS), { recursive: true });
  const normalized = {
    name: "mighty-policy-v1",
    version,
    source: "trained-self-play",
    enabled: true,
    bidScale: model.bidScale,
    playScale: model.playScale,
    training: {
      generatedAt: new Date().toISOString(),
      ...summary,
      bidFeatures: BID_FEATURES,
      playFeatures: PLAY_FEATURES,
    },
    bidWeights: model.bidWeights.map(roundWeight),
    playWeights: model.playWeights.map(roundWeight),
  };
  fs.writeFileSync(MODEL_JS, `window.MIGHTY32_AI_MODEL = ${JSON.stringify(normalized, null, 2)};\n`);
  writeBinaryModel(normalized);
}

function writeBinaryModel(model) {
  const headerSize = 12;
  const totalWeights = model.bidWeights.length + model.playWeights.length;
  const buffer = Buffer.alloc(headerSize + totalWeights * 4);
  buffer.write(MODEL_MAGIC, 0, "ascii");
  buffer.writeUInt16LE(model.version, 4);
  buffer.writeUInt16LE(model.bidWeights.length, 6);
  buffer.writeUInt16LE(model.playWeights.length, 8);
  buffer.writeUInt16LE(0, 10);
  let offset = headerSize;
  for (const weight of model.bidWeights.concat(model.playWeights)) {
    buffer.writeFloatLE(weight, offset);
    offset += 4;
  }
  fs.writeFileSync(MODEL_BIN, buffer);
}

function writeMlpModel(model) {
  const normalized = normalizeMlpModel(model);
  if (!normalized) {
    throw new Error("invalid_mlp_model");
  }
  fs.mkdirSync(path.dirname(MLP_MODEL_JS), { recursive: true });
  const output = {
    ...normalized,
    bid: serializeMlpHead(normalized.bid),
    play: serializeMlpHead(normalized.play),
  };
  fs.writeFileSync(MLP_MODEL_JS, `window.MIGHTY32_MLP_MODEL = ${JSON.stringify(output, null, 2)};\n`);
  writeMlpBinaryModel(output);
}

function serializeMlpHead(head) {
  return {
    input: head.input,
    hidden: head.hidden,
    outputScale: roundWeight(head.outputScale),
    w1: head.w1.map(roundWeight),
    b1: head.b1.map(roundWeight),
    w2: head.w2.map(roundWeight),
    b2: roundWeight(head.b2),
  };
}

function writeMlpBinaryModel(model) {
  const bid = model.bid;
  const play = model.play;
  const bidValues = bid.w1.concat(bid.b1, bid.w2, [bid.b2]);
  const playValues = play.w1.concat(play.b1, play.w2, [play.b2]);
  const headerSize = 16;
  const buffer = Buffer.alloc(headerSize + (bidValues.length + playValues.length) * 4);
  buffer.write(MLP_MODEL_MAGIC, 0, "ascii");
  buffer.writeUInt16LE(model.version || 1, 4);
  buffer.writeUInt16LE(bid.input, 6);
  buffer.writeUInt16LE(bid.hidden, 8);
  buffer.writeUInt16LE(play.input, 10);
  buffer.writeUInt16LE(play.hidden, 12);
  buffer.writeUInt16LE(0, 14);
  let offset = headerSize;
  for (const value of bidValues.concat(playValues)) {
    buffer.writeFloatLE(value, offset);
    offset += 4;
  }
  fs.writeFileSync(MLP_MODEL_BIN, buffer);
}

function roundWeight(value) {
  return Number(value.toFixed(6));
}

function printEval(label, result) {
  console.log(
    `${label}: score=${result.score.toFixed(4)} win=${(result.winRate * 100).toFixed(1)}% ` +
      `bid=${(result.bidRate * 100).toFixed(1)}% dec=${(result.declarerWinRate * 100).toFixed(1)}% ` +
      `def=${(result.defenseWinRate * 100).toFixed(1)}% games=${result.games}`,
  );
}

if (require.main === module) {
  main();
} else {
  module.exports = {
    BID_FEATURES,
    PLAY_FEATURES,
    MLP_MODEL_JS,
    MLP_MODEL_BIN,
    MLP_MODEL_MAGIC,
    createRng,
    evaluateModel,
    evaluateModelSuite,
    loadModel,
    loadMlpModel,
    loadMlpModelFromFile,
    loadOpponentModels,
    normalizeMlpModel,
    cloneModel,
    cloneMlpModel,
    runGame,
    writeMlpModel,
    writeMlpBinaryModel,
  };
}
