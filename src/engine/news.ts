export const NEWS_HEADLINES: { headline: string; impact: number; symbol?: string }[] = [
  { headline: "Fed sygnalizuje cięcie stóp — risk-on na rynkach", impact: 0.035 },
  { headline: "Hack giełdy offshore: panika na krypto", impact: -0.08, symbol: "BTC-USDT" },
  { headline: "Apple przebija oczekiwania sprzedaży iPhone", impact: 0.04, symbol: "AAPL" },
  { headline: "Tesla recall — inwestorzy uciekają", impact: -0.06, symbol: "TSLA" },
  { headline: "NVIDIA: nowe zamówienia AI data center", impact: 0.07, symbol: "NVDA" },
  { headline: "ETF na BTC zatwierdzony — napływy kapitału", impact: 0.05, symbol: "BTC-USDT" },
  { headline: "Flash crash algorytmiczny na futures", impact: -0.12 },
  { headline: "Złoto jako safe haven po napięciach geopolitycznych", impact: 0.03, symbol: "GOLD" },
  { headline: "Ethereum upgrade — gas fees w dół", impact: 0.045, symbol: "ETH-USDT" },
  { headline: "Short squeeze na SOL", impact: 0.09, symbol: "SOL-USDT" },
  { headline: "Microsoft cloud revenue bije rekordy", impact: 0.035, symbol: "MSFT" },
  { headline: "Whale dump: 2 mld USDT na rynku spot", impact: -0.05 },
];

export function pickNews(): (typeof NEWS_HEADLINES)[number] {
  return NEWS_HEADLINES[Math.floor(Math.random() * NEWS_HEADLINES.length)]!;
}
