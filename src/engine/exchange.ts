import {
  applyRealized,
  availableBalance,
  findAccount,
  lockMargin,
  toAccountView,
  unlockMargin,
} from "./accounts";
import { runBots } from "./bots";
import { uid } from "./id";
import {
  clamp,
  liquidationPrice,
  requiredMargin,
  roundTo,
  unrealizedPnl,
} from "./math";
import { CANDLE_MS, nextPrice } from "./market/scenarios";
import { pickNews } from "./news";
import { canMatch, getBook, sortedMakers } from "./orderbook";
import { createSeedState } from "./seed";
import { loadState, resetState, saveState } from "./store";
import type {
  AlertDirection,
  CloseReason,
  ClosedPosition,
  ExchangeState,
  FeedEvent,
  FeedKind,
  Instrument,
  Order,
  PlaceOrderInput,
  Position,
  PublicSnapshot,
  ScenarioId,
  Trade,
} from "./types";

const MAINTENANCE_RATE = 0.005;
const MAX_LEVERAGE = 20;
const MAX_TRADES = 500;
const MAX_CLOSED = 200;
const MAX_CANDLES = 480;
const MAX_FEED = 80;
const MAX_EQUITY = 120;

type Listener = (snap: PublicSnapshot) => void;

export class ExchangeEngine {
  private state: ExchangeState;
  private listeners = new Set<Listener>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private dirty = 0;
  private botAccountIds = new Set(["acc_mm", "acc_noise"]);
  private lastTickAt = 0;
  private emitTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(state?: ExchangeState) {
    this.state = state ?? loadState();
  }

  getState(): ExchangeState {
    return this.state;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.loop(), 100);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.persist(true);
  }

  private loop(): void {
    const { clock } = this.state;
    if (!clock.running) return;
    const interval = clock.tickMs / Math.max(0.1, clock.speed);
    const now = Date.now();
    if (!this.lastTickAt) this.lastTickAt = now;
    if (now - this.lastTickAt < interval) return;
    const steps = Math.min(5, Math.floor((now - this.lastTickAt) / interval));
    for (let i = 0; i < steps; i++) this.tick();
    this.lastTickAt += steps * interval;
    if (now - this.lastTickAt > interval * 8) this.lastTickAt = now;
  }

  tick(): void {
    const dtSec = (this.state.clock.tickMs / 1000) * this.state.clock.speed;
    this.state.clock.simTime += this.state.clock.tickMs * this.state.clock.speed;
    this.state.clock.tickCount += 1;

    if (this.state.news && this.state.clock.simTime - this.state.news.ts > 12_000) {
      this.state.news = null;
    }

    if (Math.random() < 0.003) {
      this.triggerNews(false, true);
    }

    for (const inst of this.state.instruments) {
      let raw = nextPrice(
        this.state.scenario,
        {
          instrument: inst,
          params: this.state.marketParams,
          tickCount: this.state.clock.tickCount,
        },
        dtSec,
      );

      if (this.state.news) {
        const hit =
          this.state.news.symbol === "*" || this.state.news.symbol === inst.symbol;
        if (hit) {
          const age = (this.state.clock.simTime - this.state.news.ts) / 12_000;
          const fade = Math.max(0, 1 - age);
          raw *= 1 + this.state.news.impact * 0.08 * fade;
        }
      }

      const price = roundTo(Math.max(inst.tickSize, raw), inst.tickSize);
      inst.markPrice = price;
      inst.high24h = Math.max(inst.high24h, price);
      inst.low24h = Math.min(inst.low24h, price);
      this.appendCandle(inst.symbol, price, 0);
      this.matchAgainstMark(inst);
    }

    this.markPositions();
    this.checkTpsl();
    this.checkTrailingStops();
    this.checkAlerts();
    this.liquidateIfNeeded();
    this.applyFundingIfDue();
    this.sampleEquity();

    if (this.state.botsEnabled && this.state.clock.tickCount % 2 === 0) {
      runBots(this);
    }

    const f = this.state.funding;
    f.nextInTicks = Math.max(
      0,
      f.intervalTicks - (this.state.clock.tickCount - f.lastAppliedTick),
    );

    if (this.state.clock.tickCount % 20 === 0) this.pruneDead();

    this.dirty += 1;
    this.persist(false);
    this.emit();
  }

  private matchAgainstMark(inst: Instrument): void {
    const open = this.state.orders.filter(
      (o) =>
        o.symbol === inst.symbol &&
        (o.status === "open" || o.status === "partial") &&
        o.type === "limit",
    );
    for (const order of open) {
      const crosses =
        (order.side === "buy" && order.price >= inst.markPrice) ||
        (order.side === "sell" && order.price <= inst.markPrice);
      if (!crosses) continue;
      this.fillsAgainstMark(order, inst.markPrice);
    }
  }

  private fillsAgainstMark(order: Order, price: number): void {
    const remaining = order.size - order.filled;
    if (remaining <= 0) return;
    this.executeFill(order, null, price, remaining);
  }

  placeOrder(input: PlaceOrderInput, silent = false): Order {
    const account = findAccount(this.state.accounts, input.accountId);
    if (!account) throw new Error("Nie znaleziono konta");

    const inst = this.state.instruments.find((i) => i.symbol === input.symbol);
    if (!inst) throw new Error("Nieznany instrument");

    if (input.side !== "buy" && input.side !== "sell") {
      throw new Error("Nieprawidłowa strona zlecenia");
    }
    if (input.type !== "market" && input.type !== "limit") {
      throw new Error("Nieprawidłowy typ zlecenia");
    }
    if (!Number.isFinite(input.size) || input.size <= 0) {
      throw new Error("Nieprawidłowy rozmiar");
    }

    const leverage = clamp(input.leverage ?? 1, 1, MAX_LEVERAGE);
    const size = roundTo(Math.max(inst.lotSize, input.size), inst.lotSize);
    const type = input.type;
    let price = input.price ?? inst.markPrice;
    price = roundTo(price, inst.tickSize);

    if (type === "limit" && (!Number.isFinite(input.price) || (input.price ?? 0) <= 0)) {
      throw new Error("Limit wymaga ceny");
    }
    if (!Number.isFinite(price) || price <= 0) {
      throw new Error("Nieprawidłowa cena");
    }

    const refPrice = type === "market" ? inst.markPrice : price;
    const margin = requiredMargin(refPrice, size, leverage);

    if (!input.reduceOnly) {
      if (availableBalance(account) < margin) {
        throw new Error("Niewystarczające środki na depozyt");
      }
      lockMargin(account, margin);
    }

    const order: Order = {
      id: uid("ord"),
      accountId: input.accountId,
      symbol: input.symbol,
      side: input.side,
      type,
      price: type === "market" ? refPrice : price,
      size,
      filled: 0,
      leverage,
      status: "open",
      reduceOnly: !!input.reduceOnly,
      takeProfit: input.takeProfit ?? null,
      stopLoss: input.stopLoss ?? null,
      trailingStopPct: input.trailingStopPct ?? null,
      createdAt: this.state.clock.simTime,
    };

    this.state.orders.unshift(order);
    this.matchOrder(order, inst);

    if (order.status === "open" && order.type === "market") {
      this.fillsAgainstMark(order, inst.markPrice);
    }

    if (!this.botAccountIds.has(order.accountId)) {
      this.pushFeed(
        "order",
        `${order.side.toUpperCase()} ${order.size} ${order.symbol} @ ${order.type}`,
        order.symbol,
      );
    }

    if (!silent) {
      this.persist();
      this.emit(true);
    }
    return order;
  }

  cancelOrder(orderId: string, silent = false): void {
    const order = this.state.orders.find((o) => o.id === orderId);
    if (!order) return;
    if (order.status !== "open" && order.status !== "partial") return;

    const remaining = order.size - order.filled;
    if (remaining > 0 && !order.reduceOnly) {
      const account = findAccount(this.state.accounts, order.accountId);
      if (account) {
        const release = requiredMargin(order.price, remaining, order.leverage);
        unlockMargin(account, release);
      }
    }
    order.status = "cancelled";
    if (!silent) {
      this.persist();
      this.emit(true);
    }
  }

  setPositionTpsl(
    positionId: string,
    takeProfit?: number | null,
    stopLoss?: number | null,
    trailingStopPct?: number | null,
  ): void {
    const pos = this.state.positions.find((p) => p.id === positionId);
    if (!pos) throw new Error("Brak pozycji");
    if (takeProfit !== undefined) pos.takeProfit = takeProfit;
    if (stopLoss !== undefined) pos.stopLoss = stopLoss;
    if (trailingStopPct !== undefined) {
      pos.trailingStopPct =
        trailingStopPct == null ? null : clamp(trailingStopPct, 0.001, 0.5);
      const inst = this.state.instruments.find((i) => i.symbol === pos.symbol);
      pos.trailPeak = inst?.markPrice ?? pos.entryPrice;
    }
    this.pushFeed(
      "order",
      `TP/SL/Trail ${pos.symbol}: TP=${pos.takeProfit ?? "—"} SL=${pos.stopLoss ?? "—"} Trail=${
        pos.trailingStopPct != null ? `${(pos.trailingStopPct * 100).toFixed(2)}%` : "—"
      }`,
      pos.symbol,
    );
    this.persist();
    this.emit(true);
  }

  createAlert(symbol: string, price: number, direction: AlertDirection): void {
    const inst = this.state.instruments.find((i) => i.symbol === symbol);
    if (!inst) throw new Error("Nieznany instrument");
    if (!(price > 0)) throw new Error("Cena alertu musi być dodatnia");
    this.state.alerts.unshift({
      id: uid("alert"),
      symbol,
      price: roundTo(price, inst.tickSize),
      direction,
      triggered: false,
      createdAt: this.state.clock.simTime,
    });
    if (this.state.alerts.length > 50) this.state.alerts.length = 50;
    this.pushFeed("alert", `Alert ${direction} ${price} na ${symbol}`, symbol);
    this.persist();
    this.emit(true);
  }

  deleteAlert(alertId: string): void {
    this.state.alerts = this.state.alerts.filter((a) => a.id !== alertId);
    this.persist();
    this.emit(true);
  }

  closePosition(positionId: string, size?: number): ClosedPosition {
    const pos = this.state.positions.find((p) => p.id === positionId);
    if (!pos) throw new Error("Brak pozycji");
    const closeSize = size ? Math.min(size, pos.size) : pos.size;
    return this.closePositionInternal(pos, closeSize, "close", false);
  }

  private closePositionInternal(
    pos: Position,
    closeSize: number,
    reason: CloseReason,
    quiet = false,
  ): ClosedPosition {
    const inst = this.state.instruments.find((i) => i.symbol === pos.symbol);
    if (!inst) throw new Error("Nieznany instrument");

    const exit = inst.markPrice;
    const pnl = unrealizedPnl(pos.side, closeSize, pos.entryPrice, exit);
    const fraction = closeSize / pos.size;
    const releaseMargin = pos.margin * fraction;

    const account = findAccount(this.state.accounts, pos.accountId);
    if (!account) throw new Error("Brak konta");

    applyRealized(account, pnl, releaseMargin);

    const closed: ClosedPosition = {
      id: uid("cpos"),
      accountId: pos.accountId,
      symbol: pos.symbol,
      side: pos.side,
      size: closeSize,
      entryPrice: pos.entryPrice,
      exitPrice: exit,
      leverage: pos.leverage,
      realizedPnl: pnl,
      openedAt: pos.openedAt,
      closedAt: this.state.clock.simTime,
      reason,
    };
    this.state.closedPositions.unshift(closed);
    if (this.state.closedPositions.length > MAX_CLOSED) {
      this.state.closedPositions.length = MAX_CLOSED;
    }

    if (!this.botAccountIds.has(pos.accountId)) {
      this.state.stats.trades += 1;
      this.state.stats.volume += exit * closeSize;
      this.state.stats.realizedPnl += pnl;
      if (pnl >= 0) this.state.stats.wins += 1;
      else this.state.stats.losses += 1;
      if (reason === "liquidation") this.state.stats.liquidations += 1;

      const kind: FeedKind =
        reason === "liquidation"
          ? "liquidation"
          : reason === "tp"
            ? "tp"
            : reason === "sl"
              ? "sl"
              : reason === "trail"
                ? "trail"
                : "trade";
      this.pushFeed(
        kind,
        `${reason.toUpperCase()} ${pos.side} ${pos.symbol} PnL ${pnl.toFixed(2)}`,
        pos.symbol,
        pnl,
      );
    }

    if (closeSize >= pos.size - 1e-12) {
      this.state.positions = this.state.positions.filter((p) => p.id !== pos.id);
    } else {
      pos.size -= closeSize;
      pos.margin -= releaseMargin;
      pos.unrealizedPnl = unrealizedPnl(pos.side, pos.size, pos.entryPrice, exit);
    }

    const trade: Trade = {
      id: uid("tr"),
      symbol: pos.symbol,
      price: exit,
      size: closeSize,
      side: pos.side === "long" ? "sell" : "buy",
      ts: this.state.clock.simTime,
    };
    this.pushTrade(trade);
    inst.lastPrice = exit;
    inst.volume24h += closeSize;
    this.appendCandle(inst.symbol, exit, closeSize);

    if (!quiet) {
      this.persist();
      this.emit(true);
    }
    return closed;
  }

  private matchOrder(taker: Order, inst: Instrument): void {
    const makers = sortedMakers(this.state.orders, taker.symbol, taker.side);
    for (const maker of makers) {
      if (taker.filled >= taker.size) break;
      if (maker.accountId === taker.accountId) continue;
      if (!canMatch(taker, maker)) continue;

      const takeRem = taker.size - taker.filled;
      const makeRem = maker.size - maker.filled;
      const qty = Math.min(takeRem, makeRem);
      if (qty <= 0) continue;

      const fillPrice = maker.price;
      this.executeFill(taker, maker, fillPrice, qty);
      inst.lastPrice = fillPrice;
      inst.markPrice = fillPrice;
    }
  }

  private executeFill(
    taker: Order,
    maker: Order | null,
    price: number,
    qty: number,
  ): void {
    taker.filled += qty;
    taker.status = taker.filled >= taker.size - 1e-12 ? "filled" : "partial";

    if (maker) {
      maker.filled += qty;
      maker.status = maker.filled >= maker.size - 1e-12 ? "filled" : "partial";
    }

    const trade: Trade = {
      id: uid("tr"),
      symbol: taker.symbol,
      price,
      size: qty,
      side: taker.side,
      makerOrderId: maker?.id,
      takerOrderId: taker.id,
      ts: this.state.clock.simTime,
    };
    this.pushTrade(trade);
    this.appendCandle(taker.symbol, price, qty);

    const inst = this.state.instruments.find((i) => i.symbol === taker.symbol);
    if (inst) inst.volume24h += qty;

    this.applyFillToPosition(taker, price, qty);
    if (maker) this.applyFillToPosition(maker, price, qty);
  }

  private applyFillToPosition(order: Order, price: number, qty: number): void {
    const account = findAccount(this.state.accounts, order.accountId);
    if (!account) return;

    const posSide = order.side === "buy" ? "long" : "short";
    let pos = this.state.positions.find(
      (p) => p.accountId === order.accountId && p.symbol === order.symbol,
    );

    if (pos && pos.side !== posSide) {
      const closeQty = Math.min(pos.size, qty);
      const pnl = unrealizedPnl(pos.side, closeQty, pos.entryPrice, price);
      const fraction = closeQty / pos.size;
      const release = pos.margin * fraction;
      applyRealized(account, pnl, release);

      const orderMarginPart = requiredMargin(order.price, closeQty, order.leverage);
      if (!order.reduceOnly) {
        unlockMargin(account, orderMarginPart);
      }

      this.state.closedPositions.unshift({
        id: uid("cpos"),
        accountId: pos.accountId,
        symbol: pos.symbol,
        side: pos.side,
        size: closeQty,
        entryPrice: pos.entryPrice,
        exitPrice: price,
        leverage: pos.leverage,
        realizedPnl: pnl,
        openedAt: pos.openedAt,
        closedAt: this.state.clock.simTime,
        reason: "close",
      });

      if (!this.botAccountIds.has(pos.accountId)) {
        this.state.stats.trades += 1;
        this.state.stats.volume += price * closeQty;
        this.state.stats.realizedPnl += pnl;
        if (pnl >= 0) this.state.stats.wins += 1;
        else this.state.stats.losses += 1;
      }

      pos.size -= closeQty;
      pos.margin -= release;
      const leftover = qty - closeQty;

      if (pos.size <= 1e-12) {
        this.state.positions = this.state.positions.filter((p) => p.id !== pos!.id);
        pos = undefined;
      }

      if (leftover > 1e-12) {
        this.openOrAdd(order, posSide, price, leftover);
      }
      return;
    }

    if (order.reduceOnly) {
      const release = requiredMargin(order.price, qty, order.leverage);
      unlockMargin(account, release);
      return;
    }

    this.openOrAdd(order, posSide, price, qty);
  }

  private openOrAdd(
    order: Order,
    posSide: "long" | "short",
    price: number,
    qty: number,
  ): void {
    const margin = requiredMargin(price, qty, order.leverage);
    const lockedForQty = requiredMargin(order.price, qty, order.leverage);
    const account = findAccount(this.state.accounts, order.accountId);
    if (!account) return;

    if (lockedForQty > margin) {
      unlockMargin(account, lockedForQty - margin);
    } else if (margin > lockedForQty) {
      const need = margin - lockedForQty;
      if (availableBalance(account) >= need) lockMargin(account, need);
    }

    let pos = this.state.positions.find(
      (p) =>
        p.accountId === order.accountId &&
        p.symbol === order.symbol &&
        p.side === posSide,
    );

    if (!pos) {
      const trail =
        order.trailingStopPct != null
          ? clamp(order.trailingStopPct, 0.001, 0.5)
          : null;
      pos = {
        id: uid("pos"),
        accountId: order.accountId,
        symbol: order.symbol,
        side: posSide,
        size: qty,
        entryPrice: price,
        leverage: order.leverage,
        margin,
        unrealizedPnl: 0,
        takeProfit: order.takeProfit ?? null,
        stopLoss: order.stopLoss ?? null,
        trailingStopPct: trail,
        trailPeak: trail != null ? price : null,
        openedAt: this.state.clock.simTime,
      };
      this.state.positions.unshift(pos);
    } else {
      const totalNotional = pos.entryPrice * pos.size + price * qty;
      const totalSize = pos.size + qty;
      pos.entryPrice = totalNotional / totalSize;
      pos.size = totalSize;
      pos.margin += margin;
      pos.leverage = Math.max(pos.leverage, order.leverage);
      if (order.takeProfit != null) pos.takeProfit = order.takeProfit;
      if (order.stopLoss != null) pos.stopLoss = order.stopLoss;
      if (order.trailingStopPct != null) {
        pos.trailingStopPct = clamp(order.trailingStopPct, 0.001, 0.5);
        pos.trailPeak = price;
      }
    }
  }

  private markPositions(): void {
    for (const pos of this.state.positions) {
      const inst = this.state.instruments.find((i) => i.symbol === pos.symbol);
      if (!inst) continue;
      pos.unrealizedPnl = unrealizedPnl(pos.side, pos.size, pos.entryPrice, inst.markPrice);
    }
  }

  private checkTpsl(): void {
    for (const pos of [...this.state.positions]) {
      const inst = this.state.instruments.find((i) => i.symbol === pos.symbol);
      if (!inst) continue;
      const mark = inst.markPrice;

      if (pos.takeProfit != null) {
        const hit =
          pos.side === "long" ? mark >= pos.takeProfit : mark <= pos.takeProfit;
        if (hit) {
          this.closePositionInternal(pos, pos.size, "tp", true);
          continue;
        }
      }
      if (pos.stopLoss != null) {
        const hit =
          pos.side === "long" ? mark <= pos.stopLoss : mark >= pos.stopLoss;
        if (hit) {
          this.closePositionInternal(pos, pos.size, "sl", true);
        }
      }
    }
  }

  private checkTrailingStops(): void {
    for (const pos of [...this.state.positions]) {
      if (pos.trailingStopPct == null || pos.trailingStopPct <= 0) continue;
      const inst = this.state.instruments.find((i) => i.symbol === pos.symbol);
      if (!inst) continue;
      const mark = inst.markPrice;
      if (pos.trailPeak == null) pos.trailPeak = mark;

      if (pos.side === "long") {
        if (mark > pos.trailPeak) pos.trailPeak = mark;
        const stop = pos.trailPeak * (1 - pos.trailingStopPct);
        if (mark <= stop) {
          this.closePositionInternal(pos, pos.size, "trail", true);
        }
      } else {
        if (mark < pos.trailPeak) pos.trailPeak = mark;
        const stop = pos.trailPeak * (1 + pos.trailingStopPct);
        if (mark >= stop) {
          this.closePositionInternal(pos, pos.size, "trail", true);
        }
      }
    }
  }

  private checkAlerts(): void {
    if (!this.state.alerts?.length) return;
    for (const alert of this.state.alerts) {
      if (alert.triggered) continue;
      const inst = this.state.instruments.find((i) => i.symbol === alert.symbol);
      if (!inst) continue;
      const hit =
        alert.direction === "above"
          ? inst.markPrice >= alert.price
          : inst.markPrice <= alert.price;
      if (!hit) continue;
      alert.triggered = true;
      this.pushFeed(
        "alert",
        `ALERT ${alert.symbol} ${alert.direction} ${alert.price} (mark ${inst.markPrice})`,
        alert.symbol,
      );
    }
  }

  private liquidateIfNeeded(): void {
    const marks = Object.fromEntries(
      this.state.instruments.map((i) => [i.symbol, i.markPrice]),
    );

    for (const pos of [...this.state.positions]) {
      const mark = marks[pos.symbol];
      const liq = liquidationPrice(pos.side, pos.entryPrice, pos.leverage, MAINTENANCE_RATE);
      const hit = pos.side === "long" ? mark <= liq : mark >= liq;
      const maint = pos.margin * (MAINTENANCE_RATE * pos.leverage);
      const equityOnPos = pos.margin + pos.unrealizedPnl;
      if (hit || equityOnPos < maint) {
        this.closePositionInternal(pos, pos.size, "liquidation", true);
      }
    }
  }

  private applyFundingIfDue(): void {
    const f = this.state.funding;
    if (this.state.clock.tickCount - f.lastAppliedTick < f.intervalTicks) return;

    // Oscillate funding with slight bias from aggregate long/short
    let longN = 0;
    let shortN = 0;
    for (const p of this.state.positions) {
      const n = p.entryPrice * p.size;
      if (p.side === "long") longN += n;
      else shortN += n;
    }
    const imbalance = (longN - shortN) / Math.max(1, longN + shortN);
    f.rate = clamp(0.00005 + imbalance * 0.0004 + (Math.random() - 0.5) * 0.0001, -0.001, 0.001);
    f.lastAppliedTick = this.state.clock.tickCount;

    let totalPaid = 0;
    for (const pos of this.state.positions) {
      const account = findAccount(this.state.accounts, pos.accountId);
      if (!account) continue;
      const notional = pos.entryPrice * pos.size;
      // Positive rate: longs pay shorts
      const payment =
        pos.side === "long" ? -notional * f.rate : notional * f.rate;
      account.balance += payment;
      account.fundingPaid += -payment;
      totalPaid += -payment;
      if (!this.botAccountIds.has(account.id)) {
        this.state.stats.fundingPaid += -payment;
      }
    }

    if (this.state.positions.length) {
      this.pushFeed(
        "funding",
        `Funding ${(f.rate * 100).toFixed(4)}% · netto ${totalPaid.toFixed(2)} USDT`,
      );
    }
  }

  triggerNews(manual = true, quiet = false): void {
    const pick = pickNews();
    const news = {
      id: uid("news"),
      headline: pick.headline,
      symbol: pick.symbol ?? "*",
      impact: pick.impact,
      ts: this.state.clock.simTime,
    };
    this.state.news = news;

    for (const inst of this.state.instruments) {
      const hit = news.symbol === "*" || news.symbol === inst.symbol;
      if (!hit) continue;
      const next = roundTo(
        Math.max(inst.tickSize, inst.markPrice * (1 + news.impact)),
        inst.tickSize,
      );
      inst.markPrice = next;
      inst.lastPrice = next;
      inst.high24h = Math.max(inst.high24h, next);
      inst.low24h = Math.min(inst.low24h, next);
      this.appendCandle(inst.symbol, next, 0);
    }

    this.pushFeed(
      "news",
      `${manual ? "NEWS" : "BREAKING"}: ${news.headline}`,
      news.symbol === "*" ? undefined : news.symbol,
    );
    if (!quiet) {
      this.persist();
      this.emit(true);
    }
  }

  private sampleEquity(): void {
    if (this.state.clock.tickCount % 3 !== 0) return;
    const marks = Object.fromEntries(
      this.state.instruments.map((i) => [i.symbol, i.markPrice]),
    );
    const trader = this.state.accounts.find((a) => a.id === "acc_trader");
    if (!trader) return;
    const view = toAccountView(trader, this.state.positions, marks);
    this.state.equityHistory.push({ t: this.state.clock.simTime, equity: view.equity });
    if (this.state.equityHistory.length > MAX_EQUITY) {
      this.state.equityHistory.splice(0, this.state.equityHistory.length - MAX_EQUITY);
    }
  }

  private appendCandle(symbol: string, price: number, volume: number): void {
    const periodSec = CANDLE_MS / 1000;
    const bucket = Math.floor(this.state.clock.simTime / CANDLE_MS) * periodSec;
    let series = this.state.candles[symbol];
    if (!series) {
      series = [];
      this.state.candles[symbol] = series;
    }
    let last = series[series.length - 1];

    // Wypełnij lukę przy skoku simTime, ale nie więcej niż 12 pustych słupków.
    let filled = 0;
    while (last && bucket > last.time + periodSec + 1e-9 && filled < 12) {
      const t = last.time + periodSec;
      const flat = last.close;
      series.push({
        time: t,
        open: flat,
        high: flat,
        low: flat,
        close: flat,
        volume: 0,
      });
      last = series[series.length - 1];
      filled += 1;
    }

    if (!last || bucket > last.time) {
      series.push({
        time: bucket,
        open: price,
        high: price,
        low: price,
        close: price,
        volume,
      });
    } else {
      last.high = Math.max(last.high, price);
      last.low = Math.min(last.low, price);
      last.close = price;
      last.volume += volume;
    }
    if (series.length > MAX_CANDLES) series.splice(0, series.length - MAX_CANDLES);
  }

  private pushTrade(trade: Trade): void {
    this.state.trades.unshift(trade);
    if (this.state.trades.length > MAX_TRADES) {
      this.state.trades.length = MAX_TRADES;
    }
  }

  private pushFeed(
    kind: FeedKind,
    message: string,
    symbol?: string,
    pnl?: number,
  ): void {
    const ev: FeedEvent = {
      id: uid("feed"),
      kind,
      message,
      ts: this.state.clock.simTime,
      symbol,
      pnl,
    };
    this.state.feed.unshift(ev);
    if (this.state.feed.length > MAX_FEED) this.state.feed.length = MAX_FEED;
  }

  setClock(partial: { running?: boolean; speed?: number }): void {
    if (partial.running !== undefined) this.state.clock.running = partial.running;
    if (partial.speed !== undefined) {
      this.state.clock.speed = clamp(partial.speed, 0.25, 50);
    }
    this.persist();
    this.emit(true);
  }

  setScenario(scenario: ScenarioId, params?: Partial<ExchangeState["marketParams"]>): void {
    this.state.scenario = scenario;
    if (params) this.state.marketParams = { ...this.state.marketParams, ...params };
    this.persist();
    this.emit(true);
  }

  setSelectedSymbol(symbol: string): void {
    if (!this.state.instruments.some((i) => i.symbol === symbol)) return;
    this.state.selectedSymbol = symbol;
    this.emit(true);
  }

  setBotsEnabled(enabled: boolean): void {
    this.state.botsEnabled = enabled;
    this.persist();
    this.emit(true);
  }

  createAccount(name: string, balance: number): void {
    this.state.accounts.push({
      id: uid("acc"),
      name,
      balance,
      lockedMargin: 0,
      realizedPnl: 0,
      fundingPaid: 0,
    });
    this.persist();
    this.emit(true);
  }

  deposit(accountId: string, amount: number): void {
    const account = findAccount(this.state.accounts, accountId);
    if (!account) throw new Error("Nie znaleziono konta");
    if (amount <= 0) throw new Error("Kwota musi być dodatnia");
    account.balance += amount;
    this.persist();
    this.emit(true);
  }

  reset(): void {
    this.state = resetState();
    this.dirty = 0;
    this.emit(true);
  }

  snapshot(symbol?: string): PublicSnapshot {
    const sym = symbol ?? this.state.selectedSymbol;
    const marks = Object.fromEntries(
      this.state.instruments.map((i) => [i.symbol, i.markPrice]),
    );
    const positions = this.state.positions.map((p) => {
      const mark = marks[p.symbol] ?? p.entryPrice;
      const upnl = unrealizedPnl(p.side, p.size, p.entryPrice, mark);
      const liq = liquidationPrice(p.side, p.entryPrice, p.leverage, MAINTENANCE_RATE);
      const dist =
        p.side === "long"
          ? (mark - liq) / mark
          : (liq - mark) / mark;
      return {
        ...p,
        unrealizedPnl: upnl,
        markPrice: mark,
        liquidationPrice: liq,
        roe: p.margin > 0 ? upnl / p.margin : 0,
        distanceToLiqPct: dist,
      };
    });

    const book = getBook(this.state.orders, sym);
    const bestBid = book.bids[0]?.price;
    const bestAsk = book.asks[0]?.price;
    const mid = marks[sym] ?? 0;
    const spreadBps =
      bestBid && bestAsk && mid > 0
        ? ((bestAsk - bestBid) / mid) * 10_000
        : 0;

    return {
      instruments: this.state.instruments.map((i) => ({
        ...i,
        changePct: (i.markPrice - i.openPrice) / i.openPrice,
      })),
      accounts: this.state.accounts
        .filter((a) => !a.isBot)
        .map((a) => toAccountView(a, this.state.positions, marks))
        .sort((a, b) => b.equity - a.equity),
      orders: this.state.orders.filter(
        (o) =>
          !this.botAccountIds.has(o.accountId) &&
          (o.status === "open" || o.status === "partial"),
      ),
      positions: positions.filter((p) => !this.botAccountIds.has(p.accountId)),
      closedPositions: this.state.closedPositions.filter(
        (p) => !this.botAccountIds.has(p.accountId),
      ),
      trades: this.state.trades.filter((t) => t.symbol === sym).slice(0, 40),
      candles: (this.state.candles[sym] ?? []).slice(-240),
      orderBook: book,
      scenario: this.state.scenario,
      marketParams: this.state.marketParams,
      clock: this.state.clock,
      selectedSymbol: sym,
      botsEnabled: this.state.botsEnabled,
      funding: this.state.funding,
      news: this.state.news,
      feed: this.state.feed.slice(0, 40),
      equityHistory: this.state.equityHistory,
      stats: this.state.stats,
      spreadBps,
      alerts: (this.state.alerts ?? []).filter((a) => !a.triggered).slice(0, 20),
    };
  }

  private pruneDead(): void {
    if (this.state.orders.length > 250) {
      const live: typeof this.state.orders = [];
      let hist = 0;
      for (const o of this.state.orders) {
        const open = o.status === "open" || o.status === "partial";
        if (open) {
          live.push(o);
          continue;
        }
        if (this.botAccountIds.has(o.accountId)) continue;
        if (hist < 60) {
          live.push(o);
          hist += 1;
        }
      }
      this.state.orders = live;
    }
    if (this.state.alerts.length > 30) {
      this.state.alerts = this.state.alerts.filter((a) => !a.triggered).slice(0, 20);
    }
  }

  private persist(force = true): void {
    if (!force && this.dirty < 8) return;
    saveState(this.state);
    this.dirty = 0;
  }

  private emit(immediate = false): void {
    if (immediate) {
      if (this.emitTimer) {
        clearTimeout(this.emitTimer);
        this.emitTimer = null;
      }
      this.flushEmit();
      return;
    }
    if (this.emitTimer) return;
    this.emitTimer = setTimeout(() => {
      this.emitTimer = null;
      this.flushEmit();
    }, 120);
  }

  private flushEmit(): void {
    const snap = this.snapshot();
    for (const fn of this.listeners) fn(snap);
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __jonkiszExchange: ExchangeEngine | undefined;
}

export function getExchange(): ExchangeEngine {
  if (!globalThis.__jonkiszExchange) {
    globalThis.__jonkiszExchange = new ExchangeEngine();
    globalThis.__jonkiszExchange.start();
  }
  return globalThis.__jonkiszExchange;
}

export function bootstrapFresh(): ExchangeEngine {
  const engine = new ExchangeEngine(createSeedState());
  saveState(engine.getState());
  globalThis.__jonkiszExchange = engine;
  engine.start();
  return engine;
}
