import { getExchange, SCENARIO_IDS } from "@/engine";
import type { ScenarioId } from "@/engine";
import { NextRequest, NextResponse } from "next/server";


export async function POST(req: NextRequest) {
  const body = await req.json();
  const scenario = String(body.scenario) as ScenarioId;
  if (!SCENARIO_IDS.includes(scenario)) {
    return NextResponse.json({ error: "Nieznany scenariusz" }, { status: 400 });
  }
  const engine = getExchange();
  engine.setScenario(scenario, body.params);
  return NextResponse.json({ state: engine.snapshot() });
}
