import { describe, expect, it } from "vitest";
import { InputError } from "../src/core/errors.js";
import { isQueryableLawd, regionLabel, resolveRegion } from "../src/core/region.js";

const codes = (q: string) => resolveRegion(q).matches.map((m) => m.lawdCodes);

describe("resolveRegion", () => {
  it("시군구 이름 하나", () => {
    expect(codes("강남구")).toEqual([["11680"]]);
    expect(codes("서울 강남구")).toEqual([["11680"]]);
    expect(codes("서울특별시 강남구")).toEqual([["11680"]]);
    expect(resolveRegion("강남구").matches[0]!.label).toBe("서울특별시 강남구");
  });

  it("겹치는 이름은 후보 여러 개", () => {
    const m = resolveRegion("중구").matches;
    expect(m.length).toBeGreaterThan(3);
    expect(m.map((x) => x.label)).toContain("서울특별시 중구");
    expect(codes("서울 중구")).toEqual([["11140"]]);
  });

  it("시군구 + 법정동", () => {
    const m = resolveRegion("마포구 아현동").matches;
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ lawdCodes: ["11440"], umd: "아현동" });
  });

  it("법정동만", () => {
    const m = resolveRegion("아현동").matches;
    expect(m.some((x) => x.lawdCodes[0] === "11440" && x.umd === "아현동")).toBe(true);
  });

  it("읍 아래 리", () => {
    const m = resolveRegion("세종 조치원읍 죽림리").matches;
    expect(m).toEqual([expect.objectContaining({ lawdCodes: ["36110"], umd: "조치원읍 죽림리" })]);
  });

  it("하위 구가 있는 시는 구 전체로", () => {
    expect(codes("수원시")).toEqual([["41111", "41113", "41115", "41117"]]);
    expect(codes("화성시")).toEqual([["41591", "41593", "41595", "41597"]]);
    expect(codes("수원시 영통구")).toEqual([["41117"]]);
    expect(codes("영통구")).toEqual([["41117"]]);
  });

  it("하위 구가 있는 시 + 법정동은 그 동이 속한 구로", () => {
    const m = resolveRegion("수원시 매탄동").matches;
    expect(m).toEqual([expect.objectContaining({ lawdCodes: ["41117"], umd: "매탄동" })]);
  });

  it("2026-07 개편 전 이름은 새 코드로", () => {
    const r = resolveRegion("인천 중구");
    expect(r.matches).toHaveLength(1);
    expect(r.matches[0]!.lawdCodes).toEqual(["28125", "28155"]);
    expect(r.note).toContain("바뀌");
    expect(codes("광주 북구")).toEqual([["12300"]]);
    expect(codes("광주광역시 북구")).toEqual([["12300"]]);
    expect(codes("전라남도 목포시")).toEqual([["12110"]]);
    expect(codes("강원도 강릉시")).toEqual([["51150"]]);
  });

  it("코드 입력", () => {
    expect(codes("36110")).toEqual([["36110"]]);
    expect(codes("41590")).toEqual([["41591", "41593", "41595", "41597"]]);
    expect(codes("28110")).toEqual([["28125", "28155"]]);
    expect(codes("1144010100")).toEqual([["11440"]]);
    expect(codes("99999")).toEqual([]);
  });

  it("없는 지역은 빈 결과", () => {
    expect(resolveRegion("가나다라구").matches).toEqual([]);
  });

  it("빈 입력과 너무 긴 입력은 오류", () => {
    expect(() => resolveRegion("  ")).toThrow(InputError);
    expect(() => resolveRegion("가".repeat(51))).toThrow(InputError);
  });
});

describe("코드 조회", () => {
  it("조회 가능 여부", () => {
    expect(isQueryableLawd("11680")).toBe(true);
    expect(isQueryableLawd("41590")).toBe(false);
    expect(isQueryableLawd("28110")).toBe(false);
    expect(isQueryableLawd("ABCDE")).toBe(false);
  });

  it("이름", () => {
    expect(regionLabel("11680")).toBe("서울특별시 강남구");
    expect(regionLabel("36110")).toBe("세종특별자치시");
    expect(regionLabel("41117")).toBe("경기도 수원시 영통구");
  });
});

describe("MCP 리뷰 회귀 (지역)", () => {
  it("M1: 후보의 query를 그대로 다시 넣으면 그 지역 하나", () => {
    for (const q of ["신사동", "중구", "인천 중구", "수원시", "아현동", "광주 북구", "세종 죽림리", "인천 서구", "화성시 동탄구"]) {
      for (const c of resolveRegion(q).matches) {
        const again = resolveRegion(c.query).matches;
        expect(again, `${q} → ${c.query}`).toHaveLength(1);
        expect(again[0]).toMatchObject({ lawdCodes: c.lawdCodes, ...(c.umd ? { umd: c.umd } : {}) });
      }
    }
  });

  it("M1: 법정동 후보의 query에는 법정동이 들어 있다", () => {
    const m = resolveRegion("신사동").matches;
    expect(m.length).toBeGreaterThan(1);
    expect(m.every((x) => x.query.endsWith("신사동"))).toBe(true);
  });

  it("M2: 10자리 법정동코드는 법정동까지", () => {
    expect(resolveRegion("1144010100").matches).toEqual([expect.objectContaining({ lawdCodes: ["11440"], umd: "아현동" })]);
    expect(resolveRegion("1144000000").matches[0]).not.toHaveProperty("umd");
  });

  it("M3: 광주시는 경기도 광주시", () => {
    expect(codes("광주시")).toEqual([["41610"]]);
    expect(resolveRegion("광주시 곤지암읍").matches[0]).toMatchObject({ lawdCodes: ["41610"], umd: "곤지암읍" });
    expect(codes("서울시 강남구")).toEqual([["11680"]]);
  });

  it("I1: 행정동과 줄임말", () => {
    expect(resolveRegion("강남구 역삼1동").matches[0]).toMatchObject({ lawdCodes: ["11680"], umd: "역삼동" });
    expect(codes("강남")).toEqual([["11680"]]);
    expect(codes("화성시 동탄")).toEqual([["41597"]]);
    expect(resolveRegion("강남").note).toContain("강남구");
  });
});
