import { InputError } from "./errors.js";

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const YM = /^(\d{4})(\d{2})$/;
/** 실거래가 공개 자료가 시작되는 달 */
export const FIRST_YM = "200601";

const pad = (n: number) => String(n).padStart(2, "0");

/** Asia/Seoul 기준 오늘 (YYYY-MM-DD). 한국은 서머타임이 없어 UTC+9 고정 */
export function todayKst(now: Date = new Date()): string {
  const kst = new Date(now.getTime() + 9 * 3_600_000);
  return `${kst.getUTCFullYear()}-${pad(kst.getUTCMonth() + 1)}-${pad(kst.getUTCDate())}`;
}

function parts(iso: string): [number, number, number] {
  const m = ISO.exec(iso);
  if (!m) throw new InputError(`날짜 형식이 아닙니다: ${iso}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** YYYY-MM-DD에 개월 수를 더한다. 그 달에 없는 날은 말일로 맞춘다 (3월 31일 - 1개월 = 2월 28·29일) */
export function addMonths(iso: string, months: number): string {
  const [y, m, d] = parts(iso);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${pad(nm)}-${pad(Math.min(d, last))}`;
}

/** today가 속한 달부터 거꾸로 count개월 (YYYYMM) */
export function monthsBack(today: string, count: number): string[] {
  const first = `${today.slice(0, 8)}01`;
  return Array.from({ length: count }, (_, i) => addMonths(first, -i).slice(0, 7).replace("-", ""));
}

/** from부터 to까지 (YYYYMM, 양 끝 포함, 오래된 달부터) */
export function monthRange(from: string, to: string): string[] {
  const f = YM.exec(from);
  const t = YM.exec(to);
  const validMonth = (m: RegExpExecArray | null) => m !== null && Number(m[2]) >= 1 && Number(m[2]) <= 12;
  if (!validMonth(f) || !validMonth(t) || !f || !t) throw new InputError("from·to는 YYYYMM 형식이어야 합니다 (월 01~12).");
  const start = Number(f[1]) * 12 + Number(f[2]) - 1;
  const end = Number(t[1]) * 12 + Number(t[2]) - 1;
  if (start > end) throw new InputError("from이 to보다 늦습니다.");
  return Array.from({ length: end - start + 1 }, (_, i) => `${Math.floor((start + i) / 12)}${pad(((start + i) % 12) + 1)}`);
}

/** 조회할 수 있는 계약년월인가: YYYYMM, 2006-01 이후, today가 속한 달까지 */
export function isValidYm(ym: string, today: string): boolean {
  const m = YM.exec(ym);
  if (!m) return false;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return false;
  return ym >= FIRST_YM && ym <= today.slice(0, 7).replace("-", "");
}
