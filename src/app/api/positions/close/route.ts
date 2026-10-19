import { getExchange } from "@/engine";
import { NextRequest, NextResponse } from "next/server";


export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const engine = getExchange();
    const closed = engine.closePosition(
      String(body.positionId),
      body.size !== undefined ? Number(body.size) : undefined,
    );
    return NextResponse.json({ closed, state: engine.snapshot() });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Błąd zamknięcia" },
      { status: 400 },
    );
  }
}
