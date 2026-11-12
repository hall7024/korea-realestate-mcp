import { InputError } from "./errors.js";

export const BASE_URL = "https://apis.data.go.kr/1613000";

export type PropertyType = "apt" | "rh" | "sh" | "offi" | "presale" | "commercial" | "land" | "industrial";
export type DealKind = "sale" | "rent";
/** exclusive: 전용면적, floor_total: 연면적, land: 대지면적, deal: 거래면적, building: 건물면적 */
export type AreaKind = "exclusive" | "floor_total" | "land" | "deal" | "building";

export interface ServiceDef {
  /** 공공데이터포털 서비스 이름. 요청 경로는 /{service}/get{service} */
  service: string;
  /** 활용신청할 데이터셋 번호 (data.go.kr/data/{dataset}/openapi.do) */
  dataset: string;
  label: string;
  propertyType: PropertyType;
  kind: DealKind;
  /** 단지·건물 이름 필드. 없으면 null */
  nameField: string | null;
  areaField: string;
  areaKind: AreaKind;
}

export const SERVICES = {
  "apt-sale": { service: "RTMSDataSvcAptTrade", dataset: "15126469", label: "아파트 매매", propertyType: "apt", kind: "sale", nameField: "aptNm", areaField: "excluUseAr", areaKind: "exclusive" },
  "apt-sale-detail": { service: "RTMSDataSvcAptTradeDev", dataset: "15126468", label: "아파트 매매 상세", propertyType: "apt", kind: "sale", nameField: "aptNm", areaField: "excluUseAr", areaKind: "exclusive" },
  "apt-rent": { service: "RTMSDataSvcAptRent", dataset: "15126474", label: "아파트 전월세", propertyType: "apt", kind: "rent", nameField: "aptNm", areaField: "excluUseAr", areaKind: "exclusive" },
  presale: { service: "RTMSDataSvcSilvTrade", dataset: "15126471", label: "분양·입주권 전매", propertyType: "presale", kind: "sale", nameField: "aptNm", areaField: "excluUseAr", areaKind: "exclusive" },
  "rh-sale": { service: "RTMSDataSvcRHTrade2", dataset: "15126467", label: "연립다세대 매매", propertyType: "rh", kind: "sale", nameField: "mhouseNm", areaField: "excluUseAr", areaKind: "exclusive" },
  "rh-rent": { service: "RTMSDataSvcRHRent", dataset: "15126473", label: "연립다세대 전월세", propertyType: "rh", kind: "rent", nameField: "mhouseNm", areaField: "excluUseAr", areaKind: "exclusive" },
  "sh-sale": { service: "RTMSDataSvcSHTrade", dataset: "15126465", label: "단독·다가구 매매", propertyType: "sh", kind: "sale", nameField: null, areaField: "totalFloorAr", areaKind: "floor_total" },
  "sh-rent": { service: "RTMSDataSvcSHRent", dataset: "15126472", label: "단독·다가구 전월세", propertyType: "sh", kind: "rent", nameField: null, areaField: "totalFloorAr", areaKind: "floor_total" },
  "offi-sale": { service: "RTMSDataSvcOffiTrade", dataset: "15126464", label: "오피스텔 매매", propertyType: "offi", kind: "sale", nameField: "offiNm", areaField: "excluUseAr", areaKind: "exclusive" },
  "offi-rent": { service: "RTMSDataSvcOffiRent", dataset: "15126475", label: "오피스텔 전월세", propertyType: "offi", kind: "rent", nameField: "offiNm", areaField: "excluUseAr", areaKind: "exclusive" },
  "commercial-sale": { service: "RTMSDataSvcNrgTrade", dataset: "15126463", label: "상업업무용 매매", propertyType: "commercial", kind: "sale", nameField: null, areaField: "buildingAr", areaKind: "building" },
  "land-sale": { service: "RTMSDataSvcLandTrade", dataset: "15126466", label: "토지 매매", propertyType: "land", kind: "sale", nameField: null, areaField: "dealArea", areaKind: "deal" },
  "industrial-sale": { service: "RTMSDataSvcInduTrade", dataset: "15126470", label: "공장·창고 매매", propertyType: "industrial", kind: "sale", nameField: null, areaField: "buildingAr", areaKind: "building" },
} as const satisfies Record<string, ServiceDef>;

export type ServiceId = keyof typeof SERVICES;
export const SERVICE_IDS = Object.keys(SERVICES) as ServiceId[];
export const PROPERTY_TYPES = ["apt", "rh", "sh", "offi", "presale", "commercial", "land", "industrial"] as const satisfies readonly PropertyType[];
/** 시세·전세가율 분석을 지원하는 유형 */
export const ANALYZABLE_TYPES = ["apt", "rh", "offi"] as const satisfies readonly PropertyType[];
export type AnalyzableType = (typeof ANALYZABLE_TYPES)[number];

export const PROPERTY_LABELS: Record<PropertyType, string> = {
  apt: "아파트",
  rh: "연립다세대",
  sh: "단독·다가구",
  offi: "오피스텔",
  presale: "분양·입주권",
  commercial: "상업업무용",
  land: "토지",
  industrial: "공장·창고",
};

export function serviceDef(id: ServiceId): ServiceDef {
  return SERVICES[id];
}

/** 유형과 거래 종류로 서비스를 고른다. 아파트 매매는 기본 서비스(apt-sale)를 쓴다 */
export function serviceFor(propertyType: PropertyType, kind: DealKind): ServiceId {
  const id = SERVICE_IDS.find((s) => s !== "apt-sale-detail" && SERVICES[s].propertyType === propertyType && SERVICES[s].kind === kind);
  if (!id) throw new InputError(`${PROPERTY_LABELS[propertyType]}은(는) 전월세 자료가 없습니다.`, "dealType을 sale로 바꿔 주세요.");
  return id;
}

export function serviceUrl(id: ServiceId): string {
  const { service } = SERVICES[id];
  return `${BASE_URL}/${service}/get${service}`;
}
