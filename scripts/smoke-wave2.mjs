const BASE = process.env.BASE_URL || "http://localhost:3000";

async function json(path, init) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `${res.status} ${path}`);
  return data;
}

async function main() {
  console.log("reset");
  await json("/api/reset", { method: "POST", body: "{}" });
  await json("/api/clock", {
    method: "POST",
    body: JSON.stringify({ botsEnabled: false, speed: 25, running: true }),
  });

  let state = await json("/api/state");
  const accountId = state.accounts[0].id;
  const mark = state.instruments.find((i) => i.symbol === "BTC-USDT").markPrice;

  console.log("1. alert above mark");
  await json("/api/alerts", {
    method: "POST",
    body: JSON.stringify({
      symbol: "BTC-USDT",
      price: mark * 1.001,
      direction: "above",
    }),
  });

  console.log("2. long with trail 0.5%");
  await json("/api/orders", {
    method: "POST",
    body: JSON.stringify({
      accountId,
      symbol: "BTC-USDT",
      side: "buy",
      type: "market",
      size: 0.2,
      leverage: 5,
      trailingStopPct: 0.005,
    }),
  });

  console.log("3. limit order then cancel");
  const placed = await json("/api/orders", {
    method: "POST",
    body: JSON.stringify({
      accountId,
      symbol: "ETH-USDT",
      side: "buy",
      type: "limit",
      size: 0.5,
      price: mark * 0.01,
      leverage: 2,
    }),
  });
  const openLimit = placed.state.orders.find((o) => o.symbol === "ETH-USDT" && o.type === "limit");
  if (!openLimit) throw new Error("Brak limit order w panelu");
  await json("/api/orders", {
    method: "DELETE",
    body: JSON.stringify({ orderId: openLimit.id }),
  });
  state = await json("/api/state");
  if (state.orders.some((o) => o.id === openLimit.id)) {
    throw new Error("Limit nie został anulowany");
  }
  console.log("   cancel OK");

  console.log("4. force trend up then crash for trail/alert");
  await json("/api/market/scenario", {
    method: "POST",
    body: JSON.stringify({ scenario: "trend", params: { drift: 2, volatility: 0.8 } }),
  });
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 200));
  await json("/api/market/scenario", {
    method: "POST",
    body: JSON.stringify({ scenario: "crash", params: { crashIntensity: 0.2, volatility: 1 } }),
  });

  let trailHit = false;
  let alertHit = false;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 300));
    state = await json("/api/state");
    trailHit = state.closedPositions.some((p) => p.reason === "trail");
    alertHit = state.feed.some((f) => f.kind === "alert" && f.message.startsWith("ALERT"));
    if (trailHit && alertHit) break;
  }

  console.log("   trail close:", trailHit);
  console.log("   alert fired:", alertHit);
  console.log("   candles:", state.candles.length);

  if (!trailHit && !state.closedPositions.some((p) => p.reason === "liquidation" || p.reason === "sl")) {
    // trail might not hit if price didn't peak then reverse enough — close manually still OK if position gone via liq
    const still = state.positions.find((p) => p.symbol === "BTC-USDT");
    if (still) {
      console.log("5. force trail via tiny trail pct");
      await json("/api/positions/tpsl", {
        method: "POST",
        body: JSON.stringify({ positionId: still.id, trailingStopPct: 0.001 }),
      });
      await json("/api/market/scenario", {
        method: "POST",
        body: JSON.stringify({ scenario: "crash", params: { crashIntensity: 0.3 } }),
      });
      for (let i = 0; i < 25; i++) {
        await new Promise((r) => setTimeout(r, 250));
        state = await json("/api/state");
        if (state.closedPositions.some((p) => p.reason === "trail")) {
          trailHit = true;
          break;
        }
      }
    }
  }

  trailHit = state.closedPositions.some((p) => p.reason === "trail");
  if (!trailHit) throw new Error("Trailing stop nie zamknął pozycji");
  console.log("OK wave2 smoke passed");
}

main().catch((e) => {
  console.error("FAIL", e.message);
  process.exit(1);
});
