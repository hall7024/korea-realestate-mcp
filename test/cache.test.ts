import { describe, expect, it } from "vitest";
import { MemoryCache } from "../src/core/cache.js";

describe("MemoryCache", () => {
  it("바이트 상한을 넘으면 가장 오래 안 쓴 것부터 버린다", () => {
    const cache = new MemoryCache(60);
    const entry = { deals: [], fetchedAt: 1 }; // JSON 약 26자
    cache.set("a", entry);
    cache.set("b", entry);
    cache.get("a"); // a를 최근으로
    cache.set("c", entry);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBeDefined();
    expect(cache.get("c")).toBeDefined();
  });

  it("상한보다 큰 항목은 넣지 않는다", () => {
    const cache = new MemoryCache(10);
    cache.set("a", { deals: [], fetchedAt: 1 });
    expect(cache.size).toBe(0);
  });
});
