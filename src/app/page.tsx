"use client";

import { useEffect, useState } from "react";
import { TradingTerminal } from "@/components/TradingTerminal";
import type { PublicSnapshot } from "@/engine/types";

export default function Home() {
  const [initial, setInitial] = useState<PublicSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/state")
      .then(async (r) => {
        if (!r.ok) throw new Error("Nie udało się pobrać stanu giełdy");
        return r.json();
      })
      .then((snap: PublicSnapshot) => setInitial(snap))
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : "Błąd ładowania"),
      );
  }, []);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center text-[var(--red)]">
        {error}
      </div>
    );
  }

  if (!initial) {
    return (
      <div className="flex min-h-screen items-center justify-center text-[var(--muted)]">
        Uruchamianie giełdy…
      </div>
    );
  }

  return <TradingTerminal initial={initial} />;
}
