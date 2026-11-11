import { readFileSync } from "node:fs";
import { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createClient } from "../src/core/client.js";
import { clearSecrets } from "../src/core/key.js";
import { VERSION } from "../src/core/version.js";
import { createServer } from "../src/mcp/server.js";
import { fakeFetch, KEY, tradeXml, xmlResponse } from "./helpers.js";

const NOW = new Date("2026-11-11T03:00:00Z");

/** 달마다 래미안푸르지오 84㎡ 매매 2건, 전세 2건 */
function marketFetch() {
  return fakeFetch((url) => {
    const ym = url.searchParams.get("DEAL_YMD") ?? "202610";
    const [y, m] = [ym.slice(0, 4), String(Number(ym.slice(4)))];
    const base = { sggCd: "11440", umdNm: "아현동", jibun: "100", aptNm: "래미안푸르지오", excluUseAr: "84.9", dealYear: y, dealMonth: m, dealDay: "3" };
    if (url.pathname.includes("AptRent")) {
      return xmlResponse(
        tradeXml(
          [
            { ...base, deposit: "90,000", monthlyRent: "0" },
            { ...base, deposit: "95,000", monthlyRent: "0" },
          ],
          { template: "live/RTMSDataSvcAptRent.xml" },
        ),
      );
    }
    return xmlResponse(
      tradeXml([
        { ...base, dealAmount: "150,000" },
        { ...base, dealAmount: "160,000" },
      ]),
    );
  });
}

async function connect(opts: { serviceKey?: string | null; fetch?: typeof fetch } = {}) {
  const client = createClient({ serviceKey: opts.serviceKey === undefined ? KEY : opts.serviceKey, fetch: opts.fetch ?? marketFetch().fetch, now: () => NOW, retryDelaysMs: [0, 0, 0] });
  const server = createServer({ client, now: () => NOW });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const mcp = new McpClient({ name: "test", version: "0" });
  await Promise.all([server.connect(a), mcp.connect(b)]);
  return mcp;
}

const text = (r: unknown) => ((r as { content: { text: string }[] }).content[0]?.text ?? "") as string;

afterEach(() => {
  clearSecrets();
  vi.restoreAllMocks();
});

describe("MCP 서버", () => {
  it("도구 4개, 읽기 전용", async () => {
    const mcp = await connect();
    const { tools } = await mcp.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["jeonse_ratio", "market_summary", "resolve_region", "search_deals"]);
    expect(tools.every((t) => t.annotations?.readOnlyHint === true)).toBe(true);
    expect(mcp.getServerVersion()).toMatchObject({ name: "korea-realestate-mcp", version: VERSION });
  });

  it("버전이 package.json과 같다", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
    expect(VERSION).toBe(pkg.version);
  });

  it("resolve_region: 겹치는 이름은 후보", async () => {
    const r = await (await connect()).callTool({ name: "resolve_region", arguments: { query: "중구" } });
    expect(r.isError).toBeFalsy();
    expect(text(r)).toContain("서울특별시 중구");
    expect(text(r)).toContain("부산광역시 중구");
  });

  it("market_summary: 숫자가 텍스트에 다 있다", async () => {
    const r = await (await connect()).callTool({ name: "market_summary", arguments: { propertyType: "apt", region: "마포구 아현동", name: "래미안푸르지오", area: 84 } });
    expect(r.isError).toBeFalsy();
    const t = text(r);
    expect(t).toContain("중앙값");
    expect(t).toContain("15억 5,000만원");
    expect(t).toContain("월별 추이");
    expect(t).toContain("출처: 국토교통부 실거래가");
    expect(r.structuredContent).toMatchObject({ kind: "market", result: { kind: "summary" } });
  });

  it("jeonse_ratio: 보증금 비율까지", async () => {
    const r = await (await connect()).callTool({ name: "jeonse_ratio", arguments: { propertyType: "apt", region: "마포구 아현동", name: "래미안푸르지오", area: 84.9, deposit: 1_000_000_000 } });
    const t = text(r);
    expect(t).toContain("전세가율");
    expect(t).toContain("보증금 ÷ 추정 매매가");
    expect(t).not.toMatch(/위험|적정|안전/);
  });

  it("search_deals: 최신순 목록", async () => {
    const r = await (await connect()).callTool({ name: "search_deals", arguments: { propertyType: "apt", dealType: "sale", region: "마포구", months: 2 } });
    expect(text(r)).toContain("조건에 맞는 거래 4건");
  });

  it("지역 후보가 여럿이면 조회하지 않고 안내", async () => {
    const { fetch, calls } = marketFetch();
    const r = await (await connect({ fetch })).callTool({ name: "market_summary", arguments: { propertyType: "apt", region: "중구" } });
    expect(r.isError).toBeFalsy();
    expect(text(r)).toContain("다시 조회하세요");
    expect(calls).toHaveLength(0);
  });

  it("거래 0건은 오류와 다르게 말한다", async () => {
    const { fetch } = fakeFetch(() => xmlResponse(tradeXml([])));
    const r = await (await connect({ fetch })).callTool({ name: "market_summary", arguments: { propertyType: "apt", region: "마포구" } });
    expect(r.isError).toBeFalsy();
    expect(text(r)).toContain("조회는 정상이며");
  });

  it("키가 없으면 isError와 설정 안내", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const r = await (await connect({ serviceKey: null })).callTool({ name: "market_summary", arguments: { propertyType: "apt", region: "마포구" } });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain("DATA_GO_KR_SERVICE_KEY");
  });

  it("입력 검증: months 0", async () => {
    const r = await (await connect()).callTool({ name: "market_summary", arguments: { propertyType: "apt", region: "마포구", months: 0 } }).catch((e: unknown) => ({ isError: true, content: [{ text: String(e) }] }));
    expect(r.isError).toBe(true);
  });

  it("결과·오류 어디에도 키가 없다", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const { fetch } = fakeFetch((url) => {
      throw new TypeError(`Failed to parse URL from ${url.href}`);
    });
    const mcp = await connect({ fetch });
    const r = await mcp.callTool({ name: "market_summary", arguments: { propertyType: "apt", region: "마포구" } });
    const all = JSON.stringify(r);
    expect(r.isError).toBe(true);
    expect(all).not.toContain("testKEY1234");
    expect(all).not.toContain("serviceKey");
  });
});
