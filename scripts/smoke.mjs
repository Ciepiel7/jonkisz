/**
 * Smoke: reset → long → crash → wait → close/liquidation → historia
 */
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
  console.log("1. reset");
  await json("/api/reset", { method: "POST", body: "{}" });

  console.log("2. bots off, speed 25x");
  await json("/api/clock", {
    method: "POST",
    body: JSON.stringify({ botsEnabled: false, speed: 25, running: true }),
  });

  const before = await json("/api/state");
  const accountId = before.accounts[0].id;
  const symbol = "BTC-USDT";
  const mark = before.instruments.find((i) => i.symbol === symbol).markPrice;
  console.log("3. open long", { accountId, mark });

  await json("/api/orders", {
    method: "POST",
    body: JSON.stringify({
      accountId,
      symbol,
      side: "buy",
      type: "market",
      size: 0.5,
      leverage: 20,
    }),
  });

  let state = await json("/api/state");
  console.log("   open positions:", state.positions.length);
  if (state.positions.length < 1) throw new Error("Brak otwartej pozycji");

  console.log("4. scenario crash");
  await json("/api/market/scenario", {
    method: "POST",
    body: JSON.stringify({
      scenario: "crash",
      params: { crashIntensity: 0.25, volatility: 1.2 },
    }),
  });

  console.log("5. wait for ticks / liquidation");
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 400));
    state = await json("/api/state");
    const open = state.positions.filter((p) => p.symbol === symbol);
    const closed = state.closedPositions.filter((p) => p.symbol === symbol);
    process.stdout.write(
      `   t=${i} open=${open.length} closed=${closed.length} mark=${state.instruments.find((x) => x.symbol === symbol).markPrice.toFixed(1)}\r`,
    );
    if (open.length === 0 && closed.length > 0) break;
  }
  console.log("");

  state = await json("/api/state");
  const stillOpen = state.positions.find((p) => p.symbol === symbol);
  if (stillOpen) {
    console.log("6. manual close remaining");
    await json("/api/positions/close", {
      method: "POST",
      body: JSON.stringify({ positionId: stillOpen.id }),
    });
    state = await json("/api/state");
  }

  const hist = state.closedPositions.filter((p) => p.accountId === accountId);
  console.log("7. historia:", hist.slice(0, 3).map((h) => ({
    reason: h.reason,
    pnl: h.realizedPnl.toFixed(2),
    entry: h.entryPrice.toFixed(1),
    exit: h.exitPrice.toFixed(1),
  })));

  if (hist.length < 1) throw new Error("Brak zamkniętych pozycji w historii");
  console.log("OK smoke passed");
}

main().catch((e) => {
  console.error("FAIL", e.message);
  process.exit(1);
});
