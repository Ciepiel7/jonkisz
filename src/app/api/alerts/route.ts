import { getExchange } from "@/engine";
import type { AlertDirection } from "@/engine";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const engine = getExchange();
    if (body.action === "delete") {
      engine.deleteAlert(String(body.alertId));
    } else {
      engine.createAlert(
        String(body.symbol),
        Number(body.price),
        body.direction as AlertDirection,
      );
    }
    return NextResponse.json({ state: engine.snapshot() });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Błąd alertu" },
      { status: 400 },
    );
  }
}
