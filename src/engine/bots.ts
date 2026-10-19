import { roundTo } from "./math";
import type { ExchangeEngine } from "./exchange";

const lastQuoteMid = new Map<string, number>();

export function runBots(engine: ExchangeEngine): void {
  const state = engine.getState();
  if (!state.botsEnabled) return;

  const mm = state.accounts.find((a) => a.id === "acc_mm");
  const noise = state.accounts.find((a) => a.id === "acc_noise");
  if (!mm || !noise) return;

  const noisePositions = state.positions.filter((p) => p.accountId === noise.id).length;

  for (const inst of state.instruments) {
    quoteMarketMaker(engine, mm.id, inst.symbol, inst.markPrice, inst.tickSize, inst.lotSize);
    if (noisePositions < 4 && Math.random() < 0.18) {
      noiseTrade(engine, noise.id, inst.symbol, inst.lotSize);
    }
  }
}

function quoteMarketMaker(
  engine: ExchangeEngine,
  accountId: string,
  symbol: string,
  mid: number,
  tick: number,
  lot: number,
): void {
  const prev = lastQuoteMid.get(symbol);
  if (prev != null && Math.abs(mid - prev) / mid < 0.0009) return;
  lastQuoteMid.set(symbol, mid);

  const state = engine.getState();
  const mine = state.orders.filter(
    (o) =>
      o.accountId === accountId &&
      o.symbol === symbol &&
      (o.status === "open" || o.status === "partial"),
  );
  for (const o of mine) {
    engine.cancelOrder(o.id, true);
  }

  const spreadBps = 8 + Math.random() * 10;
  const half = mid * (spreadBps / 10_000);
  const levels = 3;
  for (let i = 0; i < levels; i++) {
    const offset = half * (1 + i * 0.75);
    const size = roundLot(lot * (2 + Math.random() * 6), lot);
    const bid = roundTo(mid - offset, tick);
    const ask = roundTo(mid + offset, tick);
    if (bid <= 0 || ask <= 0) continue;
    try {
      engine.placeOrder(
        {
          accountId,
          symbol,
          side: "buy",
          type: "limit",
          price: bid,
          size,
          leverage: 1,
        },
        true,
      );
      engine.placeOrder(
        {
          accountId,
          symbol,
          side: "sell",
          type: "limit",
          price: ask,
          size,
          leverage: 1,
        },
        true,
      );
    } catch {
      // bot skips if margin tight
    }
  }
}

function noiseTrade(engine: ExchangeEngine, accountId: string, symbol: string, lot: number): void {
  const side = Math.random() > 0.5 ? "buy" : "sell";
  const size = roundLot(lot * (1 + Math.random() * 3), lot);
  try {
    engine.placeOrder(
      {
        accountId,
        symbol,
        side,
        type: "market",
        size,
        leverage: 1,
      },
      true,
    );
  } catch {
    // ignore
  }
}

function roundLot(size: number, lot: number): number {
  return Math.max(lot, Math.round(size / lot) * lot);
}
