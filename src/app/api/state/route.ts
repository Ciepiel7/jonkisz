import { getExchange } from "@/engine";
import { NextRequest, NextResponse } from "next/server";


export async function GET(req: NextRequest) {
  const engine = getExchange();
  const symbol = req.nextUrl.searchParams.get("symbol") ?? undefined;
  if (symbol) engine.setSelectedSymbol(symbol);
  return NextResponse.json(engine.snapshot(symbol ?? undefined));
}

export async function POST(req: NextRequest) {
  const engine = getExchange();
  const body = (await req.json().catch(() => ({}))) as { symbol?: string };
  if (typeof body.symbol === "string") engine.setSelectedSymbol(body.symbol);
  return NextResponse.json({ state: engine.snapshot() });
}
