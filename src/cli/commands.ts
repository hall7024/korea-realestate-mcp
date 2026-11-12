import { parseArgs } from "node:util";
import { createClient, type Client } from "../core/client.js";
import { InputError } from "../core/errors.js";
import { table } from "../core/format.js";
import { KEY_ENV, redact } from "../core/key.js";
import { ratio, searchDeals, summarize } from "../core/query.js";
import { resolveRegion } from "../core/region.js";
import { renderError, renderRatio, renderRegion, renderRegionCandidates, renderSearch, renderSummary } from "../core/render.js";
import { ANALYZABLE_TYPES, PROPERTY_TYPES, SERVICE_IDS, SERVICES, type AnalyzableType, type PropertyType } from "../core/services.js";
import { VERSION } from "../core/version.js";

export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  stdinIsTTY: boolean;
  env?: NodeJS.ProcessEnv;
  client?: Client;
  now?: () => Date;
  /** 인자 없이 파이프로 실행됐을 때 띄울 MCP 서버 */
  startServer?: () => Promise<void>;
}

export const HELP = `korea-realestate-mcp ${VERSION}
국토교통부 실거래가 조회와 시세·전세가율 분석 (MCP 서버 겸 CLI)

사용법
  korea-realestate-mcp                 MCP 서버 (stdio). 터미널에서 실행하면 이 도움말
  korea-realestate-mcp doctor          13종 서비스의 활용신청 상태 확인
  korea-realestate-mcp region <지역>    지역 이름 → 시군구 코드·법정동
  korea-realestate-mcp deals   --type apt --deal sale --region 마포구 [--months 3] [--name 래미안] [--json]
  korea-realestate-mcp summary --type apt --region "마포구 아현동" [--name 래미안푸르지오] [--area 84] [--months 12] [--json]
  korea-realestate-mcp ratio   --type rh --region "강서구 화곡동" [--area 59] [--deposit 4억] [--json]

유형(--type)
  분석(summary·ratio): ${ANALYZABLE_TYPES.join(", ")}
  조회(deals): ${PROPERTY_TYPES.join(", ")}

인증키
  환경변수 ${KEY_ENV}에 공공데이터포털 일반 인증키(Encoding·Decoding 어느 쪽이든)를 넣으세요.
`;

const OPTIONS = {
  type: { type: "string" },
  deal: { type: "string" },
  region: { type: "string" },
  months: { type: "string" },
  from: { type: "string" },
  to: { type: "string" },
  name: { type: "string" },
  area: { type: "string" },
  "area-min": { type: "string" },
  "area-max": { type: "string" },
  deposit: { type: "string" },
  limit: { type: "string" },
  "include-cancelled": { type: "boolean" },
  "include-direct": { type: "boolean" },
  json: { type: "boolean" },
  help: { type: "boolean", short: "h" },
  version: { type: "boolean", short: "v" },
} as const;

type Values = ReturnType<typeof parseArgs<{ options: typeof OPTIONS; allowPositionals: true }>>["values"];

function num(value: string | undefined, label: string): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new InputError(`--${label}는 숫자여야 합니다: ${value}`);
  return n;
}

/** "4억", "4억 5000만", "45000만", "450000000" → 원 */
export function parseWon(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const s = value.replace(/[,\s원]/g, "");
  if (/^\d+$/.test(s)) return Number(s);
  const eok = /^(\d+)억/.exec(s);
  const rest = eok ? s.slice(eok[0].length) : s;
  const man = /^(\d+)만$/.exec(rest);
  if ((!eok && !man) || (rest && !man)) throw new InputError(`금액 형식이 아닙니다: ${value}`, "예: 4억, 4억5000만, 400000000");
  return Number(eok?.[1] ?? 0) * 100_000_000 + Number(man?.[1] ?? 0) * 10_000;
}

function oneOf<T extends string>(value: string | undefined, label: string, allowed: readonly T[]): T {
  if (!value) throw new InputError(`--${label}가 필요합니다.`, `가능한 값: ${allowed.join(", ")}`);
  if (!(allowed as readonly string[]).includes(value)) throw new InputError(`--${label} 값이 올바르지 않습니다: ${value}`, `가능한 값: ${allowed.join(", ")}`);
  return value as T;
}

function regionArg(v: Values): string {
  if (!v.region) throw new InputError("--region이 필요합니다.", "예: --region '마포구 아현동'");
  return v.region;
}

const DOCTOR_STATUS: Record<string, string> = {
  not_subscribed: "미신청",
  key_or_subscription: "키 오류 또는 미신청",
  no_key: "키 없음",
  access_denied: "접근 거부",
  daily_limit: "일일 한도 초과",
  expired: "기간 만료",
};

async function doctor(client: Client, out: (s: string) => void): Promise<number> {
  if (!client.hasKey) {
    out(`인증키가 없습니다. 환경변수 ${KEY_ENV}에 공공데이터포털 일반 인증키를 넣어 주세요.\n`);
    return 1;
  }
  const results = await client.probe(SERVICE_IDS);
  const rows = SERVICE_IDS.map((id) => {
    const r = results.get(id);
    const def = SERVICES[id];
    const status = !r ? "-" : r.ok ? "정상" : (DOCTOR_STATUS[r.kind] ?? r.kind);
    return [def.label, id, def.dataset, status];
  });
  out(`${table(["서비스", "id", "데이터셋", "상태"], rows)}\n`);
  const failed = [...results.values()].filter((r) => !r.ok);
  if (failed.length) {
    out(`\n활용신청: https://www.data.go.kr/data/<데이터셋>/openapi.do 에서 신청하세요 (자동승인, 반영까지 최대 1시간).\n`);
    out("시세·전세가율에는 아파트·연립다세대·오피스텔의 매매와 전월세 6종이 필요합니다.\n");
  }
  return failed.length ? 1 : 0;
}

/** 종료 코드. 서버를 띄웠으면 null */
export async function runCli(argv: string[], io: CliIo): Promise<number | null> {
  const out = (s: string) => io.stdout(redact(s));
  const err = (s: string) => io.stderr(redact(s));
  try {
    const { values: v, positionals } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true });
    const [command, ...rest] = positionals;
    if (v.version) {
      out(`${VERSION}\n`);
      return 0;
    }
    if (v.help || command === "help") {
      out(HELP);
      return 0;
    }
    if (!command) {
      if (io.stdinIsTTY || !io.startServer) {
        out(HELP);
        return 0;
      }
      await io.startServer();
      return null;
    }

    const now = io.now ?? (() => new Date());
    const client = () => io.client ?? createClient(io.env ? { serviceKey: io.env[KEY_ENV] ?? null } : {});
    const ctx = () => ({ client: client(), now });
    const print = (json: boolean, data: unknown, text: string) => out(json ? `${JSON.stringify(data, null, 2)}\n` : `${text}\n`);

    switch (command) {
      case "doctor":
        return await doctor(client(), out);
      case "region": {
        const query = rest.join(" ") || v.region;
        if (!query) throw new InputError("지역을 입력해 주세요.", "예: korea-realestate-mcp region 아현동");
        const r = resolveRegion(query);
        print(Boolean(v.json), r, renderRegion(query, r));
        return r.matches.length ? 0 : 1;
      }
      case "deals": {
        const r = await searchDeals(ctx(), {
          propertyType: oneOf<PropertyType>(v.type, "type", PROPERTY_TYPES),
          dealType: oneOf(v.deal ?? "sale", "deal", ["sale", "rent"] as const),
          region: regionArg(v),
          ...(v.months ? { months: num(v.months, "months") } : {}),
          ...(v.from ? { from: v.from } : {}),
          ...(v.to ? { to: v.to } : {}),
          ...(v.name ? { name: v.name } : {}),
          ...(v["area-min"] ? { areaMin: num(v["area-min"], "area-min") } : {}),
          ...(v["area-max"] ? { areaMax: num(v["area-max"], "area-max") } : {}),
          ...(v.limit ? { limit: num(v.limit, "limit") } : {}),
          ...(v["include-cancelled"] ? { includeCancelled: true } : {}),
        });
        print(Boolean(v.json), r, r.kind === "region_candidates" ? renderRegionCandidates(r) : renderSearch(r, now()));
        return 0;
      }
      case "summary": {
        const r = await summarize(ctx(), {
          propertyType: oneOf<AnalyzableType>(v.type, "type", ANALYZABLE_TYPES),
          region: regionArg(v),
          ...(v.name ? { name: v.name } : {}),
          ...(v.area ? { area: num(v.area, "area") } : {}),
          ...(v.months ? { months: num(v.months, "months") } : {}),
          ...(v["include-direct"] ? { includeDirect: true } : {}),
        });
        print(Boolean(v.json), r, r.kind === "region_candidates" ? renderRegionCandidates(r) : renderSummary(r, now()));
        return 0;
      }
      case "ratio": {
        const r = await ratio(ctx(), {
          propertyType: oneOf<AnalyzableType>(v.type, "type", ANALYZABLE_TYPES),
          region: regionArg(v),
          ...(v.name ? { name: v.name } : {}),
          ...(v.area ? { area: num(v.area, "area") } : {}),
          ...(v.deposit ? { deposit: parseWon(v.deposit) } : {}),
          ...(v.months ? { months: num(v.months, "months") } : {}),
        });
        print(Boolean(v.json), r, r.kind === "region_candidates" ? renderRegionCandidates(r) : renderRatio(r, now()));
        return 0;
      }
      default:
        err(`알 수 없는 명령: ${command}\n\n${HELP}`);
        return 1;
    }
  } catch (error) {
    if (error instanceof TypeError && "code" in error && String(error.code).startsWith("ERR_PARSE_ARGS")) {
      err(`${error.message}\n\n${HELP}`);
      return 1;
    }
    err(`${renderError(error)}\n`);
    return 1;
  }
}
