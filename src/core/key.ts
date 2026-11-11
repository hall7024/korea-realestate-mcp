/** 공공데이터포털 일반 인증키를 읽는 환경변수 */
export const KEY_ENV = "DATA_GO_KR_SERVICE_KEY";

/** 이보다 짧은 값은 비밀값으로 보지 않는다 (일반 단어를 지우지 않도록) */
const MIN_SECRET_LENGTH = 8;

/**
 * 포털이 주는 Encoding 키(%2B…)와 Decoding 키(+…)를 같은 원문으로 만든다.
 * 요청할 때는 이 원문을 URLSearchParams로 한 번만 인코딩한다 (이중 인코딩하면 403/30).
 */
export function normalizeServiceKey(raw: string): string {
  const key = raw.trim();
  if (!/%[0-9A-Fa-f]{2}/.test(key)) return key;
  try {
    return decodeURIComponent(key);
  } catch {
    return key;
  }
}

export function readServiceKey(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = env[KEY_ENV];
  if (!raw?.trim()) return null;
  return normalizeServiceKey(raw);
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** 비밀값의 원문, 퍼센트 인코딩(대소문자), 폼 인코딩 형태를 모두 ***로 바꾼다 */
export function maskSecrets(text: string, secrets: Iterable<string>): string {
  let out = text;
  for (const secret of secrets) {
    if (secret.length < MIN_SECRET_LENGTH) continue;
    const forms = new Set([
      secret,
      encodeURIComponent(secret),
      new URLSearchParams({ k: secret }).toString().slice(2),
    ]);
    // escapeRegExp로 메타문자를 모두 이스케이프한 리터럴 패턴이다
    // eslint-disable-next-line security/detect-non-literal-regexp
    for (const form of forms) out = out.replace(new RegExp(escapeRegExp(form), "gi"), "***");
  }
  return out;
}

const registered = new Set<string>();

/** 프로세스 전체에서 가릴 비밀값으로 등록한다. 로그·오류·도구 결과·CLI 출력이 redact를 거친다 */
export function registerSecret(secret: string): void {
  if (secret.length >= MIN_SECRET_LENGTH) registered.add(secret);
}

export function clearSecrets(): void {
  registered.clear();
}

export function redact(text: string): string {
  return maskSecrets(text, registered);
}
