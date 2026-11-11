import { MemoryCache, type CacheStore } from "./cache.js";
import { ApiError, BudgetError, InputError, type ApiErrorKind } from "./errors.js";
import { KEY_ENV, normalizeServiceKey, readServiceKey, registerSecret } from "./key.js";
import { log } from "./log.js";
import { stripRaw, toDeal, type Deal, type DealView } from "./normalize.js";
import { apiErrorFrom, apiErrorOfKind, parseResponse, type RawItem } from "./parse.js";
import { serviceUrl, type ServiceId } from "./services.js";
import { addMonths, isValidYm, todayKst } from "./time.js";

/** 한 번의 조회(도구 호출 1회)가 쓸 수 있는 API 호출 수. 개발계정은 하루 10,000건 */
export const MAX_REQUESTS = 80;
const PAGE_SIZE = 9999;
/** 서버가 조용히 쪽 크기를 줄여도 무한히 돌지 않게 */
const MAX_PAGES = 50;
const DAY_MS = 86_400_000;

export interface ClientOptions {
  /** 없으면 환경변수 DATA_GO_KR_SERVICE_KEY. null이면 키 없음 */
  serviceKey?: string | null;
  fetch?: typeof fetch;
  cache?: CacheStore;
  now?: () => Date;
  /** 동시 요청 수 (기본 4) */
  concurrency?: number;
  /** 재시도 간격 (기본 500·1000·2000ms + 지터) */
  retryDelaysMs?: number[];
  timeoutMs?: number;
  maxBodyBytes?: number;
  /** 조회 가능한 시군구 코드인가 (기본: 5자리 숫자). 지역 코드표로 바꿔 끼운다 */
  isQueryableLawd?: (code: string) => boolean;
}

export interface RangeRequest {
  services: ServiceId[];
  lawdCodes: string[];
  /** YYYYMM */
  months: string[];
}

export interface MonthFailure {
  service: ServiceId;
  lawdCode: string;
  ym: string;
  kind: ApiErrorKind;
}

export interface RangeResult {
  deals: DealView[];
  failures: MonthFailure[];
  /** 실제로 보낸 API 요청 수 (캐시 적중 제외) */
  requests: number;
}

export type ProbeResult = { ok: true } | { ok: false; kind: ApiErrorKind; message: string; hint: string };

export interface Client {
  readonly hasKey: boolean;
  fetchMonth(service: ServiceId, lawdCode: string, ym: string): Promise<DealView[]>;
  fetchMonth(service: ServiceId, lawdCode: string, ym: string, opts: { raw: true }): Promise<Deal[]>;
  fetchRange(req: RangeRequest): Promise<RangeResult>;
  /** 서비스 하나를 1건만 요청해 활용신청 상태를 본다 (doctor) */
  probe(service: ServiceId): Promise<ProbeResult>;
}

export function estimateRequests(req: RangeRequest): number {
  return req.services.length * req.lawdCodes.length * req.months.length;
}

/** 동시 실행 수 제한 */
function limiter(max: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (active >= max) await new Promise<void>((resolve) => queue.push(resolve));
    active++;
    try {
      return await task();
    } finally {
      active--;
      queue.shift()?.();
    }
  };
}

const sleep = (ms: number) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

/** 본문을 읽되 maxBytes를 넘으면 중단한다 */
async function readLimited(res: Response, maxBytes: number): Promise<string | null> {
  const declared = Number(res.headers.get("content-length"));
  if (declared > maxBytes) return null;
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

interface Page {
  items: RawItem[];
  totalCount: number;
}

export function createClient(opts: ClientOptions = {}): Client {
  const key = opts.serviceKey === undefined ? readServiceKey() : opts.serviceKey === null ? null : normalizeServiceKey(opts.serviceKey);
  if (key) registerSecret(key);
  const doFetch = opts.fetch ?? fetch;
  const cache = opts.cache ?? new MemoryCache();
  const now = opts.now ?? (() => new Date());
  const run = limiter(opts.concurrency ?? 4);
  const delays = opts.retryDelaysMs ?? [500, 1000, 2000];
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const maxBodyBytes = opts.maxBodyBytes ?? 16 * 1024 * 1024;
  const isQueryableLawd = opts.isQueryableLawd ?? ((code: string) => /^\d{5}$/.test(code));
  /** 같은 키로 한 번이라도 성공했는가. 403/30을 "미신청"으로 좁히는 데 쓴다 */
  let keyWorks = false;

  function requireKey(): string {
    if (!key) throw new ApiError("no_key", "공공데이터포털 인증키가 설정되지 않았습니다.", `환경변수 ${KEY_ENV}에 일반 인증키(Encoding·Decoding 어느 쪽이든)를 넣어 주세요.`);
    return key;
  }

  function validate(lawdCode: string, ym: string): void {
    if (!isQueryableLawd(lawdCode)) throw new InputError(`조회할 수 없는 시군구 코드입니다: ${lawdCode}`, "resolve_region으로 지역을 먼저 확인하세요.");
    const today = todayKst(now());
    if (!isValidYm(ym, today)) throw new InputError(`조회할 수 없는 계약년월입니다: ${ym}`, `YYYYMM 형식으로 200601부터 ${today.slice(0, 7).replace("-", "")}까지 가능합니다.`);
  }

  async function fetchPage(service: ServiceId, lawdCode: string, ym: string, pageNo: number, rows: number): Promise<Page> {
    const params = new URLSearchParams({ serviceKey: requireKey(), LAWD_CD: lawdCode, DEAL_YMD: ym, pageNo: String(pageNo), numOfRows: String(rows) });
    const url = `${serviceUrl(service)}?${params.toString()}`;
    const where = { service, lawd: lawdCode, ym, page: pageNo };

    for (let attempt = 0; ; attempt++) {
      const canRetry = attempt < delays.length;
      let res: Response;
      try {
        res = await run(() => doFetch(url, { redirect: "error", signal: AbortSignal.timeout(timeoutMs), headers: { accept: "application/xml" } }));
      } catch (error) {
        // 원본 예외는 URL(키 포함)을 담을 수 있어 버리고 종류만 남긴다
        const kind: ApiErrorKind = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError") ? "timeout" : "network";
        log("warn", { ...where, error: kind, attempt });
        if (canRetry) {
          await sleep(delays[attempt] ?? 0);
          continue;
        }
        throw apiErrorOfKind(service, kind);
      }

      const body = await readLimited(res, maxBodyBytes);
      if (body === null) throw apiErrorOfKind(service, "too_large", res.status);
      const parsed = parseResponse(body);
      log("debug", { ...where, status: res.status, code: parsed.ok ? "000" : parsed.code });
      if (parsed.ok && res.ok) {
        keyWorks = true;
        return { items: parsed.items, totalCount: parsed.totalCount };
      }

      const code = parsed.ok || parsed.code === "parse" ? undefined : parsed.code;
      const retryable = res.status === 429 || res.status >= 500 || code === "23";
      if (retryable && canRetry) {
        log("warn", { ...where, status: res.status, code: code ?? "-", attempt });
        await sleep((delays[attempt] ?? 0) * (1 + Math.random() * 0.2));
        continue;
      }
      throw apiErrorFrom(service, res.status, code, { keyWorks });
    }
  }

  async function fetchMonth(service: ServiceId, lawdCode: string, ym: string, fetchOpts: { raw?: boolean } = {}): Promise<Deal[] | DealView[]> {
    validate(lawdCode, ym);
    requireKey();
    const cacheKey = `${service}:${lawdCode}:${ym}`;
    const nowMs = now().getTime();
    const today = todayKst(now());
    // 실거래 신고 기한이 30일이라 이번 달·지난달은 계속 바뀐다
    const recent = ym >= addMonths(today, -1).slice(0, 7).replace("-", "");
    const maxAge = recent ? DAY_MS : 30 * DAY_MS;
    if (!fetchOpts.raw) {
      const hit = cache.get(cacheKey);
      if (hit && nowMs - hit.fetchedAt < maxAge) return hit.deals;
    }

    const items: RawItem[] = [];
    for (let pageNo = 1; pageNo <= MAX_PAGES; pageNo++) {
      const page = await fetchPage(service, lawdCode, ym, pageNo, PAGE_SIZE);
      items.push(...page.items);
      if (page.items.length === 0 || items.length >= page.totalCount) break;
    }
    const deals = items.flatMap((item) => toDeal(service, item) ?? []);
    const views = deals.map(stripRaw);
    cache.set(cacheKey, { deals: views, fetchedAt: nowMs });
    return fetchOpts.raw ? deals : views;
  }

  async function fetchRange(req: RangeRequest): Promise<RangeResult> {
    const requests = estimateRequests(req);
    if (requests > MAX_REQUESTS) throw new BudgetError(requests, MAX_REQUESTS);
    requireKey();
    for (const lawd of req.lawdCodes) for (const ym of req.months) validate(lawd, ym);

    const jobs = req.services.flatMap((service) => req.lawdCodes.flatMap((lawdCode) => req.months.map((ym) => ({ service, lawdCode, ym }))));
    const settled = await Promise.allSettled(jobs.map((j) => fetchMonth(j.service, j.lawdCode, j.ym) as Promise<DealView[]>));
    const deals: DealView[] = [];
    const failures: MonthFailure[] = [];
    let firstError: unknown;
    settled.forEach((r, i) => {
      const job = jobs[i];
      if (!job) return;
      if (r.status === "fulfilled") deals.push(...r.value);
      else {
        firstError ??= r.reason;
        failures.push({ ...job, kind: r.reason instanceof ApiError ? r.reason.kind : "upstream" });
      }
    });
    if (jobs.length > 0 && failures.length === jobs.length) throw firstError;
    return { deals, failures, requests };
  }

  async function probe(service: ServiceId): Promise<ProbeResult> {
    const ym = addMonths(todayKst(now()), -1).slice(0, 7).replace("-", "");
    try {
      await fetchPage(service, "36110", ym, 1, 1);
      return { ok: true };
    } catch (error) {
      if (error instanceof ApiError) return { ok: false, kind: error.kind, message: error.message, hint: error.hint };
      throw error;
    }
  }

  return { hasKey: key !== null, fetchMonth: fetchMonth as Client["fetchMonth"], fetchRange, probe };
}
