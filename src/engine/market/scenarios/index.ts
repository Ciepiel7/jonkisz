import { clamp, gaussian } from "../../math";
import type { MarketParams, ScenarioId } from "../../types";
import type { Instrument } from "../../types";

export interface ScenarioContext {
  instrument: Instrument;
  params: MarketParams;
  tickCount: number;
}

export type ScenarioFn = (ctx: ScenarioContext, dtSec: number) => number;

/** Długość jednej świecy bazowej (ms czasu symulacji). */
export const CANDLE_MS = 5_000;

/**
 * Ruch na tick (nie GBM roczny).
 * volatility 0.35 → typowo ~0.1% na tick przy 1× — widać korpusy i knoty.
 */
function tickMove(ctx: ScenarioContext, dtSec: number, driftOverride?: number): number {
  const { instrument, params } = ctx;
  const vol = Math.max(0.05, params.volatility);
  const speedScale = Math.sqrt(Math.max(0.25, Math.min(dtSec / 0.5, 8)));
  const sigma = vol * 0.0024 * speedScale;
  const drift = (driftOverride ?? params.drift) * 0.0004 * speedScale;
  let ret = drift + gaussian() * sigma;

  if (Math.random() < 0.045 * vol) {
    ret += (Math.random() < 0.5 ? -1 : 1) * vol * 0.0045 * (0.4 + Math.random());
  }

  const next = instrument.markPrice * (1 + ret);
  return clamp(next, instrument.basePrice * 0.15, instrument.basePrice * 4);
}

const randomWalk: ScenarioFn = (ctx, dtSec) => tickMove(ctx, dtSec);

const trend: ScenarioFn = (ctx, dtSec) => {
  const drift = ctx.params.drift === 0 ? 1.2 : ctx.params.drift;
  return tickMove(ctx, dtSec, drift);
};

const crash: ScenarioFn = (ctx, dtSec) => {
  const { instrument, params, tickCount } = ctx;
  let price = tickMove(ctx, dtSec, -Math.abs(params.drift) - 0.4);
  if (tickCount % 28 === 0) {
    price *= 1 - params.crashIntensity * (0.35 + Math.random() * 0.65);
  } else {
    price *= 1 - params.crashIntensity * 0.004;
  }
  return Math.max(instrument.basePrice * 0.08, price);
};

const meanRevert: ScenarioFn = (ctx, dtSec) => {
  const { instrument, params } = ctx;
  const speedScale = Math.sqrt(Math.max(0.25, Math.min(dtSec / 0.5, 8)));
  const gap = (instrument.basePrice - instrument.markPrice) / instrument.basePrice;
  const pull = gap * 0.045 * speedScale;
  const noise = params.volatility * 0.0022 * gaussian() * speedScale;
  const next = instrument.markPrice * (1 + pull + noise);
  return clamp(next, instrument.basePrice * 0.2, instrument.basePrice * 3);
};

const SCENARIOS: Record<ScenarioId, ScenarioFn> = {
  randomWalk,
  trend,
  crash,
  meanRevert,
};

export function nextPrice(
  scenario: ScenarioId,
  ctx: ScenarioContext,
  dtSec: number,
): number {
  const fn = SCENARIOS[scenario] ?? randomWalk;
  return fn(ctx, dtSec);
}

export const SCENARIO_IDS: ScenarioId[] = [
  "randomWalk",
  "trend",
  "crash",
  "meanRevert",
];
