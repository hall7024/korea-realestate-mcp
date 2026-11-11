import js from "@eslint/js";
import security from "eslint-plugin-security";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/", "coverage/"] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  security.configs.recommended,
  {
    rules: {
      // 객체 키 접근마다 경고해 오탐이 대부분이다
      "security/detect-object-injection": "off",
    },
  },
  {
    // 테스트·생성 스크립트는 fixture 경로를 읽고, 이미 확인한 값을 단언한다
    files: ["test/**", "scripts/**"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
      "security/detect-non-literal-fs-filename": "off",
    },
  },
);
