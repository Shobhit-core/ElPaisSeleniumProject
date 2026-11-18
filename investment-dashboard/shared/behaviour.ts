// Behavioural-mistake detection from the user's own journal. Each finding cites the evidence.

import type { RealisedLot, Transaction, ValuedHolding } from "./types.ts";

export interface BehaviourFinding {
  pattern: string;
  severity: "info" | "warning";
  evidence: string;
  why: string;
  fix: string;
}

export function analyseBehaviour(input: {
  txns: Transaction[];
  realised: RealisedLot[];
  holdings: ValuedHolding[];
  researched: Set<string>;
  maxSingleStockPct: number;
  drawdownOnDate?: (date: string) => number | null; // portfolio drawdown % (negative) on a date
}): BehaviourFinding[] {
  const out: BehaviourFinding[] = [];
  const equityClasses = new Set(["EQUITY", "EQUITY_ETF", "EQUITY_MF"]);

  const quick = input.realised.filter((r) => equityClasses.has(r.assetClass) && r.holdingDays < 90);
  if (quick.length)
    out.push({
      pattern: "Short-term trading",
      severity: "warning",
      evidence: `${quick.length} equity lot(s) sold within 90 days (${[...new Set(quick.map((q) => q.symbol))].join(", ")}).`,
      why: "Short holding periods mean 20% STCG tax, more charges and decisions driven by noise.",
      fix: "Decide the holding period before buying; sell only if the thesis breaks.",
    });

  const sells = input.realised.filter((r) => equityClasses.has(r.assetClass));
  const winnersSold = sells.filter((r) => r.gain > 0).length;
  const losersHeld = input.holdings.filter((h) => equityClasses.has(h.assetClass) && (h.returnPct ?? 0) < -15);
  if (winnersSold >= 2 && losersHeld.length && winnersSold > sells.length / 2)
    out.push({
      pattern: "Disposition effect (selling winners, holding losers)",
      severity: "warning",
      evidence: `${winnersSold} of ${sells.length} equity sales were profitable while ${losersHeld.map((h) => h.symbol).join(", ")} sit more than 15% below cost.`,
      why: "Locking in small gains and waiting for losers to 'come back' tends to shrink returns.",
      fix: "Re-check each losing holding's thesis as if buying today; hold winners while the thesis holds.",
    });

  const expensive = input.txns.filter((t) => t.type !== "DIVIDEND" && t.quantity * t.price > 0 && (t.brokerage + t.otherCharges) / (t.quantity * t.price) > 0.01);
  if (expensive.length)
    out.push({
      pattern: "High-cost small orders",
      severity: "warning",
      evidence: `${expensive.length} trade(s) where brokerage and charges exceeded 1% of the trade value.`,
      why: "A 1–2% cost on every trade is a permanent drag on compounding.",
      fix: "Use direct mutual funds for small amounts, or batch stock purchases into larger orders.",
    });

  const months = new Map<string, number>();
  for (const t of input.txns.filter((x) => x.assetClass === "EQUITY" && x.type !== "DIVIDEND")) months.set(t.date.slice(0, 7), (months.get(t.date.slice(0, 7)) ?? 0) + 1);
  const busy = [...months.entries()].filter(([, n]) => n > 4);
  if (busy.length)
    out.push({
      pattern: "Overtrading",
      severity: "warning",
      evidence: `More than 4 stock trades in ${busy.map(([m, n]) => `${m} (${n})`).join(", ")}.`,
      why: "Frequent trading usually reflects reacting to price moves rather than business changes.",
      fix: "Limit stock decisions to scheduled monthly reviews.",
    });

  const unresearched = [...new Set(input.txns.filter((t) => t.type === "BUY" && t.assetClass === "EQUITY" && !input.researched.has(t.symbol)).map((t) => t.symbol))];
  if (unresearched.length)
    out.push({
      pattern: "Buying stocks without a research note",
      severity: "warning",
      evidence: `No research note for: ${unresearched.join(", ")}.`,
      why: "Without a written thesis and invalidation conditions, it is impossible to know when to sell.",
      fix: "Complete the Stock Research note (with sources) before or right after buying.",
    });

  if (input.drawdownOnDate) {
    const panic = input.txns.filter((t) => t.type === "SELL" && equityClasses.has(t.assetClass) && (input.drawdownOnDate!(t.date) ?? 0) <= -10);
    if (panic.length)
      out.push({
        pattern: "Selling during a drawdown",
        severity: "warning",
        evidence: `${panic.length} equity sale(s) made while the portfolio was 10%+ below its peak.`,
        why: "Selling after a fall locks in losses and often misses the recovery.",
        fix: "Follow the pre-agreed rules: in falls, continue SIPs and rebalance — don't sell on fear.",
      });
  }

  const totalVal = input.holdings.reduce((s, h) => s + (h.currentValue ?? h.invested), 0);
  for (const h of input.holdings.filter((x) => x.assetClass === "EQUITY")) {
    const w = totalVal ? ((h.currentValue ?? h.invested) / totalVal) * 100 : 0;
    const lastBuy = input.txns.find((t) => t.symbol === h.symbol && t.type === "BUY");
    if (w > input.maxSingleStockPct && lastBuy)
      out.push({
        pattern: "Concentration creep",
        severity: "warning",
        evidence: `${h.symbol} is ${w.toFixed(1)}% of the portfolio and was bought again on ${lastBuy.date}.`,
        why: "Adding to a position that is already above the limit increases single-company risk.",
        fix: "Direct new money to under-weight parts of the plan.",
      });
  }
  if (!out.length && input.txns.length)
    out.push({ pattern: "No repeated mistakes detected", severity: "info", evidence: `Checked ${input.txns.length} transaction(s).`, why: "Good discipline so far.", fix: "Keep writing rationales and reviewing decisions." });
  return out;
}
