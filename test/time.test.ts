import { describe, expect, it } from "vitest";
import { addMonths, isValidYm, monthRange, monthsBack, todayKst } from "../src/core/time.js";

describe("time", () => {
  it("KST 기준 오늘", () => {
    expect(todayKst(new Date("2026-11-10T16:00:00Z"))).toBe("2026-11-11");
    expect(todayKst(new Date("2026-11-10T14:59:59Z"))).toBe("2026-11-10");
  });

  it("개월 더하기는 말일로 맞춘다", () => {
    expect(addMonths("2026-03-31", -1)).toBe("2026-02-28");
    expect(addMonths("2024-03-31", -1)).toBe("2024-02-29");
    expect(addMonths("2026-11-11", -12)).toBe("2025-11-11");
  });

  it("오늘이 속한 달부터 거꾸로", () => {
    expect(monthsBack("2026-11-11", 3)).toEqual(["202611", "202610", "202609"]);
    expect(monthsBack("2026-01-31", 2)).toEqual(["202601", "202512"]);
  });

  it("월 범위", () => {
    expect(monthRange("202511", "202602")).toEqual(["202511", "202512", "202601", "202602"]);
    expect(() => monthRange("202602", "202511")).toThrow();
  });

  it("계약년월 검증", () => {
    expect(isValidYm("202611", "2026-11-11")).toBe(true);
    expect(isValidYm("202612", "2026-11-11")).toBe(false);
    expect(isValidYm("200512", "2026-11-11")).toBe(false);
    expect(isValidYm("200601", "2026-11-11")).toBe(true);
    expect(isValidYm("2026-11", "2026-11-11")).toBe(false);
    expect(isValidYm("202613", "2026-11-11")).toBe(false);
  });
});
