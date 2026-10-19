import { getExchange } from "@/engine";
import { NextRequest, NextResponse } from "next/server";


export async function POST(req: NextRequest) {
  const body = await req.json();
  const engine = getExchange();
  engine.setClock({
    running: body.running,
    speed: body.speed !== undefined ? Number(body.speed) : undefined,
  });
  if (body.botsEnabled !== undefined) {
    engine.setBotsEnabled(!!body.botsEnabled);
  }
  return NextResponse.json({ state: engine.snapshot() });
}
