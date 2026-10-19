export function roundTo(value: number, tick: number): number {
  if (!Number.isFinite(value)) return 0;
  if (tick <= 0 || !Number.isFinite(tick)) return value;
  return Math.round(value / tick) * tick;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function unrealizedPnl(
  side: "long" | "short",
  size: number,
  entry: number,
  mark: number,
): number {
  if (side === "long") return (mark - entry) * size;
  return (entry - mark) * size;
}

export function liquidationPrice(
  side: "long" | "short",
  entry: number,
  leverage: number,
  maintenanceRate = 0.005,
): number {
  const buffer = (1 / leverage) - maintenanceRate;
  if (side === "long") return entry * (1 - buffer);
  return entry * (1 + buffer);
}

export function requiredMargin(price: number, size: number, leverage: number): number {
  if (!Number.isFinite(price) || !Number.isFinite(size) || price <= 0 || size <= 0) {
    return Infinity;
  }
  return (price * size) / Math.max(1, leverage);
}

export function gaussian(): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
