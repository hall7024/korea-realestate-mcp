import type { Complex, Excluded, MarketSummary } from "./analytics.js";
import type { MonthFailure } from "./client.js";
import { ApiError, InputError, type ApiErrorKind } from "./errors.js";
import { pct, sourceLine, sqm, table, won, ymLabel } from "./format.js";
import { redact } from "./key.js";
import type { DealView } from "./normalize.js";
import type { RatioQueryResult, RegionCandidates, SearchResult, SummaryResult } from "./query.js";
import type { RegionResult } from "./region.js";
import { PROPERTY_LABELS, SERVICES } from "./services.js";

/** 3.3㎡(1평)당 */
const PYEONG = 3.3058;

const KIND_LABEL: Record<ApiErrorKind, string> = {
  key_or_subscription: "키 오류 또는 미신청",
  not_subscribed: "미신청",
  no_key: "키 없음",
  daily_limit: "일일 한도",
  rate_limit: "일시 한도",
  expired: "기간 만료",
  bad_request: "요청 오류",
  timeout: "시간 초과",
  network: "연결 실패",
  too_large: "응답 과대",
  access_denied: "접근 거부",
  ip_not_allowed: "IP 제한",
  service_not_found: "서비스 없음",
  incomplete: "불완전한 응답",
  schema: "해석 실패",
  upstream: "일시 오류",
};

const ZERO = "조회는 정상이며, 해당 기간·조건의 거래가 0건입니다.";

function failuresLine(failures: MonthFailure[]): string[] {
  if (!failures.length) return [];
  const list = failures.map((f) => `${ymLabel(f.ym)}(${KIND_LABEL[f.kind]})`).join(", ");
  return [`⚠ 일부 달 조회 실패: ${list}. 나머지 달로 계산했습니다.`];
}

function excludedLine(e: Excluded, includeDirect = false): string {
  const parts = [`해제 ${e.cancelled}건`];
  if (!includeDirect) parts.push(`직거래 ${e.direct}건`);
  return `제외: ${parts.join(", ")}`;
}

const periodOf = (months: string[]) => `${ymLabel(months[0] ?? "")} ~ ${ymLabel(months.at(-1) ?? "")}`;
const amountOf = (d: DealView) => (d.kind === "sale" ? won(d.price ?? 0) : d.monthlyRent ? `${won(d.deposit ?? 0)} / 월 ${won(d.monthlyRent)}` : `전세 ${won(d.deposit ?? 0)}`);

function dealRows(deals: DealView[]): string {
  return table(
    ["계약일", "이름", "법정동", "지번", "면적", "층", "금액", "비고"],
    deals.map((d) => [
      d.date,
      d.name ?? "-",
      d.umd,
      d.jibun ?? "-",
      d.area !== null ? sqm(d.area) : "-",
      d.floor ?? "-",
      amountOf(d),
      [d.cancelled ? "해제" : "", d.direct ? "직거래" : "", d.contractType ?? "", d.houseType ?? ""].filter(Boolean).join(", ") || "-",
    ]),
  );
}

function complexRows(candidates: Complex[]): string {
  return table(
    ["단지·건물", "법정동", "지번", "거래 수"],
    candidates.map((c) => [c.name, c.umd, c.jibun ?? "-", c.count]),
  );
}

export function renderRegion(query: string, r: RegionResult): string {
  if (!r.matches.length) return `'${query}'에 맞는 지역을 찾지 못했습니다. 시·군·구 이름이나 '구 이름 + 법정동'으로 입력해 주세요.`;
  const lines = [`'${query}' 지역 해석 결과 ${r.matches.length}건:`];
  if (r.note) lines.push(`참고: ${r.note}`);
  lines.push(
    table(
      ["지역", "법정동", "시군구 코드"],
      r.matches.map((m) => [m.label, m.umd ?? "-", m.lawdCodes.join(", ")]),
    ),
  );
  if (r.matches.length > 1) lines.push("조회할 때는 위 지역 이름을 region에 그대로 넣거나, 시군구 코드 5자리를 넣으세요.");
  return lines.join("\n");
}

export function renderRegionCandidates(r: RegionCandidates): string {
  return [
    `'${r.query}'에 맞는 지역이 ${r.candidates.length}곳입니다. 어느 곳인지 사용자에게 확인한 뒤, region에 아래 이름이나 시군구 코드를 넣어 다시 조회하세요.`,
    ...(r.note ? [`참고: ${r.note}`] : []),
    table(
      ["지역", "법정동", "시군구 코드"],
      r.candidates.map((m) => [m.label, m.umd ?? "-", m.lawdCodes.join(", ")]),
    ),
  ].join("\n");
}

function header(region: { label: string; umd?: string }, what: string, note?: string): string[] {
  return [`## ${region.label}${region.umd ? ` ${region.umd}` : ""} ${what}`, ...(note ? [`참고: ${note}`] : [])];
}

export function renderSearch(r: SearchResult, now: Date): string {
  const def = SERVICES[r.service];
  const lines = header(r.region, `${def.label} 실거래 (${periodOf(r.months)})`, r.note);
  if (!r.verified) lines.push(`⚠ ${def.label}는 실제 응답으로 필드를 검증하지 않은 서비스입니다. 면적·이름 값이 비어 있을 수 있습니다.`);
  if (r.total === 0) lines.push(ZERO);
  else {
    lines.push(`조건에 맞는 거래 ${r.total}건 중 최신 ${r.deals.length}건 (금액은 원 단위 환산):`);
    lines.push(dealRows(r.deals));
  }
  if (r.excludedCancelled) lines.push(`해제된 거래 ${r.excludedCancelled}건은 뺐습니다 (includeCancelled로 포함 가능).`);
  lines.push(...failuresLine(r.failures), sourceLine(now));
  return lines.join("\n");
}

function summaryBody(s: MarketSummary): string[] {
  const target = s.complex ? `단지: ${s.complex.name} (${s.complex.umd} ${s.complex.jibun ?? ""})`.trim() : "범위: 지역 전체(법정동 지정 시 그 동)";
  return [
    target,
    table(
      ["항목", "값"],
      [
        ["거래 수", `${s.count}건`],
        ["중앙값", won(s.median)],
        ["최저~최고", `${won(s.min)} ~ ${won(s.max)}`],
        ["사분위(25%~75%)", `${won(s.q1)} ~ ${won(s.q3)}`],
        ["㎡당 중앙값", `${won(s.medianPerM2)} (3.3㎡당 ${won(s.medianPerM2 * PYEONG)})`],
        ["최근 계약일", s.latestDate],
      ],
    ),
    "월별 추이 (표본 3건 미만인 달은 중앙값 생략, *는 신고 기한 30일 안이라 건수가 덜 잡혔을 수 있음, †는 기간 시작일 이후 거래만):",
    table(
      ["월", "건수", "중앙값"],
      s.monthly.map((m) => [`${ymLabel(m.ym)}${m.partial ? "*" : ""}${m.clipped ? "†" : ""}`, m.count, m.median === null ? "-" : won(m.median)]),
    ),
    "최근 거래:",
    dealRows(s.recent),
  ];
}

export function renderSummary(r: SummaryResult, now: Date): string {
  const lines = header(r.region, `${PROPERTY_LABELS[r.propertyType]} 매매 시세`, r.note);
  const res = r.result;
  if (res.kind === "complex_candidates") {
    lines.push("이름에 맞는 단지가 여러 개입니다. 어느 단지인지 확인한 뒤 name을 더 구체적으로 넣어 다시 조회하세요.", complexRows(res.candidates));
  } else if (res.kind === "empty") {
    lines.push(ZERO, `기준: ${res.criteria.join(" / ")}`, excludedLine(res.excluded));
  } else {
    lines.push(...summaryBody(res), `기준: ${res.criteria.join(" / ")}`);
  }
  lines.push("참고 자료이며 계약·투자 판단의 근거가 아닙니다.", ...failuresLine(r.failures), sourceLine(now));
  return lines.join("\n");
}

export function renderRatio(r: RatioQueryResult, now: Date): string {
  const lines = header(r.region, `${PROPERTY_LABELS[r.propertyType]} 전세가율`, r.note);
  const res = r.result;
  if (res.kind === "complex_candidates") {
    lines.push("이름에 맞는 단지가 여러 개입니다. 어느 단지인지 확인한 뒤 name을 더 구체적으로 넣어 다시 조회하세요.", complexRows(res.candidates));
  } else if (res.kind === "insufficient") {
    lines.push(`전세가율을 계산하지 않았습니다: ${res.reason}`, `기준: ${res.criteria.join(" / ")}`);
  } else {
    if (res.complex) lines.push(`단지: ${res.complex.name} (${res.complex.umd} ${res.complex.jibun ?? ""})`.trim());
    const rows: (string | number)[][] = [
      ["전세가율", pct(res.ratioPercent)],
      ["㎡당 매매 중앙값 (사분위)", `${won(res.salePerM2)} (${won(res.salePerM2Iqr[0])} ~ ${won(res.salePerM2Iqr[1])})`],
      ["㎡당 전세 중앙값 (사분위)", `${won(res.jeonsePerM2)} (${won(res.jeonsePerM2Iqr[0])} ~ ${won(res.jeonsePerM2Iqr[1])})`],
      ["표본", `매매 ${res.saleCount}건, 전세 ${res.rentCount}건`],
      ["신뢰도", res.confidence],
    ];
    if (res.deposit) {
      rows.push(["입력 보증금", won(res.deposit.amount)], ["추정 매매가", won(res.deposit.estimatedPrice)], ["보증금 ÷ 추정 매매가", pct(res.deposit.depositRatioPercent)]);
    }
    lines.push(table(["항목", "값"], rows), `기준: ${res.criteria.join(" / ")}`, excludedLine(res.excluded));
  }
  lines.push("참고 자료이며 계약·투자 판단의 근거가 아닙니다.", ...failuresLine(r.failures), sourceLine(now));
  return lines.join("\n");
}

/** 오류를 사용자·모델에게 보여 줄 문장으로. 알 수 없는 오류의 원문은 내보내지 않는다 */
export function renderError(error: unknown): string {
  if (error instanceof InputError || error instanceof ApiError) {
    return redact([`오류: ${error.message}`, error.hint ? `해결: ${error.hint}` : ""].filter(Boolean).join("\n"));
  }
  return "오류: 처리 중 예상하지 못한 문제가 생겼습니다. 잠시 뒤 다시 시도하세요.";
}
