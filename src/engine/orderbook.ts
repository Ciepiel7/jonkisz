import type { BookLevel, Order, Side } from "./types";

export function getBook(
  orders: Order[],
  symbol: string,
  depth = 12,
): { bids: BookLevel[]; asks: BookLevel[] } {
  const open = orders.filter(
    (o) => o.symbol === symbol && (o.status === "open" || o.status === "partial") && o.type === "limit",
  );

  const bidsMap = new Map<number, number>();
  const asksMap = new Map<number, number>();

  for (const o of open) {
    const remaining = o.size - o.filled;
    if (remaining <= 0) continue;
    const map = o.side === "buy" ? bidsMap : asksMap;
    map.set(o.price, (map.get(o.price) ?? 0) + remaining);
  }

  const bids = [...bidsMap.entries()]
    .map(([price, size]) => ({ price, size }))
    .sort((a, b) => b.price - a.price)
    .slice(0, depth);

  const asks = [...asksMap.entries()]
    .map(([price, size]) => ({ price, size }))
    .sort((a, b) => a.price - b.price)
    .slice(0, depth);

  return { bids, asks };
}

export function bestBid(orders: Order[], symbol: string): number | null {
  const book = getBook(orders, symbol, 1);
  return book.bids[0]?.price ?? null;
}

export function bestAsk(orders: Order[], symbol: string): number | null {
  const book = getBook(orders, symbol, 1);
  return book.asks[0]?.price ?? null;
}

export function oppositeSide(side: Side): Side {
  return side === "buy" ? "sell" : "buy";
}

export function canMatch(taker: Order, maker: Order): boolean {
  if (taker.symbol !== maker.symbol) return false;
  if (taker.side === maker.side) return false;
  if (maker.status !== "open" && maker.status !== "partial") return false;
  if (maker.type !== "limit") return false;
  if (taker.side === "buy") return taker.type === "market" || taker.price >= maker.price;
  return taker.type === "market" || taker.price <= maker.price;
}

export function sortedMakers(orders: Order[], symbol: string, takerSide: Side): Order[] {
  const want: Side = takerSide === "buy" ? "sell" : "buy";
  const makers = orders.filter(
    (o) =>
      o.symbol === symbol &&
      o.side === want &&
      (o.status === "open" || o.status === "partial") &&
      o.type === "limit",
  );
  return makers.sort((a, b) => {
    if (want === "sell") return a.price - b.price || a.createdAt - b.createdAt;
    return b.price - a.price || a.createdAt - b.createdAt;
  });
}
