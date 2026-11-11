import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryCache } from "../src/core/cache.js";
import { createClient, estimateRequests, MAX_REQUESTS } from "../src/core/client.js";
import { ApiError, BudgetError, InputError } from "../src/core/errors.js";
import { clearSecrets } from "../src/core/key.js";
import { emptyXml, fakeFetch, gatewayXml, KEY, tradeXml, xmlResponse } from "./helpers.js";

const NOW = new Date("2026-11-11T03:00:00Z"); // KST 12:00
const base = { serviceKey: KEY, now: () => NOW, retryDelaysMs: [0, 0, 0] };
const deal = (day: string, amount = "50,000") => ({ dealDay: day, dealAmount: amount });

afterEach(() => {
  clearSecrets();
  vi.restoreAllMocks();
});

describe("요청 형식", () => {
  it("키는 한 번만 인코딩하고 numOfRows 9999를 쓴다", async () => {
    const { fetch, calls } = fakeFetch(() => xmlResponse(tradeXml([deal("1")])));
    const client = createClient({ ...base, fetch });
    await client.fetchMonth("apt-sale", "36110", "202610");
    const url = calls[0]!.url;
    expect(url.origin + url.pathname).toBe("https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade");
    expect(url.searchParams.get("serviceKey")).toBe(KEY);
    expect(url.search).toContain("%2B");
    expect(url.search).not.toContain("%25");
    expect(url.searchParams.get("LAWD_CD")).toBe("36110");
    expect(url.searchParams.get("DEAL_YMD")).toBe("202610");
    expect(url.searchParams.get("numOfRows")).toBe("9999");
  });

  it("Encoding 키를 넣어도 같은 요청", async () => {
    const { fetch, calls } = fakeFetch(() => xmlResponse(emptyXml()));
    await createClient({ ...base, serviceKey: encodeURIComponent(KEY), fetch }).fetchMonth("apt-sale", "36110", "202610");
    expect(calls[0]!.url.searchParams.get("serviceKey")).toBe(KEY);
  });
});

describe("페이지 순회", () => {
  it("서버가 조용히 3건씩만 줘도 totalCount까지 받는다", async () => {
    const pages = [
      [deal("1"), deal("2"), deal("3")],
      [deal("4"), deal("5")],
    ];
    const { fetch, calls } = fakeFetch((url) => xmlResponse(tradeXml(pages[Number(url.searchParams.get("pageNo")) - 1] ?? [], { totalCount: 5 })));
    const deals = await createClient({ ...base, fetch }).fetchMonth("apt-sale", "36110", "202610");
    expect(deals).toHaveLength(5);
    expect(calls).toHaveLength(2);
  });

  it("빈 쪽에서 멈추고, 모자라면 작은 쪽 크기로 다시 받는다", async () => {
    const { fetch, calls } = fakeFetch((url) => {
      const page = url.searchParams.get("pageNo");
      if (url.searchParams.get("numOfRows") === "9999") return xmlResponse(page === "1" ? tradeXml([deal("1")], { totalCount: 2 }) : emptyXml());
      return xmlResponse(tradeXml([deal("1"), deal("2")]));
    });
    const deals = await createClient({ ...base, fetch }).fetchMonth("apt-sale", "36110", "202610");
    expect(deals).toHaveLength(2);
    expect(calls.map((c) => c.url.searchParams.get("numOfRows"))).toEqual(["9999", "9999", "1000"]);
  });

  it("끝내 모자라면 incomplete로 실패하고 캐시하지 않는다", async () => {
    const { fetch, calls } = fakeFetch((url) => xmlResponse(url.searchParams.get("pageNo") === "1" ? tradeXml([deal("1")], { totalCount: 9 }) : emptyXml()));
    const client = createClient({ ...base, fetch, cache: new MemoryCache() });
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await expect(client.fetchMonth("apt-sale", "36110", "202608")).rejects.toMatchObject({ kind: "incomplete" });
    const before = calls.length;
    await expect(client.fetchMonth("apt-sale", "36110", "202608")).rejects.toMatchObject({ kind: "incomplete" });
    expect(calls.length).toBeGreaterThan(before);
  });
});

describe("재시도와 오류", () => {
  it("429 두 번 뒤 성공", async () => {
    const { fetch, calls } = fakeFetch((_, n) => (n <= 2 ? new Response("", { status: 429 }) : xmlResponse(tradeXml([deal("1")]))));
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    expect(await createClient({ ...base, fetch }).fetchMonth("apt-sale", "36110", "202610")).toHaveLength(1);
    expect(calls).toHaveLength(3);
  });

  it("게이트웨이 23은 재시도한다", async () => {
    const { fetch, calls } = fakeFetch((_, n) => (n === 1 ? xmlResponse(gatewayXml("23"), 200) : xmlResponse(emptyXml())));
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await createClient({ ...base, fetch }).fetchMonth("apt-sale", "36110", "202610");
    expect(calls).toHaveLength(2);
  });

  it("403/30은 재시도하지 않고 활용신청 안내", async () => {
    const { fetch, calls } = fakeFetch(() => xmlResponse(gatewayXml("30"), 403));
    const err = await createClient({ ...base, fetch }).fetchMonth("rh-sale", "36110", "202610").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).kind).toBe("key_or_subscription");
    expect((err as ApiError).hint).toContain("15126467");
    expect(calls).toHaveLength(1);
  });

  it("다른 서비스가 성공한 뒤의 30은 미신청", async () => {
    const { fetch } = fakeFetch((url) => (url.pathname.includes("AptTrade") ? xmlResponse(emptyXml()) : xmlResponse(gatewayXml("30"), 403)));
    const client = createClient({ ...base, fetch });
    await client.fetchMonth("apt-sale", "36110", "202610");
    const err = await client.fetchMonth("rh-sale", "36110", "202610").catch((e: unknown) => e);
    expect((err as ApiError).kind).toBe("not_subscribed");
  });

  it("재시도를 다 써도 실패하면 오류", async () => {
    const { fetch, calls } = fakeFetch(() => new Response("bad gateway", { status: 502 }));
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const err = await createClient({ ...base, fetch }).fetchMonth("apt-sale", "36110", "202610").catch((e: unknown) => e);
    expect((err as ApiError).kind).toBe("upstream");
    expect(calls).toHaveLength(4);
  });

  it("키가 없으면 호출하지 않는다", async () => {
    const { fetch, calls } = fakeFetch(() => xmlResponse(emptyXml()));
    const err = await createClient({ ...base, serviceKey: null, fetch }).fetchMonth("apt-sale", "36110", "202610").catch((e: unknown) => e);
    expect((err as ApiError).kind).toBe("no_key");
    expect((err as ApiError).hint).toContain("DATA_GO_KR_SERVICE_KEY");
    expect(calls).toHaveLength(0);
  });

  it("응답이 너무 크면 중단", async () => {
    const { fetch } = fakeFetch(() => xmlResponse(tradeXml([deal("1")])));
    const err = await createClient({ ...base, fetch, maxBodyBytes: 100 }).fetchMonth("apt-sale", "36110", "202610").catch((e: unknown) => e);
    expect((err as ApiError).kind).toBe("too_large");
  });
});

describe("비밀값 유출 방지", () => {
  it("네트워크 오류의 원본 메시지(URL·키)를 버린다", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const { fetch } = fakeFetch((url) => {
      throw new TypeError(`Failed to parse URL from ${url.href}`);
    });
    const err = await createClient({ ...base, fetch }).fetchMonth("apt-sale", "36110", "202610").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    const text = `${(err as Error).message} ${(err as ApiError).hint} ${JSON.stringify(err)} ${String((err as Error).stack)}`;
    const logged = stderr.mock.calls.map((c) => String(c[0])).join("\n");
    for (const s of [text, logged]) {
      expect(s).not.toContain("testKEY1234");
      expect(s).not.toContain("serviceKey");
      expect(s).not.toContain("apis.data.go.kr");
    }
    expect((err as ApiError).kind).toBe("network");
  });
});

describe("입력 검증", () => {
  it("미래 달과 잘못된 코드는 호출 전에 막는다", async () => {
    const { fetch, calls } = fakeFetch(() => xmlResponse(emptyXml()));
    const client = createClient({ ...base, fetch, isQueryableLawd: (c) => c === "36110" });
    await expect(client.fetchMonth("apt-sale", "36110", "202612")).rejects.toBeInstanceOf(InputError);
    await expect(client.fetchMonth("apt-sale", "28110", "202610")).rejects.toBeInstanceOf(InputError);
    await expect(client.fetchMonth("apt-sale", "ABCDE", "202610")).rejects.toBeInstanceOf(InputError);
    expect(calls).toHaveLength(0);
  });
});

describe("fetchRange", () => {
  it("예산을 넘으면 실행하지 않는다", async () => {
    const { fetch, calls } = fakeFetch(() => xmlResponse(emptyXml()));
    const months = Array.from({ length: 21 }, (_, i) => `${2024 + Math.floor(i / 12)}${String((i % 12) + 1).padStart(2, "0")}`);
    const req = { services: ["apt-sale", "apt-rent"] as const, lawdCodes: ["11110", "11140"], months };
    expect(estimateRequests({ ...req, services: [...req.services] })).toBe(84);
    await expect(createClient({ ...base, fetch }).fetchRange({ ...req, services: [...req.services] })).rejects.toBeInstanceOf(BudgetError);
    expect(MAX_REQUESTS).toBe(80);
    expect(calls).toHaveLength(0);
  });

  it("한 달만 실패하면 나머지는 쓰고 실패를 알린다", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const { fetch } = fakeFetch((url) => (url.searchParams.get("DEAL_YMD") === "202609" ? new Response("", { status: 500 }) : xmlResponse(tradeXml([deal("1")]))));
    const result = await createClient({ ...base, fetch }).fetchRange({ services: ["apt-sale"], lawdCodes: ["36110"], months: ["202610", "202609", "202608"] });
    expect(result.deals).toHaveLength(2);
    expect(result.failures).toEqual([{ service: "apt-sale", lawdCode: "36110", ym: "202609", kind: "upstream", status: 500 }]);
  });

  it("모두 실패하면 오류를 올린다", async () => {
    const { fetch } = fakeFetch(() => xmlResponse(gatewayXml("30"), 403));
    await expect(createClient({ ...base, fetch }).fetchRange({ services: ["apt-sale"], lawdCodes: ["36110"], months: ["202610", "202609"] })).rejects.toBeInstanceOf(ApiError);
  });

  it("동시 호출은 4건까지", async () => {
    let active = 0;
    let peak = 0;
    const { fetch } = fakeFetch(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return xmlResponse(emptyXml());
    });
    const months = ["202610", "202609", "202608", "202607", "202606", "202605", "202604", "202603"];
    await createClient({ ...base, fetch }).fetchRange({ services: ["apt-sale"], lawdCodes: ["36110"], months });
    expect(peak).toBe(4);
  });
});

describe("캐시", () => {
  it("지난 달 이전은 30일, 최근 두 달은 하루", async () => {
    let now = NOW;
    const { fetch, calls } = fakeFetch(() => xmlResponse(tradeXml([deal("1")])));
    const client = createClient({ ...base, now: () => now, fetch, cache: new MemoryCache() });
    await client.fetchMonth("apt-sale", "36110", "202608");
    await client.fetchMonth("apt-sale", "36110", "202610");
    now = new Date(NOW.getTime() + 2 * 86_400_000);
    await client.fetchMonth("apt-sale", "36110", "202608");
    await client.fetchMonth("apt-sale", "36110", "202610");
    expect(calls.map((c) => c.url.searchParams.get("DEAL_YMD"))).toEqual(["202608", "202610", "202610"]);
  });

  it("실패는 캐시하지 않는다", async () => {
    const { fetch, calls } = fakeFetch((_, n) => (n === 1 ? xmlResponse(gatewayXml("22"), 200) : xmlResponse(emptyXml())));
    const client = createClient({ ...base, fetch, cache: new MemoryCache() });
    await expect(client.fetchMonth("apt-sale", "36110", "202608")).rejects.toBeInstanceOf(ApiError);
    await client.fetchMonth("apt-sale", "36110", "202608");
    expect(calls).toHaveLength(2);
  });

  it("raw 옵션은 원자료를 담는다", async () => {
    const { fetch } = fakeFetch(() => xmlResponse(tradeXml([deal("1")])));
    const [d] = await createClient({ ...base, fetch }).fetchMonth("apt-sale", "36110", "202610", { raw: true });
    expect(d).toHaveProperty("raw.aptNm");
  });
});

describe("probe", () => {
  it("서비스별 상태", async () => {
    const { fetch } = fakeFetch((url) => (url.pathname.includes("AptTrade") ? xmlResponse(emptyXml()) : xmlResponse(gatewayXml("30"), 403)));
    const client = createClient({ ...base, fetch });
    // rh-sale이 먼저 실패해도 모두 끝난 뒤 판정하므로 미신청으로 좁혀진다
    const r = await client.probe(["rh-sale", "apt-sale"]);
    expect(r.get("apt-sale")).toEqual({ ok: true });
    expect(r.get("rh-sale")).toMatchObject({ ok: false, kind: "not_subscribed" });
  });
});

describe("리뷰 회귀 테스트", () => {
  it("B1: 본문을 읽다 끊겨도 ApiError로 바꾸고 재시도한다", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const { fetch, calls } = fakeFetch((_, n) => {
      if (n > 1) return xmlResponse(emptyXml());
      const body = new ReadableStream({
        start(c) {
          c.error(new DOMException(`timed out https://x/?serviceKey=${encodeURIComponent(KEY)}`, "TimeoutError"));
        },
      });
      return new Response(body, { status: 200 });
    });
    await createClient({ ...base, fetch }).fetchMonth("apt-sale", "36110", "202610");
    expect(calls).toHaveLength(2);
  });

  it("B2: 본문 읽기까지 동시 4건", async () => {
    let open = 0;
    let peak = 0;
    const { fetch } = fakeFetch(() => {
      open++;
      peak = Math.max(peak, open);
      const text = emptyXml();
      const body = new ReadableStream({
        async pull(c) {
          await new Promise((r) => setTimeout(r, 5));
          c.enqueue(new TextEncoder().encode(text));
          c.close();
          open--;
        },
      });
      return new Response(body, { status: 200 });
    });
    const months = ["202610", "202609", "202608", "202607", "202606", "202605", "202604", "202603"];
    await createClient({ ...base, fetch }).fetchRange({ services: ["apt-sale"], lawdCodes: ["36110"], months });
    expect(peak).toBeLessThanOrEqual(4);
  });

  it("B3: limiter는 대기자에게 슬롯을 넘긴다", async () => {
    const { limiter } = await import("../src/core/client.js");
    const run = limiter(1);
    let active = 0;
    let peak = 0;
    const task = async () => {
      active++;
      peak = Math.max(peak, active);
      await Promise.resolve();
      active--;
    };
    const first = run(task);
    const second = run(task);
    await first;
    const third = run(task); // 대기자가 재개되기 전에 끼어드는 호출
    await Promise.all([second, third]);
    expect(peak).toBe(1);
  });

  it("B4: 30이 성공보다 먼저 와도 미신청으로 분류", async () => {
    const { fetch } = fakeFetch(async (url) => {
      if (url.pathname.includes("AptTrade")) {
        await new Promise((r) => setTimeout(r, 10));
        return xmlResponse(emptyXml());
      }
      return xmlResponse(gatewayXml("30"), 403);
    });
    const r = await createClient({ ...base, fetch }).fetchRange({ services: ["rh-sale", "apt-sale"], lawdCodes: ["36110"], months: ["202610"] });
    expect(r.failures).toEqual([expect.objectContaining({ service: "rh-sale", kind: "not_subscribed" })]);
  });

  it("B5: 받을 때 최근 달이었으면 하루 뒤 다시 받는다", async () => {
    let now = new Date("2026-11-01T15:00:00Z"); // KST 11-02
    const { fetch, calls } = fakeFetch(() => xmlResponse(tradeXml([deal("1")])));
    const client = createClient({ ...base, now: () => now, fetch, cache: new MemoryCache() });
    await client.fetchMonth("apt-sale", "36110", "202610");
    now = new Date("2026-11-30T15:00:00Z"); // KST 12-01, 29일 뒤
    await client.fetchMonth("apt-sale", "36110", "202610");
    expect(calls).toHaveLength(2);
  });

  it("B7: 같은 입력을 겹쳐 넣어도 한 번만", async () => {
    const { fetch, calls } = fakeFetch(() => xmlResponse(tradeXml([deal("1"), deal("2")])));
    const r = await createClient({ ...base, fetch }).fetchRange({ services: ["apt-sale", "apt-sale"], lawdCodes: ["36110", "36110"], months: ["202610", "202610"] });
    expect(r.deals).toHaveLength(2);
    expect(calls).toHaveLength(1);
    expect(r).toMatchObject({ estimatedRequests: 1, requests: 1 });
  });

  it("B8: 시군구 코드가 없으면 요청 코드로, 전부 해석 못 하면 schema 오류", async () => {
    const { fetch } = fakeFetch((url) =>
      xmlResponse(url.searchParams.get("DEAL_YMD") === "202610" ? tradeXml([{ ...deal("1"), sggCd: " " }]) : tradeXml([{ dealYear: " ", dealDay: "1" }])),
    );
    const client = createClient({ ...base, fetch });
    const [d] = await client.fetchMonth("apt-sale", "36110", "202610");
    expect(d?.lawdCode).toBe("36110");
    await expect(client.fetchMonth("apt-sale", "36110", "202609")).rejects.toMatchObject({ kind: "schema" });
  });

  it("I1: 5xx와 함께 와도 30은 재시도하지 않는다", async () => {
    const { fetch, calls } = fakeFetch(() => xmlResponse(gatewayXml("30"), 500));
    await expect(createClient({ ...base, fetch }).fetchMonth("apt-sale", "36110", "202610")).rejects.toBeInstanceOf(ApiError);
    expect(calls).toHaveLength(1);
  });

  it("I2: 일일 한도를 넘으면 남은 요청을 보내지 않는다", async () => {
    const { fetch, calls } = fakeFetch(() => xmlResponse(gatewayXml("22")));
    const months = ["202610", "202609", "202608", "202607", "202606", "202605", "202604", "202603", "202602", "202601"];
    await expect(createClient({ ...base, fetch, concurrency: 1 }).fetchRange({ services: ["apt-sale"], lawdCodes: ["36110"], months })).rejects.toMatchObject({ kind: "daily_limit" });
    expect(calls).toHaveLength(1);
  });

  it("I9: 같은 달을 동시에 부르면 요청 한 번", async () => {
    const { fetch, calls } = fakeFetch(() => xmlResponse(tradeXml([deal("1")])));
    const client = createClient({ ...base, fetch });
    await Promise.all([client.fetchMonth("apt-sale", "36110", "202610"), client.fetchMonth("apt-sale", "36110", "202610")]);
    expect(calls).toHaveLength(1);
  });

  it("I12: 빈 입력은 오류", async () => {
    const { fetch } = fakeFetch(() => xmlResponse(emptyXml()));
    await expect(createClient({ ...base, fetch }).fetchRange({ services: [], lawdCodes: ["36110"], months: ["202610"] })).rejects.toBeInstanceOf(InputError);
  });

  it("실측 오류 응답(403, charset 없음)도 같은 해석", async () => {
    const { fixture } = await import("./helpers.js");
    const { fetch } = fakeFetch(() => new Response(fixture("live/errors/unsubscribed-service.xml"), { status: 403, headers: { "content-type": "application/xml" } }));
    await expect(createClient({ ...base, fetch }).fetchMonth("rh-sale", "36110", "202610")).rejects.toMatchObject({ kind: "key_or_subscription" });
  });

  it("fetch 옵션: redirect error, signal", async () => {
    let init: RequestInit | undefined;
    const fetch = (async (_: unknown, i?: RequestInit) => {
      init = i;
      return xmlResponse(emptyXml());
    }) as typeof globalThis.fetch;
    await createClient({ ...base, fetch }).fetchMonth("apt-sale", "36110", "202610");
    expect(init?.redirect).toBe("error");
    expect(init?.signal).toBeDefined();
    expect(init?.credentials).toBeUndefined();
  });

  it("재시도 로그에도 키가 없다", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const { fetch } = fakeFetch((_, n) => (n === 1 ? new Response("", { status: 429 }) : xmlResponse(emptyXml())));
    await createClient({ ...base, fetch }).fetchMonth("apt-sale", "36110", "202610");
    const logged = stderr.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain("attempt");
    expect(logged).not.toContain("testKEY1234");
  });
});
