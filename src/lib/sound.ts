let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new AC();
  }
  return ctx;
}

export function beep(
  kind: "buy" | "sell" | "liq" | "news" | "tp" | "sl" | "trail" | "alert",
): void {
  const ac = getCtx();
  if (!ac) return;
  void ac.resume();

  const o = ac.createOscillator();
  const g = ac.createGain();
  o.connect(g);
  g.connect(ac.destination);

  const now = ac.currentTime;
  const map = {
    buy: { f: 660, d: 0.08 },
    sell: { f: 440, d: 0.08 },
    tp: { f: 880, d: 0.12 },
    sl: { f: 220, d: 0.14 },
    trail: { f: 740, d: 0.14 },
    alert: { f: 990, d: 0.16 },
    liq: { f: 120, d: 0.25 },
    news: { f: 520, d: 0.18 },
  } as const;
  const { f, d } = map[kind];
  o.type = kind === "liq" ? "sawtooth" : "sine";
  o.frequency.setValueAtTime(f, now);
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(0.08, now + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, now + d);
  o.start(now);
  o.stop(now + d + 0.02);
}
