import { describe, expect, it } from "vitest";
import { projectRange, type Bucket } from "../shared/projection.ts";
import { futureValue } from "../shared/allocation.ts";
import { bucketOf } from "../server/services/family.ts";

const z = (): Record<Bucket, number> => ({ growth: 0, steady: 0, safe: 0, gold: 0 });

describe("Range projection", () => {
  it("with zero volatility equals the closed-form future value", () => {
    const flat = { growth: { label: "", annualReturnPct: 10, annualVolPct: 0, why: "" }, steady: { label: "", annualReturnPct: 10, annualVolPct: 0, why: "" }, safe: { label: "", annualReturnPct: 10, annualVolPct: 0, why: "" }, gold: { label: "", annualReturnPct: 10, annualVolPct: 0, why: "" } };
    const pts = projectRange({ start: { ...z(), growth: 30000 }, monthly: { ...z(), growth: 10000 }, months: 24, assumptions: flat, paths: 10 });
    // futureValue adds the monthly amount at the start of each month; projectRange at the end → compare without SIP first
    const lump = projectRange({ start: { ...z(), growth: 30000 }, monthly: z(), months: 24, assumptions: flat, paths: 10 });
    expect(lump[24].p50).toBeCloseTo(futureValue(30000, 0, 10, 2), 0);
    expect(pts[24].p10).toBe(pts[24].p90);
    expect(pts[24].contributed).toBe(30000 + 24 * 10000);
  });
  it("is deterministic for a seed, ordered, and widens over time", () => {
    const input = { start: { growth: 15000, steady: 4800, safe: 10200, gold: 0 }, monthly: { growth: 5000, steady: 4000, safe: 0, gold: 1000 }, months: 60 };
    const a = projectRange(input);
    const b = projectRange(input);
    expect(a).toEqual(b);
    for (const p of a) {
      expect(p.p10).toBeLessThanOrEqual(p.p50);
      expect(p.p50).toBeLessThanOrEqual(p.p90);
    }
    const spread = (m: number) => (a[m].p90 - a[m].p10) / a[m].p50;
    expect(spread(60)).toBeGreaterThan(spread(6));
    expect(a[0].p50).toBe(30000);
    // a balanced 50%-equity plan should rarely be below money put in after 5 years, but can be after 6 months
    expect(a[6].chanceBelowContributed).toBeGreaterThan(a[60].chanceBelowContributed);
  });
  it("shows that an all-safe portfolio has a narrow range", () => {
    const p = projectRange({ start: { ...z(), safe: 30000 }, monthly: z(), months: 12 });
    expect((p[12].p90 - p[12].p10) / p[12].p50).toBeLessThan(0.02);
    expect(p[12].p50).toBeGreaterThan(31500);
    expect(p[12].p50).toBeLessThan(32200);
  });
});

describe("Money put in", () => {
  it("counts what was actually put in, not today's value", () => {
    const p = projectRange({ start: { growth: 0, steady: 0, safe: 29971, gold: 0 }, monthly: { growth: 10000, steady: 0, safe: 0, gold: 0 }, months: 6, contributedBase: 30000 });
    expect(p[6].contributed).toBe(90000);
    expect(p[0].contributed).toBe(30000);
  });
});

describe("Plain-language buckets", () => {
  it("maps funds to growth / steady / safe / gold", () => {
    expect(bucketOf({ assetClass: "EQUITY_MF", name: "UTI Nifty 50 Index Fund" })).toBe("growth");
    expect(bucketOf({ assetClass: "DEBT_MF", name: "Axis Liquid Fund - Direct" })).toBe("safe");
    expect(bucketOf({ assetClass: "DEBT_MF", name: "DSP Short Term Fund" })).toBe("steady");
    expect(bucketOf({ assetClass: "GOLD_ETF", name: "UTI Gold ETF FoF" })).toBe("gold");
  });
});
