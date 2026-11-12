import { XMLParser } from "fast-xml-parser";
import { ApiError, type ApiErrorKind } from "./errors.js";
import { KEY_ENV } from "./key.js";
import { SERVICES, type ServiceId } from "./services.js";

export type RawItem = Record<string, string | null>;

export type ParsedPage =
  | { ok: true; items: RawItem[]; totalCount: number; numOfRows: number | null }
  /** code: 게이트웨이 returnReasonCode 또는 resultCode. XML을 읽지 못하면 "parse" */
  | { ok: false; code: string; message: string; errMsg?: string };

/** 응답 텍스트는 신뢰하지 않는다: 이 길이로 자른다 */
const MAX_VALUE_LENGTH = 200;

// 값을 숫자로 바꾸지 않는다 (jibun "1387"과 "179-17"의 타입이 섞이지 않게).
// item은 1건이어도 배열. 엔티티는 XML 기본 5종만 (DOCTYPE은 아래에서 먼저 거부).
const parser = new XMLParser({
  parseTagValue: false,
  trimValues: false,
  ignoreAttributes: true,
  ignoreDeclaration: true,
  processEntities: true,
  htmlEntities: false,
  isArray: (name) => name === "item",
});

/** 앞뒤 공백 제거, 제어 문자 제거, 길이 제한. 공백뿐이면 null (응답은 빈 값을 " "로 준다) */
export function cleanValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  // eslint-disable-next-line no-control-regex
  const s = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return s ? s.slice(0, MAX_VALUE_LENGTH) : null;
}

const asRecord = (v: unknown): Record<string, unknown> | undefined =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;

const toInt = (v: unknown): number | null => {
  const s = cleanValue(v);
  return s && /^\d+$/.test(s) ? Number(s) : null;
};

/** 공공데이터포털 응답 XML 한 쪽을 읽는다 */
export function parseResponse(xml: string): ParsedPage {
  if (/<!DOCTYPE/i.test(xml)) return { ok: false, code: "parse", message: "DOCTYPE이 있는 응답은 읽지 않습니다." };
  let doc: Record<string, unknown> | undefined;
  try {
    doc = asRecord(parser.parse(xml, true));
  } catch {
    return { ok: false, code: "parse", message: "XML이 아닌 응답입니다." };
  }

  const gateway = asRecord(asRecord(doc?.OpenAPI_ServiceResponse)?.cmmMsgHeader);
  if (gateway) {
    const errMsg = cleanValue(gateway.errMsg);
    return { ok: false, code: cleanValue(gateway.returnReasonCode) ?? "unknown", message: cleanValue(gateway.returnAuthMsg) ?? "", ...(errMsg ? { errMsg } : {}) };
  }

  const response = asRecord(doc?.response);
  if (!response) return { ok: false, code: "parse", message: "알 수 없는 응답 형식입니다." };
  const header = asRecord(response.header);
  const code = cleanValue(header?.resultCode) ?? "";
  // 03(NODATA)은 옛 API의 "거래 없음". 지금은 000 + 0건으로 오지만 받아 둔다
  if (code === "03") return { ok: true, items: [], totalCount: 0, numOfRows: null };
  if (code !== "000" && code !== "00") return { ok: false, code: code || "parse", message: cleanValue(header?.resultMsg) ?? "" };

  const body = asRecord(response.body);
  const rawItems = asRecord(body?.items)?.item;
  const items = (Array.isArray(rawItems) ? rawItems : []).flatMap((item) => {
    const record = asRecord(item);
    if (!record) return [];
    return [Object.fromEntries(Object.entries(record).map(([k, v]) => [k, cleanValue(v)])) as RawItem];
  });
  return { ok: true, items, totalCount: toInt(body?.totalCount) ?? items.length, numOfRows: toInt(body?.numOfRows) };
}

const KIND_BY_CODE = new Map<string, ApiErrorKind>([
  ["30", "key_or_subscription"],
  ["20", "access_denied"],
  ["22", "daily_limit"],
  ["23", "rate_limit"],
  ["31", "expired"],
  ["10", "bad_request"],
  ["11", "bad_request"],
  ["12", "service_not_found"],
  ["29", "ip_not_allowed"],
  ["32", "ip_not_allowed"],
]);

/** 일시적이라 다시 시도할 게이트웨이 코드: 초당 한도, 내부·HTTP 오류, 시간 초과 */
export const RETRYABLE_CODES = new Set(["23", "01", "04", "05"]);

/** 업스트림이 준 코드는 숫자 1~3자리일 때만 믿는다 */
export const trustedCode = (code: string | undefined): string | undefined => (code && /^\d{1,3}$/.test(code) ? code : undefined);

/**
 * 게이트웨이 코드(없으면 HTTP 상태)로 오류를 만든다.
 * 30은 "키가 틀림"과 "그 서비스 미신청"이 바이트까지 같은 응답이라, 같은 키로 다른 서비스가 성공한 적이 있을 때만(keyWorks) 미신청으로 좁힌다.
 * 20은 키가 비었을 때(SERVICE_KEY_IS_NULL)만 no_key이고, 그 밖은 접근 거부다.
 */
export function apiErrorFrom(service: ServiceId, status: number, gatewayCode: string | undefined, opts: { keyWorks?: boolean; errMsg?: string } = {}): ApiError {
  const code = trustedCode(gatewayCode);
  let kind: ApiErrorKind = code ? (KIND_BY_CODE.get(code) ?? "upstream") : status === 429 ? "rate_limit" : "upstream";
  if (kind === "key_or_subscription" && opts.keyWorks) kind = "not_subscribed";
  if (kind === "access_denied" && opts.errMsg === "SERVICE_KEY_IS_NULL") kind = "no_key";
  return apiErrorOfKind(service, kind, status, code);
}

/** 종류로 오류를 만든다. 메시지는 한국어이고 URL·응답 본문은 담지 않는다 */
export function apiErrorOfKind(service: ServiceId, kind: ApiErrorKind, status?: number, gatewayCode?: string): ApiError {
  const def = SERVICES[service];
  const apply = `공공데이터포털(data.go.kr/data/${def.dataset}/openapi.do)에서 '${def.label}' 활용신청을 하세요. 자동승인이며 반영까지 최대 1시간 걸릴 수 있습니다.`;
  const messages: Record<ApiErrorKind, [string, string]> = {
    key_or_subscription: [`${def.label} 조회가 거부됐습니다 (등록되지 않은 서비스키).`, `${KEY_ENV} 값이 맞는지 확인하거나, ${apply}`],
    not_subscribed: [`${def.label} 서비스에 활용신청이 안 된 키입니다.`, apply],
    no_key: ["인증키가 전달되지 않았습니다.", `환경변수 ${KEY_ENV}에 공공데이터포털 일반 인증키를 넣어 주세요.`],
    access_denied: [`${def.label} 서비스 접근이 거부됐습니다.`, "공공데이터포털 마이페이지에서 활용 상태(승인·이용 정지)를 확인하세요."],
    ip_not_allowed: ["허용되지 않은 IP에서 호출했습니다.", "공공데이터포털에서 키의 IP 제한 설정을 확인하세요."],
    service_not_found: [`${def.label} 서비스를 찾지 못했습니다.`, "서비스가 바뀌었거나 폐기됐을 수 있습니다. 이 패키지를 최신 버전으로 올리거나 이슈로 알려 주세요."],
    daily_limit: ["오늘의 호출 한도를 넘었습니다.", "내일 다시 시도하거나 공공데이터포털에서 운영계정 트래픽 증량을 신청하세요."],
    rate_limit: ["짧은 시간에 너무 많이 호출했습니다.", "잠시 뒤 다시 시도하세요."],
    expired: ["인증키의 활용기간이 끝났습니다.", "공공데이터포털 마이페이지에서 활용기간을 연장하세요."],
    bad_request: ["요청 파라미터가 잘못됐습니다.", "지역 코드와 계약년월(YYYYMM)을 확인하세요."],
    timeout: ["응답이 늦어 중단했습니다.", "잠시 뒤 다시 시도하세요."],
    network: ["공공데이터포털에 연결하지 못했습니다.", "네트워크 상태를 확인하고 다시 시도하세요."],
    too_large: ["응답이 너무 커서 중단했습니다.", "기간이나 지역을 좁혀 주세요."],
    incomplete: ["응답 건수가 전체 건수(totalCount)보다 적어 결과가 불완전합니다.", "잠시 뒤 다시 시도하세요. 계속되면 이슈로 알려 주세요."],
    schema: [`${def.label} 응답을 해석하지 못했습니다 (필드 이름이 바뀐 것으로 보임).`, "이 패키지를 최신 버전으로 올리거나 이슈로 알려 주세요."],
    upstream: ["공공데이터포털이 오류를 돌려줬습니다.", "잠시 뒤 다시 시도하세요."],
  };
  const [message, hint] = messages[kind];
  const meta = [status ? `HTTP ${status}` : "", gatewayCode ? `코드 ${gatewayCode}` : ""].filter(Boolean).join(", ");
  return new ApiError(kind, meta ? `${message} (${meta})` : message, hint, {
    service,
    ...(status ? { status } : {}),
    ...(gatewayCode ? { gatewayCode } : {}),
  });
}
