import { jeonseRatio, marketSummary, type MarketResult, type RatioResult } from "./analytics.js";
import type { Client, MonthFailure } from "./client.js";
import { InputError, type ApiErrorKind } from "./errors.js";
import type { DealView } from "./normalize.js";
import { apiErrorOfKind } from "./parse.js";
import { resolveRegion, type Region } from "./region.js";
import { SERVICES, serviceFor, type AnalyzableType, type DealKind, type PropertyType, type ServiceId } from "./services.js";
import { monthRange, monthsBack, todayKst } from "./time.js";

export interface QueryContext {
  client: Client;
  now?: () => Date;
}

export interface RegionCandidates {
  kind: "region_candidates";
  query: string;
  candidates: Region[];
  note?: string;
}

/** 서비스 하나의 실패 요약 (사용자에게 할 일을 한 번만 알리기 위해) */
export interface ServiceFailure {
  service: ServiceId;
  label: string;
  kind: ApiErrorKind;
  /** 실패한 (지역, 달) 수 / 요청한 수 */
  failed: number;
  total: number;
  months: string[];
  hint: string;
}

interface Fetched {
  region: Region;
  note?: string;
  months: string[];
  failures: MonthFailure[];
  failureSummary: ServiceFailure[];
  requests: number;
}

function summarizeFailures(failures: MonthFailure[], perService: number): ServiceFailure[] {
  const by = new Map<ServiceId, MonthFailure[]>();
  for (const f of failures) by.set(f.service, [...(by.get(f.service) ?? []), f]);
  return [...by.entries()].map(([service, list]) => {
    const first = list[0];
    const kind = first?.kind ?? "upstream";
    return {
      service,
      label: SERVICES[service].label,
      kind,
      failed: list.length,
      total: perService,
      months: [...new Set(list.map((f) => f.ym))].sort(),
      hint: apiErrorOfKind(service, kind, first?.status, first?.gatewayCode).hint,
    };
  });
}

/** 한 서비스가 모든 (지역, 달)에서 실패했으면 그 오류를 올린다. 일부만 실패하면 결과에 표시한다 */
function failWhole(summary: ServiceFailure[], failures: MonthFailure[]): void {
  const whole = summary.find((s) => s.failed === s.total);
  if (!whole) return;
  const first = failures.find((f) => f.service === whole.service);
  throw apiErrorOfKind(whole.service, whole.kind, first?.status, first?.gatewayCode);
}

export interface SearchArgs {
  propertyType: PropertyType;
  dealType: DealKind;
  region: string;
  /** 최근 개월 수 (from·to가 없을 때, 기본 3) */
  months?: number;
  from?: string;
  to?: string;
  name?: string;
  areaMin?: number;
  areaMax?: number;
  includeCancelled?: boolean;
  /** 돌려줄 최대 건수 (기본 20) */
  limit?: number;
}

export interface SearchResult extends Fetched {
  kind: "deals";
  service: ServiceId;
  /** 응답 필드를 실측으로 확인한 서비스인가 */
  verified: boolean;
  /** 조건에 맞는 전체 건수 */
  total: number;
  /** 최신순 limit건 */
  deals: DealView[];
  excludedCancelled: number;
}

export interface AnalysisArgs {
  propertyType: AnalyzableType;
  region: string;
  name?: string;
  area?: number;
  /** 최근 개월 수 (기본 12) */
  months?: number;
  includeDirect?: boolean;
}

export interface SummaryResult extends Fetched {
  kind: "market";
  propertyType: AnalyzableType;
  result: MarketResult;
}

export interface RatioArgs extends AnalysisArgs {
  /** 확인하려는 전세 보증금 (원) */
  deposit?: number;
}

export interface RatioQueryResult extends Fetched {
  kind: "ratio";
  propertyType: AnalyzableType;
  result: RatioResult;
}

/** 지역을 하나로 정한다. 여럿이면 후보를 돌려주고 조회하지 않는다 */
function pickRegion(query: string): { region: Region; note?: string } | RegionCandidates {
  const { matches, note } = resolveRegion(query);
  const only = matches.length === 1 ? matches[0] : undefined;
  if (only) return { region: only, ...(note ? { note } : {}) };
  if (matches.length === 0) throw new InputError(`지역을 찾지 못했습니다: ${query}`, "시·군·구 이름이나 '구 이름 + 법정동'으로 입력해 주세요. 예: '마포구 아현동', '수원시 영통구'");
  return { kind: "region_candidates", query, candidates: matches, ...(note ? { note } : {}) };
}

const today = (ctx: QueryContext) => todayKst((ctx.now ?? (() => new Date()))());

function monthsOf(ctx: QueryContext, months: number | undefined, def: number, from?: string, to?: string): string[] {
  if (from || to) {
    const end = to ?? today(ctx).slice(0, 7).replace("-", "");
    const list = monthRange(from ?? end, end);
    if (list.length > 24) throw new InputError("기간은 24개월까지 조회할 수 있습니다.");
    return list;
  }
  const n = months ?? def;
  if (!Number.isInteger(n) || n < 1 || n > 24) throw new InputError("months는 1~24 사이 정수여야 합니다.");
  return monthsBack(today(ctx), n);
}

const squash = (s: string) => s.replace(/\s+/g, "").toLowerCase();
const lastWord = (s: string) => s.trim().split(/\s+/).at(-1) ?? "";

export async function searchDeals(ctx: QueryContext, args: SearchArgs): Promise<SearchResult | RegionCandidates> {
  const picked = pickRegion(args.region);
  if ("kind" in picked) return picked;
  const service = serviceFor(args.propertyType, args.dealType);
  const months = monthsOf(ctx, args.months, 3, args.from, args.to);
  const fetched = await ctx.client.fetchRange({ services: [service], lawdCodes: picked.region.lawdCodes, months });

  const name = args.name ? squash(args.name) : null;
  const umd = picked.region.umd;
  const matching = fetched.deals.filter(
    (d) =>
      (!umd || lastWord(d.umd) === lastWord(umd)) &&
      (!name || squash(d.name ?? "").includes(name)) &&
      (args.areaMin === undefined || (d.area ?? -1) >= args.areaMin) &&
      (args.areaMax === undefined || (d.area ?? Infinity) <= args.areaMax),
  );
  const kept = args.includeCancelled ? matching : matching.filter((d) => !d.cancelled);
  const limit = Math.min(Math.max(args.limit ?? 20, 1), 50);
  return {
    kind: "deals",
    region: picked.region,
    ...(picked.note ? { note: picked.note } : {}),
    service,
    verified: SERVICES[service].verified,
    months: [...months].sort(),
    total: kept.length,
    deals: [...kept].sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit),
    excludedCancelled: matching.length - kept.length,
    failures: fetched.failures,
    failureSummary: summarizeFailures(fetched.failures, picked.region.lawdCodes.length * months.length),
    requests: fetched.requests,
  };
}

function analysisFilter(ctx: QueryContext, args: AnalysisArgs, region: Region) {
  const months = args.months ?? 12;
  if (!Number.isInteger(months) || months < 1 || months > 24) throw new InputError("months는 1~24 사이 정수여야 합니다.");
  if (args.area !== undefined && !(args.area > 0 && args.area < 1000)) throw new InputError("area는 전용면적(㎡)입니다. 예: 34평형 ≈ 84㎡");
  return {
    propertyType: args.propertyType,
    months,
    today: today(ctx),
    ...(region.umd ? { umd: region.umd } : {}),
    ...(args.name ? { name: args.name } : {}),
    ...(args.area !== undefined ? { area: args.area } : {}),
    ...(args.includeDirect ? { includeDirect: true } : {}),
  };
}

export async function summarize(ctx: QueryContext, args: AnalysisArgs): Promise<SummaryResult | RegionCandidates> {
  const picked = pickRegion(args.region);
  if ("kind" in picked) return picked;
  const filter = analysisFilter(ctx, args, picked.region);
  // 계약일 기준 N개월은 N+1개 달에 걸친다
  const months = monthsBack(filter.today, filter.months + 1);
  const fetched = await ctx.client.fetchRange({ services: [serviceFor(args.propertyType, "sale")], lawdCodes: picked.region.lawdCodes, months });
  return {
    kind: "market",
    propertyType: args.propertyType,
    region: picked.region,
    ...(picked.note ? { note: picked.note } : {}),
    months: [...months].sort(),
    result: marketSummary(fetched.deals, filter),
    failures: fetched.failures,
    failureSummary: summarizeFailures(fetched.failures, picked.region.lawdCodes.length * months.length),
    requests: fetched.requests,
  };
}

export async function ratio(ctx: QueryContext, args: RatioArgs): Promise<RatioQueryResult | RegionCandidates> {
  const picked = pickRegion(args.region);
  if ("kind" in picked) return picked;
  const filter = analysisFilter(ctx, args, picked.region);
  if (args.deposit !== undefined && !(args.deposit > 0)) throw new InputError("deposit은 원 단위 양수입니다. 예: 4억 = 400000000");
  const months = monthsBack(filter.today, filter.months + 1);
  const sale = serviceFor(args.propertyType, "sale");
  const rent = serviceFor(args.propertyType, "rent");
  const fetched = await ctx.client.fetchRange({ services: [sale, rent], lawdCodes: picked.region.lawdCodes, months });
  const failureSummary = summarizeFailures(fetched.failures, picked.region.lawdCodes.length * months.length);
  // 매매나 전월세 한쪽을 통째로 못 받으면 "표본 부족"이 아니라 그 서비스의 문제(대개 미신청)다
  failWhole(failureSummary, fetched.failures);
  const sales = fetched.deals.filter((d) => d.service === sale);
  const rents = fetched.deals.filter((d) => d.service === rent);
  return {
    kind: "ratio",
    propertyType: args.propertyType,
    region: picked.region,
    ...(picked.note ? { note: picked.note } : {}),
    months: [...months].sort(),
    result: jeonseRatio(sales, rents, { ...filter, ...(args.deposit !== undefined ? { deposit: args.deposit } : {}) }),
    failures: fetched.failures,
    failureSummary,
    requests: fetched.requests,
  };
}
