import type { Account, AccountView, Position } from "./types";
import { unrealizedPnl } from "./math";

export function findAccount(accounts: Account[], id: string): Account | undefined {
  return accounts.find((a) => a.id === id);
}

/** Wallet minus locked margin. lockMargin no longer subtracts from balance. */
export function availableBalance(account: Account): number {
  return account.balance - account.lockedMargin;
}

export function accountEquity(
  account: Account,
  positions: Position[],
  marks: Record<string, number>,
): number {
  let upnl = 0;
  for (const p of positions) {
    if (p.accountId !== account.id) continue;
    const mark = marks[p.symbol] ?? p.entryPrice;
    upnl += unrealizedPnl(p.side, p.size, p.entryPrice, mark);
  }
  return account.balance + upnl;
}

export function toAccountView(
  account: Account,
  positions: Position[],
  marks: Record<string, number>,
): AccountView {
  const equity = accountEquity(account, positions, marks);
  return {
    ...account,
    equity,
    available: availableBalance(account),
  };
}

export function lockMargin(account: Account, amount: number): void {
  if (amount <= 0) return;
  if (availableBalance(account) + 1e-9 < amount) {
    throw new Error("Niewystarczające środki na depozyt");
  }
  account.lockedMargin += amount;
}

export function unlockMargin(account: Account, amount: number): void {
  if (amount <= 0) return;
  account.lockedMargin = Math.max(0, account.lockedMargin - amount);
}

export function applyRealized(account: Account, pnl: number, releaseMargin: number): void {
  unlockMargin(account, releaseMargin);
  account.balance += pnl;
  account.realizedPnl += pnl;
}
