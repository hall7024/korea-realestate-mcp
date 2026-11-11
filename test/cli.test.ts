import { afterEach, describe, expect, it, vi } from "vitest";
import { parseWon, runCli } from "../src/cli/commands.js";
import { createClient } from "../src/core/client.js";
import { clearSecrets } from "../src/core/key.js";
import { emptyXml, fakeFetch, gatewayXml, KEY, tradeXml, xmlResponse } from "./helpers.js";

const NOW = new Date("2026-11-11T03:00:00Z");

function io(opts: { fetch?: typeof fetch; tty?: boolean; key?: string | null } = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const client = createClient({ serviceKey: opts.key === undefined ? KEY : opts.key, fetch: opts.fetch ?? fakeFetch(() => xmlResponse(emptyXml())).fetch, now: () => NOW, retryDelaysMs: [0, 0, 0] });
  return {
    io: { stdout: (s: string) => out.push(s), stderr: (s: string) => err.push(s), stdinIsTTY: opts.tty ?? true, client, now: () => NOW },
    out: () => out.join(""),
    err: () => err.join(""),
  };
}

afterEach(() => {
  clearSecrets();
  vi.restoreAllMocks();
});

describe("CLI", () => {
  it("터미널에서 인자 없이 실행하면 도움말", async () => {
    const t = io();
    expect(await runCli([], t.io)).toBe(0);
    expect(t.out()).toContain("사용법");
  });

  it("파이프면 MCP 서버를 띄운다", async () => {
    const t = io({ tty: false });
    const startServer = vi.fn(async () => undefined);
    expect(await runCli([], { ...t.io, startServer })).toBeNull();
    expect(startServer).toHaveBeenCalledOnce();
  });

  it("region", async () => {
    const t = io();
    expect(await runCli(["region", "강남구"], t.io)).toBe(0);
    expect(t.out()).toContain("11680");
  });

  it("summary --json은 JSON", async () => {
    const { fetch } = fakeFetch((url) => {
      const ym = url.searchParams.get("DEAL_YMD") ?? "202610";
      return xmlResponse(tradeXml([{ sggCd: "11440", umdNm: "아현동", dealYear: ym.slice(0, 4), dealMonth: String(Number(ym.slice(4))), dealDay: "2", dealAmount: "100,000" }]));
    });
    const t = io({ fetch });
    expect(await runCli(["summary", "--type", "apt", "--region", "마포구 아현동", "--json"], t.io)).toBe(0);
    const data = JSON.parse(t.out()) as { kind: string; result: { kind: string; median: number } };
    expect(data).toMatchObject({ kind: "market", result: { kind: "summary", median: 1_000_000_000 } });
  });

  it("잘못된 유형은 오류", async () => {
    const t = io();
    expect(await runCli(["summary", "--type", "land", "--region", "마포구"], t.io)).toBe(1);
    expect(t.err()).toContain("가능한 값");
  });

  it("알 수 없는 명령·옵션", async () => {
    const t = io();
    expect(await runCli(["foo"], t.io)).toBe(1);
    expect(await runCli(["region", "--bogus"], t.io)).toBe(1);
  });

  it("doctor: 미신청 표시, 키는 출력하지 않음", async () => {
    const { fetch } = fakeFetch((url) => (url.pathname.includes("AptTrade") ? xmlResponse(emptyXml()) : xmlResponse(gatewayXml("30"), 403)));
    const t = io({ fetch });
    expect(await runCli(["doctor"], t.io)).toBe(1);
    expect(t.out()).toContain("| 아파트 매매 | apt-sale | 15126469 | 정상 |");
    expect(t.out()).toContain("미신청");
    expect(t.out() + t.err()).not.toContain("testKEY1234");
  });

  it("doctor: 키 없음", async () => {
    const t = io({ key: null });
    expect(await runCli(["doctor"], t.io)).toBe(1);
    expect(t.out()).toContain("DATA_GO_KR_SERVICE_KEY");
  });

  it("버전", async () => {
    const t = io();
    expect(await runCli(["--version"], t.io)).toBe(0);
    expect(t.out()).toMatch(/^\d+\.\d+\.\d+\n$/);
  });
});

describe("parseWon", () => {
  it.each([
    ["4억", 400_000_000],
    ["4억 5000만", 450_000_000],
    ["4억5,000만원", 450_000_000],
    ["45000만", 450_000_000],
    ["400000000", 400_000_000],
  ])("%s", (input, expected) => {
    expect(parseWon(input)).toBe(expected);
  });

  it("형식이 아니면 오류", () => {
    expect(() => parseWon("사억")).toThrow();
  });
});
