/** 원 → "8억 5,000만원", "9,900만원", "3억원", "5,000원" */
export function won(amount: number): string {
  if (Math.abs(amount) < 10_000) return `${Math.round(amount).toLocaleString("ko-KR")}원`;
  const manTotal = Math.round(amount / 10_000);
  const eok = Math.trunc(manTotal / 10_000);
  const man = Math.abs(manTotal % 10_000);
  if (eok && man) return `${eok}억 ${man.toLocaleString("ko-KR")}만원`;
  if (eok) return `${eok}억원`;
  return `${manTotal.toLocaleString("ko-KR")}만원`;
}

export const pct = (x: number) => `${x.toFixed(1)}%`;
export const sqm = (x: number) => `${Number(x.toFixed(2))}㎡`;

/** Markdown 표 (모델이 읽기 쉬운 압축 형식) */
export function table(headers: string[], rows: (string | number)[][]): string {
  const esc = (v: string | number) => String(v).replace(/\|/g, "\\|");
  return [`| ${headers.map(esc).join(" | ")} |`, `|${headers.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r.map(esc).join(" | ")} |`)].join("\n");
}

/** "2026-11-11 22:40 KST" */
export function kstTimestamp(now: Date): string {
  const k = new Date(now.getTime() + 9 * 3_600_000).toISOString();
  return `${k.slice(0, 10)} ${k.slice(11, 16)} KST`;
}

export function sourceLine(now: Date): string {
  return `출처: 국토교통부 실거래가 공개자료(공공데이터포털), 조회 ${kstTimestamp(now)}`;
}

/** "202610" → "2026-10" */
export const ymLabel = (ym: string) => `${ym.slice(0, 4)}-${ym.slice(4)}`;
