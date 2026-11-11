import { readFileSync } from "node:fs";
import { InputError } from "./errors.js";

interface SigunguEntry {
  name: string;
  sido: string;
  queryable: boolean;
  children?: string[];
}

interface RegionData {
  generatedAt: string;
  sido: Record<string, string>;
  sigungu: Record<string, SigunguEntry>;
  /** 시군구 코드 → [법정동코드 뒤 5자리, 법정동 이름][] */
  umd: Record<string, [string, string][]>;
  aliases: Record<string, string[]>;
}

export interface Region {
  /** 조회할 시군구 코드. 하위 구가 있는 시나 옛 지역은 여러 개 */
  lawdCodes: string[];
  label: string;
  /** 법정동 ("아현동", "조치원읍 죽림리") */
  umd?: string;
  /** resolveRegion에 그대로 다시 넣으면 이 지역 하나로 돌아오는 값 */
  query: string;
}

export interface RegionResult {
  matches: Region[];
  note?: string;
}

let cached: RegionData | undefined;
function data(): RegionData {
  // 패키지에 data/regions.json이 같이 배포된다 (dist/core → ../../data). 경로는 고정값이다
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  cached ??= JSON.parse(readFileSync(new URL("../../data/regions.json", import.meta.url), "utf8")) as RegionData;
  return cached;
}

/** 시도 약칭과 옛 이름 → 현재 시도 이름 */
const SIDO_ALIASES: Record<string, string> = {
  서울: "서울특별시",
  부산: "부산광역시",
  대구: "대구광역시",
  인천: "인천광역시",
  광주: "전남광주통합특별시",
  광주광역시: "전남광주통합특별시",
  대전: "대전광역시",
  울산: "울산광역시",
  세종: "세종특별자치시",
  경기: "경기도",
  강원: "강원특별자치도",
  강원도: "강원특별자치도",
  충북: "충청북도",
  충남: "충청남도",
  전북: "전북특별자치도",
  전라북도: "전북특별자치도",
  전남: "전남광주통합특별시",
  전라남도: "전남광주통합특별시",
  경북: "경상북도",
  경남: "경상남도",
  제주: "제주특별자치도",
};
/** 옛 시도 이름 (별칭표 키를 찾을 때 쓴다) */
const OLD_SIDO_NAMES: Record<string, string[]> = { 광주: ["광주광역시"], 전남: ["전라남도"], 강원: ["강원도"], 전북: ["전라북도"] };

const lastWord = (s: string) => s.split(" ").at(-1) ?? s;

function isSigunguName(token: string): boolean {
  return Object.values(data().sigungu).some((s) => s.name === token || s.name.endsWith(` ${token}`));
}

function sidoOf(token: string): string | null {
  const names = new Set(Object.values(data().sido));
  if (names.has(token)) return token;
  if (Object.hasOwn(SIDO_ALIASES, token)) return SIDO_ALIASES[token] ?? null;
  // "서울시", "부산시". 단, "광주시"처럼 같은 이름의 시군구가 있으면 그쪽이다
  if (!token.endsWith("시") || isSigunguName(token)) return null;
  const short = token.slice(0, -1);
  return Object.hasOwn(SIDO_ALIASES, short) ? (SIDO_ALIASES[short] ?? null) : null;
}

export function regionLabel(code: string): string {
  const s = data().sigungu[code];
  if (!s) return code;
  return s.sido === s.name ? s.name : `${s.sido} ${s.name}`;
}

export function isQueryableLawd(code: string): boolean {
  return data().sigungu[code]?.queryable === true;
}

/** 그 시군구에 이 법정동이 있으면 정식 이름을 돌려준다 ("죽림리" → "조치원읍 죽림리") */
function findUmd(code: string, umd: string): string | undefined {
  const list = data().umd[code] ?? [];
  return list.find(([, u]) => u === umd)?.[1] ?? list.find(([, u]) => lastWord(u) === lastWord(umd) && u.includes(" "))?.[1];
}

function single(code: string, umd?: string): Region {
  const label = regionLabel(code);
  return { lawdCodes: [code], label, ...(umd ? { umd } : {}), query: umd ? `${label} ${umd}` : label };
}

function regionOf(code: string, umd?: string): Region | null {
  const s = data().sigungu[code];
  if (!s) return null;
  if (s.queryable) return single(code, umd);
  const children = s.children ?? [];
  if (umd) {
    // 하위 구가 있는 시 + 법정동: 그 동이 속한 구
    for (const child of children) {
      const name = findUmd(child, umd);
      if (name) return single(child, name);
    }
    return null;
  }
  return { lawdCodes: children, label: `${regionLabel(code)} (구 ${children.length}개 전체)`, query: regionLabel(code) };
}

function aliasRegion(key: string): Region | null {
  const codes = data().aliases[key];
  if (!codes?.length) return null;
  return { lawdCodes: codes, label: `${key} → ${codes.map(regionLabel).join(", ")}`, query: key };
}

const ALIAS_NOTE = "행정구역 개편으로 지역 이름·코드가 바뀌어 새 코드로 조회합니다. 실거래가 API는 과거 거래도 새 코드로만 돌려줍니다.";

function resolveCode(q: string): RegionResult {
  const code = q.slice(0, 5);
  let umd: string | undefined;
  if (q.length === 10 && !q.endsWith("00000")) {
    const suffix = q.slice(5);
    const s = data().sigungu[code];
    const owners = s?.queryable ? [code] : (s?.children ?? []);
    umd = owners.flatMap((c) => data().umd[c] ?? []).find(([sfx]) => sfx === suffix)?.[1];
  }
  const region = regionOf(code, umd);
  if (region) return { matches: [region] };
  const alias = aliasRegion(code);
  return alias ? { matches: [alias], note: ALIAS_NOTE } : { matches: [] };
}

function resolveNames(q: string): RegionResult {
  const d = data();
  const tokens = q.split(" ");
  const first = tokens[0] ?? "";
  const sido = sidoOf(first);
  const rest = sido ? tokens.slice(1) : tokens;
  const entries = Object.entries(d.sigungu).filter(([, s]) => !sido || s.sido === sido);
  // 시도만 입력: 세종처럼 시도가 곧 시군구인 곳만 바로 쓴다
  if (rest.length === 0) {
    const only = entries.length === 1 ? entries[0] : undefined;
    const region = only ? regionOf(only[0]) : null;
    if (region) return { matches: [region] };
    throw new InputError(`${sido ?? q} 전체는 너무 넓습니다.`, "시·군·구까지 입력해 주세요.");
  }

  // 끝의 동·리·가·읍·면은 법정동. "조치원읍 죽림리"처럼 읍·면 + 리는 둘을 함께 쓴다
  let umdTokens: string[] = [];
  const last = rest.at(-1) ?? "";
  if (/[동리가읍면]$/.test(last) && !/[시군구]$/.test(last)) {
    const prev = rest.at(-2);
    umdTokens = prev && /[읍면]$/.test(prev) && /리$/.test(last) ? [prev, last] : [last];
  }
  const sigunguName = rest.slice(0, rest.length - umdTokens.length).join(" ");
  const umdQuery = umdTokens.join(" ");

  const withUmd = (code: string): Region[] => {
    const umd = findUmd(code, umdQuery);
    return umd ? [single(code, umd)] : [];
  };
  const matched: Region[] = sigunguName
    ? entries
        .filter(([, s]) => s.name === sigunguName || s.name.endsWith(` ${sigunguName}`))
        .flatMap(([code, s]) => {
          if (!umdQuery) return regionOf(code) ?? [];
          return (s.queryable ? [code] : (s.children ?? [])).flatMap(withUmd);
        })
    : entries.filter(([, s]) => s.queryable).flatMap(([code]) => withUmd(code));
  if (matched.length) return { matches: matched };

  // 옛 이름: "인천 중구" → 인천광역시 중구 → 제물포구·영종구
  if (sigunguName && !umdQuery) {
    const keys = sido
      ? [sido, first, ...(OLD_SIDO_NAMES[first] ?? [])].map((s) => `${s} ${sigunguName}`)
      : Object.keys(d.aliases).filter((k) => !/^\d/.test(k) && (k === sigunguName || k.endsWith(` ${sigunguName}`)));
    const aliases = [...new Set(keys)].flatMap((k) => aliasRegion(k) ?? []);
    if (aliases.length) return { matches: aliases, note: ALIAS_NOTE };
  }
  return { matches: [] };
}

/** 못 찾았을 때 한 번 더 해 볼 입력: 행정동(역삼1동 → 역삼동), 줄임말(강남 → 강남구, 동탄 → 동탄구) */
function variants(q: string): string[] {
  const tokens = q.split(" ");
  const last = tokens.at(-1) ?? "";
  const head = tokens.slice(0, -1);
  const out: string[] = [];
  if (/\d+동$/.test(last)) out.push([...head, last.replace(/제?\d+동$/, "동")].join(" "));
  if (!/[시군구동리가읍면도]$/.test(last)) for (const suffix of ["구", "시", "군"]) out.push([...head, `${last}${suffix}`].join(" "));
  return out;
}

/**
 * 자연어 지역명을 조회할 시군구 코드(와 법정동)로 바꾼다.
 * 후보가 여럿이면 모두 돌려주고, 호출하는 쪽이 사용자에게 고르게 한다. 후보의 query는 그대로 다시 넣을 수 있다.
 */
export function resolveRegion(query: string): RegionResult {
  const q = query.trim().replace(/\s+/g, " ");
  if (!q) throw new InputError("지역을 입력해 주세요.", "예: '마포구 아현동', '수원시 영통구', '세종'");
  if (q.length > 50) throw new InputError("지역 이름이 너무 깁니다 (50자 이하).");
  if (/^\d{10}$/.test(q) || /^\d{5}$/.test(q)) return resolveCode(q);

  const direct = resolveNames(q);
  if (direct.matches.length) return direct;
  for (const v of variants(q)) {
    const r = resolveNames(v);
    if (r.matches.length) return { ...r, note: [`'${q}'을(를) '${v}'(으)로 찾았습니다.`, r.note].filter(Boolean).join(" ") };
  }
  return direct;
}
