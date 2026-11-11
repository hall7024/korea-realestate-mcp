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

  it("빈 쪽이 오면 멈춘다", async () => {
    const { fetch, calls } = fakeFetch((url) => xmlResponse(url.searchParams.get("pageNo") === "1" ? tradeXml([deal("1")], { totalCount: 9 }) : emptyXml()));
    const deals = await createClient({ ...base, fetch }).fetchMonth("apt-sale", "36110", "202610");
    expect(deals).toHaveLength(1);
    expect(calls).toHaveLength(2);
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
    const months = Array.from({ length: 21 }, (_, i) => `2025${String((i % 12) + 1).padStart(2, "0")}`);
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
    expect(result.failures).toEqual([{ service: "apt-sale", lawdCode: "36110", ym: "202609", kind: "upstream" }]);
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
    expect(await client.probe("apt-sale")).toEqual({ ok: true });
    expect(await client.probe("rh-sale")).toMatchObject({ ok: false, kind: "not_subscribed" });
  });
});
