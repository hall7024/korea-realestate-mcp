import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { apiErrorFrom, parseResponse } from "../src/core/parse.js";
import { serviceFor, serviceUrl, SERVICE_IDS } from "../src/core/services.js";

const live = (name: string) => readFileSync(new URL(`./fixtures/live/${name}`, import.meta.url), "utf8");
const synthetic = (name: string) => readFileSync(new URL(`./fixtures/synthetic/${name}`, import.meta.url), "utf8");

describe("services", () => {
  it("13종이고 아파트 매매는 기본 서비스를 쓴다", () => {
    expect(SERVICE_IDS).toHaveLength(13);
    expect(serviceFor("apt", "sale")).toBe("apt-sale");
    expect(serviceFor("rh", "rent")).toBe("rh-rent");
    expect(() => serviceFor("land", "rent")).toThrow();
    expect(serviceUrl("rh-sale")).toBe("https://apis.data.go.kr/1613000/RTMSDataSvcRHTrade2/getRTMSDataSvcRHTrade2");
  });
});

describe("parseResponse: 실측 정상 응답", () => {
  it.each([
    ["RTMSDataSvcAptTrade.xml", 10, 674],
    ["RTMSDataSvcAptRent.xml", 10, 1574],
    ["RTMSDataSvcRHTrade2.xml", 8, 8],
    ["RTMSDataSvcRHRent.xml", 10, 47],
    ["RTMSDataSvcOffiTrade.xml", 10, 22],
  ])("%s", (file, items, total) => {
    const page = parseResponse(live(file));
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    expect(page.items).toHaveLength(items);
    expect(page.totalCount).toBe(total);
  });

  it("값은 문자열 그대로, 공백 한 칸은 null", () => {
    const page = parseResponse(live("RTMSDataSvcAptTrade.xml"));
    if (!page.ok) throw new Error("not ok");
    const first = page.items[0]!;
    expect(first.jibun).toBe("1387");
    expect(first.sggCd).toBe("36110");
    expect(first.dealAmount).toBe("49,000");
    expect(first.aptDong).toBeNull();
    expect(first.cdealType).toBeNull();
  });
});

describe("parseResponse: 경계", () => {
  it("빈 결과 <items/>", () => {
    const page = parseResponse(live("errors/invalid-lawd-cd.xml"));
    expect(page).toMatchObject({ ok: true, items: [], totalCount: 0 });
  });

  it("1건이어도 배열", () => {
    const page = parseResponse(synthetic("single-item.xml"));
    if (!page.ok) throw new Error("not ok");
    expect(page.items).toHaveLength(1);
  });

  it("엔티티를 복원하고 해제 표시를 읽는다", () => {
    const page = parseResponse(synthetic("cancelled-entity.xml"));
    if (!page.ok) throw new Error("not ok");
    expect(page.items[0]!.mhouseNm).toBe("A&B 빌라");
    expect(page.items[0]!.cdealType).toBe("O");
  });

  it("DOCTYPE은 거부한다", () => {
    expect(parseResponse(synthetic("doctype.xml"))).toMatchObject({ ok: false, code: "parse" });
  });

  it("resultCode 03은 빈 결과", () => {
    expect(parseResponse(synthetic("nodata-03.xml"))).toMatchObject({ ok: true, items: [], totalCount: 0 });
  });

  it("알 수 없는 resultCode는 오류", () => {
    expect(parseResponse(synthetic("result-error.xml"))).toMatchObject({ ok: false, code: "99" });
  });

  it("XML이 아니면 오류", () => {
    expect(parseResponse("<html>gateway timeout")).toMatchObject({ ok: false, code: "parse" });
  });
});

describe("parseResponse: 게이트웨이 오류", () => {
  it.each([
    ["errors/invalid-key.xml", "30"],
    ["errors/double-encoded-key.xml", "30"],
    ["errors/unsubscribed-service.xml", "30"],
    ["errors/old-path-rhtrade.xml", "30"],
    ["errors/missing-key.xml", "20"],
  ])("%s → %s", (file, code) => {
    expect(parseResponse(live(file))).toMatchObject({ ok: false, code });
  });
});

describe("apiErrorFrom", () => {
  it("30은 키 오류와 미신청을 함께 안내한다", () => {
    const e = apiErrorFrom("apt-sale", 403, "30");
    expect(e.kind).toBe("key_or_subscription");
    expect(e.hint).toContain("15126469");
    expect(e.hint).toContain("DATA_GO_KR_SERVICE_KEY");
  });

  it("다른 서비스가 성공했으면 미신청으로 좁힌다", () => {
    expect(apiErrorFrom("rh-sale", 403, "30", { keyWorks: true }).kind).toBe("not_subscribed");
  });

  it.each([
    ["20", "no_key"],
    ["22", "daily_limit"],
    ["23", "rate_limit"],
    ["31", "expired"],
    ["10", "bad_request"],
    ["99", "upstream"],
  ])("%s → %s", (code, kind) => {
    expect(apiErrorFrom("apt-sale", 200, code).kind).toBe(kind);
  });

  it("코드가 없으면 HTTP 상태로", () => {
    expect(apiErrorFrom("apt-sale", 429, undefined).kind).toBe("rate_limit");
    expect(apiErrorFrom("apt-sale", 502, undefined).kind).toBe("upstream");
  });
});
