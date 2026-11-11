// 라이브러리 진입점. MCP SDK를 불러오지 않는다.
export { createClient, estimateRequests, MAX_REQUESTS } from "./client.js";
export type { Client, ClientOptions, MonthFailure, ProbeResult, RangeRequest, RangeResult } from "./client.js";
export { MemoryCache } from "./cache.js";
export type { CacheStore, CachedMonth } from "./cache.js";
export { ApiError, BudgetError, InputError } from "./errors.js";
export type { ApiErrorKind } from "./errors.js";
export { KEY_ENV, maskSecrets, normalizeServiceKey, readServiceKey } from "./key.js";
export type { Deal, DealView } from "./normalize.js";
export { isQueryableLawd, regionLabel, resolveRegion } from "./region.js";
export type { Region, RegionResult } from "./region.js";
export { ANALYZABLE_TYPES, PROPERTY_LABELS, PROPERTY_TYPES, SERVICE_IDS, SERVICES, serviceFor } from "./services.js";
export type { AnalyzableType, AreaKind, DealKind, PropertyType, ServiceDef, ServiceId } from "./services.js";
export { filterDeals, groupComplexes, jeonseRatio, marketSummary, median, quantile } from "./analytics.js";
export type { AnalysisFilter, Complex, JeonseRatio, MarketResult, MarketSummary, RatioResult } from "./analytics.js";
export { ratio, searchDeals, summarize } from "./query.js";
export type { AnalysisArgs, QueryContext, RatioArgs, RatioQueryResult, RegionCandidates, SearchArgs, SearchResult, SummaryResult } from "./query.js";
export { won } from "./format.js";
export { VERSION } from "./version.js";
