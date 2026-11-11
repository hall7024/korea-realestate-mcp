import { describe, expect, it } from "vitest";
import { kstTimestamp, pct, sourceLine, sqm, table, won } from "../src/core/format.js";

describe("format", () => {
  it("금액", () => {
    expect(won(850_000_000)).toBe("8억 5,000만원");
    expect(won(99_000_000)).toBe("9,900만원");
    expect(won(300_000_000)).toBe("3억원");
    expect(won(1_234_567_890)).toBe("12억 3,457만원");
    expect(won(530_000)).toBe("53만원");
    expect(won(5_000)).toBe("5,000원");
    expect(won(999_995_000)).toBe("10억원");
  });

  it("비율·면적", () => {
    expect(pct(72.44)).toBe("72.4%");
    expect(sqm(84.9712)).toBe("84.97㎡");
    expect(sqm(59)).toBe("59㎡");
  });

  it("표는 | 를 이스케이프한다", () => {
    expect(table(["a", "b"], [["x|y", 1]])).toBe("| a | b |\n|---|---|\n| x\\|y | 1 |");
  });

  it("출처 줄", () => {
    const now = new Date("2026-11-11T13:40:00Z");
    expect(kstTimestamp(now)).toBe("2026-11-11 22:40 KST");
    expect(sourceLine(now)).toContain("국토교통부 실거래가");
  });
});
