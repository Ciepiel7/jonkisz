import { getExchange } from "@/engine";
import { NextResponse } from "next/server";


export async function POST() {
  const engine = getExchange();
  engine.reset();
  return NextResponse.json({ state: engine.snapshot() });
}
