# 보안 정책

## 취약점 신고

공개 이슈로 올리지 말고 GitHub의 비공개 취약점 신고를 이용해 주세요:
저장소의 **Security → Report a vulnerability**.

받은 신고는 7일 안에 답하고, 고친 버전을 배포한 뒤 공개합니다.

## 지원 버전

가장 최근의 0.x 버전만 보안 수정을 받습니다.

## 이 패키지가 지키는 것

- 공공데이터포털 인증키는 환경변수(`DATA_GO_KR_SERVICE_KEY`)로만 받습니다. 도구 입력에 키 필드가 없습니다.
- 키가 담긴 요청 URL과 원본 예외 메시지는 오류·로그·도구 결과·CLI 출력에 내보내지 않습니다. 이 동작은 테스트로 확인합니다.
- 요청은 `https://apis.data.go.kr`로만 보내고 리다이렉트를 따르지 않습니다.
- 응답 XML은 DOCTYPE을 거부하고, 값의 길이를 제한하며, 응답 텍스트를 지시로 다루지 않도록 서버 안내에 적습니다.
- 런타임 의존성은 3개(`@modelcontextprotocol/sdk`, `zod`, `fast-xml-parser`)이고 버전을 고정합니다.
- npm 배포는 GitHub Actions의 trusted publishing(OIDC)으로만 하며 provenance가 붙습니다.

## 사용자에게 권하는 것

- Claude Desktop 설정 파일(`claude_desktop_config.json`)에 키를 넣으면 평문으로 저장됩니다. 파일 권한을 확인하고, 키가 새면 공공데이터포털 마이페이지에서 재발급하세요.
- 설정 예시처럼 버전을 고정해(`korea-realestate-mcp@0.1`) 쓰는 것을 권합니다.
