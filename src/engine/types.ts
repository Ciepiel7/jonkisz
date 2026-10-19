export type Side = "buy" | "sell";
export type PositionSide = "long" | "short";
export type OrderType = "market" | "limit";
export type OrderStatus = "open" | "filled" | "partial" | "cancelled";
export type ScenarioId = "randomWalk" | "trend" | "crash" | "meanRevert";
export type CloseReason = "close" | "liquidation" | "tp" | "sl" | "trail";
export type AlertDirection = "above" | "below";
export type FeedKind =
  | "trade"
  | "liquidation"
  | "tp"
  | "sl"
  | "trail"
  | "funding"
  | "news"
  | "order"
  | "alert";

export interface Instrument {
  symbol: string;
  name: string;
  kind: "crypto" | "stock";
  tickSize: number;
  lotSize: number;
  markPrice: number;
  lastPrice: number;
  basePrice: number;
  openPrice: number;
  high24h: number;
  low24h: number;
  volume24h: number;
}

export interface Account {
  id: string;
  name: string;
  balance: number;
  lockedMargin: number;
  realizedPnl: number;
  fundingPaid: number;
  isBot?: boolean;
}

export interface Order {
  id: string;
  accountId: string;
  symbol: string;
  side: Side;
  type: OrderType;
  price: number;
  size: number;
  filled: number;
  leverage: number;
  status: OrderStatus;
  reduceOnly: boolean;
  takeProfit?: number | null;
  stopLoss?: number | null;
  trailingStopPct?: number | null;
  createdAt: number;
}

export interface Position {
  id: string;
  accountId: string;
  symbol: string;
  side: PositionSide;
  size: number;
  entryPrice: number;
  leverage: number;
  margin: number;
  unrealizedPnl: number;
  takeProfit?: number | null;
  stopLoss?: number | null;
  trailingStopPct?: number | null;
  trailPeak?: number | null;
  openedAt: number;
}

export interface PriceAlert {
  id: string;
  symbol: string;
  price: number;
  direction: AlertDirection;
  triggered: boolean;
  createdAt: number;
}

export interface ClosedPosition {
  id: string;
  accountId: string;
  symbol: string;
  side: PositionSide;
  size: number;
  entryPrice: number;
  exitPrice: number;
  leverage: number;
  realizedPnl: number;
  openedAt: number;
  closedAt: number;
  reason: CloseReason;
}

export interface Trade {
  id: string;
  symbol: string;
  price: number;
  size: number;
  side: Side;
  makerOrderId?: string;
  takerOrderId?: string;
  ts: number;
}

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface BookLevel {
  price: number;
  size: number;
}

export interface MarketParams {
  volatility: number;
  drift: number;
  crashIntensity: number;
}

export interface ClockState {
  running: boolean;
  speed: number;
  tickMs: number;
  simTime: number;
  tickCount: number;
}

export interface FundingState {
  rate: number;
  intervalTicks: number;
  lastAppliedTick: number;
  nextInTicks: number;
}

export interface NewsFlash {
  id: string;
  headline: string;
  symbol: string | "*";
  impact: number;
  ts: number;
}

export interface FeedEvent {
  id: string;
  kind: FeedKind;
  message: string;
  ts: number;
  symbol?: string;
  pnl?: number;
}

export interface EquityPoint {
  t: number;
  equity: number;
}

export interface SessionStats {
  trades: number;
  wins: number;
  losses: number;
  volume: number;
  realizedPnl: number;
  liquidations: number;
  fundingPaid: number;
}

export interface ExchangeState {
  version: number;
  instruments: Instrument[];
  accounts: Account[];
  orders: Order[];
  positions: Position[];
  closedPositions: ClosedPosition[];
  trades: Trade[];
  candles: Record<string, Candle[]>;
  scenario: ScenarioId;
  marketParams: MarketParams;
  clock: ClockState;
  selectedSymbol: string;
  botsEnabled: boolean;
  funding: FundingState;
  news: NewsFlash | null;
  feed: FeedEvent[];
  equityHistory: EquityPoint[];
  stats: SessionStats;
  alerts: PriceAlert[];
}

export interface PlaceOrderInput {
  accountId: string;
  symbol: string;
  side: Side;
  type: OrderType;
  size: number;
  price?: number;
  leverage?: number;
  reduceOnly?: boolean;
  takeProfit?: number | null;
  stopLoss?: number | null;
  trailingStopPct?: number | null;
}

export interface PublicSnapshot {
  instruments: InstrumentView[];
  accounts: AccountView[];
  orders: Order[];
  positions: PositionView[];
  closedPositions: ClosedPosition[];
  trades: Trade[];
  candles: Candle[];
  orderBook: { bids: BookLevel[]; asks: BookLevel[] };
  scenario: ScenarioId;
  marketParams: MarketParams;
  clock: ClockState;
  selectedSymbol: string;
  botsEnabled: boolean;
  funding: FundingState;
  news: NewsFlash | null;
  feed: FeedEvent[];
  equityHistory: EquityPoint[];
  stats: SessionStats;
  spreadBps: number;
  alerts: PriceAlert[];
}

export interface InstrumentView extends Instrument {
  changePct: number;
}

export interface AccountView extends Account {
  equity: number;
  available: number;
}

export interface PositionView extends Position {
  markPrice: number;
  liquidationPrice: number;
  roe: number;
  distanceToLiqPct: number;
}
