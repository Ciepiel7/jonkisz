"use client";

import type { EquityPoint } from "@/engine/types";

export function EquitySpark({ points }: { points: EquityPoint[] }) {
  if (points.length < 2) {
    return (
      <div className="flex h-16 items-center text-xs text-[var(--muted)]">
        Equity curve zbuduje się po kilku tickach…
      </div>
    );
  }

  const vals = points.map((p) => p.equity);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = Math.max(1, max - min);
  const w = 240;
  const h = 56;
  const d = points
    .map((p, i) => {
      const x = (i / (points.length - 1)) * w;
      const y = h - ((p.equity - min) / span) * (h - 4) - 2;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const up = vals[vals.length - 1]! >= vals[0]!;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-16 w-full" preserveAspectRatio="none">
      <path
        d={d}
        fill="none"
        stroke={up ? "var(--green)" : "var(--red)"}
        strokeWidth="2"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
