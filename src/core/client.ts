import { MemoryCache, type CacheStore } from "./cache.js";
import { ApiError, BudgetError, InputError, type ApiErrorKind } from "./errors.js";
import { KEY_ENV, normalizeServiceKey, readServiceKey, registerSecret } from "./key.js";
import { log } from "./log.js";
import { stripRaw, toDeal, type Deal, type DealView } from "./normalize.js";
import { apiErrorFrom, apiErrorOfKind, parseResponse, RETRYABLE_CODES, trustedCode, type RawItem } from "./parse.js";
import { isQueryableLawd as queryableInTable } from "./region.js";
import { serviceUrl, type ServiceId } from "./services.js";
import { addMonths, isValidYm, todayKst } from "./time.js";

/** 한 번의 조회(도구 호출 1회)가 쓸 수 있는 API 호출 수. 개발계정은 하루 10,000건 */
export const MAX_REQUESTS = 80;
/** 큰 쪽으로 받고, 결과가 모자라면 작은 쪽으로 한 번 더 받는다 */
const PAGE_SIZES = [9999, 1000];
/** 서버가 조용히 쪽 크기를 줄여도 무한히 돌지 않게 */
const MAX_PAGES = 50;
const DAY_MS = 86_400_000;
/** 이 오류가 나면 같은 조회의 남은 요청도 같은 이유로 실패한다 */
const GLOBAL_KINDS = new Set<ApiErrorKind>(["no_key", "daily_limit", "expired", "access_denied", "ip_not_allowed"]);
/** 이 오류가 나면 같은 서비스의 남은 요청도 실패한다 */
const SERVICE_KINDS = new Set<ApiErrorKind>(["key_or_subscription", "not_subscribed", "service_not_found", "schema"]);

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
  /** 조회 가능한 시군구 코드인가 (기본: 지역 코드표의 queryable). 옛 코드·시 단위 코드는 오류 없이 0건이 오므로 미리 막는다 */
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
  status?: number;
  gatewayCode?: string;
}

export interface RangeResult {
  deals: DealView[];
  failures: MonthFailure[];
  /** 서비스 × 지역 × 달 (예산 계산에 쓴 값) */
  estimatedRequests: number;
  /** 실제로 보낸 HTTP 요청 수 (쪽·재시도 포함, 캐시 적중 제외) */
  requests: number;
  /** 계약일 등 필수 값이 없어 버린 레코드 수 */
  dropped: number;
}

export type ProbeResult = { ok: true } | { ok: false; kind: ApiErrorKind; message: string; hint: string };

export interface Client {
  readonly hasKey: boolean;
  fetchMonth(service: ServiceId, lawdCode: string, ym: string): Promise<DealView[]>;
  fetchMonth(service: ServiceId, lawdCode: string, ym: string, opts: { raw: true }): Promise<Deal[]>;
  fetchRange(req: RangeRequest): Promise<RangeResult>;
  /** 서비스마다 1건만 요청해 활용신청 상태를 본다 (doctor) */
  probe(services: ServiceId[]): Promise<Map<ServiceId, ProbeResult>>;
}

const uniq = <T>(xs: T[]) => [...new Set(xs)];

export function estimateRequests(req: RangeRequest): number {
  return uniq(req.services).length * uniq(req.lawdCodes).length * uniq(req.months).length;
}

/** 동시 실행 수 제한. 끝난 작업의 슬롯을 대기자에게 그대로 넘긴다 */
export function limiter(max: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (active < max) active++;
    else await new Promise<void>((resolve) => queue.push(resolve));
    try {
      return await task();
    } finally {
      const next = queue.shift();
      if (next) next();
      else active--;
    }
  };
}

const sleep = (ms: number) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

class TooLarge extends Error {}

/** 본문을 읽되 maxBytes를 넘으면 중단한다 */
async function readLimited(res: Response, maxBytes: number): Promise<string> {
  const declared = Number(res.headers.get("content-length"));
  if (declared > maxBytes) {
    await res.body?.cancel().catch(() => undefined);
    throw new TooLarge();
  }
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new TooLarge();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** 한 번의 조회(fetchRange)가 공유하는 상태 */
interface RunState {
  requests: number;
  dropped: number;
  /** 전체를 멈추게 한 오류 */
  stopAll?: ApiError;
  /** 서비스를 멈추게 한 오류 */
  stopService: Map<ServiceId, ApiError>;
}

const newState = (): RunState => ({ requests: 0, dropped: 0, stopService: new Map() });

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
  const isQueryableLawd = opts.isQueryableLawd ?? queryableInTable;
  /** 같은 키로 한 번이라도 성공했는가. 403/30을 "미신청"으로 좁히는 데 쓴다 */
  let keyWorks = false;
  /** 같은 달을 동시에 부르면 요청을 하나로 묶는다 */
  const inflight = new Map<string, Promise<{ deals: Deal[]; dropped: number }>>();

  function requireKey(): string {
    if (!key) throw new ApiError("no_key", "공공데이터포털 인증키가 설정되지 않았습니다.", `환경변수 ${KEY_ENV}에 일반 인증키(Encoding·Decoding 어느 쪽이든)를 넣어 주세요.`);
    return key;
  }

  function validate(lawdCode: string, ym: string): void {
    if (!isQueryableLawd(lawdCode)) throw new InputError(`조회할 수 없는 시군구 코드입니다: ${lawdCode}`, "resolve_region으로 지역을 먼저 확인하세요.");
    const today = todayKst(now());
    if (!isValidYm(ym, today)) throw new InputError(`조회할 수 없는 계약년월입니다: ${ym}`, `YYYYMM 형식으로 200601부터 ${today.slice(0, 7).replace("-", "")}까지 가능합니다.`);
  }

  /** 같은 조회의 남은 요청을 멈출 오류면 표시한다. 슬롯을 놓기 전에 불러야 대기자가 보지 못하고 지나가지 않는다 */
  function recordStop(state: RunState, service: ServiceId, error: ApiError): ApiError {
    if (GLOBAL_KINDS.has(error.kind)) state.stopAll ??= error;
    else if (SERVICE_KINDS.has(error.kind) && !state.stopService.has(service)) state.stopService.set(service, error);
    return error;
  }

  type Attempt = { kind: "page"; page: Page } | { kind: "retry"; status: number; code?: string } | { kind: "error"; error: ApiError };

  async function fetchPage(service: ServiceId, lawdCode: string, ym: string, pageNo: number, rows: number, state: RunState): Promise<Page> {
    const params = new URLSearchParams({ serviceKey: requireKey(), LAWD_CD: lawdCode, DEAL_YMD: ym, pageNo: String(pageNo), numOfRows: String(rows) });
    const url = `${serviceUrl(service)}?${params.toString()}`;
    const where = { service, lawd: lawdCode, ym, page: pageNo };

    const checkStopped = () => {
      const stopped = state.stopAll ?? state.stopService.get(service);
      if (stopped) throw stopped;
    };

    /** 요청 한 번: 본문까지 슬롯 안에서 읽고(동시 스트림 수 제한), 판정도 슬롯 안에서 끝낸다 */
    const attemptOnce = (canRetry: boolean) =>
      run(async (): Promise<Attempt> => {
        // 대기하는 동안 다른 요청이 중단 오류를 받았을 수 있다
        checkStopped();
        state.requests++;
        let res: Response;
        let body: string;
        try {
          res = await doFetch(url, { redirect: "error", signal: AbortSignal.timeout(timeoutMs), headers: { accept: "application/xml" } });
          body = await readLimited(res, maxBodyBytes);
        } catch (error) {
          if (error instanceof TooLarge) return { kind: "error", error: apiErrorOfKind(service, "too_large") };
          // 원본 예외는 URL(키 포함)을 담을 수 있어 버리고 종류만 남긴다
          const name = error instanceof Error ? error.name : "";
          const kind: ApiErrorKind = name === "TimeoutError" || name === "AbortError" ? "timeout" : "network";
          const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : "";
          // 리다이렉트는 일시적인 문제가 아니라 다시 시도하지 않는다
          const redirect = /redirect/i.test(cause);
          log("warn", { ...where, error: redirect ? "redirect" : kind });
          return canRetry && !redirect ? { kind: "retry", status: 0 } : { kind: "error", error: apiErrorOfKind(service, kind) };
        }

        const parsed = parseResponse(body);
        log("debug", { ...where, status: res.status, code: parsed.ok ? "000" : parsed.code });
        if (parsed.ok && res.ok) {
          keyWorks = true;
          return { kind: "page", page: { items: parsed.items, totalCount: parsed.totalCount } };
        }
        const code = parsed.ok ? undefined : trustedCode(parsed.code);
        const retryable = code ? RETRYABLE_CODES.has(code) : res.status === 429 || res.status >= 500;
        if (retryable && canRetry) return { kind: "retry", status: res.status, ...(code ? { code } : {}) };
        const error = apiErrorFrom(service, res.status, code, { keyWorks, ...(!parsed.ok && parsed.errMsg ? { errMsg: parsed.errMsg } : {}) });
        return { kind: "error", error: recordStop(state, service, error) };
      });

    for (let attempt = 0; ; attempt++) {
      checkStopped();
      const result = await attemptOnce(attempt < delays.length);
      if (result.kind === "page") return result.page;
      if (result.kind === "error") throw result.error;
      log("warn", { ...where, status: result.status, code: result.code ?? "-", attempt });
      await sleep((delays[attempt] ?? 0) * (1 + Math.random() * 0.2));
    }
  }

  /** 한 달치 모든 쪽. 모자라게 받으면 작은 쪽 크기로 한 번 더 받는다 */
  async function loadMonth(service: ServiceId, lawdCode: string, ym: string, state: RunState): Promise<{ deals: Deal[]; dropped: number }> {
    for (const size of PAGE_SIZES) {
      const items: RawItem[] = [];
      let total = 0;
      for (let pageNo = 1; pageNo <= MAX_PAGES; pageNo++) {
        const page = await fetchPage(service, lawdCode, ym, pageNo, size, state);
        items.push(...page.items);
        // 빈 쪽은 totalCount를 0으로 줄 수 있어 가장 큰 값을 쓴다
        total = Math.max(total, page.totalCount);
        if (page.items.length === 0 || items.length >= total) break;
      }
      if (items.length < total) {
        log("warn", { service, lawd: lawdCode, ym, error: "incomplete", got: items.length, total });
        continue;
      }
      const deals = items.flatMap((item) => toDeal(service, item, lawdCode) ?? []);
      if (items.length > 0 && deals.length === 0) throw recordStop(state, service, apiErrorOfKind(service, "schema"));
      return { deals, dropped: items.length - deals.length };
    }
    throw apiErrorOfKind(service, "incomplete");
  }

  /** 받은 시점에 최근 두 달이었던 자료는 하루, 그 전 달은 30일 (신고 기한 30일 동안 계속 바뀐다) */
  function isFresh(ym: string, fetchedAt: number): boolean {
    const then = todayKst(new Date(fetchedAt));
    const wasRecent = ym >= addMonths(then, -1).slice(0, 7).replace("-", "");
    return now().getTime() - fetchedAt < (wasRecent ? DAY_MS : 30 * DAY_MS);
  }

  async function month(service: ServiceId, lawdCode: string, ym: string, state: RunState, raw: boolean): Promise<Deal[] | DealView[]> {
    validate(lawdCode, ym);
    requireKey();
    const cacheKey = `${service}:${lawdCode}:${ym}`;
    if (!raw) {
      const hit = cache.get(cacheKey);
      if (hit && isFresh(ym, hit.fetchedAt)) return hit.deals;
    }
    let pending = raw ? undefined : inflight.get(cacheKey);
    if (!pending) {
      const fetchedAt = now().getTime();
      pending = loadMonth(service, lawdCode, ym, state).then((r) => {
        cache.set(cacheKey, { deals: r.deals.map(stripRaw), fetchedAt });
        return r;
      });
      if (!raw) {
        inflight.set(cacheKey, pending);
        pending.then(
          () => inflight.delete(cacheKey),
          () => inflight.delete(cacheKey),
        );
      }
    }
    const result = await pending;
    state.dropped += result.dropped;
    return raw ? result.deals : result.deals.map(stripRaw);
  }

  async function fetchMonth(service: ServiceId, lawdCode: string, ym: string, fetchOpts: { raw?: boolean } = {}): Promise<Deal[] | DealView[]> {
    try {
      return await month(service, lawdCode, ym, newState(), fetchOpts.raw === true);
    } catch (error) {
      throw narrow(error);
    }
  }

  /** 다른 서비스가 성공한 적이 있으면, 키 문제가 아니라 그 서비스 미신청이다 */
  function narrow(error: unknown): unknown {
    if (error instanceof ApiError && error.kind === "key_or_subscription" && keyWorks && error.details.service) {
      return apiErrorOfKind(error.details.service as ServiceId, "not_subscribed", error.details.status, error.details.gatewayCode);
    }
    return error;
  }

  async function fetchRange(req: RangeRequest): Promise<RangeResult> {
    const services = uniq(req.services);
    const lawdCodes = uniq(req.lawdCodes);
    const months = uniq(req.months);
    if (!services.length || !lawdCodes.length || !months.length) throw new InputError("조회할 서비스·지역·기간이 비어 있습니다.");
    const estimatedRequests = services.length * lawdCodes.length * months.length;
    if (estimatedRequests > MAX_REQUESTS) throw new BudgetError(estimatedRequests, MAX_REQUESTS);
    requireKey();
    for (const lawd of lawdCodes) for (const ym of months) validate(lawd, ym);

    const state = newState();
    const jobs = services.flatMap((service) => lawdCodes.flatMap((lawdCode) => months.map((ym) => ({ service, lawdCode, ym }))));
    const settled = await Promise.allSettled(
      jobs.map((j) => month(j.service, j.lawdCode, j.ym, state, false) as Promise<DealView[]>),
    );

    const deals: DealView[] = [];
    const failures: MonthFailure[] = [];
    let firstError: unknown;
    settled.forEach((r, i) => {
      const job = jobs[i];
      if (!job) return;
      if (r.status === "fulfilled") {
        deals.push(...r.value);
        return;
      }
      // 모두 끝난 뒤에 좁혀야 도착 순서와 상관없이 판정이 같다
      const error = narrow(r.reason);
      firstError ??= error;
      const failure: MonthFailure = { ...job, kind: error instanceof ApiError ? error.kind : "upstream" };
      if (error instanceof ApiError && error.details.status) failure.status = error.details.status;
      if (error instanceof ApiError && error.details.gatewayCode) failure.gatewayCode = error.details.gatewayCode;
      failures.push(failure);
    });
    if (failures.length === jobs.length) throw firstError;
    return { deals, failures, estimatedRequests, requests: state.requests, dropped: state.dropped };
  }

  async function probe(services: ServiceId[]): Promise<Map<ServiceId, ProbeResult>> {
    const ym = addMonths(todayKst(now()), -1).slice(0, 7).replace("-", "");
    const errors = new Map<ServiceId, unknown>();
    await Promise.all(
      uniq(services).map((s) =>
        fetchPage(s, "36110", ym, 1, 1, newState()).then(
          () => errors.set(s, null),
          (e: unknown) => errors.set(s, e),
        ),
      ),
    );
    const out = new Map<ServiceId, ProbeResult>();
    for (const s of uniq(services)) {
      const e = narrow(errors.get(s));
      if (e === null || e === undefined) out.set(s, { ok: true });
      else if (e instanceof ApiError) out.set(s, { ok: false, kind: e.kind, message: e.message, hint: e.hint });
      else throw e;
    }
    return out;
  }

  return { hasKey: key !== null, fetchMonth: fetchMonth as Client["fetchMonth"], fetchRange, probe };
}
