"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FeedEvent, PublicSnapshot, ScenarioId, Side } from "@/engine/types";
import { fmtPct, fmtPrice, fmtQty, fmtUsd } from "@/lib/format";
import { beep } from "@/lib/sound";
import { DepthChart } from "./DepthChart";
import { EquitySpark } from "./EquitySpark";
import { PriceChart, type ChartTimeframe } from "./PriceChart";

const SCENARIOS: { id: ScenarioId; label: string }[] = [
  { id: "randomWalk", label: "Walk" },
  { id: "trend", label: "Trend" },
  { id: "crash", label: "Krach" },
  { id: "meanRevert", label: "Revert" },
];

const LEVS = [1, 2, 5, 10, 20];

type Toast = { id: string; text: string; kind: string };
type Dock = "pos" | "ord" | "hist" | "tape";

export function TradingTerminal({ initial }: { initial: PublicSnapshot }) {
  const [state, setState] = useState<PublicSnapshot>(initial);
  const [accountId, setAccountId] = useState(initial.accounts[0]?.id ?? "");
  const [side, setSide] = useState<Side>("buy");
  const [orderType, setOrderType] = useState<"market" | "limit">("market");
  const [size, setSize] = useState("0.01");
  const [price, setPrice] = useState("");
  const [leverage, setLeverage] = useState(5);
  const [tp, setTp] = useState("");
  const [sl, setSl] = useState("");
  const [trail, setTrail] = useState("");
  const [alertPrice, setAlertPrice] = useState("");
  const [alertDir, setAlertDir] = useState<"above" | "below">("above");
  const [timeframe, setTimeframe] = useState<ChartTimeframe>(1);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [soundOn, setSoundOn] = useState(true);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [priceFlash, setPriceFlash] = useState<"up" | "down" | null>(null);
  const [dock, setDock] = useState<Dock>("pos");
  const prevFeed = useRef<string>(initial.feed[0]?.id ?? "");
  const prevMark = useRef(initial.instruments[0]?.markPrice ?? 0);
  const soundRef = useRef(soundOn);
  soundRef.current = soundOn;
  const [volDraft, setVolDraft] = useState(initial.marketParams.volatility);
  const [driftDraft, setDriftDraft] = useState(initial.marketParams.drift);

  const instrument = useMemo(
    () => state.instruments.find((i) => i.symbol === state.selectedSymbol),
    [state.instruments, state.selectedSymbol],
  );

  const account = state.accounts.find((a) => a.id === accountId);
  const upnl = state.positions.reduce((s, p) => s + p.unrealizedPnl, 0);
  const winRate = state.stats.trades > 0 ? state.stats.wins / state.stats.trades : 0;

  const pushToast = useCallback((text: string, kind: string) => {
    const id = `${Date.now()}_${Math.random()}`;
    setToasts((t) => [{ id, text, kind }, ...t].slice(0, 4));
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }, []);

  const handleFeed = useCallback(
    (feed: FeedEvent[]) => {
      const newest = feed[0];
      if (!newest || newest.id === prevFeed.current) return;
      prevFeed.current = newest.id;
      pushToast(newest.message, newest.kind);
      if (!soundRef.current) return;
      if (newest.kind === "liquidation") beep("liq");
      else if (newest.kind === "tp") beep("tp");
      else if (newest.kind === "sl") beep("sl");
      else if (newest.kind === "trail") beep("trail");
      else if (newest.kind === "alert") beep("alert");
      else if (newest.kind === "news") beep("news");
      else if (newest.kind === "trade" || newest.kind === "order") {
        beep(newest.message.includes("SELL") || newest.message.includes("short") ? "sell" : "buy");
      }
    },
    [pushToast],
  );

  useEffect(() => {
    const es = new EventSource("/api/stream");
    es.onmessage = (ev) => {
      try {
        const snap = JSON.parse(ev.data) as PublicSnapshot;
        const inst = snap.instruments.find((i) => i.symbol === snap.selectedSymbol);
        if (inst) {
          if (inst.markPrice > prevMark.current) setPriceFlash("up");
          else if (inst.markPrice < prevMark.current) setPriceFlash("down");
          prevMark.current = inst.markPrice;
        }
        setState(snap);
        handleFeed(snap.feed);
      } catch {
        // ignore
      }
    };
    return () => es.close();
  }, [handleFeed]);

  useEffect(() => {
    if (!accountId && state.accounts[0]) setAccountId(state.accounts[0].id);
  }, [accountId, state.accounts]);

  useEffect(() => {
    if (instrument && !price) setPrice(String(instrument.markPrice));
  }, [instrument, price]);

  const post = useCallback(async (url: string, body: unknown, opts?: { busy?: boolean }) => {
    const useBusy = opts?.busy !== false;
    if (useBusy) setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Błąd");
      if (data.state) setState(data.state as PublicSnapshot);
      return data;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Błąd");
      throw e;
    } finally {
      if (useBusy) setBusy(false);
    }
  }, []);

  const selectSymbol = useCallback(
    async (symbol: string) => {
      const data = await post("/api/state", { symbol }, { busy: false });
      const snap = data.state as PublicSnapshot | undefined;
      const inst = snap?.instruments.find((i) => i.symbol === symbol);
      if (inst) {
        setPrice(String(inst.markPrice));
        setSize(String(inst.lotSize * (inst.kind === "crypto" ? 10 : 1)));
      }
    },
    [post],
  );

  async function submitOrder(nextSide: Side = side) {
    if (!instrument) return;
    const qty = Number(size);
    if (!Number.isFinite(qty) || qty <= 0) {
      setError("Nieprawidłowy rozmiar");
      return;
    }
    await post("/api/orders", {
      accountId,
      symbol: instrument.symbol,
      side: nextSide,
      type: orderType,
      size: qty,
      price: orderType === "limit" ? Number(price) : undefined,
      leverage,
      takeProfit: tp ? Number(tp) : null,
      stopLoss: sl ? Number(sl) : null,
      trailingStopPct: trail ? Number(trail) / 100 : null,
    });
    if (soundOn) beep(nextSide === "buy" ? "buy" : "sell");
  }

  async function cancelOrder(orderId: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/orders", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Błąd anulowania");
      if (data.state) setState(data.state as PublicSnapshot);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Błąd");
    } finally {
      setBusy(false);
    }
  }

  function setSizePct(pct: number) {
    if (!instrument || !account) return;
    const notional = account.available * pct * leverage;
    const qty = notional / instrument.markPrice;
    const rounded =
      Math.max(instrument.lotSize, Math.round(qty / instrument.lotSize) * instrument.lotSize);
    setSize(String(Number(rounded.toPrecision(6))));
  }

  function pickBookPrice(px: number) {
    setOrderType("limit");
    setPrice(String(px));
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      if (e.key === "b" || e.key === "B") {
        setSide("buy");
        void submitOrder("buy").catch(() => {});
      } else if (e.key === "s" || e.key === "S") {
        setSide("sell");
        void submitOrder("sell").catch(() => {});
      } else if (e.key === " ") {
        e.preventDefault();
        void post("/api/clock", { running: !state.clock.running }, { busy: false });
      } else if (e.key === "n" || e.key === "N") {
        void post("/api/news", {}, { busy: false });
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, size, leverage, orderType, price, tp, sl, trail, state.clock.running, instrument?.symbol]);

  const maxBook = Math.max(
    ...state.orderBook.bids.map((l) => l.size),
    ...state.orderBook.asks.map((l) => l.size),
    1,
  );
  const chg = instrument?.changePct ?? 0;
  const asks = [...state.orderBook.asks].slice(0, 12).reverse();
  const bids = state.orderBook.bids.slice(0, 12);

  return (
    <div className="flex h-dvh min-w-[1280px] flex-col overflow-hidden bg-black text-[12px]">
      <div className="pointer-events-none fixed right-3 top-12 z-50 flex w-80 flex-col gap-1.5">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`toast-in pointer-events-auto border px-2.5 py-1.5 text-[11px] ${
              t.kind === "liquidation" || t.kind === "sl"
                ? "border-[var(--red)] bg-[#1a080b]"
                : t.kind === "tp" || t.kind === "trail"
                  ? "border-[var(--green)] bg-[#06140e]"
                  : "border-[#2a2a2a] bg-[#111]"
            }`}
          >
            {t.text}
          </div>
        ))}
      </div>

      <header className="flex h-10 shrink-0 items-center gap-3 border-b border-[#1c1c1c] bg-[#0a0a0a] px-3">
        <span className="text-[13px] font-semibold tracking-[0.22em] text-[var(--accent)]">JONKISZ</span>
        <div
          className={`mono flex items-baseline gap-2 text-[16px] font-semibold ${
            priceFlash === "up" ? "flash-up" : priceFlash === "down" ? "flash-down" : ""
          }`}
        >
          <span className="text-white">{instrument?.symbol}</span>
          <span className={chg >= 0 ? "up" : "down"}>{fmtPrice(instrument?.markPrice ?? 0)}</span>
          <span className={`text-[11px] ${chg >= 0 ? "up" : "down"}`}>{fmtPct(chg)}</span>
        </div>
        <span className="mono text-[11px] text-[#666]">
          H {fmtPrice(instrument?.high24h ?? 0)} · L {fmtPrice(instrument?.low24h ?? 0)} · spr{" "}
          {state.spreadBps.toFixed(1)}
        </span>
        <div className="ml-auto flex items-center gap-3">
          <span className="mono text-[11px] text-[#888]">
            eq <span className="text-white">{fmtUsd(account?.equity ?? 0)}</span>
            <span className="mx-1.5 text-[#333]">|</span>
            uPnL <span className={upnl >= 0 ? "up" : "down"}>{fmtUsd(upnl)}</span>
          </span>
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide ${
              state.clock.running ? "bg-[#0a3322] text-[var(--green)]" : "bg-[#1a1a1a] text-[#888]"
            }`}
          >
            {state.clock.running ? "LIVE" : "PAUSE"} {state.clock.speed}×
          </span>
          <div className="flex items-center gap-px">
            <button
              className="chip h-6 px-2 text-[11px]"
              onClick={() => post("/api/clock", { running: !state.clock.running }, { busy: false })}
            >
              {state.clock.running ? "Pauza" : "Start"}
            </button>
            {[1, 5, 10, 25].map((s) => (
              <button
                key={s}
                className={`h-6 px-1.5 text-[11px] ${state.clock.speed === s ? "chip-on text-[var(--accent)]" : "chip"}`}
                onClick={() => post("/api/clock", { speed: s }, { busy: false })}
              >
                {s}×
              </button>
            ))}
          </div>
          <button
            className={`h-6 px-2 text-[11px] ${state.botsEnabled ? "chip-on text-white" : "chip"}`}
            onClick={() => post("/api/clock", { botsEnabled: !state.botsEnabled }, { busy: false })}
          >
            Bot
          </button>
          <button
            className="chip h-6 px-2 text-[11px] text-[var(--accent)]"
            onClick={() => post("/api/news", {}, { busy: false })}
          >
            News
          </button>
          <button className="chip h-6 px-2 text-[11px]" onClick={() => setSoundOn((v) => !v)}>
            {soundOn ? "Dźwięk" : "Cicho"}
          </button>
          <button
            className="chip h-6 px-2 text-[11px] text-[var(--red)]"
            onClick={() => {
              if (confirm("Reset całej giełdy?")) post("/api/reset", {});
            }}
          >
            Reset
          </button>
        </div>
      </header>

      <div className="flex h-8 shrink-0 items-stretch overflow-x-auto border-b border-[#1c1c1c] bg-black">
        {state.instruments.map((inst) => {
          const on = inst.symbol === state.selectedSymbol;
          return (
            <button
              key={inst.symbol}
              onClick={() => selectSymbol(inst.symbol)}
              className={`flex shrink-0 items-center gap-2 border-r border-[#1c1c1c] px-3 text-[11px] ${
                on ? "bg-[#121212] text-white" : "text-[#777] hover:bg-[#0d0d0d] hover:text-[#ccc]"
              }`}
              style={on ? { boxShadow: "inset 0 -2px 0 #f0b90b" } : undefined}
            >
              <span>{inst.symbol.replace("-USDT", "")}</span>
              <span className={`mono ${inst.changePct >= 0 ? "up" : "down"}`}>{fmtPrice(inst.markPrice)}</span>
              <span className={`mono text-[10px] ${inst.changePct >= 0 ? "up" : "down"}`}>{fmtPct(inst.changePct)}</span>
            </button>
          );
        })}
        <span className="ml-auto flex shrink-0 items-center px-3 text-[11px] text-[#555]">
          fund {(state.funding.rate * 100).toFixed(4)}% · {state.funding.nextInTicks}t · WR {fmtPct(winRate)}
        </span>
      </div>

      {state.news && (
        <div className="news-banner shrink-0 truncate px-3 py-1 text-[11px]">
          <span className="mr-2 font-semibold text-[var(--accent)]">NEWS</span>
          {state.news.headline}
          <span className="ml-2 text-[#888]">
            {state.news.symbol} {(state.news.impact * 100).toFixed(1)}%
          </span>
        </div>
      )}

      <div
        className="grid min-h-0 flex-1"
        style={{ gridTemplateColumns: "minmax(0, 1fr) 272px 308px" }}
      >
        <section className="flex min-h-0 min-w-0 flex-col border-r border-[#1c1c1c]">
          <div className="flex h-8 shrink-0 items-center gap-1 border-b border-[#1c1c1c] px-2">
            <span className="mr-2 text-[11px] text-[#888]">{instrument?.name}</span>
            {(
              [
                [1, "5s"],
                [3, "15s"],
                [12, "1m"],
              ] as [ChartTimeframe, string][]
            ).map(([tf, label]) => (
              <button
                key={tf}
                className={`h-6 px-2 text-[11px] mono ${timeframe === tf ? "chip-on text-white" : "chip"}`}
                onClick={() => setTimeframe(tf)}
              >
                {label}
              </button>
            ))}
            <span className="ml-auto text-[10px] text-[#444]">B long · S short · spacja pauza · N news</span>
          </div>
          <div className="min-h-0 flex-1">
            <PriceChart candles={state.candles} timeframe={timeframe} />
          </div>

          <div className="flex h-[248px] shrink-0 flex-col border-t border-[#1c1c1c] bg-[#050505]">
            <div className="flex h-8 shrink-0 items-center border-b border-[#1c1c1c] text-[11px]">
              {(
                [
                  ["pos", "Pozycje", state.positions.length],
                  ["ord", "Zlecenia", state.orders.length],
                  ["hist", "Historia", state.closedPositions.length],
                  ["tape", "Taśma", state.trades.length],
                ] as [Dock, string, number][]
              ).map(([id, label, n]) => (
                <button
                  key={id}
                  className={`flex h-full items-center gap-1.5 px-3 ${
                    dock === id ? "text-white" : "text-[#666] hover:text-[#aaa]"
                  }`}
                  style={dock === id ? { boxShadow: "inset 0 -2px 0 #f0b90b" } : undefined}
                  onClick={() => setDock(id)}
                >
                  {label}
                  <span className="mono text-[10px] text-[#555]">{n}</span>
                </button>
              ))}
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              {dock === "pos" && (
                <table className="w-full text-left text-[11px] mono">
                  <thead className="sticky top-0 bg-[#0a0a0a] text-[#555]">
                    <tr>
                      <th className="px-2 py-1.5">Para</th>
                      <th className="px-2 py-1.5">Strona</th>
                      <th className="px-2 py-1.5">Size</th>
                      <th className="px-2 py-1.5">Wejście</th>
                      <th className="px-2 py-1.5">Mark</th>
                      <th className="px-2 py-1.5">Lev</th>
                      <th className="px-2 py-1.5">uPnL</th>
                      <th className="px-2 py-1.5">Liq</th>
                      <th className="px-2 py-1.5">TP / SL / %</th>
                      <th className="px-2 py-1.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {state.positions.length === 0 && (
                      <tr>
                        <td colSpan={10} className="px-3 py-6 text-[#555]">
                          Brak otwartych pozycji
                        </td>
                      </tr>
                    )}
                    {state.positions.map((p) => (
                      <tr key={p.id} className="border-t border-[#161616] hover:bg-[#0d0d0d]">
                        <td className="px-2 py-1.5 text-white">{p.symbol}</td>
                        <td className={`px-2 py-1.5 ${p.side === "long" ? "up" : "down"}`}>{p.side}</td>
                        <td className="px-2 py-1.5">{fmtQty(p.size)}</td>
                        <td className="px-2 py-1.5">{fmtPrice(p.entryPrice)}</td>
                        <td className="px-2 py-1.5">{fmtPrice(p.markPrice)}</td>
                        <td className="px-2 py-1.5">{p.leverage}×</td>
                        <td className={`px-2 py-1.5 ${p.unrealizedPnl >= 0 ? "up" : "down"}`}>
                          {fmtUsd(p.unrealizedPnl)}
                        </td>
                        <td className={`px-2 py-1.5 ${p.distanceToLiqPct < 0.03 ? "down" : "text-[#666]"}`}>
                          {fmtPct(p.distanceToLiqPct)}
                        </td>
                        <td className="px-2 py-1.5">
                          <form
                            className="flex gap-1"
                            onSubmit={(e) => {
                              e.preventDefault();
                              const fd = new FormData(e.currentTarget);
                              void post("/api/positions/tpsl", {
                                positionId: p.id,
                                takeProfit: fd.get("tp") || null,
                                stopLoss: fd.get("sl") || null,
                                trailingStopPct: fd.get("trail") || null,
                              });
                            }}
                          >
                            <input name="tp" defaultValue={p.takeProfit ?? ""} placeholder="TP" className="h-6 w-16 border border-[#222] bg-black px-1" />
                            <input name="sl" defaultValue={p.stopLoss ?? ""} placeholder="SL" className="h-6 w-16 border border-[#222] bg-black px-1" />
                            <input
                              name="trail"
                              defaultValue={p.trailingStopPct != null ? String(Number((p.trailingStopPct * 100).toFixed(2))) : ""}
                              placeholder="%"
                              className="h-6 w-10 border border-[#222] bg-black px-1"
                            />
                            <button className="chip h-6 px-1.5">OK</button>
                          </form>
                        </td>
                        <td className="px-2 py-1.5">
                          <div className="flex gap-1">
                            <button className="chip h-6 px-1.5" onClick={() => post("/api/positions/close", { positionId: p.id, size: p.size / 2 })}>
                              50%
                            </button>
                            <button className="chip h-6 px-1.5 text-[var(--red)]" onClick={() => post("/api/positions/close", { positionId: p.id })}>
                              Zamknij
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {dock === "ord" && (
                <table className="w-full text-left text-[11px] mono">
                  <thead className="sticky top-0 bg-[#0a0a0a] text-[#555]">
                    <tr>
                      <th className="px-2 py-1.5">Para</th>
                      <th className="px-2 py-1.5">Strona</th>
                      <th className="px-2 py-1.5">Typ</th>
                      <th className="px-2 py-1.5">Cena</th>
                      <th className="px-2 py-1.5">Fill</th>
                      <th className="px-2 py-1.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {state.orders.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-3 py-6 text-[#555]">Brak otwartych zleceń</td>
                      </tr>
                    )}
                    {state.orders.map((o) => (
                      <tr key={o.id} className="border-t border-[#161616] hover:bg-[#0d0d0d]">
                        <td className="px-2 py-1.5 text-white">{o.symbol}</td>
                        <td className={`px-2 py-1.5 ${o.side === "buy" ? "up" : "down"}`}>{o.side}</td>
                        <td className="px-2 py-1.5">{o.type}</td>
                        <td className="px-2 py-1.5">{fmtPrice(o.price)}</td>
                        <td className="px-2 py-1.5">{fmtQty(o.filled)}/{fmtQty(o.size)}</td>
                        <td className="px-2 py-1.5">
                          <button className="chip h-6 px-1.5 text-[var(--red)]" onClick={() => cancelOrder(o.id)}>Anuluj</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {dock === "hist" && (
                <table className="w-full text-left text-[11px] mono">
                  <thead className="sticky top-0 bg-[#0a0a0a] text-[#555]">
                    <tr>
                      <th className="px-2 py-1.5">Para</th>
                      <th className="px-2 py-1.5">Strona</th>
                      <th className="px-2 py-1.5">Wejście → wyjście</th>
                      <th className="px-2 py-1.5">PnL</th>
                      <th className="px-2 py-1.5">Powód</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.closedPositions.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-3 py-6 text-[#555]">Brak zamkniętych pozycji</td>
                      </tr>
                    )}
                    {state.closedPositions.slice(0, 40).map((p) => (
                      <tr key={p.id} className="border-t border-[#161616] hover:bg-[#0d0d0d]">
                        <td className="px-2 py-1.5 text-white">{p.symbol}</td>
                        <td className={`px-2 py-1.5 ${p.side === "long" ? "up" : "down"}`}>{p.side}</td>
                        <td className="px-2 py-1.5">{fmtPrice(p.entryPrice)} → {fmtPrice(p.exitPrice)}</td>
                        <td className={`px-2 py-1.5 ${p.realizedPnl >= 0 ? "up" : "down"}`}>{fmtUsd(p.realizedPnl)}</td>
                        <td className="px-2 py-1.5 text-[#666]">{p.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {dock === "tape" && (
                <div className="grid h-full grid-cols-2">
                  <div className="overflow-auto border-r border-[#1c1c1c] px-2 py-1 text-[11px] mono">
                    {state.trades.map((t) => (
                      <div key={t.id} className="flex justify-between py-0.5 hover:bg-[#0d0d0d]">
                        <span className={t.side === "buy" ? "up" : "down"}>{t.side}</span>
                        <span>{fmtPrice(t.price)}</span>
                        <span className="text-[#666]">{fmtQty(t.size)}</span>
                      </div>
                    ))}
                  </div>
                  <div className="overflow-auto px-2 py-1 text-[11px]">
                    {state.feed.slice(0, 24).map((f) => (
                      <div key={f.id} className={`truncate py-0.5 ${f.kind === "liquidation" || f.kind === "sl" ? "down" : f.kind === "tp" ? "up" : "text-[#777]"}`}>
                        <span className="mr-1 text-[#444]">{f.kind}</span>
                        {f.message}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="flex min-h-0 flex-col border-r border-[#1c1c1c] bg-[#0a0a0a]">
          <div className="flex h-8 items-center justify-between border-b border-[#1c1c1c] px-2 text-[11px]">
            <span className="text-[#888]">Książka</span>
            <span className="mono text-[var(--accent)]">{fmtPrice(instrument?.markPrice ?? 0)}</span>
          </div>
          <div className="border-b border-[#1c1c1c] px-1">
            <DepthChart bids={state.orderBook.bids} asks={state.orderBook.asks} />
          </div>
          <div className="flex justify-between px-2 py-1 text-[10px] uppercase tracking-wide text-[#555]">
            <span>Cena</span>
            <span>Ilość</span>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {asks.map((l) => (
              <button
                key={`a-${l.price}`}
                type="button"
                onClick={() => pickBookPrice(l.price)}
                className="relative flex w-full items-center justify-between px-2 py-[3px] text-left text-[11px] mono hover:bg-[#161010]"
              >
                <div className="book-bar-ask absolute inset-y-0 right-0" style={{ width: `${(l.size / maxBook) * 100}%` }} />
                <span className="relative down">{fmtPrice(l.price)}</span>
                <span className="relative text-[#9a9a9a]">{fmtQty(l.size)}</span>
              </button>
            ))}
            <div className="my-0.5 border-y border-[#1c1c1c] bg-[#111] py-1.5 text-center mono text-[13px] font-semibold text-white">
              {fmtPrice(instrument?.markPrice ?? 0)}
              <span className={`ml-2 text-[10px] font-normal ${chg >= 0 ? "up" : "down"}`}>{fmtPct(chg)}</span>
            </div>
            {bids.map((l) => (
              <button
                key={`b-${l.price}`}
                type="button"
                onClick={() => pickBookPrice(l.price)}
                className="relative flex w-full items-center justify-between px-2 py-[3px] text-left text-[11px] mono hover:bg-[#0d1612]"
              >
                <div className="book-bar-bid absolute inset-y-0 right-0" style={{ width: `${(l.size / maxBook) * 100}%` }} />
                <span className="relative up">{fmtPrice(l.price)}</span>
                <span className="relative text-[#9a9a9a]">{fmtQty(l.size)}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="flex min-h-0 flex-col bg-[#0a0a0a]">
          <div className="flex h-8 shrink-0 items-center justify-between border-b border-[#1c1c1c] px-2">
            <span className="text-[11px] text-[#888]">Zlecenie</span>
            <select
              className="max-w-[200px] border-0 bg-transparent text-right text-[11px] text-white"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
            >
              {state.accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} {fmtUsd(a.equity)}
                </option>
              ))}
            </select>
          </div>

          <div className="min-h-0 flex-1 overflow-auto px-2.5 py-2">
            <div className="mb-2 grid grid-cols-2 gap-1">
              <button
                className={`h-9 text-[12px] font-semibold ${
                  side === "buy" ? "bg-[var(--green)] text-black" : "bg-[#111] text-[#777] hover:text-[#ccc]"
                }`}
                onClick={() => setSide("buy")}
              >
                Long
              </button>
              <button
                className={`h-9 text-[12px] font-semibold ${
                  side === "sell" ? "bg-[var(--red)] text-white" : "bg-[#111] text-[#777] hover:text-[#ccc]"
                }`}
                onClick={() => setSide("sell")}
              >
                Short
              </button>
            </div>
            <div className="mb-3 flex border-b border-[#1c1c1c] text-[11px]">
              <button
                className={`h-7 flex-1 ${orderType === "market" ? "text-white" : "text-[#666]"}`}
                style={orderType === "market" ? { boxShadow: "inset 0 -2px 0 #f0b90b" } : undefined}
                onClick={() => setOrderType("market")}
              >
                Market
              </button>
              <button
                className={`h-7 flex-1 ${orderType === "limit" ? "text-white" : "text-[#666]"}`}
                style={orderType === "limit" ? { boxShadow: "inset 0 -2px 0 #f0b90b" } : undefined}
                onClick={() => setOrderType("limit")}
              >
                Limit
              </button>
            </div>

            <label className="mb-1 block text-[10px] uppercase tracking-wide text-[#666]">
              Rozmiar
              <input
                className="mt-1 h-9 w-full border border-[#222] bg-black px-2 mono text-[13px] text-white outline-none focus:border-[#444]"
                value={size}
                onChange={(e) => setSize(e.target.value)}
              />
            </label>
            <div className="mb-3 grid grid-cols-4 gap-1">
              {[0.1, 0.25, 0.5, 1].map((p) => (
                <button key={p} className="chip h-7 text-[10px]" onClick={() => setSizePct(p)}>
                  {p * 100}%
                </button>
              ))}
            </div>

            {orderType === "limit" && (
              <label className="mb-3 block text-[10px] uppercase tracking-wide text-[#666]">
                Cena
                <input
                  className="mt-1 h-9 w-full border border-[#222] bg-black px-2 mono text-[13px] text-white outline-none focus:border-[#444]"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                />
              </label>
            )}

            <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wide text-[#666]">
              <span>Dźwignia</span>
              <span className="mono text-[12px] text-white">{leverage}×</span>
            </div>
            <div className="mb-2 grid grid-cols-5 gap-1">
              {LEVS.map((lv) => (
                <button
                  key={lv}
                  className={`h-7 text-[11px] ${leverage === lv ? "chip-on text-[var(--accent)]" : "chip"}`}
                  onClick={() => setLeverage(lv)}
                >
                  {lv}×
                </button>
              ))}
            </div>
            <input
              type="range"
              min={1}
              max={20}
              value={leverage}
              onChange={(e) => setLeverage(Number(e.target.value))}
              className="mb-3 w-full"
            />

            <div className="mb-3 grid grid-cols-3 gap-1">
              <label className="text-[10px] text-[#666]">
                TP
                <input className="mt-1 h-8 w-full border border-[#222] bg-black px-1.5 text-[11px] mono text-white" placeholder="—" value={tp} onChange={(e) => setTp(e.target.value)} />
              </label>
              <label className="text-[10px] text-[#666]">
                SL
                <input className="mt-1 h-8 w-full border border-[#222] bg-black px-1.5 text-[11px] mono text-white" placeholder="—" value={sl} onChange={(e) => setSl(e.target.value)} />
              </label>
              <label className="text-[10px] text-[#666]">
                Trail %
                <input className="mt-1 h-8 w-full border border-[#222] bg-black px-1.5 text-[11px] mono text-white" placeholder="—" value={trail} onChange={(e) => setTrail(e.target.value)} />
              </label>
            </div>

            <div className="mb-3 flex gap-1">
              <select className="chip h-8 px-1.5 text-[11px]" value={alertDir} onChange={(e) => setAlertDir(e.target.value as "above" | "below")}>
                <option value="above">↑</option>
                <option value="below">↓</option>
              </select>
              <input
                className="h-8 min-w-0 flex-1 border border-[#222] bg-black px-1.5 text-[11px] mono text-white"
                placeholder="alert"
                value={alertPrice}
                onChange={(e) => setAlertPrice(e.target.value)}
              />
              <button
                className="chip h-8 px-2 text-[11px]"
                onClick={() =>
                  post("/api/alerts", {
                    symbol: state.selectedSymbol,
                    price: Number(alertPrice || instrument?.markPrice),
                    direction: alertDir,
                  }, { busy: false })
                }
              >
                +
              </button>
            </div>
            {(state.alerts ?? []).length > 0 && (
              <div className="mb-3 max-h-14 space-y-0.5 overflow-auto text-[10px] text-[#666]">
                {(state.alerts ?? []).map((a) => (
                  <div key={a.id} className="flex justify-between">
                    <span>{a.symbol} {a.direction} {fmtPrice(a.price)}</span>
                    <button className="text-[var(--red)]" onClick={() => post("/api/alerts", { action: "delete", alertId: a.id }, { busy: false })}>×</button>
                  </div>
                ))}
              </div>
            )}

            {account && (
              <div className="mb-2 flex justify-between text-[11px] mono text-[#666]">
                <span>wolne {fmtUsd(account.available)}</span>
                <span>lock {fmtUsd(account.lockedMargin)}</span>
              </div>
            )}
            {error && <div className="mb-2 text-[11px] text-[var(--red)]">{error}</div>}

            <button
              disabled={busy}
              onClick={() => submitOrder().catch(() => {})}
              className={`mb-1 h-11 w-full text-[13px] font-semibold disabled:opacity-40 ${
                side === "buy" ? "bg-[var(--green)] text-black" : "bg-[var(--red)] text-white"
              }`}
            >
              {side === "buy" ? "Kup / Long" : "Sprzedaj / Short"}
            </button>
          </div>

          <div className="shrink-0 border-t border-[#1c1c1c] px-2.5 py-2">
            <div className="mb-2 grid grid-cols-4 gap-1">
              {SCENARIOS.map((s) => (
                <button
                  key={s.id}
                  className={`h-7 text-[10px] ${state.scenario === s.id ? "bg-[var(--accent)] text-black" : "chip"}`}
                  onClick={() => post("/api/market/scenario", { scenario: s.id }, { busy: false })}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <label className="mb-1 block text-[10px] text-[#666]">
              Vol {volDraft.toFixed(2)}
              <input
                type="range"
                min={0.05}
                max={1.5}
                step={0.05}
                value={volDraft}
                onChange={(e) => setVolDraft(Number(e.target.value))}
                onMouseUp={() => post("/api/market/scenario", { scenario: state.scenario, params: { volatility: volDraft } }, { busy: false })}
                onTouchEnd={() => post("/api/market/scenario", { scenario: state.scenario, params: { volatility: volDraft } }, { busy: false })}
                className="w-full"
              />
            </label>
            <label className="mb-2 block text-[10px] text-[#666]">
              Drift {driftDraft.toFixed(2)}
              <input
                type="range"
                min={-1.5}
                max={1.5}
                step={0.05}
                value={driftDraft}
                onChange={(e) => setDriftDraft(Number(e.target.value))}
                onMouseUp={() => post("/api/market/scenario", { scenario: state.scenario, params: { drift: driftDraft } }, { busy: false })}
                onTouchEnd={() => post("/api/market/scenario", { scenario: state.scenario, params: { drift: driftDraft } }, { busy: false })}
                className="w-full"
              />
            </label>
            <div className="mb-1 flex items-center justify-between text-[11px]">
              <span className="text-[#666]">Konta</span>
              <button className="chip h-6 px-2 text-[10px]" onClick={() => post("/api/accounts", { action: "deposit", accountId, amount: 10_000 }, { busy: false })}>
                +10k
              </button>
            </div>
            {state.accounts.map((a, i) => (
              <button
                key={a.id}
                onClick={() => setAccountId(a.id)}
                className={`flex w-full justify-between py-0.5 text-[11px] ${a.id === accountId ? "text-white" : "text-[#666]"}`}
              >
                <span>#{i + 1} {a.name}</span>
                <span className="mono">{fmtUsd(a.equity)}</span>
              </button>
            ))}
            <EquitySpark points={state.equityHistory} />
          </div>
        </section>
      </div>
    </div>
  );
}
