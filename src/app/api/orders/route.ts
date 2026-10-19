import { getExchange } from "@/engine";
import type { OrderType, Side } from "@/engine";
import { NextRequest, NextResponse } from "next/server";


export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const side = body.side as Side;
    const type = body.type as OrderType;
    const size = Number(body.size);
    if (side !== "buy" && side !== "sell") {
      return NextResponse.json({ error: "Nieprawidłowa strona" }, { status: 400 });
    }
    if (type !== "market" && type !== "limit") {
      return NextResponse.json({ error: "Nieprawidłowy typ" }, { status: 400 });
    }
    if (!Number.isFinite(size) || size <= 0) {
      return NextResponse.json({ error: "Nieprawidłowy rozmiar" }, { status: 400 });
    }
    const engine = getExchange();
    const order = engine.placeOrder({
      accountId: String(body.accountId),
      symbol: String(body.symbol),
      side,
      type,
      size,
      price: body.price !== undefined ? Number(body.price) : undefined,
      leverage: body.leverage !== undefined ? Number(body.leverage) : 1,
      reduceOnly: !!body.reduceOnly,
      takeProfit:
        body.takeProfit === null || body.takeProfit === "" || body.takeProfit === undefined
          ? null
          : Number(body.takeProfit),
      stopLoss:
        body.stopLoss === null || body.stopLoss === "" || body.stopLoss === undefined
          ? null
          : Number(body.stopLoss),
      trailingStopPct:
        body.trailingStopPct === null ||
        body.trailingStopPct === "" ||
        body.trailingStopPct === undefined
          ? null
          : Number(body.trailingStopPct) > 1
            ? Number(body.trailingStopPct) / 100
            : Number(body.trailingStopPct),
    });
    return NextResponse.json({ order, state: engine.snapshot() });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Błąd zlecenia" },
      { status: 400 },
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json();
    const engine = getExchange();
    engine.cancelOrder(String(body.orderId));
    return NextResponse.json({ state: engine.snapshot() });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Błąd anulowania" },
      { status: 400 },
    );
  }
}
