import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseManwon, stripRaw, toDeal } from "../src/core/normalize.js";
import { parseResponse, type RawItem } from "../src/core/parse.js";
import { SERVICES, type ServiceId } from "../src/core/services.js";

function items(path: string): RawItem[] {
  const page = parseResponse(readFileSync(new URL(`./fixtures/${path}`, import.meta.url), "utf8"));
  if (!page.ok) throw new Error(`fixture not ok: ${path}`);
  return page.items;
}

describe("parseManwon", () => {
  it("만원 단위 콤마 문자열을 원으로", () => {
    expect(parseManwon("49,000")).toBe(490_000_000);
    expect(parseManwon(" 100,250 ")).toBe(1_002_500_000);
    expect(parseManwon("85")).toBe(850_000);
    expect(parseManwon("0")).toBe(0);
    expect(parseManwon(null)).toBeNull();
    expect(parseManwon("abc")).toBeNull();
  });
});

describe("toDeal", () => {
  it("아파트 매매", () => {
    const deal = toDeal("apt-sale", items("live/RTMSDataSvcAptTrade.xml")[0]!);
    expect(deal).toMatchObject({
      service: "apt-sale",
      kind: "sale",
      lawdCode: "36110",
      umd: "고운동",
      jibun: "1387",
      name: "가락마을22단지(에듀힐스)",
      area: 96.1416,
      areaKind: "exclusive",
      floor: 7,
      buildYear: 2015,
      date: "2026-10-30",
      price: 490_000_000,
      deposit: null,
      monthlyRent: null,
      direct: false,
      cancelled: false,
    });
    expect(deal?.raw.aptNm).toBe("가락마을22단지(에듀힐스)");
  });

  it("연립다세대 매매: 직거래, 주택 유형", () => {
    const deal = toDeal("rh-sale", items("live/RTMSDataSvcRHTrade2.xml")[0]!);
    expect(deal).toMatchObject({ name: "서창연립", direct: true, houseType: "연립", price: 48_000_000, umd: "조치원읍 서창리" });
  });

  it("연립다세대 전월세: 갱신, 월세, 연립다세대", () => {
    const deal = toDeal("rh-rent", items("live/RTMSDataSvcRHRent.xml")[0]!);
    expect(deal).toMatchObject({ kind: "rent", deposit: 3_000_000, monthlyRent: 530_000, contractType: "갱신", houseType: "연립다세대", price: null });
  });

  it("아파트 전월세: 계약 구분 공백은 null", () => {
    const deal = toDeal("apt-rent", items("live/RTMSDataSvcAptRent.xml")[0]!);
    expect(deal).toMatchObject({ name: "신동아", deposit: 99_000_000, monthlyRent: 0, contractType: null, area: 59 });
  });

  it("해제 거래", () => {
    const deal = toDeal("rh-sale", items("synthetic/cancelled-entity.xml")[0]!);
    expect(deal?.cancelled).toBe(true);
    expect(deal?.name).toBe("A&B 빌라");
  });

  it("날짜가 없으면 버린다", () => {
    const item = { ...items("live/RTMSDataSvcAptTrade.xml")[0]!, dealDay: null };
    expect(toDeal("apt-sale", item)).toBeNull();
  });

  it("오피스텔 전월세: 신규 전세", () => {
    const deal = toDeal("offi-rent", items("live/RTMSDataSvcOffiRent.xml")[0]!);
    expect(deal).toMatchObject({ name: "산울마을 6단지", deposit: 100_000_000, monthlyRent: 0, contractType: "신규", area: 23.29, floor: 4 });
  });

  it("단독·다가구 전월세: 연면적, 이름 없음", () => {
    const deal = toDeal("sh-rent", items("live/RTMSDataSvcSHRent.xml")[0]!);
    expect(deal).toMatchObject({ name: null, areaKind: "floor_total", area: 30, houseType: "다가구", deposit: 2_000_000, monthlyRent: 280_000 });
  });

  it("13종 실측 레코드가 모두 정규화된다", () => {
    for (const [service, def] of Object.entries(SERVICES) as [ServiceId, (typeof SERVICES)[ServiceId]][]) {
      const deals = items(`live/${def.service}.xml`).map((i) => toDeal(service, i));
      expect(deals.length, service).toBeGreaterThan(0);
      expect(deals.every((d) => d !== null && d.area !== null && d.area > 0), service).toBe(true);
      if (def.nameField) expect(deals.every((d) => d?.name), service).toBe(true);
    }
  });

  it("stripRaw는 원자료를 뺀다", () => {
    const deal = toDeal("offi-sale", items("live/RTMSDataSvcOffiTrade.xml")[0]!)!;
    expect(stripRaw(deal)).not.toHaveProperty("raw");
    expect(stripRaw(deal).name).toBe("푸르지오시티");
  });
});
