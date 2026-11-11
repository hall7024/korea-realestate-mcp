import { describe, expect, it } from "vitest";
import { filterDeals, jeonseRatio, marketSummary, median, quantile } from "../src/core/analytics.js";
import type { DealView } from "../src/core/normalize.js";

const TODAY = "2026-11-11";

function sale(p: Partial<DealView> & { date: string; price: number }): DealView {
  return {
    service: "apt-sale",
    kind: "sale",
    lawdCode: "11440",
    umd: "아현동",
    jibun: "100",
    name: "래미안푸르지오",
    area: 84.9,
    areaKind: "exclusive",
    floor: 10,
    buildYear: 2014,
    deposit: null,
    monthlyRent: null,
    contractType: null,
    direct: false,
    cancelled: false,
    houseType: null,
    complexId: null,
    ...p,
  };
}

function rent(p: Partial<DealView> & { date: string; deposit: number }): DealView {
  return sale({ ...p, service: "apt-rent", kind: "rent", price: null as unknown as number, monthlyRent: p.monthlyRent ?? 0 });
}

/** 2025-12 ~ 2026-11 (매달 5일), 달마다 한 건씩 가격이 오른다 */
const yearOfSales = Array.from({ length: 12 }, (_, i) => {
  const m = ((11 + i) % 12) + 1;
  const y = m === 12 ? 2025 : 2026;
  return sale({ date: `${y}-${String(m).padStart(2, "0")}-05`, price: (150_000 + i * 1_000) * 10_000 });
});

describe("통계", () => {
  it("중앙값·사분위", () => {
    expect(median([1, 3, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(3);
    expect(quantile([1, 2, 3, 4, 5], 0.25)).toBe(2);
    expect(quantile([10, 20], 0.5)).toBe(15);
  });
});

describe("filterDeals", () => {
  it("기간·해제·직거래·면적", () => {
    const deals = [
      sale({ date: "2025-11-11", price: 1 }), // 12개월 경계 밖
      sale({ date: "2025-11-12", price: 2 }),
      sale({ date: "2026-05-01", price: 3, cancelled: true }),
      sale({ date: "2026-05-01", price: 4, direct: true }),
      sale({ date: "2026-05-01", price: 5, area: 75 }),
    ];
    const r = filterDeals(deals, { propertyType: "apt", months: 12, today: TODAY, area: 84 });
    expect(r.deals.map((d) => d.price)).toEqual([2]);
    expect(r.excluded).toEqual({ cancelled: 1, direct: 1 });
  });

  it("단지 지정이면 면적 ±3%", () => {
    const deals = [sale({ date: "2026-05-01", price: 1, area: 81.4 }), sale({ date: "2026-05-01", price: 2, area: 82 }), sale({ date: "2026-05-01", price: 3, area: 86.5 })];
    const r = filterDeals(deals, { propertyType: "apt", months: 12, today: TODAY, area: 84, name: "래미안" });
    expect(r.deals.map((d) => d.price)).toEqual([2, 3]);
  });

  it("법정동은 마지막 말로 맞춘다", () => {
    const deals = [sale({ date: "2026-05-01", price: 1, umd: "조치원읍 죽림리" }), sale({ date: "2026-05-01", price: 2, umd: "서창리" })];
    expect(filterDeals(deals, { propertyType: "rh", months: 12, today: TODAY, umd: "죽림리" }).deals.map((d) => d.price)).toEqual([1]);
  });
});

describe("marketSummary", () => {
  it("단지 하나: 중앙값·범위·월별 추이", () => {
    const r = marketSummary(yearOfSales, { propertyType: "apt", months: 12, today: TODAY, name: "래미안", area: 84 });
    if (r.kind !== "summary") throw new Error(r.kind);
    expect(r.scope).toBe("complex");
    expect(r.complex).toMatchObject({ name: "래미안푸르지오", jibun: "100" });
    expect(r.count).toBe(12);
    expect(r.min).toBe(1_500_000_000);
    expect(r.max).toBe(1_610_000_000);
    expect(r.median).toBe(1_555_000_000);
    expect(r.monthly).toHaveLength(13);
    expect(r.monthly.every((m) => m.median === null)).toBe(true); // 달마다 1건 < 3
    expect(r.monthly.filter((m) => m.partial).map((m) => m.ym)).toEqual(["202610", "202611"]);
    expect(r.monthly.filter((m) => m.clipped).map((m) => m.ym)).toEqual(["202511"]);
    expect(r.recent[0]!.date).toBe("2026-11-05");
    expect(r.recent).toHaveLength(5);
  });

  it("달 표본이 3건 이상이면 중앙값", () => {
    const deals = [1, 2, 3].map((k) => sale({ date: "2026-06-10", price: k * 100_000_000 }));
    const r = marketSummary(deals, { propertyType: "apt", months: 12, today: TODAY });
    if (r.kind !== "summary") throw new Error(r.kind);
    expect(r.monthly.find((m) => m.ym === "202606")).toMatchObject({ count: 3, median: 200_000_000, partial: false });
  });

  it("이름이 여러 단지에 맞으면 후보", () => {
    const deals = [sale({ date: "2026-05-01", price: 1 }), sale({ date: "2026-05-01", price: 2, name: "래미안푸르지오2차", jibun: "200" })];
    const r = marketSummary(deals, { propertyType: "apt", months: 12, today: TODAY, name: "래미안" });
    expect(r.kind).toBe("complex_candidates");
    if (r.kind === "complex_candidates") expect(r.candidates).toHaveLength(2);
  });

  it("이름이 정확히 같은 단지가 하나면 그것을 고른다", () => {
    const deals = [sale({ date: "2026-05-01", price: 1 }), sale({ date: "2026-05-01", price: 2, name: "래미안푸르지오2차", jibun: "200" })];
    const r = marketSummary(deals, { propertyType: "apt", months: 12, today: TODAY, name: "래미안 푸르지오" });
    expect(r.kind).toBe("summary");
  });

  it("거래가 없으면 empty", () => {
    expect(marketSummary([], { propertyType: "apt", months: 12, today: TODAY }).kind).toBe("empty");
  });
});

describe("jeonseRatio", () => {
  const rents = Array.from({ length: 12 }, (_, i) => rent({ date: `2026-${String((i % 10) + 1).padStart(2, "0")}-05`, deposit: 90_000 * 10_000 }));

  it("전세가율과 입력 보증금 비율", () => {
    const r = jeonseRatio(yearOfSales, rents, { propertyType: "apt", months: 12, today: TODAY, name: "래미안푸르지오", area: 84.9, deposit: 1_000_000_000 });
    if (r.kind !== "ratio") throw new Error(r.kind);
    expect(r.saleCount).toBe(12);
    expect(r.rentCount).toBe(12);
    expect(r.ratioPercent).toBeCloseTo((900_000_000 / 1_555_000_000) * 100, 1);
    expect(r.confidence).toBe("높음");
    expect(r.deposit?.estimatedPrice).toBe(1_555_000_000);
    expect(r.deposit?.depositRatioPercent).toBeCloseTo((1_000_000_000 / 1_555_000_000) * 100, 1);
  });

  it("월세와 갱신 계약은 전세 표본에서 뺀다", () => {
    const mixed = [...rents.slice(0, 4), rent({ date: "2026-05-01", deposit: 1, monthlyRent: 500_000 }), rent({ date: "2026-05-01", deposit: 1, contractType: "갱신" })];
    const r = jeonseRatio(yearOfSales, mixed, { propertyType: "apt", months: 12, today: TODAY });
    expect(r).toMatchObject({ kind: "insufficient", rentCount: 4 });
  });

  it("법정동 범위는 최대 보통", () => {
    const r = jeonseRatio(yearOfSales, rents, { propertyType: "apt", months: 12, today: TODAY, umd: "아현동" });
    if (r.kind !== "ratio") throw new Error(r.kind);
    expect(r.scope).toBe("area");
    expect(r.confidence).toBe("보통");
  });

  it("면적이 없으면 보증금 비율은 계산하지 않는다", () => {
    const r = jeonseRatio(yearOfSales, rents, { propertyType: "apt", months: 12, today: TODAY, deposit: 500_000_000 });
    if (r.kind !== "ratio") throw new Error(r.kind);
    expect(r.deposit).toBeUndefined();
    expect(r.criteria.join(" ")).toContain("area");
  });
});
