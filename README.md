# Jonkisz — giełda offline

Lokalna symulacja giełdy perpetual: instrumenty (krypto + akcje), konta, long/short z dźwignią, order book, boty i programowane scenariusze rynku.

## Start

```bash
npm install
npm run dev
```

Otwórz [http://localhost:3000](http://localhost:3000).

## Co jest w środku

- Silnik w `src/engine/` — matching, margin, PnL, likwidacja, tick zegara
- TP/SL, trailing stop, alerty cenowe, funding, news flash, boty MM/noise
- Stan w `data/state.json` (bez zewnętrznej bazy)
- Scenariusze: `randomWalk`, `trend`, `crash`, `meanRevert`
- Dashboard: wykres 1m/5m/15m, depth chart, książka, ticket, zlecenia, ranking, equity, feed

### Hotkeys

| Klawisz | Akcja |
|---------|--------|
| `B` | Market long |
| `S` | Market short |
| `Space` | Pauza / start |
| `N` | Losowy news |

## API

| Endpoint | Opis |
|----------|------|
| `GET /api/state` | Snapshot |
| `GET /api/stream` | SSE ticków |
| `POST /api/orders` | Zlecenie market/limit (+ opcjonalne TP/SL) |
| `DELETE /api/orders` | Anulowanie (`{ orderId }`) |
| `POST /api/positions/close` | Zamknięcie pozycji (pełne lub `size`) |
| `POST /api/positions/tpsl` | Ustaw TP/SL/trailing na pozycji |
| `POST /api/alerts` | Twórz / usuń alert cenowy |
| `POST /api/news` | Wymuś news flash |
| `POST /api/clock` | `running`, `speed`, `botsEnabled` |
| `POST /api/market/scenario` | Scenariusz + parametry |
| `POST /api/accounts` | Nowe konto / depozyt |
| `POST /api/reset` | Seed od zera |
