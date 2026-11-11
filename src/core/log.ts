import { redact } from "./key.js";

/** KOREA_REALESTATE_DEBUG=1이면 모든 요청을, 아니면 재시도·실패만 남긴다 */
const debug = () => process.env.KOREA_REALESTATE_DEBUG === "1";

/**
 * stderr에 한 줄. stdout은 MCP 프로토콜 통로라 쓰지 않는다.
 * 넘기는 필드는 서비스·코드·달·상태처럼 비밀이 아닌 값만이지만, 혹시 몰라 redact를 거친다.
 */
export function log(level: "debug" | "warn", fields: Record<string, string | number>): void {
  if (level === "debug" && !debug()) return;
  const line = Object.entries(fields)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  process.stderr.write(`[korea-realestate-mcp] ${level} ${redact(line)}\n`);
}
