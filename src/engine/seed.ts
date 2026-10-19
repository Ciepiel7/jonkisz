import { CANDLE_MS } from "./market/scenarios";
import type { ExchangeState, Instrument } from "./types";

const INSTRUMENTS: Omit<
  Instrument,
  "markPrice" | "lastPrice" | "openPrice" | "high24h" | "low24h" | "volume24h"
>[] = [
  { symbol: "BTC-USDT", name: "Bitcoin", kind: "crypto", tickSize: 0.1, lotSize: 0.001, basePrice: 67500 },
  { symbol: "ETH-USDT", name: "Ethereum", kind: "crypto", tickSize: 0.01, lotSize: 0.01, basePrice: 3450 },
  { symbol: "SOL-USDT", name: "Solana", kind: "crypto", tickSize: 0.01, lotSize: 0.1, basePrice: 148 },
  { symbol: "AAPL", name: "Apple", kind: "stock", tickSize: 0.01, lotSize: 1, basePrice: 228 },
  { symbol: "TSLA", name: "Tesla", kind: "stock", tickSize: 0.01, lotSize: 1, basePrice: 248 },
  { symbol: "NVDA", name: "NVIDIA", kind: "stock", tickSize: 0.01, lotSize: 1, basePrice: 132 },
  { symbol: "MSFT", name: "Microsoft", kind: "stock", tickSize: 0.01, lotSize: 1, basePrice: 420 },
  { symbol: "GOLD", name: "Gold Spot", kind: "stock", tickSize: 0.1, lotSize: 0.1, basePrice: 2650 },
];

export function createSeedState(): ExchangeState {
  const now = Date.now();
  const instruments: Instrument[] = INSTRUMENTS.map((i) => ({
    ...i,
    markPrice: i.basePrice,
    lastPrice: i.basePrice,
    openPrice: i.basePrice,
    high24h: i.basePrice,
    low24h: i.basePrice,
    volume24h: 0,
  }));

  const candles: ExchangeState["candles"] = {};
  for (const inst of instruments) {
    const series = seedCandles(inst.basePrice, now);
    candles[inst.symbol] = series;
    const last = series[series.length - 1]!;
    inst.markPrice = last.close;
    inst.lastPrice = last.close;
    inst.openPrice = series[0]!.open;
    inst.high24h = Math.max(...series.map((c) => c.high));
    inst.low24h = Math.min(...series.map((c) => c.low));
  }

  return {
    version: 5,
    instruments,
    accounts: [
      {
        id: "acc_trader",
        name: "Trader Demo",
        balance: 100_000,
        lockedMargin: 0,
        realizedPnl: 0,
        fundingPaid: 0,
      },
      {
        id: "acc_whale",
        name: "Whale",
        balance: 500_000,
        lockedMargin: 0,
        realizedPnl: 0,
        fundingPaid: 0,
      },
      {
        id: "acc_mm",
        name: "Market Maker",
        balance: 1_000_000,
        lockedMargin: 0,
        realizedPnl: 0,
        fundingPaid: 0,
        isBot: true,
      },
      {
        id: "acc_noise",
        name: "Noise Bot",
        balance: 200_000,
        lockedMargin: 0,
        realizedPnl: 0,
        fundingPaid: 0,
        isBot: true,
      },
    ],
    orders: [],
    positions: [],
    closedPositions: [],
    trades: [],
    candles,
    scenario: "randomWalk",
    marketParams: { volatility: 0.55, drift: 0.15, crashIntensity: 0.08 },
    clock: {
      running: true,
      speed: 1,
      tickMs: 400,
      simTime: now,
      tickCount: 0,
    },
    selectedSymbol: "BTC-USDT",
    botsEnabled: true,
    funding: {
      rate: 0.0001,
      intervalTicks: 80,
      lastAppliedTick: 0,
      nextInTicks: 80,
    },
    news: null,
    feed: [
      {
        id: "feed_boot",
        kind: "news",
        message: "Sesja offline start — boty i funding włączone",
        ts: now,
      },
    ],
    equityHistory: [{ t: now, equity: 100_000 }],
    stats: {
      trades: 0,
      wins: 0,
      losses: 0,
      volume: 0,
      realizedPnl: 0,
      liquidations: 0,
      fundingPaid: 0,
    },
    alerts: [],
  };
}

function seedCandles(base: number, now: number) {
  const out = [];
  const periodSec = CANDLE_MS / 1000;
  const endBucket = Math.floor(now / CANDLE_MS) * periodSec;
  let price = base * (0.985 + Math.random() * 0.03);
  let momentum = 0;

  for (let i = 200; i >= 0; i--) {
    const t = endBucket - i * periodSec;
    const open = price;
    const pull = ((base - open) / base) * 0.08;
    momentum = momentum * 0.7 + (Math.random() - 0.5) * 0.003 + pull;
    const shock = (Math.random() - 0.5) * 0.0025;
    let close = open * (1 + momentum + shock);
    close = Math.min(base * 1.08, Math.max(base * 0.92, close));
    const span = Math.max(Math.abs(close - open), base * 0.0006);
    const wick = span * (0.5 + Math.random() * 1.6);
    const high = Math.max(open, close) + wick * Math.random();
    const low = Math.min(open, close) - wick * Math.random();
    out.push({
      time: t,
      open,
      high,
      low,
      close,
      volume: 20 + Math.random() * 180,
    });
    price = close;
  }
  return out;
}
