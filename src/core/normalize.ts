import type { RawItem } from "./parse.js";
import { SERVICES, type AreaKind, type DealKind, type ServiceId } from "./services.js";

/** 실거래 한 건. 금액은 원 단위 정수 */
export interface Deal {
  service: ServiceId;
  kind: DealKind;
  /** 시군구 코드 5자리 (sggCd) */
  lawdCode: string;
  /** 법정동 (umdNm). 읍·면 아래 리는 "조치원읍 죽림리"처럼 온다 */
  umd: string;
  jibun: string | null;
  /** 단지·건물 이름 */
  name: string | null;
  area: number | null;
  areaKind: AreaKind;
  floor: number | null;
  buildYear: number | null;
  /** 계약일 YYYY-MM-DD */
  date: string;
  price: number | null;
  deposit: number | null;
  monthlyRent: number | null;
  contractType: "신규" | "갱신" | null;
  /** 직거래 (dealingGbn) */
  direct: boolean;
  /** 해제된 거래 (cdealType "O") */
  cancelled: boolean;
  /** 연립다세대의 주택 유형: "연립", "다세대", "연립다세대" */
  houseType: string | null;
  /** 응답 원자료 (trim, 빈 값은 null) */
  raw: RawItem;
}

export type DealView = Omit<Deal, "raw">;

/** "49,000"(만원) → 490000000(원). 숫자가 아니면 null */
export function parseManwon(value: string | null | undefined): number | null {
  const s = value?.replace(/,/g, "").trim();
  if (!s || !/^\d+$/.test(s)) return null;
  return Number(s) * 10_000;
}

function parseNumber(value: string | null | undefined): number | null {
  const s = value?.replace(/,/g, "").trim();
  if (!s || !/^[-\d.]+$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const pad2 = (s: string) => s.padStart(2, "0");

/** 응답 레코드를 Deal로. 계약일이나 시군구 코드가 없으면 null */
export function toDeal(service: ServiceId, item: RawItem): Deal | null {
  const def = SERVICES[service];
  const year = item.dealYear;
  const month = item.dealMonth;
  const day = item.dealDay;
  const lawdCode = item.sggCd;
  if (!year || !month || !day || !/^\d{4}$/.test(year) || !/^\d{1,2}$/.test(month) || !/^\d{1,2}$/.test(day)) return null;
  if (!lawdCode || !/^\d{5}$/.test(lawdCode)) return null;

  const contract = item.contractType;
  const floor = parseNumber(item.floor);
  const buildYear = parseNumber(item.buildYear);
  return {
    service,
    kind: def.kind,
    lawdCode,
    umd: item.umdNm ?? "",
    jibun: item.jibun ?? null,
    name: def.nameField ? (item[def.nameField] ?? null) : null,
    area: parseNumber(item[def.areaField]),
    areaKind: def.areaKind,
    floor: floor === null ? null : Math.trunc(floor),
    buildYear: buildYear === null ? null : Math.trunc(buildYear),
    date: `${year}-${pad2(month)}-${pad2(day)}`,
    price: def.kind === "sale" ? parseManwon(item.dealAmount) : null,
    deposit: def.kind === "rent" ? parseManwon(item.deposit) : null,
    monthlyRent: def.kind === "rent" ? parseManwon(item.monthlyRent) : null,
    contractType: contract === "신규" || contract === "갱신" ? contract : null,
    direct: item.dealingGbn === "직거래",
    cancelled: item.cdealType === "O",
    houseType: item.houseType ?? null,
    raw: item,
  };
}

export function stripRaw(deal: Deal): DealView {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { raw, ...view } = deal;
  return view;
}
