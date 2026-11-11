import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseManwon, stripRaw, toDeal } from "../src/core/normalize.js";
import { parseResponse, type RawItem } from "../src/core/parse.js";

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

  it("모든 실측 레코드가 정규화된다", () => {
    const pairs = [
      ["apt-sale", "RTMSDataSvcAptTrade"],
      ["apt-rent", "RTMSDataSvcAptRent"],
      ["rh-sale", "RTMSDataSvcRHTrade2"],
      ["rh-rent", "RTMSDataSvcRHRent"],
      ["offi-sale", "RTMSDataSvcOffiTrade"],
    ] as const;
    for (const [service, file] of pairs) {
      const deals = items(`live/${file}.xml`).map((i) => toDeal(service, i));
      expect(deals.every((d) => d !== null && d.area !== null && d.area > 0)).toBe(true);
    }
  });

  it("stripRaw는 원자료를 뺀다", () => {
    const deal = toDeal("offi-sale", items("live/RTMSDataSvcOffiTrade.xml")[0]!)!;
    expect(stripRaw(deal)).not.toHaveProperty("raw");
    expect(stripRaw(deal).name).toBe("푸르지오시티");
  });
});
