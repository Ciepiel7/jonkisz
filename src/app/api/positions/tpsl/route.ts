import { getExchange } from "@/engine";
import { NextRequest, NextResponse } from "next/server";

function optNum(v: unknown): number | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  return Number(v);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const engine = getExchange();
    const trailRaw = optNum(body.trailingStopPct);
    engine.setPositionTpsl(
      String(body.positionId),
      optNum(body.takeProfit),
      optNum(body.stopLoss),
      trailRaw === undefined
        ? undefined
        : trailRaw === null
          ? null
          : trailRaw > 1
            ? trailRaw / 100
            : trailRaw,
    );
    return NextResponse.json({ state: engine.snapshot() });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Błąd TP/SL" },
      { status: 400 },
    );
  }
}
