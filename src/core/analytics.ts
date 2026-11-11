import type { DealView } from "./normalize.js";
import type { AnalyzableType } from "./services.js";
import { addMonths, monthsBack } from "./time.js";

export interface AnalysisFilter {
  propertyType: AnalyzableType;
  /** 계약일 기준 최근 개월 수 */
  months: number;
  /** 기준일 YYYY-MM-DD (KST) */
  today: string;
  /** 법정동 ("아현동", "조치원읍 죽림리") */
  umd?: string;
  /** 단지·건물 이름 (공백 무시 부분 일치) */
  name?: string;
  /** 전용면적 ㎡ */
  area?: number;
  includeDirect?: boolean;
}

export interface Complex {
  name: string;
  umd: string;
  jibun: string | null;
  count: number;
}

export interface Excluded {
  cancelled: number;
  direct: number;
}

export interface MonthPoint {
  ym: string;
  count: number;
  /** 표본이 3건 미만이면 null */
  median: number | null;
  /** 신고 기한(30일) 안이라 건수가 덜 잡혔을 수 있는 달 */
  partial: boolean;
  /** 기간 시작일 이후 거래만 들어간 첫 달 */
  clipped: boolean;
}

export interface MarketSummary {
  kind: "summary";
  scope: "complex" | "area";
  complex?: Complex;
  count: number;
  median: number;
  min: number;
  max: number;
  q1: number;
  q3: number;
  medianPerM2: number;
  latestDate: string;
  monthly: MonthPoint[];
  recent: DealView[];
  excluded: Excluded;
  criteria: string[];
}

export interface ComplexCandidates {
  kind: "complex_candidates";
  candidates: Complex[];
}

export interface Empty {
  kind: "empty";
  excluded: Excluded;
  criteria: string[];
}

export type MarketResult = MarketSummary | ComplexCandidates | Empty;

export interface JeonseRatio {
  kind: "ratio";
  scope: "complex" | "area";
  complex?: Complex;
  /** ㎡당 전세 중앙값 ÷ ㎡당 매매 중앙값 (%) */
  ratioPercent: number;
  salePerM2: number;
  jeonsePerM2: number;
  salePerM2Iqr: [number, number];
  jeonsePerM2Iqr: [number, number];
  saleCount: number;
  rentCount: number;
  confidence: "높음" | "보통";
  deposit?: { amount: number; estimatedPrice: number; depositRatioPercent: number };
  excluded: Excluded;
  criteria: string[];
}

export interface Insufficient {
  kind: "insufficient";
  saleCount: number;
  rentCount: number;
  reason: string;
  criteria: string[];
}

export type RatioResult = JeonseRatio | ComplexCandidates | Insufficient;

/** 월 중앙값을 내는 최소 표본 */
const MONTH_MIN = 3;
/** 전세가율을 내는 최소 표본 (매매·전세 각각) */
const RATIO_MIN = 5;
const HIGH = { min: 10, recentMonths: 6, recentMin: 3 };

const sorted = (xs: number[]) => [...xs].sort((a, b) => a - b);

/** 선형 보간 분위수 */
export function quantile(xs: number[], q: number): number {
  const s = sorted(xs);
  if (!s.length) return NaN;
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const a = s[lo] ?? 0;
  const b = s[hi] ?? a;
  return a + (b - a) * (pos - lo);
}

export const median = (xs: number[]) => Math.round(quantile(xs, 0.5));

const squash = (s: string) => s.replace(/\s+/g, "").toLowerCase();
const lastWord = (s: string) => s.trim().split(/\s+/).at(-1) ?? "";
const complexKey = (d: DealView) => `${lastWord(d.umd)}|${d.jibun ?? ""}|${squash(d.name ?? "")}`;

function tolerance(f: AnalysisFilter): number {
  if (f.name) return 0.03;
  return f.propertyType === "apt" ? 0.1 : 0.15;
}

/** 기간·법정동·이름 (면적·해제·직거래 전) */
function baseFilter(deals: DealView[], f: AnalysisFilter): DealView[] {
  const since = addMonths(f.today, -f.months);
  const name = f.name ? squash(f.name) : null;
  return deals.filter(
    (d) =>
      d.date > since &&
      d.date <= f.today &&
      (!f.umd || lastWord(d.umd) === lastWord(f.umd)) &&
      (!name || squash(d.name ?? "").includes(name)),
  );
}

/** 면적·해제·직거래를 거른다. 뺀 건수를 센다 */
function finalFilter(deals: DealView[], f: AnalysisFilter): { deals: DealView[]; excluded: Excluded } {
  const excluded: Excluded = { cancelled: 0, direct: 0 };
  const tol = tolerance(f);
  const out = deals.filter((d) => {
    if (f.area !== undefined && (d.area === null || Math.abs(d.area - f.area) > f.area * tol)) return false;
    if (d.cancelled) {
      excluded.cancelled++;
      return false;
    }
    if (d.direct && !f.includeDirect) {
      excluded.direct++;
      return false;
    }
    return true;
  });
  return { deals: out, excluded };
}

export function filterDeals(deals: DealView[], f: AnalysisFilter): { deals: DealView[]; excluded: Excluded } {
  return finalFilter(baseFilter(deals, f), f);
}

export function groupComplexes(deals: DealView[]): Complex[] {
  const groups = new Map<string, Complex>();
  for (const d of deals) {
    const key = complexKey(d);
    const g = groups.get(key);
    if (g) g.count++;
    else groups.set(key, { name: d.name ?? "", umd: d.umd, jibun: d.jibun, count: 1 });
  }
  return [...groups.values()].sort((a, b) => b.count - a.count);
}

/** 이름을 지정했을 때 단지 하나로 좁힌다. 여럿이면 후보 */
function pickComplex(deals: DealView[], f: AnalysisFilter): { deals: DealView[]; complex?: Complex } | ComplexCandidates {
  if (!f.name) return { deals };
  const groups = groupComplexes(deals);
  if (groups.length <= 1) return { deals, ...(groups[0] ? { complex: groups[0] } : {}) };
  const query = squash(f.name);
  const exact = groups.filter((g) => squash(g.name) === query);
  if (exact.length === 1 && exact[0]) {
    const key = `${lastWord(exact[0].umd)}|${exact[0].jibun ?? ""}|${squash(exact[0].name)}`;
    return { deals: deals.filter((d) => complexKey(d) === key), complex: exact[0] };
  }
  return { kind: "complex_candidates", candidates: groups };
}

function criteriaOf(f: AnalysisFilter, excluded: Excluded): string[] {
  const c = [`계약일 기준 최근 ${f.months}개월 (${addMonths(f.today, -f.months)} 초과 ~ ${f.today})`];
  if (f.area !== undefined) c.push(`전용면적 ${f.area}㎡ ±${Math.round(tolerance(f) * 100)}%`);
  c.push(`해제 거래 제외${excluded.cancelled ? ` (${excluded.cancelled}건)` : ""}`);
  c.push(f.includeDirect ? "직거래 포함" : `직거래 제외${excluded.direct ? ` (${excluded.direct}건)` : ""}`);
  return c;
}

const perM2 = (amount: number | null, area: number | null) => (amount !== null && area ? amount / area : null);
const nums = (xs: (number | null)[]) => xs.filter((x): x is number => x !== null && Number.isFinite(x));

export function marketSummary(deals: DealView[], f: AnalysisFilter): MarketResult {
  const sales = deals.filter((d) => d.kind === "sale" && d.price !== null);
  const picked = pickComplex(baseFilter(sales, f), f);
  if ("kind" in picked) return picked;
  const { deals: kept, excluded } = finalFilter(picked.deals, f);
  const criteria = criteriaOf(f, excluded);
  if (!kept.length) return { kind: "empty", excluded, criteria };

  const prices = nums(kept.map((d) => d.price));
  const recentFrom = monthsBack(f.today, 2).at(-1) ?? "";
  const since = addMonths(f.today, -f.months);
  const sinceYm = since.slice(0, 7).replace("-", "");
  const monthly = monthsBack(f.today, f.months + 1)
    .reverse()
    .map((ym) => {
      const inMonth = nums(kept.filter((d) => d.date.slice(0, 7).replace("-", "") === ym).map((d) => d.price));
      return { ym, count: inMonth.length, median: inMonth.length >= MONTH_MIN ? median(inMonth) : null, partial: ym >= recentFrom, clipped: ym === sinceYm && !since.endsWith("-01") };
    });
  return {
    kind: "summary",
    scope: f.name ? "complex" : "area",
    ...(picked.complex ? { complex: picked.complex } : {}),
    count: kept.length,
    median: median(prices),
    min: Math.min(...prices),
    max: Math.max(...prices),
    q1: Math.round(quantile(prices, 0.25)),
    q3: Math.round(quantile(prices, 0.75)),
    medianPerM2: median(nums(kept.map((d) => perM2(d.price, d.area)))),
    latestDate: kept.map((d) => d.date).sort().at(-1) ?? "",
    monthly,
    recent: [...kept].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5),
    excluded,
    criteria,
  };
}

/** 전세: 월세 0, 갱신 계약이 아님 (계약 구분이 비어 있으면 포함) */
const isJeonse = (d: DealView) => d.kind === "rent" && d.monthlyRent === 0 && d.contractType !== "갱신" && (d.deposit ?? 0) > 0;

export function jeonseRatio(sales: DealView[], rents: DealView[], f: AnalysisFilter & { deposit?: number }): RatioResult {
  const saleBase = baseFilter(
    sales.filter((d) => d.kind === "sale" && d.price !== null),
    f,
  );
  const picked = pickComplex(saleBase, f);
  if ("kind" in picked) return picked;
  const { deals: keptSales, excluded } = finalFilter(picked.deals, f);
  // 전세는 매매에서 고른 단지와 법정동·이름이 같은 것
  const rentBase = baseFilter(rents.filter(isJeonse), f).filter(
    (d) => !picked.complex || (lastWord(d.umd) === lastWord(picked.complex.umd) && squash(d.name ?? "") === squash(picked.complex.name)),
  );
  const { deals: keptRents } = finalFilter(rentBase, { ...f, includeDirect: true });
  const criteria = [...criteriaOf(f, excluded), "전세: 월세 0원, 갱신 계약 제외(계약 구분이 빈 계약은 포함)", `전세가율 = ㎡당 전세 보증금 중앙값 ÷ ㎡당 매매가 중앙값`];

  const saleM2 = nums(keptSales.map((d) => perM2(d.price, d.area)));
  const rentM2 = nums(keptRents.map((d) => perM2(d.deposit, d.area)));
  if (saleM2.length < RATIO_MIN || rentM2.length < RATIO_MIN) {
    return {
      kind: "insufficient",
      saleCount: saleM2.length,
      rentCount: rentM2.length,
      reason: `표본이 부족합니다 (매매 ${saleM2.length}건, 전세 ${rentM2.length}건, 각각 ${RATIO_MIN}건 이상 필요).`,
      criteria,
    };
  }

  const salePerM2 = median(saleM2);
  const jeonsePerM2 = median(rentM2);
  const scope = f.name ? "complex" : "area";
  const recentSince = addMonths(f.today, -HIGH.recentMonths);
  const recentCount = (xs: DealView[]) => xs.filter((d) => d.date > recentSince).length;
  const high =
    scope === "complex" &&
    saleM2.length >= HIGH.min &&
    rentM2.length >= HIGH.min &&
    recentCount(keptSales) >= HIGH.recentMin &&
    recentCount(keptRents) >= HIGH.recentMin;
  criteria.push(`신뢰도 높음: 단지 지정, 매매·전세 각 ${HIGH.min}건 이상, 최근 ${HIGH.recentMonths}개월에 각 ${HIGH.recentMin}건 이상. 그 밖은 보통`);

  let deposit: JeonseRatio["deposit"];
  if (f.deposit !== undefined) {
    if (f.area !== undefined) {
      const estimatedPrice = Math.round((salePerM2 * f.area) / 10_000) * 10_000;
      deposit = { amount: f.deposit, estimatedPrice, depositRatioPercent: Math.round((f.deposit / estimatedPrice) * 1000) / 10 };
      criteria.push("추정 매매가 = ㎡당 매매가 중앙값 × 입력 면적");
    } else {
      criteria.push("area(전용면적)가 없어 입력 보증금 비율은 계산하지 않았습니다");
    }
  }

  return {
    kind: "ratio",
    scope,
    ...(picked.complex ? { complex: picked.complex } : {}),
    ratioPercent: Math.round((jeonsePerM2 / salePerM2) * 1000) / 10,
    salePerM2,
    jeonsePerM2,
    salePerM2Iqr: [Math.round(quantile(saleM2, 0.25)), Math.round(quantile(saleM2, 0.75))],
    jeonsePerM2Iqr: [Math.round(quantile(rentM2, 0.25)), Math.round(quantile(rentM2, 0.75))],
    saleCount: saleM2.length,
    rentCount: rentM2.length,
    confidence: high ? "높음" : "보통",
    ...(deposit ? { deposit } : {}),
    excluded,
    criteria,
  };
}
