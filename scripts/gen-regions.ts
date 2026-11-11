/**
 * 지역 코드표(data/regions.json)를 만든다.
 *   1) 행정표준코드관리시스템에서 법정동코드 전체자료(ZIP, cp949 txt)를 받는다:
 *      curl -X POST https://www.code.go.kr/etc/codeFullDown.do --data-urlencode codeseId=법정동코드 -o lawd.zip
 *   2) 압축을 풀어 UTF-8로 바꾼 txt 경로를 넘긴다: pnpm gen:regions <법정동코드.txt>
 *
 * 실거래가 API는 시군구 코드(법정동코드 앞 5자리)로 조회한다. 2026-07 개편 지역은 과거 거래도 새 코드로만 조회되므로
 * (옛 코드는 0건), 옛 이름·옛 코드는 aliases로 새 코드에 잇는다.
 */
import { readFileSync, writeFileSync } from "node:fs";

interface Row {
  code: string;
  name: string;
  exists: boolean;
}

const [path] = process.argv.slice(2);
if (!path) throw new Error("사용법: pnpm gen:regions <법정동코드 전체자료 txt (UTF-8)>");

const rows: Row[] = readFileSync(path, "utf8")
  .split(/\r?\n/)
  .slice(1)
  .map((line) => line.split("\t"))
  .filter((cols) => cols.length >= 3 && /^\d{10}$/.test(cols[0]!.trim()))
  .map(([code, name, status]) => ({ code: code!.trim(), name: name!.trim().replace(/\s+/g, " "), exists: status!.trim() === "존재" }));

const isSido = (c: string) => c.endsWith("00000000");
const isSigungu = (c: string) => c.endsWith("00000") && !isSido(c);

// 시도
const sido: Record<string, string> = {};
for (const r of rows) if (r.exists && isSido(r.code)) sido[r.code.slice(0, 2)] = r.name;
const currentSidoNames = new Set(Object.values(sido));

// 시군구
interface Sigungu {
  name: string;
  sido: string;
  queryable: boolean;
  children?: string[];
}
const sigungu: Record<string, Sigungu> = {};
const fullName: Record<string, string> = {};
for (const r of rows) {
  if (!r.exists || !isSigungu(r.code)) continue;
  const code5 = r.code.slice(0, 5);
  // 세종처럼 시도 행 없이 시군구 행만 있는 곳은 시도 = 시군구
  if (!sido[r.code.slice(0, 2)] && !r.name.includes(" ")) sido[r.code.slice(0, 2)] = r.name;
  const sidoName = sido[r.code.slice(0, 2)] ?? "";
  sigungu[code5] = { name: r.name.startsWith(`${sidoName} `) ? r.name.slice(sidoName.length + 1) : r.name, sido: sidoName, queryable: true };
  fullName[code5] = r.name;
}
// 하위 구가 있는 시는 시 단위 코드로 조회되지 않는다 (화성시 41590 실측 0건)
for (const [code, s] of Object.entries(sigungu)) {
  const prefix = `${fullName[code]} `;
  const children = Object.keys(sigungu).filter((c) => c !== code && fullName[c]!.startsWith(prefix));
  if (children.length) {
    s.queryable = false;
    s.children = children.sort();
  }
}

// 법정동: [법정동코드 뒤 5자리, 시군구 이름 뒤 부분 ("아현동", "조치원읍 죽림리")]
const umd: Record<string, [string, string][]> = {};
for (const r of rows) {
  if (!r.exists || isSigungu(r.code) || isSido(r.code)) continue;
  const code5 = r.code.slice(0, 5);
  const parent = fullName[code5];
  if (!parent || !r.name.startsWith(`${parent} `)) continue;
  (umd[code5] ??= []).push([r.code.slice(5), r.name.slice(parent.length + 1)]);
}
for (const list of Object.values(umd)) list.sort((a, b) => a[1].localeCompare(b[1], "ko"));

// 옛 이름·옛 코드 → 새 코드. 같은 (새) 시도 안에서 법정동 이름이 겹치는 현재 시군구를 잇는다
const SIDO_RENAMED: Record<string, string> = {
  강원도: "강원특별자치도",
  전라북도: "전북특별자치도",
  광주광역시: "전남광주통합특별시",
  전라남도: "전남광주통합특별시",
};
const lastWord = (s: string) => s.split(" ").at(-1)!;
const aliases: Record<string, string[]> = {};
const currentNames = new Set(Object.values(fullName));
for (const r of rows) {
  if (r.exists || !isSigungu(r.code)) continue;
  const oldSido = r.name.split(" ")[0]!;
  const newSido = SIDO_RENAMED[oldSido] ?? (currentSidoNames.has(oldSido) ? oldSido : null);
  if (!newSido || currentNames.has(r.name)) continue;
  const code5 = r.code.slice(0, 5);
  const oldUmds = new Set(rows.filter((x) => x.code.startsWith(code5) && x.code !== r.code && x.name.startsWith(`${r.name} `)).map((x) => lastWord(x.name)));
  if (!oldUmds.size) continue;
  const successors = Object.entries(sigungu)
    .filter(([, s]) => s.sido === newSido && s.queryable)
    .map(([code, s]) => ({ code, s, overlap: (umd[code] ?? []).filter(([, u]) => oldUmds.has(lastWord(u))).length }))
    // 흔한 동 이름(중앙동 등) 하나 겹친 것은 무시한다
    .filter((x) => x.overlap >= 2 && x.overlap >= oldUmds.size * 0.1)
    .map((x) => x.code)
    .sort();
  if (!successors.length) continue;
  aliases[r.name] = successors;
  aliases[code5] ??= successors;
}
// 이름이 바뀐 시도의 현재 시군구: "강원도 강릉시" → 강원특별자치도 강릉시
for (const [oldSido, newSido] of Object.entries(SIDO_RENAMED)) {
  for (const [code, s] of Object.entries(sigungu)) {
    if (s.sido !== newSido) continue;
    const oldName = `${oldSido} ${s.name}`;
    if (!currentNames.has(oldName)) aliases[oldName] ??= s.queryable ? [code] : (s.children ?? []);
  }
}

const out = {
  generatedAt: new Date().toISOString().slice(0, 10),
  source: "행정안전부 행정표준코드관리시스템(code.go.kr) 법정동코드 전체자료",
  sido,
  sigungu,
  umd,
  aliases,
};
writeFileSync(new URL("../data/regions.json", import.meta.url), JSON.stringify(out) + "\n");
console.log(`시도 ${Object.keys(sido).length}, 시군구 ${Object.keys(sigungu).length}, 법정동 ${Object.values(umd).flat().length}, 별칭 ${Object.keys(aliases).length}`);
