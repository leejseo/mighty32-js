const DEFAULT_PLAYER_NAMES = ["나", "이명박", "김영삼", "김대중", "최규하"];
const DEFAULT_AVATARS = [
  "",
  "assets/avatars/lee-myung-bak.png",
  "assets/avatars/kim-young-sam.png",
  "assets/avatars/kim-dae-jung.png",
  "assets/avatars/choi-kyu-hah.png",
];
const CHARACTER_STORAGE_KEY = "mighty32-lite-characters";
const SUITS = ["S", "D", "H", "C"];
const BID_TRUMPS = ["S", "D", "H", "C", "NT"];
const SUIT_LABELS = {
  S: "♠",
  D: "◆",
  H: "♥",
  C: "♣",
  NT: "NT",
};
const SUIT_NAMES = {
  S: "스페이드",
  D: "다이아",
  H: "하트",
  C: "클럽",
  NT: "노기루",
};
const RANK_LABELS = {
  14: "A",
  13: "K",
  12: "Q",
  11: "J",
  10: "10",
  9: "9",
  8: "8",
  7: "7",
  6: "6",
  5: "5",
  4: "4",
  3: "3",
  2: "2",
};
const DB_NAME = "mighty32-lite-db";
const DB_VERSION = 1;
const STORE_NAME = "games";
const RECORDS_API_URL = "/api/records";
const RECORD_LIMIT = 30;
const IS_STATIC_PAGES_HOST =
  window.MIGHTY32_PAGES_MODE === true ||
  window.location.hostname.endsWith(".github.io");
const HUMAN = 0;
const MAX_TARGET = 20;
const TOTAL_POINT_CARDS = 20;
const MIN_TARGET = 13;
const MIN_NO_TRUMP_TARGET = 12;
const CPU_DELAY = 4500;
const TRICK_RESOLVE_DELAY = 950;
const TRICK_TREE_WEIGHT = 0.42;
const BASE_BID_PERSONALITIES = [
  { aggression: 0, noTrumpBias: 0, discipline: 0.62, stretch: 0 },
  { aggression: -0.04, noTrumpBias: -0.05, discipline: 0.64, stretch: -0.04 },
  { aggression: -0.12, noTrumpBias: 0.03, discipline: 0.74, stretch: -0.1 },
  { aggression: -0.06, noTrumpBias: 0.08, discipline: 0.67, stretch: -0.05 },
  { aggression: -0.1, noTrumpBias: -0.03, discipline: 0.7, stretch: -0.12 },
];

const app = document.querySelector("#app");
let playerProfiles = loadCharacterProfiles();
let PLAYER_NAMES = playerProfiles.map((profile) => profile.name);
let db = null;
let cpuTimer = null;
let state = createEmptyState();

function createEmptyState() {
  return {
    phase: "loading",
    hands: [[], [], [], [], []],
    kitty: [],
    buried: [],
    captured: [[], [], [], [], []],
    currentBid: null,
    passed: [false, false, false, false, false],
    currentPlayer: HUMAN,
    totalBidActions: 0,
    passesSinceBid: 0,
    bidPersonalities: createNeutralBidPersonalities(),
    declarerIndex: null,
    friendCardId: null,
    friendIndex: null,
    friendRevealed: false,
    trump: "NT",
    target: MIN_TARGET,
    leaderIndex: HUMAN,
    trick: [],
    jokerLeadSuit: null,
    pendingJokerLeadCardId: null,
    jokerCallActive: false,
    pendingJokerCallCardId: null,
    trickNumber: 1,
    playHistory: [],
    dealMissPlayers: [],
    selectedDiscardIds: new Set(),
    records: [],
    log: [],
    lastResult: null,
    message: "새 판을 준비합니다.",
    busy: false,
  };
}

document.addEventListener("DOMContentLoaded", async () => {
  db = await openRecordsDb();
  state.records = await loadRecords();
  startNewRound();
});

document.addEventListener("click", (event) => {
  const actionTarget = event.target.closest("[data-action]");
  const cardTarget = event.target.closest("[data-card-id]");

  if (cardTarget && handleCardClick(cardTarget.dataset.cardId)) {
    return;
  }

  if (!actionTarget) {
    return;
  }

  const action = actionTarget.dataset.action;
  if (action === "new-round") {
    startNewRound();
  }
  if (action === "redeal") {
    startNewRound();
  }
  if (action === "sort-hand") {
    sortHand(HUMAN);
    render();
  }
  if (action === "bid") {
    submitHumanBid();
  }
  if (action === "pass") {
    humanPass();
  }
  if (action === "confirm-contract") {
    confirmHumanContract();
  }
  if (action === "pick-friend") {
    pickFriend(actionTarget.dataset.friendId || null);
  }
  if (action === "confirm-discard") {
    confirmDiscard();
  }
  if (action === "choose-joker-suit") {
    chooseHumanJokerLeadSuit(actionTarget.dataset.suit);
  }
  if (action === "cancel-joker-suit") {
    cancelJokerLeadSuit();
  }
  if (action === "choose-joker-call") {
    chooseHumanJokerCallMode(actionTarget.dataset.mode === "call");
  }
  if (action === "cancel-joker-call") {
    cancelJokerCallChoice();
  }
  if (action === "clear-records") {
    clearRecords();
  }
  if (action === "save-characters") {
    saveCharacterSettings();
  }
  if (action === "reset-characters") {
    resetCharacterSettings();
  }
});

document.addEventListener("change", (event) => {
  if (event.target.matches("#bid-trump")) {
    updateBidTargetBounds();
  }
  if (event.target.matches("#contract-trump")) {
    updateContractTargetBounds();
  }
});

function startNewRound() {
  clearTimeout(cpuTimer);
  state = {
    ...createEmptyState(),
    phase: "bidding",
    records: state.records || [],
    message: "입찰을 시작합니다. 노기루는 12점, 일반 기루는 13점부터 20점까지입니다.",
  };
  state.bidPersonalities = createRoundBidPersonalities();

  const deck = shuffle(createDeck());
  for (let i = 0; i < 50; i += 1) {
    state.hands[i % 5].push(deck[i]);
  }
  state.kitty = deck.slice(50);
  for (let i = 0; i < 5; i += 1) {
    sortHand(i);
  }
  state.dealMissPlayers = getDealMissPlayers();
  if (state.dealMissPlayers.length) {
    const names = state.dealMissPlayers.map((index) => PLAYER_NAMES[index]).join(", ");
    addLog(`딜미스: ${names}`);
    state.phase = "dealMiss";
    if (state.dealMissPlayers.includes(HUMAN)) {
      state.message = "딜미스입니다. 점수 카드가 없어 재딜할 수 있습니다.";
      render();
      return;
    }
    state.message = `${names} 딜미스로 재딜합니다.`;
    render();
    clearTimeout(cpuTimer);
    cpuTimer = setTimeout(startNewRound, TRICK_RESOLVE_DELAY);
    return;
  }

  state.currentPlayer = HUMAN;
  addLog("새 판을 시작했습니다. 카드 10장과 바닥패 3장이 배분되었습니다.");
  render();
}

function createDeck() {
  const cards = [];
  for (const suit of SUITS) {
    for (let rank = 2; rank <= 14; rank += 1) {
      cards.push({
        id: `${suit}${rank}`,
        suit,
        rank,
      });
    }
  }
  cards.push({
    id: "JOKER",
    suit: "J",
    rank: 0,
    joker: true,
  });
  return cards;
}

function createRoundBidPersonalities() {
  return BASE_BID_PERSONALITIES.map((base, index) => {
    if (index === HUMAN) {
      return { ...base };
    }
    return {
      aggression: clamp(base.aggression + randomBetween(-0.08, 0.06), -0.34, 0.12),
      noTrumpBias: clamp(base.noTrumpBias + randomBetween(-0.08, 0.08), -0.2, 0.2),
      discipline: clamp(base.discipline + randomBetween(-0.06, 0.12), 0.5, 0.9),
      stretch: clamp(base.stretch + randomBetween(-0.08, 0.04), -0.28, 0.08),
    };
  });
}

function createNeutralBidPersonalities() {
  return BASE_BID_PERSONALITIES.map((base) => ({ ...base }));
}

function getDealMissPlayers() {
  return state.hands
    .map((hand, index) => (isDealMissHand(hand) ? index : null))
    .filter((index) => index !== null);
}

function isDealMissHand(hand) {
  return !hand.some(isPointCard);
}

function loadCharacterProfiles() {
  const defaults = createDefaultProfiles();
  try {
    const saved = JSON.parse(localStorage.getItem(CHARACTER_STORAGE_KEY) || "[]");
    return defaults.map((profile, index) => ({
      ...profile,
      ...(saved[index] || {}),
      name: String(saved[index]?.name || profile.name).slice(0, 12),
      avatarUrl: normalizeAvatarUrl(saved[index]?.avatarUrl || ""),
    }));
  } catch {
    return defaults;
  }
}

function createDefaultProfiles() {
  return DEFAULT_PLAYER_NAMES.map((name, index) => ({
    name,
    avatarUrl: "",
    defaultAvatar: DEFAULT_AVATARS[index] || "",
  }));
}

function normalizeAvatarUrl(value) {
  const url = String(value || "").trim();
  if (!url) {
    return "";
  }
  if (/^https?:\/\//i.test(url) || /^data:image\//i.test(url) || /^(\.\/)?assets\//i.test(url)) {
    return url;
  }
  return "";
}

function syncPlayerNames() {
  PLAYER_NAMES = playerProfiles.map((profile, index) => profile.name || DEFAULT_PLAYER_NAMES[index] || "COM");
}

function saveCharacterSettings() {
  const nextProfiles = playerProfiles.map((profile, index) => {
    if (index === HUMAN) {
      return profile;
    }
    const nameInput = document.querySelector(`[data-character-name="${index}"]`);
    const avatarInput = document.querySelector(`[data-character-avatar="${index}"]`);
    return {
      ...profile,
      name: String(nameInput?.value || DEFAULT_PLAYER_NAMES[index]).trim().slice(0, 12) || DEFAULT_PLAYER_NAMES[index],
      avatarUrl: normalizeAvatarUrl(avatarInput?.value || ""),
    };
  });
  playerProfiles = nextProfiles;
  syncPlayerNames();
  persistCharacterProfiles();
  state.message = "상대 캐릭터 설정을 저장했습니다.";
  render();
}

function resetCharacterSettings() {
  playerProfiles = createDefaultProfiles();
  syncPlayerNames();
  localStorage.removeItem(CHARACTER_STORAGE_KEY);
  state.message = "상대 캐릭터 설정을 기본값으로 되돌렸습니다.";
  render();
}

function persistCharacterProfiles() {
  const payload = playerProfiles.map((profile) => ({
    name: profile.name,
    avatarUrl: profile.avatarUrl,
  }));
  localStorage.setItem(CHARACTER_STORAGE_KEY, JSON.stringify(payload));
}

function getAvatarSrc(index) {
  return playerProfiles[index]?.avatarUrl || playerProfiles[index]?.defaultAvatar || "";
}

function shuffle(cards) {
  const copy = cards.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function submitHumanBid() {
  if (state.phase !== "bidding" || state.currentPlayer !== HUMAN || state.busy) {
    return;
  }
  const trumpInput = document.querySelector("#bid-trump");
  const targetInput = document.querySelector("#bid-target");
  const trump = trumpInput ? trumpInput.value : "S";
  const minTarget = getMinimumBid(trump);
  const target = Number(targetInput ? targetInput.value : minTarget);

  if (!BID_TRUMPS.includes(trump)) {
    state.message = "올바른 기루를 선택해야 합니다.";
    render();
    return;
  }

  if (!Number.isInteger(target) || target < minTarget || target > MAX_TARGET) {
    state.message = `${minTarget}점 이상 ${MAX_TARGET}점 이하로 입찰해야 합니다.`;
    render();
    return;
  }

  placeBid(HUMAN, trump, target);
  advanceBidTurn();
}

function humanPass() {
  if (state.phase !== "bidding" || state.currentPlayer !== HUMAN || state.busy) {
    return;
  }
  passBid(HUMAN);
  advanceBidTurn();
}

function placeBid(playerIndex, trump, target) {
  state.currentBid = {
    playerIndex,
    trump,
    target,
  };
  state.passesSinceBid = 0;
  state.totalBidActions += 1;
  state.message = `${PLAYER_NAMES[playerIndex]}: ${SUIT_NAMES[trump]} ${target}점 입찰`;
  addLog(state.message);
}

function passBid(playerIndex) {
  state.passed[playerIndex] = true;
  state.passesSinceBid += 1;
  state.totalBidActions += 1;
  state.message = `${PLAYER_NAMES[playerIndex]}: 패스`;
  addLog(state.message);
}

function getMinimumBid(trump = "S") {
  const floor = getOpeningBidFloor(trump);
  if (!state.currentBid) {
    return floor;
  }
  for (let target = floor; target <= MAX_TARGET; target += 1) {
    if (bidBeats({ trump, target }, state.currentBid)) {
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

function contractMatchesCurrent(candidate) {
  return state.currentBid && candidate.trump === state.currentBid.trump && candidate.target === state.currentBid.target;
}

function contractAdjustmentAllowed(candidate) {
  return contractMatchesCurrent(candidate) || bidBeats(candidate, state.currentBid);
}

function getMinimumContractAdjustment(trump = state.trump) {
  const floor = getOpeningBidFloor(trump);
  for (let target = floor; target <= MAX_TARGET; target += 1) {
    if (contractAdjustmentAllowed({ trump, target })) {
      return target;
    }
  }
  return MAX_TARGET + 1;
}

function getBidPower(bid) {
  return bid.target + (bid.trump === "NT" ? 0.1 : 0);
}

function getDefaultHumanBidTrump() {
  return BID_TRUMPS.find((trump) => getMinimumBid(trump) <= MAX_TARGET) || null;
}

function updateBidTargetBounds() {
  const trumpInput = document.querySelector("#bid-trump");
  const targetInput = document.querySelector("#bid-target");
  if (!trumpInput || !targetInput) {
    return;
  }
  const previousMin = Number(targetInput.min || targetInput.value);
  const minTarget = getMinimumBid(trumpInput.value);
  targetInput.min = String(minTarget);
  targetInput.disabled = minTarget > MAX_TARGET;
  const bidButton = document.querySelector('[data-action="bid"]');
  if (bidButton) {
    bidButton.disabled = minTarget > MAX_TARGET;
  }
  if (minTarget > MAX_TARGET) {
    targetInput.value = String(MAX_TARGET);
    return;
  }
  if (!state.currentBid || Number(targetInput.value) < minTarget || Number(targetInput.value) === previousMin) {
    targetInput.value = String(minTarget);
  }
}

function updateContractTargetBounds() {
  const trumpInput = document.querySelector("#contract-trump");
  const targetInput = document.querySelector("#contract-target");
  if (!trumpInput || !targetInput) {
    return;
  }
  const minTarget = getMinimumContractAdjustment(trumpInput.value);
  targetInput.min = String(minTarget);
  targetInput.disabled = minTarget > MAX_TARGET;
  const confirmButton = document.querySelector('[data-action="confirm-contract"]');
  if (confirmButton) {
    confirmButton.disabled = minTarget > MAX_TARGET;
  }
  if (minTarget > MAX_TARGET) {
    targetInput.value = String(MAX_TARGET);
    return;
  }
  if (Number(targetInput.value) < minTarget) {
    targetInput.value = String(minTarget);
  }
}

function advanceBidTurn() {
  if (shouldFinishBidding()) {
    finishBidding();
    return;
  }

  let next = nextPlayer(state.currentPlayer);
  let guard = 0;
  while (state.passed[next] && guard < 5) {
    next = nextPlayer(next);
    guard += 1;
  }
  state.currentPlayer = next;
  render();

  if (state.currentPlayer !== HUMAN) {
    scheduleCpuBid();
  }
}

function shouldFinishBidding() {
  const passedCount = state.passed.filter(Boolean).length;
  if (!state.currentBid && state.totalBidActions >= 5 && passedCount === 5) {
    return true;
  }
  if (!state.currentBid) {
    return false;
  }
  const allOthersPassed = state.passed.every((passed, index) => index === state.currentBid.playerIndex || passed);
  return allOthersPassed || state.passesSinceBid >= 4;
}

function scheduleCpuBid() {
  clearTimeout(cpuTimer);
  state.busy = true;
  render();
  cpuTimer = setTimeout(() => {
    state.busy = false;
    takeCpuBidTurn();
  }, CPU_DELAY);
}

function takeCpuBidTurn() {
  if (state.phase !== "bidding" || state.currentPlayer === HUMAN) {
    return;
  }
  const playerIndex = state.currentPlayer;
  const decision = chooseCpuBid(playerIndex);

  if (decision) {
    placeBid(playerIndex, decision.trump, decision.target);
  } else {
    passBid(playerIndex);
  }
  advanceBidTurn();
}

function chooseCpuBid(playerIndex) {
  const evaluation = evaluateBid(state.hands[playerIndex], playerIndex);
  const personality = getBidPersonality(playerIndex);
  const candidates = evaluation.candidates
    .map((candidate) => ({
      ...candidate,
      minTarget: getMinimumBid(candidate.trump),
    }))
    .filter((candidate) => candidate.minTarget <= MAX_TARGET && candidate.ceiling >= candidate.minTarget)
    .map((candidate) => {
      const target = chooseCpuBidTarget(candidate, personality);
      const pressure = state.currentBid
        ? getBidPower({ trump: candidate.trump, target }) - getBidPower(state.currentBid)
        : target - getOpeningBidFloor(candidate.trump);
      const reserve = candidate.ceiling - target;
      const suitPreference = candidate.trump === "NT" ? personality.noTrumpBias : 0;
      const failure = evaluateBidFailureRisk(candidate, target, personality);
      return {
        ...candidate,
        target,
        failure,
        score:
          candidate.confidence * 1.15 +
          reserve * 0.28 +
          (failure.successChance - 0.5) * 1.05 +
          suitPreference * 0.55 +
          personality.aggression * 0.16 -
          pressure * 0.12 -
          highBidRiskPenalty(target) -
          failure.penalty,
      };
    })
    .filter((candidate) => !state.currentBid || bidBeats(candidate, state.currentBid));

  if (!candidates.length) {
    return null;
  }

  candidates.sort((a, b) => b.score - a.score || getBidPower(b) - getBidPower(a));
  const best = candidates[0];
  const minConfidence = clamp(
    (state.currentBid ? 0.48 : 0.39) +
      personality.discipline * 0.22 -
      personality.aggression * 0.1 +
      highBidConfidenceTax(best.target),
    0.32,
    0.9,
  );
  const forcedStretch =
    (best.target === best.minTarget && best.raw < best.target + 0.12) ||
    (best.target >= 18 && best.raw < best.target + 0.75);
  const closeCallChance = clamp(
    0.25 +
      (best.confidence - minConfidence) * 1.35 +
      personality.aggression * 0.25 -
      personality.discipline * 0.28 -
      highBidRiskPenalty(best.target) * 0.75,
    0.02,
    0.72,
  );
  if (best.confidence < minConfidence && Math.random() > closeCallChance) {
    return null;
  }
  if (forcedStretch && Math.random() < personality.discipline) {
    return null;
  }
  if (shouldPassForFailureRisk(best, personality)) {
    return null;
  }
  return {
    trump: best.trump,
    target: best.target,
  };
}

function chooseCpuBidTarget(candidate, personality) {
  const headroom = candidate.ceiling - candidate.minTarget;
  if (headroom <= 0) {
    return candidate.minTarget;
  }

  let lift = 0;
  const openQuietly = !state.currentBid && personality.discipline > 0.48 && Math.random() < 0.88;
  if (!openQuietly && Math.random() < 0.045 + candidate.confidence * 0.06 + personality.aggression * 0.08) {
    lift += 1;
  }
  if (
    headroom >= 2 &&
    candidate.confidence > 0.76 &&
    Math.random() < 0.012 + personality.aggression * 0.06 + personality.stretch * 0.08
  ) {
    lift += 1;
  }
  if (
    headroom >= 3 &&
    candidate.confidence > 0.9 &&
    candidate.ceiling >= 18 &&
    Math.random() < 0.004 + personality.aggression * 0.04 + personality.stretch * 0.04
  ) {
    lift += 1;
  }

  let target = Math.min(candidate.ceiling, candidate.minTarget + Math.max(0, lift));
  if (target >= 16 && !isHighBidShape(candidate)) {
    target = 15;
  }
  if (target >= 17 && candidate.trump !== "NT" && !candidate.shape?.hasTopTrump) {
    target = 16;
  }
  if (target >= 18 && candidate.confidence < 0.94 && Math.random() < personality.discipline + 0.32) {
    target = 17;
  }
  return Math.min(candidate.ceiling, Math.max(candidate.minTarget, target));
}

function isHighBidShape(candidate) {
  if (candidate.trump === "NT") {
    return candidate.quality >= 7.1 && candidate.expectedPoints >= 16.2;
  }
  const shape = candidate.shape || {};
  return (
    candidate.quality >= 6.4 &&
    shape.hasTopTrump &&
    shape.trumpLength >= 4 &&
    (shape.hasBothTrumpAk || shape.hasMighty || shape.hasJoker)
  );
}

function highBidRiskPenalty(target) {
  if (target < 16) {
    return 0;
  }
  return (target - 15) * 0.38 + Math.max(0, target - 17) * 0.42;
}

function highBidConfidenceTax(target) {
  if (target < 16) {
    return 0;
  }
  return (target - 15) * 0.09 + Math.max(0, target - 17) * 0.11;
}

function evaluateBidFailureRisk(candidate, target, personality) {
  const expectedPoints = candidate.expectedPoints ?? candidate.raw - 1.2;
  const quality = candidate.quality ?? 0;
  const qualityNeed = target >= 18
    ? (candidate.trump === "NT" ? 7.2 : 6.8) + (target - 18) * 1.05
    : 4.45 + Math.max(0, target - getOpeningBidFloor(candidate.trump)) * 0.55;
  const pointMargin = expectedPoints - target;
  const qualityMargin = quality - qualityNeed;
  const successChance = clamp(
    0.45 +
      pointMargin * 0.16 +
      qualityMargin * 0.07 +
      candidate.confidence * 0.12 +
      personality.aggression * 0.035 -
      personality.discipline * 0.06,
    0.05,
    0.95,
  );
  const missBy = Math.max(0, target - expectedPoints);
  const penalty =
    (1 - successChance) *
      (1.05 + Math.max(0, target - 13) * 0.28 + Math.max(0, target - 16) * 0.62) +
    missBy * (0.48 + personality.discipline * 0.28);
  return {
    successChance,
    expectedPoints,
    penalty,
    missBy,
  };
}

function minimumBidSuccessChance(target, personality) {
  return clamp(
    0.45 + Math.max(0, target - 14) * 0.095 + Math.max(0, target - 16) * 0.12 + personality.discipline * 0.11,
    0.42,
    0.9,
  );
}

function shouldPassForFailureRisk(candidate, personality) {
  const required = minimumBidSuccessChance(candidate.target, personality) + (state.currentBid ? 0.07 : 0);
  if (candidate.target >= 16 && !isHighBidShape(candidate)) {
    return true;
  }
  if (candidate.target >= 17 && candidate.trump !== "NT" && !candidate.shape?.hasTopTrump) {
    return true;
  }
  if (candidate.failure.successChance < required) {
    return true;
  }
  if (candidate.failure.missBy > 0.55 && candidate.target >= 16) {
    return Math.random() < personality.discipline + 0.28;
  }
  if (candidate.target >= 17 && candidate.failure.successChance < required + 0.08) {
    return Math.random() < personality.discipline;
  }
  return false;
}

function getBidPersonality(playerIndex) {
  const profile = state.bidPersonalities[playerIndex] || BASE_BID_PERSONALITIES[playerIndex] || BASE_BID_PERSONALITIES[0];
  if (typeof profile === "number") {
    return {
      aggression: profile,
      noTrumpBias: 0,
      discipline: clamp(0.55 - profile * 0.5, 0.22, 0.82),
      stretch: profile * 0.45,
    };
  }
  return profile;
}

function finishBidding() {
  if (!state.currentBid) {
    state.message = "모두 패스했습니다. 새 판을 다시 돌립니다.";
    addLog(state.message);
    render();
    setTimeout(startNewRound, 900);
    return;
  }

  state.declarerIndex = state.currentBid.playerIndex;
  state.trump = state.currentBid.trump;
  state.target = state.currentBid.target;
  state.hands[state.declarerIndex].push(...state.kitty);
  state.kitty = [];
  sortHand(state.declarerIndex);

  addLog(`${PLAYER_NAMES[state.declarerIndex]}이 주공입니다. 바닥패 3장을 가져갑니다.`);

  if (state.declarerIndex === HUMAN) {
    state.phase = "contract";
    state.currentPlayer = HUMAN;
    state.message = "바닥패를 확인했습니다. 공약을 유지하거나 더 높은 공약으로 조정하세요.";
    render();
    return;
  }

  chooseCpuContractAdjustment();
  chooseCpuFriendAndDiscard();
  announceCpuFriendThenStart();
}

function confirmHumanContract() {
  if (state.phase !== "contract" || state.declarerIndex !== HUMAN) {
    return;
  }
  const trumpInput = document.querySelector("#contract-trump");
  const targetInput = document.querySelector("#contract-target");
  const trump = trumpInput ? trumpInput.value : state.trump;
  const target = Number(targetInput ? targetInput.value : state.target);
  const minTarget = getMinimumContractAdjustment(trump);

  if (!BID_TRUMPS.includes(trump)) {
    state.message = "올바른 기루를 선택해야 합니다.";
    render();
    return;
  }
  if (!Number.isInteger(target) || target < minTarget || target > MAX_TARGET || !contractAdjustmentAllowed({ trump, target })) {
    state.message = "기존 입찰보다 높은 공약이거나 현재 공약 그대로여야 합니다.";
    render();
    return;
  }

  applyContractAdjustment(HUMAN, trump, target);
  state.phase = "friend";
  state.message = "프렌드 카드를 고르세요. 선택한 카드를 낸 사람이 주공 편이 됩니다.";
  render();
}

function chooseCpuContractAdjustment() {
  const original = { ...state.currentBid };
  const decision = chooseCpuBid(state.declarerIndex);
  if (decision && bidBeats(decision, original)) {
    applyContractAdjustment(state.declarerIndex, decision.trump, decision.target);
    return;
  }
  applyContractAdjustment(state.declarerIndex, original.trump, original.target, false);
}

function applyContractAdjustment(playerIndex, trump, target, logUnchanged = true) {
  const changed = state.trump !== trump || state.target !== target;
  state.currentBid = {
    playerIndex,
    trump,
    target,
  };
  state.trump = trump;
  state.target = target;
  sortHand(state.declarerIndex);
  if (changed) {
    addLog(`${PLAYER_NAMES[playerIndex]}이 바닥패 확인 후 ${SUIT_NAMES[trump]} ${target}점으로 공약을 조정했습니다.`);
  } else if (logUnchanged) {
    addLog(`${PLAYER_NAMES[playerIndex]}이 ${SUIT_NAMES[trump]} ${target}점 공약을 유지했습니다.`);
  }
}

function announceCpuFriendThenStart() {
  const declarerName = PLAYER_NAMES[state.declarerIndex];
  state.phase = "announcement";
  state.currentPlayer = state.declarerIndex;
  state.message = state.friendCardId
    ? `${declarerName}의 프렌드는 ${formatCardById(state.friendCardId)}입니다.`
    : `${declarerName}이 독주를 선언했습니다.`;
  render();
  clearTimeout(cpuTimer);
  cpuTimer = setTimeout(startPlaying, TRICK_RESOLVE_DELAY * 1.6);
}

function evaluateBid(hand, playerIndex = HUMAN) {
  const candidates = [];
  const personality = getBidPersonality(playerIndex);
  const points = hand.filter(isPointCard).length;
  const aces = hand.filter((card) => card.rank === 14).length;
  const voids = SUITS.filter((item) => !hand.some((card) => card.suit === item)).length;

  for (const suit of SUITS) {
    const suited = hand.filter((card) => card.suit === suit);
    const highCardScore = suited.reduce((sum, card) => {
      if (card.rank === 14) {
        return sum + 2.4;
      }
      if (card.rank === 13) {
        return sum + 1.4;
      }
      if (card.rank === 12) {
        return sum + 0.8;
      }
      if (card.rank === 11) {
        return sum + 0.45;
      }
      return sum;
    }, 0);
    const pointCards = suited.filter(isPointCard).length;
    const score = suited.length * 0.55 + highCardScore + pointCards * 0.22;
    const trumpLength = suited.length;
    const hasTopTrump = suited.some((card) => card.rank === 14 || card.rank === 13);
    const controls = hand.reduce((sum, card) => {
      if (card.joker) {
        return sum + 2.1;
      }
      if (isMighty(card, suit)) {
        return sum + 2.6;
      }
      if (card.suit === suit && card.rank >= 12) {
        return sum + 1.2 + (card.rank - 12) * 0.35;
      }
      if (card.rank === 14) {
        return sum + 0.9;
      }
      return sum;
    }, 0);
    const longTrumpShape = trumpLength >= 4 ? (trumpLength - 3) * 0.32 : 0;
    const fragileSuitPenalty = (hasTopTrump ? 0 : 1.45) + (trumpLength <= 3 ? 0.55 : 0);
    const raw =
      10.72 +
      points * 0.28 +
      aces * 0.18 +
      trumpLength * 0.26 +
      score * 0.32 +
      controls * 0.56 +
      voids * 0.12 +
      longTrumpShape -
      fragileSuitPenalty;
    candidates.push(makeBidCandidate(suit, raw, hand, personality));
  }

  const suitCounts = SUITS.map((suit) => hand.filter((card) => card.suit === suit).length);
  const balanced = Math.max(...suitCounts) - Math.min(...suitCounts) <= 2;
  const noTrumpControls = hand.reduce((sum, card) => {
    if (card.joker) {
      return sum + 1.8;
    }
    if (isMighty(card, "NT")) {
      return sum + 2.5;
    }
    if (card.rank === 14) {
      return sum + 1.2;
    }
    if (card.rank === 13) {
      return sum + 0.45;
    }
    return sum;
  }, 0);
  const noTrumpRaw = 10.36 + points * 0.36 + aces * 0.28 + noTrumpControls * 0.58 + (balanced ? 0.55 : -1.2);
  candidates.push(makeBidCandidate("NT", noTrumpRaw, hand, personality));
  candidates.sort(
    (a, b) =>
      b.ceiling - a.ceiling ||
      b.confidence - a.confidence ||
      getBidPower({ trump: b.trump, target: b.ceiling }) - getBidPower({ trump: a.trump, target: a.ceiling }) ||
      b.raw - a.raw,
  );
  const best = candidates[0];
  return {
    trump: best.trump,
    target: best.ceiling,
    confidence: best.confidence,
    candidates,
  };
}

function makeBidCandidate(trump, raw, hand, personality) {
  const floor = getOpeningBidFloor(trump);
  const styleAdjustment =
    personality.aggression * 0.38 +
    personality.stretch * 0.22 +
    (trump === "NT" ? personality.noTrumpBias * 0.75 : 0) -
    personality.discipline * 0.32;
  const adjustedRaw = raw + styleAdjustment;
  const quality = highBidQuality(hand, trump);
  const bidShape = getBidShape(hand, trump);
  const expectedPoints = estimateBidExpectedPoints(hand, trump, adjustedRaw, quality);
  const initialCeiling = Math.max(floor - 1, Math.min(MAX_TARGET, Math.floor(adjustedRaw)));
  const ceiling = capBidByFailureRisk(
    capAmbitiousBid(capFragileSuitBid(initialCeiling, trump, bidShape), hand, trump, quality),
    floor,
    expectedPoints,
    quality,
    personality,
    trump,
  );
  return {
    trump,
    raw: adjustedRaw,
    ceiling,
    confidence: clamp((adjustedRaw - floor + 0.7) / 6.2, 0, 1),
    expectedPoints,
    quality,
    shape: bidShape,
    points: hand.filter(isPointCard).length,
  };
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

function capFragileSuitBid(ceiling, trump, shape) {
  if (trump === "NT") {
    return ceiling;
  }
  let capped = ceiling;
  if (!shape.hasTopTrump && capped >= 17) {
    capped = 16;
  }
  if (!shape.hasTopTrump && capped >= 16) {
    capped = 15;
  }
  if (shape.trumpLength <= 3 && capped >= 17) {
    capped = 16;
  }
  if (shape.trumpLength <= 3 && capped >= 16 && !shape.hasBothTrumpAk) {
    capped = 15;
  }
  if (capped >= 16) {
    const hasSixteenCore =
      shape.hasBothTrumpAk ||
      (shape.hasTopTrump && shape.trumpLength >= 4 && (shape.hasMighty || shape.hasJoker));
    if (!hasSixteenCore) {
      capped = 15;
    }
  }
  if (capped >= 17) {
    const hasSeventeenCore =
      shape.hasBothTrumpAk ||
      (shape.hasTopTrump && shape.trumpLength >= 5 && (shape.hasMighty || shape.hasJoker));
    if (!hasSeventeenCore) {
      capped = 16;
    }
  }
  if (capped >= 18) {
    const hasHighTrumpCore =
      shape.hasBothTrumpAk ||
      (shape.hasTopTrump && shape.trumpLength >= 5 && (shape.hasMighty || shape.hasJoker));
    if (!hasHighTrumpCore) {
      capped = 17;
    }
  }
  return capped;
}

function capAmbitiousBid(ceiling, hand, trump, quality = highBidQuality(hand, trump)) {
  let capped = ceiling;
  const thresholds = {
    18: trump === "NT" ? 7.2 : 6.8,
    19: trump === "NT" ? 8.3 : 7.9,
    20: trump === "NT" ? 9.5 : 9.0,
  };
  while (capped >= 18 && quality < thresholds[capped]) {
    capped -= 1;
  }
  return capped;
}

function capBidByFailureRisk(ceiling, floor, expectedPoints, quality, personality, trump) {
  let capped = ceiling;
  while (capped >= floor) {
    const candidate = {
      trump,
      raw: expectedPoints + 1.1,
      confidence: clamp((expectedPoints - floor + 1.4) / 5.2, 0, 1),
      expectedPoints,
      quality,
    };
    const failure = evaluateBidFailureRisk(candidate, capped, personality);
    const relaxedRequirement = minimumBidSuccessChance(capped, personality) - 0.02;
    if (failure.successChance >= relaxedRequirement && failure.missBy <= 0.85) {
      break;
    }
    capped -= 1;
  }
  return Math.max(floor - 1, capped);
}

function estimateBidExpectedPoints(hand, trump, raw, quality) {
  const pointCards = hand.filter(isPointCard).length;
  const aces = hand.filter((card) => !card.joker && card.rank === 14).length;
  const kings = hand.filter((card) => !card.joker && card.rank === 13).length;
  const bidShape = getBidShape(hand, trump);
  const mighty = hand.some((card) => isMighty(card, trump)) ? 0.8 : 0;
  const joker = hand.some((card) => card.joker) ? 0.65 : 0;
  const trumpLength = trump === "NT" ? 0 : hand.filter((card) => !card.joker && card.suit === trump).length;
  const lengthBonus = trump === "NT" ? 0 : Math.max(0, trumpLength - 3) * 0.18;
  const fragility = trump !== "NT" && !bidShape.hasTopTrump ? 0.8 : 0;
  const rawAnchor = raw - 1.25;
  const conservativeShape =
    pointCards * 0.12 +
    aces * 0.12 +
    kings * 0.06 +
    mighty +
    joker +
    lengthBonus +
    Math.max(-0.5, (quality - 5.2) * 0.16);
  return clamp(rawAnchor + conservativeShape - 0.75 - fragility, 10.2, 18.5);
}

function highBidQuality(hand, trump) {
  const pointCards = hand.filter(isPointCard).length;
  const aces = hand.filter((card) => !card.joker && card.rank === 14).length;
  const mighty = hand.some((card) => isMighty(card, trump)) ? 2.1 : 0;
  const joker = hand.some((card) => card.joker) ? 1.7 : 0;
  const voids = SUITS.filter((suit) => !hand.some((card) => !card.joker && card.suit === suit)).length;

  if (trump === "NT") {
    const kings = hand.filter((card) => !card.joker && card.rank === 13).length;
    const suitCounts = SUITS.map((suit) => hand.filter((card) => !card.joker && card.suit === suit).length);
    const balanced = Math.max(...suitCounts) - Math.min(...suitCounts) <= 2 ? 0.8 : -0.6;
    return mighty + joker + aces * 0.75 + kings * 0.32 + pointCards * 0.28 + balanced;
  }

  const trumpCards = hand.filter((card) => !card.joker && card.suit === trump);
  const topTrump = trumpCards.reduce((sum, card) => {
    if (card.rank === 14) {
      return sum + 1.45;
    }
    if (card.rank === 13) {
      return sum + 0.9;
    }
    if (card.rank === 12) {
      return sum + 0.55;
    }
    if (card.rank === 11) {
      return sum + 0.35;
    }
    return sum;
  }, 0);
  const longTrump = Math.max(0, trumpCards.length - 3) * 0.55;
  return mighty + joker + topTrump + longTrump + aces * 0.45 + pointCards * 0.24 + voids * 0.28;
}

function pickFriend(friendId) {
  if (state.phase !== "friend" || state.declarerIndex !== HUMAN) {
    return;
  }
  state.friendCardId = friendId || null;
  if (friendId) {
    addLog(`프렌드는 ${formatCardById(friendId)}입니다.`);
    state.message = "버릴 카드 3장을 선택하세요. 바닥 점수는 주공 팀 점수에 포함됩니다.";
  } else {
    addLog("프렌드 없이 혼자 갑니다.");
    state.message = "독주입니다. 버릴 카드 3장을 선택하세요.";
  }
  state.phase = "discard";
  render();
}

function chooseCpuFriendAndDiscard() {
  const declarerHand = state.hands[state.declarerIndex];
  const candidates = getFriendCandidates(state.declarerIndex);
  const preferred = chooseCpuFriendCandidate(state.declarerIndex, candidates);
  state.friendCardId = preferred ? preferred.id : null;
  if (state.friendCardId) {
    addLog(`${PLAYER_NAMES[state.declarerIndex]}의 프렌드는 ${formatCardById(state.friendCardId)}입니다.`);
  } else {
    addLog(`${PLAYER_NAMES[state.declarerIndex]}이 독주를 선언했습니다.`);
  }

  const sorted = declarerHand.slice().sort((a, b) => discardValue(a) - discardValue(b));
  const discard = sorted.slice(0, 3);
  state.buried = discard;
  state.hands[state.declarerIndex] = declarerHand.filter((card) => !discard.some((item) => item.id === card.id));
  sortHand(state.declarerIndex);
  addLog(`${PLAYER_NAMES[state.declarerIndex]}이 3장을 묻었습니다.`);
}

function getFriendCandidates(declarerIndex) {
  const declarerIds = new Set(state.hands[declarerIndex].map((card) => card.id));
  const allCards = createDeck();
  return allCards
    .filter((card) => !declarerIds.has(card.id))
    .map((card) => ({
      id: card.id,
      label: formatCard(card),
      priority: friendPriority(card, declarerIndex),
    }))
    .sort((a, b) => b.priority - a.priority || a.label.localeCompare(b.label, "ko"));
}

function chooseCpuFriendCandidate(declarerIndex, candidates) {
  if (!candidates.length) {
    return null;
  }
  const bestPriority = candidates[0].priority;
  const nextPriority = candidates[1]?.priority ?? -Infinity;
  if (state.target >= 17 || bestPriority >= 128 || bestPriority - nextPriority >= 5) {
    return candidates[0];
  }

  const personality = getBidPersonality(declarerIndex);
  const window = Math.max(1, 2.5 + personality.aggression * 8 + personality.stretch * 4);
  const elite = candidates.filter((candidate) => candidate.priority >= bestPriority - window);
  if (elite.length === 1) {
    return elite[0];
  }

  const totalWeight = elite.reduce((sum, candidate) => sum + Math.max(1, candidate.priority - bestPriority + window + 1), 0);
  let roll = Math.random() * totalWeight;
  for (const candidate of elite) {
    roll -= Math.max(1, candidate.priority - bestPriority + window + 1);
    if (roll <= 0) {
      return candidate;
    }
  }
  return elite[0];
}

function friendPriority(card, declarerIndex = state.declarerIndex) {
  const hand = state.hands[declarerIndex] || [];
  const suitCounts = getSuitCounts(hand);
  const targetPressure = clamp((state.target - getOpeningBidFloor(state.trump)) / 7, 0, 1);
  const declarerHasJoker = hand.some((item) => item.joker);
  const declarerHasMighty = hand.some((item) => isMighty(item, state.trump));

  if (isMighty(card, state.trump)) {
    return 136 + (declarerHasJoker ? 2 : 8) + targetPressure * 8;
  }
  if (card.joker) {
    return 124 + (declarerHasMighty ? 9 : -5) + targetPressure * 7;
  }

  const isTrumpSuit = state.trump !== "NT" && card.suit === state.trump;
  const suitCount = suitCounts[card.suit] ?? 0;
  const ownsSuitAce = hand.some((item) => !item.joker && item.suit === card.suit && item.rank === 14);
  const ownsSuitKing = hand.some((item) => !item.joker && item.suit === card.suit && item.rank === 13);
  let score = 8;

  if (card.rank === 14) {
    score += 46;
  } else if (card.rank === 13) {
    score += 27;
  } else if (card.rank === 12) {
    score += 17;
  } else if (card.rank === 11) {
    score += 10;
  } else if (card.rank === 10) {
    score += 7;
  } else {
    score += card.rank * 0.55;
  }

  if (isTrumpSuit) {
    score += 26 + Math.max(0, card.rank - 9) * 1.5 + suitCount * 1.6;
  } else if (state.trump === "NT") {
    score += card.rank >= 13 ? 8 : 0;
  }

  if (isPointCard(card)) {
    score += 6 + targetPressure * 5;
  }
  if (suitCount === 0 && card.rank >= 13) {
    score += 14;
  } else if (suitCount === 1 && card.rank >= 13) {
    score += 8;
  } else if (suitCount >= 4 && !isTrumpSuit) {
    score -= 5;
  }
  if (!ownsSuitAce && card.rank === 14) {
    score += 9;
  }
  if (!ownsSuitKing && card.rank === 13 && suitCount <= 2) {
    score += 5;
  }
  if (card.rank <= 5 && !isTrumpSuit) {
    score -= 12;
  }
  if (isJokerCall(card)) {
    score += declarerHasJoker ? 2 : -3;
  }

  return Math.round(score * 10) / 10;
}

function discardValue(card) {
  if (card.joker) {
    return 990;
  }
  if (isMighty(card, state.trump)) {
    return 1000;
  }
  const trumpBonus = card.suit === state.trump ? 36 : 0;
  const aceBonus = card.rank === 14 ? 24 : 0;
  const kingBonus = card.rank === 13 ? 9 : 0;
  const safePointBonus = isPointCard(card) ? (card.rank <= 12 ? -13 : -5) : 0;
  return card.rank + trumpBonus + aceBonus + kingBonus + safePointBonus;
}

function handleCardClick(cardId) {
  if (state.phase === "discard" && state.declarerIndex === HUMAN) {
    const hasCard = state.hands[HUMAN].some((card) => card.id === cardId);
    if (!hasCard) {
      return false;
    }
    if (state.selectedDiscardIds.has(cardId)) {
      state.selectedDiscardIds.delete(cardId);
    } else if (state.selectedDiscardIds.size < 3) {
      state.selectedDiscardIds.add(cardId);
    }
    render();
    return true;
  }

  if (state.phase === "playing" && state.currentPlayer === HUMAN) {
    const card = state.hands[HUMAN].find((item) => item.id === cardId);
    if (!card || !isLegalPlay(HUMAN, card)) {
      state.message = getIllegalPlayMessage(HUMAN, card);
      render();
      return true;
    }
    if (state.pendingJokerLeadCardId && state.pendingJokerLeadCardId !== card.id) {
      state.pendingJokerLeadCardId = null;
    }
    if (state.pendingJokerCallCardId && state.pendingJokerCallCardId !== card.id) {
      state.pendingJokerCallCardId = null;
    }
    if (needsJokerLeadSuitChoice(card)) {
      state.pendingJokerLeadCardId = card.id;
      state.message = "조커로 리드할 문양을 선택하세요.";
      render();
      return true;
    }
    if (needsJokerCallChoice(card)) {
      state.pendingJokerCallCardId = card.id;
      state.message = "조커콜로 부를지, 일반 카드로 리드할지 선택하세요.";
      render();
      return true;
    }
    playCard(HUMAN, cardId);
    return true;
  }

  return false;
}

function needsJokerLeadSuitChoice(card) {
  return state.phase === "playing" && state.currentPlayer === HUMAN && state.trick.length === 0 && card.joker && !state.jokerLeadSuit;
}

function needsJokerCallChoice(card) {
  return state.phase === "playing" && state.currentPlayer === HUMAN && state.trick.length === 0 && isJokerCall(card);
}

function chooseHumanJokerLeadSuit(suit) {
  if (
    state.phase !== "playing" ||
    state.currentPlayer !== HUMAN ||
    !state.pendingJokerLeadCardId ||
    !SUITS.includes(suit)
  ) {
    return;
  }
  const cardId = state.pendingJokerLeadCardId;
  state.pendingJokerLeadCardId = null;
  setJokerLeadSuit(HUMAN, suit);
  playCard(HUMAN, cardId);
}

function cancelJokerLeadSuit() {
  if (state.phase !== "playing" || state.currentPlayer !== HUMAN || !state.pendingJokerLeadCardId) {
    return;
  }
  state.pendingJokerLeadCardId = null;
  state.message = "조커 문양 선택을 취소했습니다. 낼 카드를 선택하세요.";
  render();
}

function chooseHumanJokerCallMode(useCall) {
  if (
    state.phase !== "playing" ||
    state.currentPlayer !== HUMAN ||
    !state.pendingJokerCallCardId
  ) {
    return;
  }
  const cardId = state.pendingJokerCallCardId;
  const card = state.hands[HUMAN].find((item) => item.id === cardId);
  if (!card) {
    state.pendingJokerCallCardId = null;
    render();
    return;
  }
  if (useCall && !canUseJokerCallAsLead(HUMAN, card)) {
    state.message = "첫 트릭에는 일반 카드가 있으면 조커콜로 부를 수 없습니다.";
    render();
    return;
  }
  state.pendingJokerCallCardId = null;
  state.jokerCallActive = Boolean(useCall);
  playCard(HUMAN, cardId);
}

function cancelJokerCallChoice() {
  if (state.phase !== "playing" || state.currentPlayer !== HUMAN || !state.pendingJokerCallCardId) {
    return;
  }
  state.pendingJokerCallCardId = null;
  state.message = "조커콜 선택을 취소했습니다. 낼 카드를 선택하세요.";
  render();
}

function getIllegalPlayMessage(playerIndex, card) {
  if (state.trick.length === 0 && state.trickNumber === 1 && isRestrictedFirstLeadCard(card)) {
    return "첫 트릭 리드는 일반 카드가 있으면 기루, 마이티, 조커, 조커콜을 낼 수 없습니다.";
  }
  if (isJokerCallLead() && playerHasJoker(playerIndex)) {
    return "조커콜이 나왔습니다. 조커를 내야 하며, 마이티로 대신 받을 수 있습니다.";
  }
  return "리드 문양을 따라야 합니다. 마이티는 언제든 낼 수 있습니다.";
}

function confirmDiscard() {
  if (state.phase !== "discard" || state.declarerIndex !== HUMAN) {
    return;
  }
  if (state.selectedDiscardIds.size !== 3) {
    state.message = "정확히 3장을 선택해야 합니다.";
    render();
    return;
  }
  const discardIds = state.selectedDiscardIds;
  state.buried = state.hands[HUMAN].filter((card) => discardIds.has(card.id));
  state.hands[HUMAN] = state.hands[HUMAN].filter((card) => !discardIds.has(card.id));
  state.selectedDiscardIds.clear();
  sortHand(HUMAN);
  addLog(`내가 ${state.buried.map(formatCard).join(", ")}을 묻었습니다.`);
  startPlaying();
}

function startPlaying() {
  state.phase = "playing";
  state.leaderIndex = state.declarerIndex;
  state.currentPlayer = state.leaderIndex;
  state.trick = [];
  state.jokerLeadSuit = null;
  state.pendingJokerLeadCardId = null;
  state.jokerCallActive = false;
  state.pendingJokerCallCardId = null;
  state.trickNumber = 1;
  state.message = `${PLAYER_NAMES[state.leaderIndex]}이 첫 트릭을 시작합니다.`;
  render();
  if (state.currentPlayer !== HUMAN) {
    scheduleCpuPlay();
  }
}

function scheduleCpuPlay() {
  clearTimeout(cpuTimer);
  state.busy = true;
  render();
  cpuTimer = setTimeout(() => {
    state.busy = false;
    if (state.phase === "playing" && state.currentPlayer !== HUMAN) {
      playCpuCard(state.currentPlayer);
    }
  }, CPU_DELAY);
}

function playCpuCard(playerIndex) {
  const card = chooseCpuCard(playerIndex);
  if (!card) {
    state.message = `${PLAYER_NAMES[playerIndex]}이 낼 수 있는 카드가 없습니다.`;
    addLog(state.message);
    render();
    return;
  }
  playCard(playerIndex, card.id);
}

function chooseCpuCard(playerIndex) {
  const legalCards = state.hands[playerIndex].filter((card) => isLegalPlay(playerIndex, card));
  if (!legalCards.length) {
    return null;
  }

  const candidates = legalCards
    .map((card) => ({
      card,
      score: evaluateCpuCardChoice(playerIndex, card, legalCards),
    }))
    .sort((a, b) => b.score - a.score || defensiveDiscardCost(a.card) - defensiveDiscardCost(b.card));

  return candidates[0].card;
}

function evaluateCpuCardChoice(playerIndex, card, legalCards) {
  if (state.trick.length === 0 && isJokerPowerless() && card.joker && legalCards.some((item) => !item.joker)) {
    return -999;
  }

  const outcome = simulateTrickAfterPlay(playerIndex, card);
  const playerSide = getSideForAi(playerIndex);
  const winnerSide = getSideForAi(outcome.winner);
  const playerSideWins = playerSide === winnerSide;
  const declarerSideWins = winnerSide === "declarer";
  const existingPointCardsInTrick = state.trick.filter((entry) => isPointCard(entry.card)).length;
  const pointCardsInTrick = state.trick.filter((entry) => isPointCard(entry.card)).length + (isPointCard(card) ? 1 : 0);
  const declarerPoints = getDeclarerTeamPointsForAi(playerIndex);
  const declarerNeed = Math.max(0, state.target - declarerPoints);
  const late = state.trickNumber >= 8;
  const finalSeat = state.trick.length === 4;
  const spent = aiCardSpendCost(card);
  const treeScore = evaluateCurrentTrickTree(playerIndex, card, playerSide);
  let score = 0;

  if (playerSide === "declarer") {
    score += declarerSideWins ? 18 + outcome.points * 7 : -10 - outcome.points * 6;
    if (declarerNeed > 0) {
      score += declarerSideWins ? Math.min(outcome.points, declarerNeed) * 4 : -Math.min(outcome.points, declarerNeed) * 3;
    }
  } else {
    score += declarerSideWins ? -18 - outcome.points * 8 : 16 + outcome.points * 6;
    if (declarerNeed <= 5) {
      score += declarerSideWins ? -10 : 6;
    }
  }

  if (state.trick.length > 0) {
    const currentWinner = getTrickWinner([...state.trick]);
    const currentWinnerSide = getSideForAi(currentWinner);
    if (currentWinnerSide === playerSide && !playerSideWins) {
      score -= 18;
    }
    if (currentWinnerSide !== playerSide && playerSideWins) {
      score += pointCardsInTrick > 0 || finalSeat ? 14 : 5;
    }
    if (isPointCard(card)) {
      score += playerSideWins ? 10 : -12;
      if (currentWinnerSide === playerSide) {
        score += 6;
      }
    }
    score += evaluateTrickResponseDiscipline(playerIndex, card, legalCards, currentWinner, currentWinnerSide);
  }

  if (state.trick.length === 0) {
    score += evaluateLeadPlan(playerIndex, card, outcome, legalCards);
  }

  score += treeScore * TRICK_TREE_WEIGHT;

  if (card.joker && !isJokerEffective()) {
    score -= legalCards.some((item) => !item.joker) ? 80 : 0;
  }
  if (card.joker && isJokerEffective() && outcome.points === 0 && !late) {
    score -= 22;
  }
  if (isMighty(card, state.trump) && existingPointCardsInTrick === 0 && !late) {
    score -= 36;
  }
  if (card.suit === state.trump && state.trump !== "NT" && card.rank >= 12 && outcome.points === 0 && !late) {
    score -= 8;
  }
  score += evaluateMightyConservation(playerIndex, card, legalCards, outcome);

  score -= spent * (playerSideWins ? 0.08 : 0.18);
  score += Math.random() * 0.08;
  return score;
}

function evaluateLeadPlan(playerIndex, card, outcome, legalCards) {
  const playerSide = getSideForAi(playerIndex);
  const winnerSide = getSideForAi(outcome.winner);
  const hand = state.hands[playerIndex] || [];
  const suitCounts = getSuitCounts(hand);
  const handPoints = hand.filter(isPointCard).length;
  let score = 0;

  if (winnerSide === playerSide) {
    score += 8 + outcome.points * 4;
  } else {
    score -= 6 + outcome.points * 5;
  }

  if (isControlCard(card) && shouldLeadControlCard(card, playerIndex)) {
    score += handPoints >= 2 || playerSide === "declarer" ? 12 : 3;
  }
  if (!isSpecial(card) && card.rank === 14 && card.suit !== state.trump) {
    score += 9;
  }
  if (!isSpecial(card) && !isPointCard(card)) {
    score += Math.max(0, 4 - (suitCounts[card.suit] || 0)) * 1.8;
    score += Math.max(0, 10 - card.rank) * (card.suit === state.trump ? 0.45 : 0.9);
  }
  if (isPointCard(card) && winnerSide !== playerSide) {
    score -= 14;
  }
  if (card.suit === state.trump && state.trump !== "NT" && playerSide !== "declarer" && !isControlCard(card)) {
    score -= 9;
  }
  if (card.joker && legalCards.some((item) => item !== card && !item.joker && !isPointCard(item))) {
    score -= state.trickNumber <= 5 ? 12 : 4;
  }
  score += evaluateDeclarerLeadPlan(playerIndex, card, legalCards);
  score += evaluateDefenseLeadPlan(playerIndex, card, legalCards);
  score += evaluateJokerCallLeadPlan(playerIndex, card);
  score += evaluateFriendLeadDiscipline(playerIndex, card, legalCards);
  score += evaluateCardCountingLeadPlan(playerIndex, card);
  return score;
}

function evaluateTrickResponseDiscipline(playerIndex, card, legalCards, currentWinner, currentWinnerSide) {
  const playerSide = getSideForAi(playerIndex);
  const preview = [...state.trick, { playerIndex, card }];
  const winner = getTrickWinner(preview);
  const winsWithCard = winner === playerIndex;
  const existingTrickPoints = state.trick.filter((entry) => isPointCard(entry.card)).length;
  const trickPoints = existingTrickPoints + (isPointCard(card) ? 1 : 0);
  let score = 0;

  if (currentWinnerSide === playerSide && winsWithCard && currentWinner !== playerIndex) {
    const currentWinnerCard = state.trick.find((entry) => entry.playerIndex === currentWinner)?.card;
    const secureAllyTrick = state.trick.length === 4 || (currentWinnerCard && cardPower(currentWinnerCard, getLeadSuit()) >= 900);
    score -= 56 + aiCardSpendCost(card) * (trickPoints > 0 ? 0.22 : 0.34);
    if (isControlCard(card)) {
      score -= secureAllyTrick ? 84 : 52;
    }
    if ((card.joker || isMighty(card, state.trump)) && existingTrickPoints === 0) {
      score -= 65;
    }
  }

  if (currentWinnerSide === playerSide && !winsWithCard) {
    if (isPointCard(card)) {
      score += 18;
    } else if (!isSpecial(card)) {
      score += Math.max(0, 9 - card.rank) * 0.9;
    }
  }

  if (!winsWithCard) {
    return score;
  }

  const cheapestWinner = legalCards
    .filter((candidate) => getTrickWinner([...state.trick, { playerIndex, card: candidate }]) === playerIndex)
    .sort((a, b) => aiCardSpendCost(a) - aiCardSpendCost(b))[0];
  if (!cheapestWinner || cheapestWinner.id === card.id) {
    return score;
  }

  const overpay = Math.max(0, aiCardSpendCost(card) - aiCardSpendCost(cheapestWinner));
  const finalSeat = state.trick.length === 4;
  const rate = trickPoints > 0 ? 0.07 : 0.18;
  score -= overpay * (finalSeat ? rate * 0.65 : rate);
  return score;
}

function evaluateMightyConservation(playerIndex, card, legalCards, outcome) {
  if (!isMighty(card, state.trump)) {
    return 0;
  }

  const playerSide = getSideForAi(playerIndex);
  const late = state.trickNumber >= 8;
  const ordinaryAlternative = legalCards.some((candidate) => candidate.id !== card.id && !candidate.joker && !isMighty(candidate, state.trump));
  const anyAlternative = legalCards.some((candidate) => candidate.id !== card.id);
  let score = 0;

  if (state.trick.length === 0) {
    if (anyAlternative && !late) {
      score -= ordinaryAlternative ? 88 : 54;
    } else if (anyAlternative && state.trickNumber < 10) {
      score -= ordinaryAlternative ? 38 : 22;
    }
    return score;
  }

  const currentWinner = getTrickWinner([...state.trick]);
  const currentWinnerSide = getSideForAi(currentWinner);
  const currentWinnerIsAlly = currentWinnerSide === playerSide;
  const existingPoints = state.trick.filter((entry) => isPointCard(entry.card)).length;
  const finalSeat = state.trick.length === 4;
  const declarerNeed = Math.max(0, state.target - getDeclarerTeamPointsForAi(playerIndex));
  const pointUrgency = getMightyPointUrgency(playerIndex, playerSide, currentWinnerSide, existingPoints);
  const leadSuit = getLeadSuit();
  const hasOrdinaryTrumpAlternative =
    state.trump !== "NT" &&
    leadSuit === state.trump &&
    legalCards.some((candidate) => candidate.id !== card.id && isOrdinaryTrump(candidate));

  if (currentWinnerIsAlly) {
    score -= ordinaryAlternative ? 105 : 70;
  }
  if (hasOrdinaryTrumpAlternative) {
    score -= Math.max(0, (currentWinnerIsAlly ? 180 : 120) - pointUrgency);
  }
  if (existingPoints === 0 && !late) {
    score -= ordinaryAlternative ? 95 : 54;
  } else if (existingPoints <= 1 && !late) {
    score -= Math.max(0, (ordinaryAlternative ? 112 : 54) - pointUrgency);
  }
  if (!finalSeat && existingPoints <= 1 && !late) {
    score -= Math.max(0, 42 - pointUrgency * 0.5);
  }
  if (playerSide === "defense" && currentWinnerSide === "declarer" && existingPoints >= Math.max(2, declarerNeed)) {
    score += 35;
  }
  if (playerSide === "declarer" && currentWinnerSide === "defense" && existingPoints >= Math.max(2, declarerNeed)) {
    score += 28;
  }
  score += pointUrgency * 0.35;
  if (outcome.winner !== playerIndex && anyAlternative) {
    score -= 40;
  }
  return score;
}

function getMightyPointUrgency(playerIndex, playerSide, currentWinnerSide, existingPoints) {
  if (existingPoints <= 0 || currentWinnerSide === playerSide) {
    return 0;
  }
  const declarerPoints = getDeclarerTeamPointsForAi(playerIndex);
  const defensePoints = getDefenseTeamPointsForAi();
  const declarerLossAllowance = Math.max(0, TOTAL_POINT_CARDS - state.target);
  const remainingSafeLosses = Math.max(0, declarerLossAllowance - defensePoints);
  const contractPressure = clamp((state.target - 15) / 5, 0, 1);
  const allowancePressure = clamp((5 - remainingSafeLosses) / 5, 0, 1);
  const declarerNeed = Math.max(0, state.target - declarerPoints);
  const remainingTricks = Math.max(1, 11 - state.trickNumber);
  const remainingPointPressure = clamp((declarerNeed - remainingTricks * 1.8) / 8, 0, 1);
  const latePressure = state.trickNumber >= 7 ? 0.2 : 0;
  const pointPressure = clamp(existingPoints / 2, 0.75, 1);
  const urgency = (allowancePressure * 52 + contractPressure * 22 + remainingPointPressure * 18 + latePressure * 18) * pointPressure;

  if (playerSide === "defense" && currentWinnerSide === "declarer") {
    return urgency;
  }
  if (playerSide === "declarer" && currentWinnerSide === "defense") {
    return urgency * 0.86;
  }
  return 0;
}

function evaluateDeclarerLeadPlan(playerIndex, card, legalCards) {
  if (playerIndex !== state.declarerIndex || state.trump === "NT" || state.trickNumber === 1) {
    return 0;
  }
  const ordinaryTrumps = legalCards.filter(isOrdinaryTrump);
  if (!ordinaryTrumps.length || !shouldDeclarerDrawTrump(playerIndex, ordinaryTrumps)) {
    return 0;
  }
  if (isOrdinaryTrump(card)) {
    return 24 + Math.max(0, 14 - card.rank) * 1.4 - (isPointCard(card) ? 8 : 0);
  }
  if (card.joker || isMighty(card, state.trump)) {
    return -8;
  }
  return -7;
}

function shouldDeclarerDrawTrump(playerIndex, ordinaryTrumps) {
  const hand = state.hands[playerIndex] || [];
  const shape = getBidShape(hand, state.trump);
  const declarerPoints = getDeclarerTeamPointsForAi(playerIndex);
  if (declarerPoints >= state.target || state.trickNumber >= 8) {
    return false;
  }
  if (ordinaryTrumps.length >= 3 && (shape.hasMighty || shape.hasJoker || shape.hasTopTrump)) {
    return true;
  }
  return ordinaryTrumps.length >= 2 && shape.hasBothTrumpAk;
}

function evaluateDefenseLeadPlan(playerIndex, card, legalCards) {
  if (getSideForAi(playerIndex) !== "defense") {
    return 0;
  }
  let score = 0;
  const declarerNeed = Math.max(0, state.target - getDeclarerTeamPointsForAi(playerIndex));
  if (isOrdinaryTrump(card)) {
    score -= state.trickNumber <= 7 && declarerNeed > 3 ? 18 : 7;
  }
  if (!isSpecial(card) && card.suit !== state.trump && card.rank === 14) {
    score += isPlayerKnownVoidInSuit(state.declarerIndex, card.suit) ? -22 : 6;
  }
  if (!isSpecial(card) && !isPointCard(card) && card.suit !== state.trump) {
    const suitCount = (getSuitCounts(state.hands[playerIndex] || [])[card.suit] || 0);
    score += Math.max(0, 4 - suitCount) * 1.2;
  }
  if (legalCards.some((candidate) => isJokerCall(candidate)) && card.joker) {
    score -= 12;
  }
  return score;
}

function evaluateCardCountingLeadPlan(playerIndex, card) {
  if (isSpecial(card)) {
    return 0;
  }

  const playerSide = getSideForAi(playerIndex);
  const unseenBySuit = countPublicUnseenCardsBySuit(playerIndex);
  const voids = getKnownVoidSuitsByPlayer();
  const opponentsVoid = [];
  const alliesVoid = [];
  for (let index = 0; index < PLAYER_NAMES.length; index += 1) {
    if (index === playerIndex || !voids[index]?.has(card.suit)) {
      continue;
    }
    if (getSideForAi(index) === playerSide) {
      alliesVoid.push(index);
    } else {
      opponentsVoid.push(index);
    }
  }

  let score = 0;
  if (opponentsVoid.length) {
    score -= isPointCard(card) ? opponentsVoid.length * 14 : opponentsVoid.length * 5;
  }
  if (alliesVoid.length && !isPointCard(card)) {
    score += alliesVoid.length * 2.5;
  }
  if (card.rank === 14 && unseenBySuit[card.suit] <= 1 && !opponentsVoid.length) {
    score += 6;
  }
  if (card.suit === state.trump && opponentsVoid.length) {
    score -= opponentsVoid.length * 8;
  }
  return score;
}

function evaluateJokerCallLeadPlan(playerIndex, card) {
  if (!isJokerCall(card) || !canUseJokerCallAsLead(playerIndex, card) || !isJokerEffective()) {
    return 0;
  }
  const jokerOwner = getCardOwnerIndex("JOKER");
  if (jokerOwner === null || jokerOwner === playerIndex) {
    return 0;
  }
  const playerSide = getSideForAi(playerIndex);
  const jokerOwnerSide = getSideForAi(jokerOwner);
  if (playerSide === jokerOwnerSide) {
    return -38;
  }
  if (shouldUseJokerCall(playerIndex, card)) {
    return state.trickNumber <= 8 ? 34 : 18;
  }
  return 10;
}

function evaluateFriendLeadDiscipline(playerIndex, card, legalCards) {
  if (!isFriendPlayerForAi(playerIndex)) {
    return 0;
  }

  let score = 0;
  if (shouldReturnTrumpToDeclarer(playerIndex, legalCards)) {
    if (isOrdinaryTrump(card)) {
      score += 40 + Math.max(0, 14 - card.rank) * 1.8 - (isPointCard(card) ? 11 : 0);
    } else if (card.joker || isMighty(card, state.trump)) {
      score -= 72;
    } else if (isControlCard(card)) {
      score -= 30;
    } else {
      score -= 10;
    }
  }

  if (isMighty(card, state.trump) && !shouldLeadMightyAsFriend(playerIndex, legalCards)) {
    score -= 68;
  }
  if (card.joker && !shouldLeadJokerAsFriend(playerIndex, legalCards)) {
    score -= 52;
  }
  if (!isSpecial(card) && card.rank === 14 && card.suit !== state.trump && state.trickNumber <= 6) {
    score -= 12;
  }
  return score;
}

function simulateTrickAfterPlay(playerIndex, card) {
  const jokerLeadSuit = state.trick.length === 0 && card.joker
    ? chooseJokerLeadSuitForSim(playerIndex)
    : state.jokerLeadSuit;
  const jokerCallActive = state.trick.length === 0 && isJokerCall(card)
    ? shouldUseJokerCall(playerIndex, card)
    : state.jokerCallActive;
  const trick = [...state.trick, { playerIndex, card }];
  const usedIds = new Set(trick.map((entry) => entry.card.id));
  let next = nextPlayer(playerIndex);
  let guard = 0;

  while (trick.length < 5 && guard < 5) {
    const hand = state.hands[next].filter((item) => !usedIds.has(item.id));
    const legalCards = getLegalCardsForSim(next, hand, trick, jokerLeadSuit, jokerCallActive);
    const response = chooseSimulatedResponse(next, legalCards, trick, jokerLeadSuit);
    if (!response) {
      break;
    }
    trick.push({ playerIndex: next, card: response });
    usedIds.add(response.id);
    next = nextPlayer(next);
    guard += 1;
  }

  const winner = getTrickWinnerForContext(trick, jokerLeadSuit, state.trickNumber);
  const points = trick.filter((entry) => isPointCard(entry.card)).length;
  return { winner, points, trick };
}

function evaluateCurrentTrickTree(playerIndex, card, perspectiveSide) {
  const jokerLeadSuit = state.trick.length === 0 && card.joker
    ? chooseJokerLeadSuitForSim(playerIndex)
    : state.jokerLeadSuit;
  const jokerCallActive = state.trick.length === 0 && isJokerCall(card)
    ? shouldUseJokerCall(playerIndex, card)
    : state.jokerCallActive;
  const trick = [...state.trick, { playerIndex, card }];
  if (trick.length === 5) {
    return scoreTrickTreeTerminal(trick, jokerLeadSuit, perspectiveSide, playerIndex);
  }

  const usedIds = new Set(trick.map((entry) => entry.card.id));
  return minimaxTrickNode(
    nextPlayer(playerIndex),
    trick,
    usedIds,
    jokerLeadSuit,
    jokerCallActive,
    perspectiveSide,
    playerIndex,
    -Infinity,
    Infinity,
  );
}

function minimaxTrickNode(
  playerIndex,
  trick,
  usedIds,
  jokerLeadSuit,
  jokerCallActive,
  perspectiveSide,
  observerIndex,
  alpha,
  beta,
) {
  if (trick.length === 5) {
    return scoreTrickTreeTerminal(trick, jokerLeadSuit, perspectiveSide, observerIndex);
  }

  const hand = (state.hands[playerIndex] || []).filter((card) => !usedIds.has(card.id));
  const legalCards = getLegalCardsForSim(playerIndex, hand, trick, jokerLeadSuit, jokerCallActive);
  if (!legalCards.length) {
    return scoreTrickTreeTerminal(trick, jokerLeadSuit, perspectiveSide, observerIndex);
  }

  const maximizing = getSideForAi(playerIndex) === perspectiveSide;
  const orderedCards = orderTrickTreeCards(playerIndex, legalCards, trick, jokerLeadSuit);
  let best = maximizing ? -Infinity : Infinity;

  for (const nextCard of orderedCards) {
    trick.push({ playerIndex, card: nextCard });
    usedIds.add(nextCard.id);
    const childScore =
      minimaxTrickNode(
        nextPlayer(playerIndex),
        trick,
        usedIds,
        jokerLeadSuit,
        jokerCallActive,
        perspectiveSide,
        observerIndex,
        alpha,
        beta,
      ) + trickTreeSpendAdjustment(playerIndex, nextCard, perspectiveSide, trick);
    usedIds.delete(nextCard.id);
    trick.pop();

    if (maximizing) {
      best = Math.max(best, childScore);
      alpha = Math.max(alpha, best);
      if (beta <= alpha) {
        break;
      }
    } else {
      best = Math.min(best, childScore);
      beta = Math.min(beta, best);
      if (beta <= alpha) {
        break;
      }
    }
  }

  return best;
}

function orderTrickTreeCards(playerIndex, legalCards, trick, jokerLeadSuit) {
  const currentWinner = getTrickWinnerForContext(trick, jokerLeadSuit, state.trickNumber);
  const currentWinnerSide = getSideForAi(currentWinner);
  const playerSide = getSideForAi(playerIndex);
  const trickPoints = trick.filter((entry) => isPointCard(entry.card)).length;
  const remainingAfter = 4 - trick.length;
  return legalCards
    .slice()
    .sort((a, b) => {
      const scoreA = evaluateSimulatedResponse(playerIndex, a, trick, jokerLeadSuit, currentWinnerSide, playerSide, trickPoints, remainingAfter);
      const scoreB = evaluateSimulatedResponse(playerIndex, b, trick, jokerLeadSuit, currentWinnerSide, playerSide, trickPoints, remainingAfter);
      return scoreB - scoreA || aiCardSpendCost(a) - aiCardSpendCost(b);
    });
}

function trickTreeSpendAdjustment(playerIndex, card, perspectiveSide, trick) {
  const sameSide = getSideForAi(playerIndex) === perspectiveSide;
  const otherPoints = trick.filter((entry) => entry.card.id !== card.id && isPointCard(entry.card)).length;
  let factor = otherPoints > 0 ? 0.025 : 0.075;
  if (isMighty(card, state.trump) && otherPoints === 0 && state.trickNumber <= 7) {
    factor = 0.17;
  }
  return (sameSide ? -1 : 1) * aiCardSpendCost(card) * factor;
}

function scoreTrickTreeTerminal(trick, jokerLeadSuit, perspectiveSide, observerIndex) {
  const winner = getTrickWinnerForContext(trick, jokerLeadSuit, state.trickNumber);
  const winnerSide = getSideForAi(winner);
  const points = trick.filter((entry) => isPointCard(entry.card)).length;
  const declarerPoints = getDeclarerTeamPointsForAi(observerIndex);
  const declarerNeed = Math.max(0, state.target - declarerPoints);
  const perspectiveWins = winnerSide === perspectiveSide;
  const effectivePoints = Math.min(points, Math.max(1, declarerNeed));
  let score = perspectiveWins ? 16 : -16;

  if (perspectiveSide === "declarer") {
    score += winnerSide === "declarer" ? effectivePoints * 7.5 : -effectivePoints * 7.5;
    if (declarerNeed <= points && winnerSide === "declarer") {
      score += 9;
    }
  } else {
    score += winnerSide === "declarer" ? -effectivePoints * 7.8 : effectivePoints * 7.2;
    if (declarerNeed <= points && winnerSide !== "declarer") {
      score += 8;
    }
  }

  if (points === 0) {
    score += perspectiveWins ? 1.5 : -1.5;
  }
  return score;
}

function getLegalCardsForSim(playerIndex, hand, trick, jokerLeadSuit, jokerCallActive = state.jokerCallActive) {
  if (!trick.length) {
    return hand.filter((card) => isLegalLead(playerIndex, card));
  }
  return hand.filter((card) => isLegalFollowForSim(playerIndex, card, hand, trick, jokerLeadSuit, jokerCallActive));
}

function isLegalFollowForSim(playerIndex, card, hand, trick, jokerLeadSuit, jokerCallActive = state.jokerCallActive) {
  const leadSuit = getLeadSuitForContext(trick, jokerLeadSuit);
  if (!leadSuit) {
    return true;
  }
  if (isMightyLeadForTrick(trick) && handHasFollowSuit(hand, leadSuit)) {
    return !isSpecial(card) && card.suit === leadSuit;
  }
  if (isSpecial(card)) {
    return true;
  }
  if (isJokerCallLeadForTrick(trick, jokerCallActive) && hand.some((item) => item.joker)) {
    return card.joker || isMighty(card, state.trump);
  }
  const hasLeadSuit = handHasFollowSuit(hand, leadSuit);
  return !hasLeadSuit || (!isSpecial(card) && card.suit === leadSuit);
}

function chooseSimulatedResponse(playerIndex, legalCards, trick, jokerLeadSuit) {
  if (!legalCards.length) {
    return null;
  }
  const currentWinner = getTrickWinnerForContext(trick, jokerLeadSuit, state.trickNumber);
  const currentWinnerSide = getSideForAi(currentWinner);
  const playerSide = getSideForAi(playerIndex);
  const trickPoints = trick.filter((entry) => isPointCard(entry.card)).length;
  const remainingAfter = 4 - trick.length;

  return legalCards
    .slice()
    .sort((a, b) => {
      const scoreA = evaluateSimulatedResponse(playerIndex, a, trick, jokerLeadSuit, currentWinnerSide, playerSide, trickPoints, remainingAfter);
      const scoreB = evaluateSimulatedResponse(playerIndex, b, trick, jokerLeadSuit, currentWinnerSide, playerSide, trickPoints, remainingAfter);
      return scoreB - scoreA || aiCardSpendCost(a) - aiCardSpendCost(b);
    })[0];
}

function evaluateSimulatedResponse(playerIndex, card, trick, jokerLeadSuit, currentWinnerSide, playerSide, trickPoints, remainingAfter) {
  const preview = [...trick, { playerIndex, card }];
  const winner = getTrickWinnerForContext(preview, jokerLeadSuit, state.trickNumber);
  const winnerSide = getSideForAi(winner);
  const winsNow = winner === playerIndex;
  const pointsWithCard = trickPoints + (isPointCard(card) ? 1 : 0);
  let score = 0;

  if (currentWinnerSide === playerSide) {
    if (isPointCard(card)) {
      score += 15;
    }
    score += winnerSide === playerSide ? 8 : -16;
    score -= aiCardSpendCost(card) * 0.2;
    if (winsNow) {
      score -= 48 + aiCardSpendCost(card) * 0.2;
      if (isControlCard(card)) {
        score -= 46;
      }
    }
  } else if (winsNow) {
    score += pointsWithCard > 0 || remainingAfter === 0 ? 18 + pointsWithCard * 6 : 5;
    score -= aiCardSpendCost(card) * (pointsWithCard > 0 ? 0.08 : 0.22);
  } else {
    score += isPointCard(card) ? -12 : 7;
    score -= aiCardSpendCost(card) * 0.05;
  }

  if (card.joker && !isJokerEffective()) {
    score -= 80;
  }
  if (card.joker && pointsWithCard === 0 && state.trickNumber <= 7) {
    score -= 16;
  }
  if (isMighty(card, state.trump)) {
    const pointUrgency = getMightyPointUrgency(playerIndex, playerSide, currentWinnerSide, trickPoints);
    if (currentWinnerSide === playerSide) {
      score -= 55;
    }
    if (trickPoints === 0 && state.trickNumber <= 7) {
      score -= 52;
    } else if (trickPoints <= 1 && state.trickNumber <= 6) {
      score -= Math.max(0, 24 - pointUrgency * 0.6);
    }
    score += pointUrgency * 0.25;
  }
  return score;
}

function getSideForAi(playerIndex) {
  return isDeclarerSideForAi(playerIndex) ? "declarer" : "defense";
}

function isFriendPlayerForAi(playerIndex) {
  return playerIndex !== state.declarerIndex && getFriendOwnerIndex() === playerIndex;
}

function aiCardSpendCost(card) {
  if (card.joker) {
    return isJokerEffective() ? 92 : 8;
  }
  if (isMighty(card, state.trump)) {
    return 98;
  }
  if (state.trump !== "NT" && card.suit === state.trump) {
    return 34 + card.rank * 1.7 + (isPointCard(card) ? 10 : 0);
  }
  if (card.rank === 14) {
    return 34;
  }
  return card.rank + (isPointCard(card) ? 24 : 0);
}

function chooseLeadCard(playerIndex, legalCards) {
  if (isJokerPowerless() && legalCards.length > 1 && legalCards.some((card) => !card.joker)) {
    legalCards = legalCards.filter((card) => !card.joker);
  }
  if (shouldReturnTrumpToDeclarer(playerIndex, legalCards)) {
    return legalCards
      .filter(isOrdinaryTrump)
      .sort((a, b) => a.rank - b.rank || defensiveDiscardCost(a) - defensiveDiscardCost(b))[0];
  }
  const handPoints = state.hands[playerIndex].filter(isPointCard).length;
  const declarerPoints = getDeclarerTeamPointsForAi(playerIndex);
  const needsTempo = isDeclarerSideForAi(playerIndex) && declarerPoints < state.target;
  const controls = legalCards
    .filter((card) => isControlCard(card) && shouldLeadControlCard(card, playerIndex))
    .sort((a, b) => controlValue(b) - controlValue(a));

  if ((needsTempo || handPoints >= 3) && controls.length) {
    return controls[0];
  }

  const suitCounts = getSuitCounts(state.hands[playerIndex]);
  const sideAces = legalCards
    .filter((card) => !isSpecial(card) && card.rank === 14 && card.suit !== state.trump)
    .sort((a, b) => suitCounts[a.suit] - suitCounts[b.suit]);
  if (handPoints >= 2 && sideAces.length) {
    return sideAces[0];
  }

  const nonPoint = legalCards.filter((card) => !isPointCard(card) && !isSpecial(card));
  const leadPool = nonPoint.length ? nonPoint : legalCards.filter((card) => !isSpecial(card));
  const fallbackPool = leadPool.length ? leadPool : legalCards;
  return fallbackPool
    .slice()
    .sort((a, b) => (suitCounts[a.suit] ?? 99) - (suitCounts[b.suit] ?? 99) || leadValue(a) - leadValue(b))[0];
}

function chooseSupportCard(playerIndex, legalCards, remainingAfterMe) {
  const currentWinner = getTrickWinner([...state.trick]);
  const leadSuit = getLeadSuit();
  const winnerPower = cardPower(state.trick.find((entry) => entry.playerIndex === currentWinner).card, leadSuit);
  const secureTrick = remainingAfterMe === 0 || winnerPower >= 900;
  const pointCards = legalCards
    .filter((card) => isPointCard(card) && !isSpecial(card))
    .sort((a, b) => pointDumpValue(b) - pointDumpValue(a));

  if (pointCards.length && (secureTrick || isDeclarerSideForAi(playerIndex))) {
    return pointCards[0];
  }

  if (pointCards.length && state.trick.some((entry) => isPointCard(entry.card))) {
    return pointCards[pointCards.length - 1];
  }

  return lowestSacrifice(legalCards);
}

function shouldSpendSpecialWinner(card, playerIndex, trickPoints, remainingAfterMe) {
  if (card.joker) {
    return shouldSpendJokerToWin(playerIndex, trickPoints, remainingAfterMe);
  }
  return isMighty(card, state.trump) && (trickPoints > 0 || remainingAfterMe === 0);
}

function shouldSpendJokerToWin(playerIndex, trickPoints, remainingAfterMe) {
  if (!isJokerEffective()) {
    return false;
  }
  if (trickPoints > 0) {
    return true;
  }
  if (remainingAfterMe === 0 && state.trickNumber >= 8) {
    return true;
  }
  return isDeclarerSideForAi(playerIndex) && getDeclarerTeamPointsForAi(playerIndex) < state.target && state.trickNumber <= 7;
}

function shouldLeadControlCard(card, playerIndex) {
  if (isFriendPlayerForAi(playerIndex)) {
    if (isMighty(card, state.trump)) {
      return shouldLeadMightyAsFriend(playerIndex);
    }
    if (card.joker) {
      return shouldLeadJokerAsFriend(playerIndex);
    }
  }
  if (!card.joker) {
    return true;
  }
  if (!isJokerEffective()) {
    return false;
  }
  const hand = state.hands[playerIndex] || [];
  const pointCards = hand.filter(isPointCard).length;
  if (state.trickNumber >= 9 && pointCards === 0) {
    return false;
  }
  return isDeclarerSideForAi(playerIndex) || pointCards >= 2 || state.trickNumber <= 6;
}

function shouldReturnTrumpToDeclarer(playerIndex, legalCards = []) {
  if (!isFriendPlayerForAi(playerIndex) || state.trump === "NT" || state.trick.length > 0 || state.trickNumber >= 9) {
    return false;
  }
  return legalCards.some((card) => isOrdinaryTrump(card));
}

function shouldLeadMightyAsFriend(playerIndex, legalCards = []) {
  if (!isFriendPlayerForAi(playerIndex)) {
    return true;
  }
  if (shouldReturnTrumpToDeclarer(playerIndex, legalCards)) {
    return false;
  }
  const hand = state.hands[playerIndex] || [];
  const handPoints = hand.filter(isPointCard).length;
  const hasEffectiveJoker = isJokerEffective() && hand.some((card) => card.joker);
  if (state.trickNumber >= 9) {
    return true;
  }
  if (state.trickNumber >= 8 && handPoints >= 2) {
    return true;
  }
  return state.trickNumber >= 7 && handPoints >= 3 && hasEffectiveJoker;
}

function shouldLeadJokerAsFriend(playerIndex, legalCards = []) {
  if (!isFriendPlayerForAi(playerIndex)) {
    return true;
  }
  if (!isJokerEffective() || shouldReturnTrumpToDeclarer(playerIndex, legalCards)) {
    return false;
  }
  const handPoints = (state.hands[playerIndex] || []).filter(isPointCard).length;
  return state.trickNumber >= 8 || handPoints >= 3;
}

function lowestSacrifice(cards) {
  const nonPoint = cards.filter((card) => !isPointCard(card) && !isSpecial(card));
  const pool = nonPoint.length ? nonPoint : cards;
  return pool.slice().sort((a, b) => defensiveDiscardCost(a) - defensiveDiscardCost(b))[0];
}

function getSuitCounts(hand) {
  return SUITS.reduce((counts, suit) => {
    counts[suit] = hand.filter((card) => !card.joker && card.suit === suit).length;
    return counts;
  }, {});
}

function isControlCard(card) {
  if (card.joker) {
    return isJokerEffective();
  }
  if (isMighty(card, state.trump)) {
    return true;
  }
  if (card.suit === state.trump && card.rank >= 12) {
    return true;
  }
  return card.rank === 14;
}

function controlValue(card) {
  if (isMighty(card, state.trump)) {
    return 100;
  }
  if (card.joker) {
    return isJokerEffective() ? 94 : -20;
  }
  if (card.suit === state.trump) {
    return 72 + card.rank;
  }
  if (card.rank === 14) {
    return 50;
  }
  return card.rank;
}

function pointDumpValue(card) {
  return card.rank + (card.suit === state.trump ? -5 : 0);
}

function leadValue(card) {
  if (card.joker) {
    return isJokerEffective() ? 80 : 160;
  }
  if (isMighty(card, state.trump)) {
    return 90;
  }
  const pointPenalty = isPointCard(card) ? 22 : 0;
  const trumpPenalty = card.suit === state.trump ? 12 : 0;
  return card.rank + pointPenalty + trumpPenalty;
}

function playCost(card) {
  if (card.joker) {
    if (state.trickNumber === 10) {
      return 4;
    }
    return isJokerEffective() ? 85 : 72;
  }
  if (isMighty(card, state.trump)) {
    return 95;
  }
  return card.rank + (card.suit === state.trump ? 20 : 0) + (isPointCard(card) ? 14 : 0);
}

function defensiveDiscardCost(card) {
  if (card.joker) {
    if (state.trickNumber === 10) {
      return 2;
    }
    return isJokerEffective() ? 120 : 96;
  }
  if (isMighty(card, state.trump)) {
    return 120;
  }
  return card.rank + (isPointCard(card) ? 28 : 0) + (card.suit === state.trump ? 24 : 0);
}

function wouldWinCurrentTrick(playerIndex, card) {
  const preview = [...state.trick, { playerIndex, card }];
  return getTrickWinner(preview) === playerIndex;
}

function playCard(playerIndex, cardId) {
  const hand = state.hands[playerIndex];
  const cardIndex = hand.findIndex((card) => card.id === cardId);
  if (cardIndex < 0) {
    return false;
  }
  const card = hand[cardIndex];
  if (state.phase === "playing" && !isLegalPlay(playerIndex, card)) {
    state.message = `${PLAYER_NAMES[playerIndex]}의 불법 플레이가 차단되었습니다.`;
    addLog(state.message);
    render();
    return false;
  }
  let declaredJokerCall = false;
  if (state.phase === "playing" && state.trick.length === 0) {
    if (card.joker && !state.jokerLeadSuit) {
      setJokerLeadSuit(playerIndex, chooseJokerLeadSuit(playerIndex));
    }
    if (isJokerCall(card)) {
      state.jokerCallActive = playerIndex === HUMAN
        ? state.jokerCallActive && canUseJokerCallAsLead(playerIndex, card)
        : shouldUseJokerCall(playerIndex, card);
      declaredJokerCall = state.jokerCallActive;
    } else {
      state.jokerCallActive = false;
    }
  }
  hand.splice(cardIndex, 1);
  state.trick.push({ playerIndex, card });
  recordCardPlay(playerIndex, card);

  if (declaredJokerCall) {
    addLog(`${PLAYER_NAMES[playerIndex]}이 조커콜을 선언했습니다.`);
  }

  if (state.friendCardId && card.id === state.friendCardId && !state.friendRevealed) {
    state.friendIndex = playerIndex;
    state.friendRevealed = true;
    addLog(`${PLAYER_NAMES[playerIndex]}이 프렌드 카드 ${formatCard(card)}을 냈습니다.`);
  }

  const playedLabel = getPlayedCardLabel(card);
  state.message = `${PLAYER_NAMES[playerIndex]}: ${playedLabel}`;
  render();

  if (state.trick.length === 5) {
    clearTimeout(cpuTimer);
    cpuTimer = setTimeout(resolveTrick, TRICK_RESOLVE_DELAY);
    return true;
  }

  state.currentPlayer = nextPlayer(playerIndex);
  if (state.currentPlayer !== HUMAN) {
    scheduleCpuPlay();
  } else {
    state.message = "내 차례입니다. 낼 카드를 선택하세요.";
    render();
  }
  return true;
}

function recordCardPlay(playerIndex, card) {
  const leadSuit = getLeadSuit();
  state.playHistory.push({
    trickNumber: state.trickNumber,
    playerIndex,
    cardId: card.id,
    suit: card.suit,
    rank: card.rank,
    joker: Boolean(card.joker),
    leadSuit,
    isLead: state.trick.length === 1,
    jokerCallActive: isJokerCallLead(),
  });
}

function getPlayedCardLabel(card) {
  if (card.joker && state.trick.length === 1 && state.jokerLeadSuit) {
    return `${formatCard(card)} (${SUIT_LABELS[state.jokerLeadSuit]} 리드)`;
  }
  if (state.trick.length === 1 && isJokerCall(card) && state.jokerCallActive) {
    return `${formatCard(card)} (조커콜)`;
  }
  return formatCard(card);
}

function resolveTrick() {
  const winner = getTrickWinner(state.trick);
  const cards = state.trick.map((entry) => entry.card);
  state.captured[winner].push(...cards);
  const points = cards.filter(isPointCard).length;
  addLog(`${state.trickNumber}트릭: ${PLAYER_NAMES[winner]} 획득${points ? `, 점수 ${points}` : ""}`);

  state.trick = [];
  state.jokerLeadSuit = null;
  state.pendingJokerLeadCardId = null;
  state.jokerCallActive = false;
  state.pendingJokerCallCardId = null;
  state.trickNumber += 1;
  state.leaderIndex = winner;
  state.currentPlayer = winner;

  if (state.trickNumber > 10) {
    finishRound();
    return;
  }

  state.message = `${PLAYER_NAMES[winner]}이 다음 트릭을 시작합니다.`;
  render();
  if (state.currentPlayer !== HUMAN) {
    scheduleCpuPlay();
  }
}

function getTrickWinner(trick) {
  return getTrickWinnerForContext(trick, state.jokerLeadSuit, state.trickNumber);
}

function getTrickWinnerForContext(trick, jokerLeadSuit = state.jokerLeadSuit, trickNumber = state.trickNumber) {
  const leadSuit = getLeadSuitForContext(trick, jokerLeadSuit);
  let winningEntry = trick[0];
  let winningPower = cardPowerForContext(winningEntry.card, leadSuit, trickNumber);
  for (const entry of trick.slice(1)) {
    const power = cardPowerForContext(entry.card, leadSuit, trickNumber);
    if (power > winningPower) {
      winningPower = power;
      winningEntry = entry;
    }
  }
  return winningEntry.playerIndex;
}

function getLeadSuit(trick = state.trick) {
  return getLeadSuitForContext(trick, state.jokerLeadSuit);
}

function getLeadSuitForContext(trick = state.trick, jokerLeadSuit = state.jokerLeadSuit) {
  if (trick.length > 0 && trick[0].card.joker && jokerLeadSuit) {
    return jokerLeadSuit;
  }
  if (isMightyLeadForTrick(trick)) {
    return "S";
  }
  const lead = trick.find((entry) => !isSpecial(entry.card));
  return lead ? lead.card.suit : null;
}

function setJokerLeadSuit(playerIndex, suit) {
  if (!SUITS.includes(suit)) {
    return false;
  }
  state.jokerLeadSuit = suit;
  const subject = playerIndex === HUMAN ? "내가" : `${PLAYER_NAMES[playerIndex]}이`;
  addLog(`${subject} 조커 리드 문양을 ${SUIT_NAMES[suit]}로 지정했습니다.`);
  return true;
}

function chooseJokerLeadSuit(playerIndex) {
  return chooseJokerLeadSuitForContext(playerIndex, true);
}

function chooseJokerLeadSuitForSim(playerIndex) {
  return chooseJokerLeadSuitForContext(playerIndex, false);
}

function chooseJokerLeadSuitForContext(playerIndex, jitter) {
  const hand = state.hands[playerIndex] || [];
  const suitCounts = getSuitCounts(hand);
  const pointCounts = SUITS.reduce((counts, suit) => {
    counts[suit] = hand.filter((card) => !card.joker && card.suit === suit && isPointCard(card)).length;
    return counts;
  }, {});
  const playerIsDeclarerSide = state.declarerIndex !== null && isDeclarerSideForAi(playerIndex);
  return SUITS.slice().sort((a, b) => {
    const scoreA = jokerLeadSuitScore(a, suitCounts, pointCounts, playerIsDeclarerSide, jitter);
    const scoreB = jokerLeadSuitScore(b, suitCounts, pointCounts, playerIsDeclarerSide, jitter);
    return scoreB - scoreA || SUITS.indexOf(a) - SUITS.indexOf(b);
  })[0];
}

function jokerLeadSuitScore(suit, suitCounts, pointCounts, playerIsDeclarerSide, jitter = true) {
  const ownCount = suitCounts[suit] || 0;
  const ownPoints = pointCounts[suit] || 0;
  const trumpBonus = state.trump !== "NT" && suit === state.trump ? (playerIsDeclarerSide ? 0.4 : -0.3) : 0;
  return (5 - ownPoints) * 1.2 + (4 - ownCount) * 0.45 + trumpBonus + (jitter ? Math.random() * 0.18 : 0);
}

function cardPower(card, leadSuit) {
  return cardPowerForContext(card, leadSuit, state.trickNumber);
}

function cardPowerForContext(card, leadSuit, trickNumber = state.trickNumber) {
  if (isMighty(card, state.trump)) {
    return 1000;
  }
  if (card.joker) {
    return isJokerEffectiveForTrick(trickNumber) ? 900 : -100;
  }
  if (card.suit === state.trump) {
    return 600 + card.rank;
  }
  if (leadSuit && card.suit === leadSuit) {
    return 300 + card.rank;
  }
  return card.rank;
}

function isLegalPlay(playerIndex, card) {
  if (state.trick.length === 0) {
    return isLegalLead(playerIndex, card);
  }
  const leadSuit = getLeadSuit();
  if (!leadSuit) {
    return true;
  }
  if (isMightyLeadForTrick(state.trick) && playerHasFollowSuit(playerIndex, leadSuit)) {
    return !isSpecial(card) && card.suit === leadSuit;
  }
  if (isSpecial(card)) {
    return true;
  }
  if (isJokerCallLead() && playerHasJoker(playerIndex)) {
    return card.joker || isMighty(card, state.trump);
  }
  const hasLeadSuit = playerHasFollowSuit(playerIndex, leadSuit);
  return !hasLeadSuit || (!isSpecial(card) && card.suit === leadSuit);
}

function isMightyLeadForTrick(trick) {
  return trick.length > 0 && isMighty(trick[0].card, state.trump);
}

function playerHasFollowSuit(playerIndex, suit) {
  return handHasFollowSuit(state.hands[playerIndex], suit);
}

function handHasFollowSuit(hand, suit) {
  return hand.some((item) => !isSpecial(item) && item.suit === suit);
}

function isLegalLead(playerIndex, card) {
  if (state.trickNumber !== 1 || playerIndex !== state.declarerIndex) {
    return true;
  }
  if (!isRestrictedFirstLeadCard(card)) {
    return true;
  }
  if (hasUnrestrictedFirstLeadCard(playerIndex)) {
    return false;
  }
  if (isOrdinaryTrump(card)) {
    return true;
  }
  return !state.hands[playerIndex].some(isOrdinaryTrump);
}

function isOrdinaryTrump(card) {
  return !card.joker && !isMighty(card, state.trump) && state.trump !== "NT" && card.suit === state.trump;
}

function isRestrictedFirstLeadCard(card) {
  return card.joker || isMighty(card, state.trump) || isOrdinaryTrump(card);
}

function hasUnrestrictedFirstLeadCard(playerIndex) {
  return state.hands[playerIndex].some((card) => !isRestrictedFirstLeadCard(card));
}

function isJokerPowerless() {
  return state.trickNumber === 1 || state.trickNumber === 10;
}

function isJokerEffective() {
  return isJokerEffectiveForTrick(state.trickNumber);
}

function isJokerEffectiveForTrick(trickNumber) {
  return trickNumber !== 1 && trickNumber !== 10;
}

function isJokerCallLead() {
  return isJokerCallLeadForTrick(state.trick, state.jokerCallActive);
}

function isJokerCallLeadForTrick(trick, jokerCallActive = state.jokerCallActive) {
  return Boolean(jokerCallActive) && trick.length > 0 && isJokerCall(trick[0].card);
}

function isJokerCall(card) {
  return !card.joker && card.rank === 3 && card.suit === getJokerCallSuit();
}

function canUseJokerCallAsLead(playerIndex, card) {
  if (!isJokerCall(card)) {
    return false;
  }
  if (state.trickNumber !== 1 || playerIndex !== state.declarerIndex) {
    return true;
  }
  return !state.hands[playerIndex].some((item) => item.id !== card.id && !isRestrictedFirstLeadCard(item));
}

function shouldUseJokerCall(playerIndex, card) {
  if (!canUseJokerCallAsLead(playerIndex, card) || !isJokerEffective()) {
    return false;
  }
  const hand = state.hands[playerIndex] || [];
  if (hand.some((item) => item.joker)) {
    return false;
  }
  const hasMighty = hand.some((item) => isMighty(item, state.trump));
  const declarerSide = state.declarerIndex !== null && isDeclarerSideForAi(playerIndex);
  if (hasMighty) {
    return true;
  }
  if (!declarerSide && state.trickNumber >= 4) {
    return true;
  }
  return declarerSide && state.trickNumber >= 7 && getDeclarerTeamPointsForAi(playerIndex) < state.target;
}

function getJokerCallSuit() {
  if (state.trump === "C") {
    return "S";
  }
  if (state.trump === "H") {
    return "D";
  }
  return "C";
}

function playerHasJoker(playerIndex) {
  return state.hands[playerIndex].some((card) => card.joker);
}

function finishRound() {
  const buriedPoints = state.buried.filter(isPointCard).length;
  const declarerTeam = getDeclarerTeam();
  const declarerPoints = declarerTeam.reduce((sum, playerIndex) => sum + state.captured[playerIndex].filter(isPointCard).length, buriedPoints);
  const success = declarerPoints >= state.target;
  const humanSideWon = declarerTeam.includes(HUMAN) ? success : !success;

  state.phase = "roundOver";
  state.lastResult = {
    success,
    humanSideWon,
    declarerPoints,
    buriedPoints,
    declarerTeam,
  };
  state.message = success
    ? `주공 팀 성공: ${declarerPoints}/${state.target}점`
    : `주공 팀 실패: ${declarerPoints}/${state.target}점`;
  addLog(state.message);
  render();

  saveRoundRecord({
    endedAt: new Date().toISOString(),
    declarer: PLAYER_NAMES[state.declarerIndex],
    declarerIndex: state.declarerIndex,
    humanDeclarer: state.declarerIndex === HUMAN,
    friend: state.friendIndex !== null ? PLAYER_NAMES[state.friendIndex] : "없음",
    friendCard: state.friendCardId ? formatCardById(state.friendCardId) : "독주",
    trump: state.trump,
    target: state.target,
    points: declarerPoints,
    success,
    humanSideWon,
  });
}

function getDeclarerTeam() {
  const team = [state.declarerIndex];
  if (state.friendIndex !== null && state.friendIndex !== state.declarerIndex) {
    team.push(state.friendIndex);
  }
  return team;
}

function isSameKnownTeam(a, b) {
  if (a === b) {
    return true;
  }
  return isSameAiTeam(a, b);
}

function getFriendOwnerIndex() {
  if (!state.friendCardId) {
    return null;
  }
  if (state.friendIndex !== null) {
    return state.friendIndex;
  }
  for (let i = 0; i < state.hands.length; i += 1) {
    if (state.hands[i].some((card) => card.id === state.friendCardId)) {
      return i;
    }
  }
  const trickEntry = state.trick.find((entry) => entry.card.id === state.friendCardId);
  if (trickEntry) {
    return trickEntry.playerIndex;
  }
  for (let i = 0; i < state.captured.length; i += 1) {
    if (state.captured[i].some((card) => card.id === state.friendCardId)) {
      return i;
    }
  }
  return null;
}

function getCardOwnerIndex(cardId) {
  for (let i = 0; i < state.hands.length; i += 1) {
    if (state.hands[i].some((card) => card.id === cardId)) {
      return i;
    }
  }
  const trickEntry = state.trick.find((entry) => entry.card.id === cardId);
  if (trickEntry) {
    return trickEntry.playerIndex;
  }
  for (let i = 0; i < state.captured.length; i += 1) {
    if (state.captured[i].some((card) => card.id === cardId)) {
      return i;
    }
  }
  if (state.buried.some((card) => card.id === cardId)) {
    return state.declarerIndex;
  }
  return null;
}

function getCardById(cardId) {
  return createDeck().find((card) => card.id === cardId) || null;
}

function getKnownVoidSuitsByPlayer() {
  const voids = Array.from({ length: PLAYER_NAMES.length }, () => new Set());
  for (const entry of state.playHistory || []) {
    if (entry.isLead || !entry.leadSuit || entry.joker) {
      continue;
    }
    const card = getCardById(entry.cardId);
    if (!card || isMighty(card, state.trump)) {
      continue;
    }
    if (card.suit !== entry.leadSuit) {
      voids[entry.playerIndex].add(entry.leadSuit);
    }
  }
  return voids;
}

function isPlayerKnownVoidInSuit(playerIndex, suit) {
  if (!SUITS.includes(suit)) {
    return false;
  }
  const voids = getKnownVoidSuitsByPlayer();
  return Boolean(voids[playerIndex]?.has(suit));
}

function getPublicKnownCardIds(observerIndex) {
  const known = new Set((state.playHistory || []).map((entry) => entry.cardId));
  for (const card of state.hands[observerIndex] || []) {
    known.add(card.id);
  }
  if (canAiSeeBuried(observerIndex)) {
    for (const card of state.buried) {
      known.add(card.id);
    }
  }
  return known;
}

function countPublicUnseenCardsBySuit(observerIndex) {
  const known = getPublicKnownCardIds(observerIndex);
  return SUITS.reduce((counts, suit) => {
    counts[suit] = createDeck().filter((card) => !card.joker && card.suit === suit && !known.has(card.id)).length;
    return counts;
  }, {});
}

function isDeclarerSideForAi(playerIndex) {
  if (playerIndex === state.declarerIndex) {
    return true;
  }
  const friendOwner = getFriendOwnerIndex();
  return friendOwner !== null && playerIndex === friendOwner;
}

function canPlayerFollowSuitInActualHand(playerIndex, suit) {
  return Boolean(suit) && handHasFollowSuit(state.hands[playerIndex] || [], suit);
}

function isSameAiTeam(a, b) {
  return isDeclarerSideForAi(a) === isDeclarerSideForAi(b);
}

function canAiSeeBuried(observerIndex) {
  return observerIndex === state.declarerIndex || state.phase === "roundOver";
}

function getDeclarerTeamPointsForAi(observerIndex = state.declarerIndex) {
  const friendOwner = getFriendOwnerIndex();
  const buriedPoints = canAiSeeBuried(observerIndex) ? state.buried.filter(isPointCard).length : 0;
  return state.captured.reduce((sum, cards, playerIndex) => {
    if (playerIndex !== state.declarerIndex && playerIndex !== friendOwner) {
      return sum;
    }
    return sum + cards.filter(isPointCard).length;
  }, buriedPoints);
}

function getDefenseTeamPointsForAi() {
  const friendOwner = getFriendOwnerIndex();
  return state.captured.reduce((sum, cards, playerIndex) => {
    if (playerIndex === state.declarerIndex || playerIndex === friendOwner) {
      return sum;
    }
    return sum + cards.filter(isPointCard).length;
  }, 0);
}

function canHumanSeeBuried() {
  return state.declarerIndex === HUMAN || state.phase === "roundOver";
}

function getKnownDeclarerTeamPointsForHuman() {
  if (state.declarerIndex === null) {
    return 0;
  }
  const visibleTeam = getDeclarerTeam();
  const capturedPoints = visibleTeam.reduce(
    (sum, playerIndex) => sum + state.captured[playerIndex].filter(isPointCard).length,
    0,
  );
  return capturedPoints + (canHumanSeeBuried() ? state.buried.filter(isPointCard).length : 0);
}

function isPointCard(card) {
  return !card.joker && card.rank >= 10;
}

function isMighty(card, trump = state.trump) {
  if (card.joker) {
    return false;
  }
  return card.suit === getMightySuit(trump) && card.rank === 14;
}

function getMightySuit(trump = state.trump) {
  return trump === "S" ? "D" : "S";
}

function isSpecial(card) {
  return card.joker || isMighty(card, state.trump);
}

function nextPlayer(playerIndex) {
  return (playerIndex + 1) % 5;
}

function sortHand(playerIndex) {
  state.hands[playerIndex].sort((a, b) => {
    const suitOrder = { S: 0, D: 1, H: 2, C: 3, J: 4 };
    if (suitOrder[a.suit] !== suitOrder[b.suit]) {
      return suitOrder[a.suit] - suitOrder[b.suit];
    }
    return b.rank - a.rank;
  });
}

function addLog(message) {
  state.log.unshift({
    at: new Date(),
    message,
  });
  state.log = state.log.slice(0, 80);
}

async function openRecordsDb() {
  if (isRecordStorageDisabled() || !("indexedDB" in window)) {
    return null;
  }
  return new Promise((resolve) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, {
          keyPath: "id",
          autoIncrement: true,
        });
        store.createIndex("endedAt", "endedAt");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

async function loadRecords() {
  if (isRecordStorageDisabled()) {
    return [];
  }
  const fileRecords = await loadFileRecords();
  if (fileRecords) {
    return fileRecords;
  }
  if (!db) {
    return loadFallbackRecords();
  }
  return new Promise((resolve) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();
    request.onsuccess = () => {
      const records = request.result || [];
      resolve(sortRecords(records));
    };
    request.onerror = () => resolve([]);
  });
}

async function saveRoundRecord(record) {
  if (isRecordStorageDisabled()) {
    state.records = [];
    render();
    return;
  }
  if (await saveFileRecord(record)) {
    state.records = await loadRecords();
    render();
    return;
  }
  if (!db) {
    const records = sortRecords([record, ...loadFallbackRecords()]);
    localStorage.setItem("mighty32-lite-records", JSON.stringify(records));
    state.records = records;
    render();
    return;
  }
  await new Promise((resolve) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).add(record);
    transaction.oncomplete = resolve;
    transaction.onerror = resolve;
  });
  state.records = await loadRecords();
  render();
}

async function loadFileRecords() {
  if (isRecordStorageDisabled()) {
    return null;
  }
  try {
    const response = await fetch(RECORDS_API_URL, { cache: "no-store" });
    if (!response.ok) {
      return null;
    }
    const payload = await response.json();
    if (!Array.isArray(payload.records)) {
      return null;
    }
    return sortRecords(payload.records);
  } catch {
    return null;
  }
}

async function saveFileRecord(record) {
  if (isRecordStorageDisabled()) {
    return false;
  }
  try {
    const response = await fetch(RECORDS_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(record),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function clearFileRecords() {
  if (isRecordStorageDisabled()) {
    return false;
  }
  try {
    const response = await fetch(RECORDS_API_URL, {
      method: "DELETE",
    });
    return response.ok;
  } catch {
    return false;
  }
}

function sortRecords(records) {
  return records
    .slice()
    .sort((a, b) => new Date(b.endedAt) - new Date(a.endedAt))
    .slice(0, RECORD_LIMIT);
}

function loadFallbackRecords() {
  if (isRecordStorageDisabled()) {
    return [];
  }
  try {
    return JSON.parse(localStorage.getItem("mighty32-lite-records") || "[]");
  } catch {
    return [];
  }
}

async function clearRecords() {
  if (isRecordStorageDisabled()) {
    state.records = [];
    render();
    return;
  }
  await clearFileRecords();
  if (db) {
    await new Promise((resolve) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).clear();
      transaction.oncomplete = resolve;
      transaction.onerror = resolve;
    });
  }
  localStorage.removeItem("mighty32-lite-records");
  state.records = [];
  render();
}

function isRecordStorageDisabled() {
  return IS_STATIC_PAGES_HOST;
}

function formatCard(card) {
  if (card.joker) {
    return "JOKER";
  }
  return `${RANK_LABELS[card.rank]}${SUIT_LABELS[card.suit]}`;
}

function formatCardById(cardId) {
  const card = createDeck().find((item) => item.id === cardId);
  return card ? formatCard(card) : "알 수 없음";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function render() {
  app.innerHTML = `
    <section class="window">
      <div class="titlebar">
        <span class="titlebar-title">Mighty32 Lite <span class="compact">COM 대전</span></span>
        <span class="window-buttons" aria-hidden="true">
          <span class="win-button">_</span><span class="win-button">□</span><span class="win-button">×</span>
        </span>
      </div>
      ${renderToolbar()}
      <div class="layout">
        <aside class="panel">
          <div class="panel-title">진행</div>
          <div class="panel-body">${renderControlPanel()}</div>
          <div class="panel-title section-gap">기록</div>
          <div class="panel-body">${renderRecords()}</div>
        </aside>
        <section class="table-wrap">${renderTable()}</section>
        <aside class="panel">
          <div class="panel-title">판 정보</div>
          <div class="panel-body">${renderScorePanel()}</div>
          <div class="panel-title section-gap">플레이어</div>
          <div class="panel-body">${renderPlayers()}</div>
          <details class="panel-collapse section-gap">
            <summary class="panel-title">캐릭터</summary>
            <div class="panel-body">${renderCharacterEditor()}</div>
          </details>
          <div class="panel-title section-gap">로그</div>
          <div class="panel-body">${renderLog()}</div>
        </aside>
      </div>
      <div class="statusbar">
        <span>${escapeHtml(state.message)}</span>
        <span>${state.phase === "playing" ? `${state.trickNumber}/10 트릭` : phaseLabel(state.phase)}</span>
      </div>
    </section>
  `;
}

function renderToolbar() {
  return `
    <div class="toolbar">
      <div class="toolbar-group">
        <button type="button" data-action="new-round">새 판</button>
        <button type="button" data-action="sort-hand" ${state.hands[HUMAN].length ? "" : "disabled"}>정렬</button>
      </div>
      <div class="toolbar-group compact">
        <span>라이트 룰</span>
        <span class="kbd">마이티</span>
        ${renderInlineCard(getMightyCard())}
        <span class="kbd">조커</span>
        <span>마이티 다음 서열</span>
      </div>
    </div>
  `;
}

function renderControlPanel() {
  if (state.phase === "bidding") {
    if (state.currentPlayer !== HUMAN) {
      return `
        <div class="notice">${PLAYER_NAMES[state.currentPlayer]}이 입찰을 생각 중입니다.</div>
        ${renderCurrentBid()}
      `;
    }
    const defaultTrump = getDefaultHumanBidTrump();
    const minTarget = defaultTrump ? getMinimumBid(defaultTrump) : MAX_TARGET + 1;
    const canBid = Boolean(defaultTrump);
    return `
      <div class="notice">내 입찰 차례입니다. 현재 입찰보다 높은 점수로 부르거나 패스하세요.</div>
      ${renderCurrentBid()}
      <div class="control-panel">
        <div class="control-line">
          <label>기루
            <select id="bid-trump" ${canBid ? "" : "disabled"}>
              ${BID_TRUMPS.map((suit) => {
                const optionMin = getMinimumBid(suit);
                const disabled = optionMin > MAX_TARGET;
                const selected = suit === defaultTrump;
                return `<option value="${suit}" ${selected ? "selected" : ""} ${disabled ? "disabled" : ""}>${SUIT_LABELS[suit]} ${SUIT_NAMES[suit]}</option>`;
              }).join("")}
            </select>
          </label>
        </div>
        <div class="control-line">
          <label>목표
            <input id="bid-target" type="number" min="${minTarget}" max="${MAX_TARGET}" value="${Math.min(minTarget, MAX_TARGET)}" ${canBid ? "" : "disabled"} />
          </label>
        </div>
        <div class="control-line">
          <button type="button" data-action="bid" ${canBid ? "" : "disabled"}>입찰</button>
          <button type="button" data-action="pass">패스</button>
        </div>
      </div>
    `;
  }

  if (state.phase === "dealMiss") {
    const names = state.dealMissPlayers.map((index) => PLAYER_NAMES[index]).join(", ");
    const canHumanRedeal = state.dealMissPlayers.includes(HUMAN);
    return `
      <div class="notice">딜미스: ${escapeHtml(names)}. 점수 카드가 없는 초기 손패입니다.</div>
      <div class="control-line section-gap">
        <button type="button" data-action="redeal" ${canHumanRedeal ? "" : "disabled"}>재딜</button>
      </div>
    `;
  }

  if (state.phase === "announcement") {
    return `<div class="notice">${escapeHtml(state.message)}</div>`;
  }

  if (state.phase === "contract") {
    const minTarget = getMinimumContractAdjustment(state.trump);
    return `
      <div class="notice">바닥패를 본 뒤 공약을 유지하거나 더 높은 공약으로 조정할 수 있습니다.</div>
      <dl class="score-grid section-gap">
        <dt>현재 공약</dt><dd>${SUIT_LABELS[state.trump]} ${state.target}</dd>
      </dl>
      <div class="control-panel">
        <div class="control-line">
          <label>기루
            <select id="contract-trump">
              ${BID_TRUMPS.map((suit) => {
                const optionMin = getMinimumContractAdjustment(suit);
                const disabled = optionMin > MAX_TARGET;
                const selected = suit === state.trump;
                return `<option value="${suit}" ${selected ? "selected" : ""} ${disabled ? "disabled" : ""}>${SUIT_LABELS[suit]} ${SUIT_NAMES[suit]}</option>`;
              }).join("")}
            </select>
          </label>
        </div>
        <div class="control-line">
          <label>목표
            <input id="contract-target" type="number" min="${minTarget}" max="${MAX_TARGET}" value="${state.target}" />
          </label>
        </div>
        <div class="control-line">
          <button type="button" data-action="confirm-contract">공약 확정</button>
        </div>
      </div>
    `;
  }

  if (state.phase === "friend") {
    const candidates = getFriendCandidates(HUMAN).slice(0, 10);
    return `
      <div class="notice">프렌드 카드를 선택합니다. 프렌드 카드를 낸 플레이어가 주공 팀으로 공개됩니다.</div>
      <div class="control-panel">
        ${candidates
          .map(
            (candidate) =>
              `<button type="button" data-action="pick-friend" data-friend-id="${candidate.id}">${escapeHtml(candidate.label)}</button>`,
          )
          .join("")}
        <button type="button" data-action="pick-friend">독주</button>
      </div>
    `;
  }

  if (state.phase === "discard") {
    return `
      <div class="notice">손패에서 3장을 눌러 묻으세요. 선택 ${state.selectedDiscardIds.size}/3</div>
      <div class="control-line">
        <button type="button" data-action="confirm-discard" ${state.selectedDiscardIds.size === 3 ? "" : "disabled"}>3장 묻기</button>
      </div>
    `;
  }

  if (state.phase === "playing") {
    const leadSuit = getLeadSuit();
    if (state.pendingJokerLeadCardId && state.currentPlayer === HUMAN) {
      return `
        <div class="notice">조커로 리드할 문양을 고르세요. 선택한 문양이 이번 트릭의 리드 문양이 됩니다.</div>
        <div class="control-panel section-gap">
          ${SUITS.map((suit) => `<button type="button" data-action="choose-joker-suit" data-suit="${suit}">${SUIT_LABELS[suit]} ${SUIT_NAMES[suit]}</button>`).join("")}
          <button type="button" data-action="cancel-joker-suit">취소</button>
        </div>
      `;
    }
    if (state.pendingJokerCallCardId && state.currentPlayer === HUMAN) {
      const card = state.hands[HUMAN].find((item) => item.id === state.pendingJokerCallCardId);
      const canCall = card ? canUseJokerCallAsLead(HUMAN, card) : false;
      return `
        <div class="notice">이 카드를 조커콜로 쓸지 일반 리드로 낼지 선택하세요.</div>
        <div class="control-panel section-gap">
          <button type="button" data-action="choose-joker-call" data-mode="call" ${canCall ? "" : "disabled"}>조커콜</button>
          <button type="button" data-action="choose-joker-call" data-mode="normal">일반 리드</button>
          <button type="button" data-action="cancel-joker-call">취소</button>
        </div>
      `;
    }
    const text = state.currentPlayer === HUMAN
      ? "내 차례입니다. 밝게 떠 있는 카드를 낼 수 있습니다."
      : `${PLAYER_NAMES[state.currentPlayer]} 차례입니다.`;
    return `
      <div class="notice">${text}</div>
      <dl class="score-grid section-gap">
        <dt>리드</dt><dd>${leadSuit ? SUIT_LABELS[leadSuit] : "-"}</dd>
        <dt>트릭 점수</dt><dd>${state.trick.filter((entry) => isPointCard(entry.card)).length}</dd>
      </dl>
    `;
  }

  if (state.phase === "roundOver") {
    const result = state.lastResult;
    return `
      <div class="result-banner ${result.success ? "" : "fail"}">
        ${result.success ? "주공 팀 성공" : "주공 팀 실패"} · ${result.declarerPoints}/${state.target}점
      </div>
      <div class="notice section-gap">
        내 편 기준 ${result.humanSideWon ? "승리" : "패배"}입니다. 새 판을 누르면 바로 다시 시작합니다.
      </div>
      <div class="control-line section-gap">
        <button type="button" data-action="new-round">새 판</button>
      </div>
    `;
  }

  return `<div class="notice">게임을 준비하고 있습니다.</div>`;
}

function renderCurrentBid() {
  if (!state.currentBid) {
    return `<dl class="score-grid"><dt>현재 입찰</dt><dd>없음</dd></dl>`;
  }
  return `
    <dl class="score-grid">
      <dt>현재 입찰</dt><dd>${PLAYER_NAMES[state.currentBid.playerIndex]}</dd>
      <dt>기루</dt><dd>${SUIT_LABELS[state.currentBid.trump]} ${state.currentBid.target}</dd>
    </dl>
  `;
}

function renderTable() {
  return `
    <div class="table" aria-label="마이티 게임 테이블">
      ${PLAYER_NAMES.map((name, index) => renderSeat(index, name)).join("")}
      ${renderTrickArea()}
    </div>
  `;
}

function renderSeat(index, name) {
  const isTurn = state.currentPlayer === index && ["bidding", "playing"].includes(state.phase);
  const isDeclarer = state.declarerIndex === index;
  const isFriend = state.friendIndex === index && state.friendRevealed;
  const handCount = index === HUMAN ? "" : `<span class="badge count">${state.hands[index].length}장</span>`;
  return `
    <div class="seat" data-seat="${index}">
      <div class="seat-card">
        ${index === HUMAN ? "" : `<img class="seat-avatar" src="${escapeHtml(getAvatarSrc(index))}" alt="" />`}
        <div class="seat-name ${isTurn ? "is-turn" : ""} ${isDeclarer ? "is-declarer" : ""}">
          ${escapeHtml(name)}
          ${handCount}
          ${isDeclarer ? `<span class="badge">주공</span>` : ""}
          ${isFriend ? `<span class="badge friend">친구</span>` : ""}
        </div>
      </div>
      ${index === HUMAN ? renderHumanHand() : ""}
    </div>
  `;
}

function renderHumanHand() {
  return `
    <div class="hand human-hand">
      ${state.hands[HUMAN].map((card) => renderCard(card, getHumanCardClass(card), false)).join("")}
    </div>
  `;
}

function getHumanCardClass(card) {
  const classes = [];
  if (state.phase === "discard" && state.selectedDiscardIds.has(card.id)) {
    classes.push("is-selected");
  }
  if (isMighty(card, state.trump)) {
    classes.push("is-mighty");
  }
  if (state.phase === "playing" && state.currentPlayer === HUMAN) {
    if (isLegalPlay(HUMAN, card)) {
      classes.push("is-playable");
    } else {
      classes.push("is-disabled");
    }
  }
  return classes.join(" ");
}

function renderTrickArea() {
  return `
    <div class="trick-area">
      ${PLAYER_NAMES.map((name, index) => {
        const entry = state.trick.find((item) => item.playerIndex === index);
        const isJokerCallLeadEntry = entry && state.trick[0]?.playerIndex === index && isJokerCallLeadForTrick(state.trick, state.jokerCallActive);
        const label = entry
          ? `${name}${entry.card.joker && state.jokerLeadSuit ? ` · ${SUIT_LABELS[state.jokerLeadSuit]}` : ""}${isJokerCallLeadEntry ? " · 조커콜" : ""}`
          : "";
        const slotClass = `trick-slot${isJokerCallLeadEntry ? " is-joker-call-slot" : ""}`;
        return `
          <div class="${slotClass}" data-slot="${index}">
            <div class="slot-label">${escapeHtml(label)}</div>
            ${isJokerCallLeadEntry ? `<div class="joker-call-banner">조커콜 선언</div>` : ""}
            ${entry ? renderCard(entry.card, isJokerCallLeadEntry ? "is-joker-call" : "", true, isJokerCallLeadEntry ? "조커콜" : null) : `<div class="empty-card"></div>`}
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function renderCard(card, extraClass = "", inert = false, tagOverride = null) {
  const red = card.suit === "D" || card.suit === "H";
  const classes = ["card", red ? "is-red" : "", card.joker ? "is-joker" : "", extraClass].filter(Boolean).join(" ");
  const tag = tagOverride ?? (isMighty(card, state.trump) ? "MIGHTY" : card.joker ? "JOKER" : "");
  const content = card.joker
    ? `
      <span class="card-rank">JOKER</span>
      <span class="card-center">★</span>
      <span class="card-tag">${tag}</span>
    `
    : `
      <span class="card-rank">${RANK_LABELS[card.rank]}</span>
      <span class="card-suit">${SUIT_LABELS[card.suit]}</span>
      <span class="card-center">${SUIT_LABELS[card.suit]}</span>
      <span class="card-tag">${tag}</span>
    `;

  if (inert) {
    return `<div class="${classes}">${content}</div>`;
  }
  return `<button type="button" class="${classes}" data-card-id="${card.id}" aria-label="${formatCard(card)}">${content}</button>`;
}

function renderInlineCard(card) {
  const red = card.suit === "D" || card.suit === "H";
  return `<span class="inline-card ${red ? "is-red" : ""}">${formatCard(card)}</span>`;
}

function renderScorePanel() {
  const declarerPoints = getKnownDeclarerTeamPointsForHuman();
  const humanCanSeeBuried = canHumanSeeBuried();
  const scoreLabel = state.declarerIndex === null || humanCanSeeBuried ? "주공 팀 점수" : "주공 팀 공개 점수";
  const buriedPointText = state.declarerIndex === null
    ? "-"
    : humanCanSeeBuried
      ? state.buried.filter(isPointCard).length
      : "비공개";
  const buriedVisibilityNote = state.declarerIndex !== null
    ? humanCanSeeBuried
      ? "위 주공 팀 점수에는 바닥 점수가 포함됩니다."
      : "주공이 아니면 바닥 점수는 종료 전까지 비공개이며, 공개 점수에는 바닥 점수가 포함되지 않습니다."
    : "점수 카드는 A, K, Q, J, 10입니다. 조커는 점수 카드가 아닙니다.";
  return `
    <dl class="score-grid">
      <dt>단계</dt><dd>${phaseLabel(state.phase)}</dd>
      <dt>주공</dt><dd>${state.declarerIndex === null ? "-" : PLAYER_NAMES[state.declarerIndex]}</dd>
      <dt>기루</dt><dd>${state.declarerIndex === null ? "-" : `${SUIT_LABELS[state.trump]} ${SUIT_NAMES[state.trump]}`}</dd>
      <dt>목표</dt><dd>${state.declarerIndex === null ? "-" : state.target}</dd>
      <dt>${scoreLabel}</dt><dd>${state.declarerIndex === null ? "-" : declarerPoints}</dd>
      <dt>프렌드</dt><dd>${renderFriendLabel()}</dd>
      <dt>바닥 점수</dt><dd>${buriedPointText}</dd>
    </dl>
    <p class="compact section-gap">${escapeHtml(buriedVisibilityNote)}</p>
  `;
}

function renderFriendLabel() {
  if (state.friendCardId === null) {
    return state.declarerIndex === null ? "-" : "독주";
  }
  if (state.friendRevealed && state.friendIndex !== null) {
    return `${PLAYER_NAMES[state.friendIndex]} (${formatCardById(state.friendCardId)})`;
  }
  return `${formatCardById(state.friendCardId)} 미공개`;
}

function renderPlayers() {
  return `
    <ul class="player-list">
      ${PLAYER_NAMES.map((name, index) => {
        const points = state.captured[index].filter(isPointCard).length;
        return `
          <li class="player-row">
            <span class="player-identity">
              ${index === HUMAN ? "" : `<img class="mini-avatar" src="${escapeHtml(getAvatarSrc(index))}" alt="" />`}
              <span>${escapeHtml(name)}</span>
            </span>
            <span>${state.hands[index].length}장</span>
            <span>${points}점</span>
          </li>
        `;
      }).join("")}
    </ul>
  `;
}

function renderCharacterEditor() {
  return `
    <div class="character-editor">
      ${playerProfiles
        .map((profile, index) => {
          if (index === HUMAN) {
            return "";
          }
          return `
            <div class="character-row">
              <img class="character-avatar" src="${escapeHtml(getAvatarSrc(index))}" alt="" />
              <div class="character-fields">
                <label>
                  이름
                  <input type="text" maxlength="12" value="${escapeHtml(profile.name)}" data-character-name="${index}" />
                </label>
                <details class="avatar-details">
                  <summary>이미지</summary>
                  <label>
                    URL/경로
                    <input type="text" value="${escapeHtml(profile.avatarUrl)}" data-character-avatar="${index}" placeholder="https://... 또는 assets/..." />
                  </label>
                </details>
              </div>
            </div>
          `;
        })
        .join("")}
      <div class="control-line">
        <button type="button" data-action="save-characters">저장</button>
        <button type="button" data-action="reset-characters">초기화</button>
      </div>
    </div>
  `;
}

function renderRecords() {
  if (isRecordStorageDisabled()) {
    return `
      <div class="notice compact">GitHub Pages 정적 호스팅에서는 전적 저장을 끕니다. 로컬 서버로 실행하면 data/games.jsonl에 저장됩니다.</div>
    `;
  }
  if (!state.records.length) {
    return `
      <div class="notice compact">아직 저장된 전적이 없습니다. 서버 실행 시 data/games.jsonl에, 아니면 브라우저 저장소에 기록됩니다.</div>
    `;
  }
  return `
    <div class="control-line">
      <button type="button" data-action="clear-records">기록 삭제</button>
    </div>
    <ul class="record-list section-gap">
      ${state.records.slice(0, 8).map(renderRecord).join("")}
    </ul>
  `;
}

function renderRecord(record) {
  const date = new Date(record.endedAt);
  const dateText = Number.isNaN(date.getTime()) ? "" : date.toLocaleString("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  return `
    <li class="record-row">
      <div class="record-main">
        <span>${record.humanSideWon ? "승" : "패"}</span>
        <span>${record.points}/${record.target}</span>
      </div>
      <div class="record-sub">${escapeHtml(dateText)} · ${escapeHtml(record.declarer)} · ${SUIT_LABELS[record.trump] || ""} ${record.target}</div>
    </li>
  `;
}

function renderLog() {
  if (!state.log.length) {
    return `<div class="notice compact">로그가 없습니다.</div>`;
  }
  return `
    <ul class="log-list">
      ${state.log.slice(0, 10).map((entry) => `<li class="log-row">${escapeHtml(entry.message)}</li>`).join("")}
    </ul>
  `;
}

function phaseLabel(phase) {
  const labels = {
    loading: "준비",
    dealMiss: "딜미스",
    bidding: "입찰",
    announcement: "프렌드 공개",
    contract: "공약 조정",
    friend: "프렌드 선택",
    discard: "묻기",
    playing: "플레이",
    roundOver: "결과",
  };
  return labels[phase] || phase;
}

function getMightyCard() {
  const mightySuit = getMightySuit(getDisplayTrump());
  return {
    id: `${mightySuit}14`,
    suit: mightySuit,
    rank: 14,
  };
}

function getDisplayTrump() {
  if (state.declarerIndex !== null || state.phase === "playing" || state.phase === "roundOver") {
    return state.trump;
  }
  return state.currentBid?.trump || "NT";
}
