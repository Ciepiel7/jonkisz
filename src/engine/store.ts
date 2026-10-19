import fs from "fs";
import path from "path";
import { createSeedState } from "./seed";
import type { ExchangeState } from "./types";

const DATA_DIR = path.join(process.cwd(), "data");
const STATE_PATH = path.join(DATA_DIR, "state.json");
const CURRENT_VERSION = 5;

export function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

export function loadState(): ExchangeState {
  ensureDataDir();
  if (!fs.existsSync(STATE_PATH)) {
    const seed = createSeedState();
    saveState(seed);
    return seed;
  }
  try {
    const raw = fs.readFileSync(STATE_PATH, "utf8");
    const parsed = JSON.parse(raw) as ExchangeState;
    if (!parsed.version || parsed.version < 2) {
      const seed = createSeedState();
      saveState(seed);
      return seed;
    }
    const next = migrate(parsed);
    if (next.version !== parsed.version) saveState(next);
    return next;
  } catch {
    const seed = createSeedState();
    saveState(seed);
    return seed;
  }
}

function migrate(state: ExchangeState): ExchangeState {
  for (const inst of state.instruments) {
    if (inst.openPrice == null) inst.openPrice = inst.basePrice;
    if (inst.high24h == null) inst.high24h = inst.markPrice;
    if (inst.low24h == null) inst.low24h = inst.markPrice;
    if (inst.volume24h == null) inst.volume24h = 0;
  }
  for (const a of state.accounts) {
    if (a.fundingPaid == null) a.fundingPaid = 0;
  }
  if (!state.funding) {
    state.funding = {
      rate: 0.0001,
      intervalTicks: 80,
      lastAppliedTick: 0,
      nextInTicks: 80,
    };
  }
  if (!state.feed) state.feed = [];
  if (!state.equityHistory) state.equityHistory = [];
  if (!state.stats) {
    state.stats = {
      trades: 0,
      wins: 0,
      losses: 0,
      volume: 0,
      realizedPnl: 0,
      liquidations: 0,
      fundingPaid: 0,
    };
  }
  if (state.news === undefined) state.news = null;
  if (!state.alerts) state.alerts = [];

  // v5: margin stays inside wallet. Older saves subtracted it from balance.
  if (state.version < 5) {
    for (const a of state.accounts) {
      if (a.lockedMargin > 0) a.balance += a.lockedMargin;
    }
    state.version = CURRENT_VERSION;
  }

  return state;
}

export function saveState(state: ExchangeState): void {
  ensureDataDir();
  const tmp = `${STATE_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state), "utf8");
  fs.renameSync(tmp, STATE_PATH);
}

export function resetState(): ExchangeState {
  const seed = createSeedState();
  seed.version = CURRENT_VERSION;
  saveState(seed);
  return seed;
}
