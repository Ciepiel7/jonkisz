import { getExchange } from "@/engine";
import { NextRequest, NextResponse } from "next/server";


export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const engine = getExchange();
    if (body.action === "deposit") {
      engine.deposit(String(body.accountId), Number(body.amount));
    } else {
      engine.createAccount(String(body.name || "Konto"), Number(body.balance || 10_000));
    }
    return NextResponse.json({ state: engine.snapshot() });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Błąd konta" },
      { status: 400 },
    );
  }
}
