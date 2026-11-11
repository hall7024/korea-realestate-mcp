import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Client } from "../core/client.js";
import { log } from "../core/log.js";
import { ratio, searchDeals, summarize } from "../core/query.js";
import { resolveRegion } from "../core/region.js";
import { renderError, renderRatio, renderRegion, renderRegionCandidates, renderSearch, renderSummary } from "../core/render.js";
import { ANALYZABLE_TYPES, PROPERTY_TYPES } from "../core/services.js";

const annotations = { readOnlyHint: true, openWorldHint: true, idempotentHint: true, destructiveHint: false } as const;

// 도구 설명은 짧고 고정한다 (설명이 바뀌면 사용자가 승인한 내용과 달라진다)
const region = z.string().min(1).max(50).describe("지역. 예: '마포구 아현동', '수원시 영통구', '세종', 시군구 코드 5자리, 법정동코드 10자리");
const name = z.string().min(1).max(50).optional().describe("단지·건물 이름 (공백 무시 부분 일치). 예: '래미안푸르지오'");
const area = z.number().positive().max(1000).optional().describe("전용면적 ㎡. 예: 34평형 ≈ 84㎡, 25평형 ≈ 59㎡");
const months = (def: number) => z.number().int().min(1).max(24).optional().describe(`최근 몇 개월 (1~24, 기본 ${def})`);
const analyzable = z.enum(ANALYZABLE_TYPES).describe("apt: 아파트, rh: 연립·다세대(빌라), offi: 오피스텔");
const ym = z
  .string()
  .regex(/^\d{6}$/)
  .optional();

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

// structuredContent는 outputSchema 계약 없이 보내면 토큰만 늘어 v0.1에서는 텍스트만 돌려준다 (라이브러리 API가 객체를 준다)
const ok = (text: string): ToolResult => ({ content: [{ type: "text", text }] });

async function guard(tool: string, run: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await run();
  } catch (error) {
    log("warn", { tool, error: error instanceof Error ? error.name : "unknown" });
    return { content: [{ type: "text", text: renderError(error) }], isError: true };
  }
}

export function registerTools(server: McpServer, client: Client, now: () => Date = () => new Date()): void {
  const ctx = { client, now };

  server.registerTool(
    "resolve_region",
    {
      title: "지역 해석",
      description:
        "지역 이름을 실거래가 조회용 시군구 코드와 법정동으로 바꿉니다. 이름이 겹치면 후보를 모두 돌려줍니다. 다른 도구의 region에는 결과의 'region에 넣을 값'을 그대로 쓰세요. 2026-07 행정구역 개편 전 이름도 받습니다.",
      inputSchema: { query: region },
      annotations,
    },
    async ({ query }) => guard("resolve_region", async () => {
      const r = resolveRegion(query);
      return ok(renderRegion(query, r));
    }),
  );

  server.registerTool(
    "search_deals",
    {
      title: "실거래 조회",
      description:
        "국토교통부 실거래 원자료를 최신순으로 조회합니다. 금액은 원 단위입니다. 시세·전세가율 계산이 필요하면 market_summary, jeonse_ratio를 쓰세요.",
      inputSchema: {
        propertyType: z.enum(PROPERTY_TYPES).describe("apt 아파트, rh 연립·다세대, sh 단독·다가구, offi 오피스텔, presale 분양·입주권, commercial 상업업무용, land 토지, industrial 공장·창고"),
        dealType: z.enum(["sale", "rent"]).describe("sale 매매, rent 전월세 (apt·rh·sh·offi만)"),
        region,
        months: months(3),
        from: ym.describe("시작 계약년월 YYYYMM (months 대신, 최대 24개월)"),
        to: ym.describe("끝 계약년월 YYYYMM (기본 이번 달)"),
        name,
        areaMin: z.number().nonnegative().optional().describe("최소 면적 ㎡"),
        areaMax: z.number().positive().optional().describe("최대 면적 ㎡"),
        includeCancelled: z.boolean().optional().describe("해제된 거래 포함 (기본 false)"),
        limit: z.number().int().min(1).max(50).optional().describe("돌려줄 건수 (기본 20, 최대 50)"),
      },
      annotations,
    },
    async (args) => guard("search_deals", async () => {
      const r = await searchDeals(ctx, args);
      return r.kind === "region_candidates" ? ok(renderRegionCandidates(r)) : ok(renderSearch(r, now()));
    }),
  );

  server.registerTool(
    "market_summary",
    {
      title: "매매 시세 요약",
      description:
        "매매 실거래로 시세를 요약합니다: 중앙값, 범위, 사분위, ㎡당 가격, 월별 추이, 최근 거래. name·area를 주면 범위가 좁아져 정확해지고, 여러 단지에 맞으면 후보를 돌려줍니다. 해제·직거래는 기본으로 뺍니다. 구가 여러 개인 시 전체는 호출 한도를 넘을 수 있습니다.",
      inputSchema: { propertyType: analyzable, region, name, area, months: months(12), includeDirect: z.boolean().optional().describe("직거래 포함 (기본 false)") },
      annotations,
    },
    async (args) => guard("market_summary", async () => {
      const r = await summarize(ctx, args);
      return r.kind === "region_candidates" ? ok(renderRegionCandidates(r)) : ok(renderSummary(r, now()));
    }),
  );

  server.registerTool(
    "jeonse_ratio",
    {
      title: "전세가율",
      description:
        "같은 조건의 ㎡당 매매 중앙값 대비 ㎡당 전세 보증금 중앙값(전세가율)을 계산합니다. deposit과 area를 주면 같은 면적의 추정 전세가·매매가와 입력 보증금의 비율, 비교 전세 중 위치도 냅니다. name·area를 주면 정확해집니다.",
      inputSchema: {
        propertyType: analyzable,
        region,
        name,
        area,
        deposit: z.number().int().positive().max(100_000_000_000).optional().describe("확인할 전세 보증금 (원). 예: 4억 = 400000000"),
        months: months(12),
      },
      annotations,
    },
    async (args) => guard("jeonse_ratio", async () => {
      const r = await ratio(ctx, args);
      return r.kind === "region_candidates" ? ok(renderRegionCandidates(r)) : ok(renderRatio(r, now()));
    }),
  );
}
