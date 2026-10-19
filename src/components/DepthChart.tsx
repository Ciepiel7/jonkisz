"use client";

import type { BookLevel } from "@/engine/types";

export function DepthChart({
  bids,
  asks,
}: {
  bids: BookLevel[];
  asks: BookLevel[];
}) {
  if (!bids.length && !asks.length) {
    return (
      <div className="flex h-10 items-center justify-center text-[10px] text-[#555]">
        Brak głębokości
      </div>
    );
  }

  const bidCum: { price: number; cum: number }[] = [];
  let c = 0;
  for (const b of bids) {
    c += b.size;
    bidCum.push({ price: b.price, cum: c });
  }
  const askCum: { price: number; cum: number }[] = [];
  c = 0;
  for (const a of asks) {
    c += a.size;
    askCum.push({ price: a.price, cum: c });
  }

  const maxCum = Math.max(
    bidCum[bidCum.length - 1]?.cum ?? 0,
    askCum[askCum.length - 1]?.cum ?? 0,
    1,
  );
  const prices = [...bidCum.map((x) => x.price), ...askCum.map((x) => x.price)];
  const minP = Math.min(...prices);
  const maxP = Math.max(...prices);
  const span = Math.max(maxP - minP, 1e-9);

  const w = 280;
  const h = 40;
  const xOf = (p: number) => ((p - minP) / span) * w;
  const yOf = (cum: number) => h - (cum / maxCum) * (h - 4) - 2;

  const bidPath =
    bidCum.length > 0
      ? `M ${xOf(bidCum[0]!.price)},${h} ` +
        bidCum.map((p) => `L ${xOf(p.price)},${yOf(p.cum)}`).join(" ") +
        ` L ${xOf(bidCum[bidCum.length - 1]!.price)},${h} Z`
      : "";

  const askPath =
    askCum.length > 0
      ? `M ${xOf(askCum[0]!.price)},${h} ` +
        askCum.map((p) => `L ${xOf(p.price)},${yOf(p.cum)}`).join(" ") +
        ` L ${xOf(askCum[askCum.length - 1]!.price)},${h} Z`
      : "";

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-10 w-full" preserveAspectRatio="none">
      {bidPath && <path d={bidPath} fill="rgba(14, 203, 129, 0.28)" stroke="#0ecb81" strokeWidth="1" />}
      {askPath && <path d={askPath} fill="rgba(246, 70, 93, 0.28)" stroke="#f6465d" strokeWidth="1" />}
    </svg>
  );
}
