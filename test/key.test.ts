import { afterEach, describe, expect, it } from "vitest";
import { clearSecrets, maskSecrets, normalizeServiceKey, readServiceKey, redact, registerSecret } from "../src/core/key.js";

const DECODED = "abcdEFGH1234+ijkl/mnop==";
const ENCODED = "abcdEFGH1234%2Bijkl%2Fmnop%3D%3D";

describe("normalizeServiceKey", () => {
  it("Decoding 키와 Encoding 키를 같은 원문으로 만든다", () => {
    expect(normalizeServiceKey(DECODED)).toBe(DECODED);
    expect(normalizeServiceKey(ENCODED)).toBe(DECODED);
    expect(normalizeServiceKey(`  ${ENCODED}\n`)).toBe(DECODED);
  });

  it("소문자 퍼센트 인코딩도 받는다", () => {
    expect(normalizeServiceKey("abcdEFGH1234%2bijkl%2fmnop%3d%3d")).toBe(DECODED);
  });

  it("깨진 퍼센트 인코딩은 원문 그대로 둔다", () => {
    expect(normalizeServiceKey("abc%2Gdef")).toBe("abc%2Gdef");
  });
});

describe("readServiceKey", () => {
  it("환경변수에서만 읽는다", () => {
    expect(readServiceKey({ DATA_GO_KR_SERVICE_KEY: ` ${ENCODED} ` })).toBe(DECODED);
    expect(readServiceKey({})).toBeNull();
    expect(readServiceKey({ DATA_GO_KR_SERVICE_KEY: "   " })).toBeNull();
  });
});

describe("maskSecrets", () => {
  it("원문·퍼센트 인코딩·폼 인코딩 형태를 모두 지운다", () => {
    const form = new URLSearchParams({ serviceKey: DECODED }).toString();
    const text = `a ${DECODED} b ${ENCODED} c ${form} d ${encodeURIComponent(DECODED).toLowerCase()}`;
    const out = maskSecrets(text, [DECODED]);
    expect(out).not.toContain("abcdEFGH1234");
    expect(out).not.toContain("abcdefgh1234");
    expect(out).toContain("***");
  });

  it("너무 짧은 값은 비밀값으로 보지 않는다", () => {
    expect(maskSecrets("abc def", ["abc"])).toBe("abc def");
  });
});

describe("redact", () => {
  afterEach(() => clearSecrets());

  it("등록한 비밀값을 지운다", () => {
    registerSecret(DECODED);
    expect(redact(`Failed to parse URL from https://x/?serviceKey=${ENCODED}&a=1`)).not.toContain("abcdEFGH1234");
  });
});
