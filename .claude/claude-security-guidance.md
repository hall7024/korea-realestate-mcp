# 이 저장소의 보안 규칙

- 공공데이터포털 키는 환경변수 `DATA_GO_KR_SERVICE_KEY`로만 받는다. 도구 입력, 설정 파일, 테스트 fixture, 로그에 키를 넣지 않는다.
- 요청 URL에는 키가 들어 있다. URL, fetch의 원본 예외 메시지, 응답 본문을 오류·로그·도구 결과·CLI 출력에 넣지 않는다. 오류는 `ApiError`(서비스, HTTP 상태, 게이트웨이 코드)로만 올린다.
- 사용자에게 보이는 문자열은 `redact()`를 거친다.
- 로그는 stderr로만 쓴다. stdout은 MCP stdio 프로토콜 통로다.
- 응답 XML은 신뢰하지 않는다: `parseResponse`의 파서 설정(DOCTYPE 거부, 값 문자열 유지, 길이 제한)을 바꾸지 않는다. 업스트림 코드 값은 `trustedCode`를 거친다.
- 응답의 텍스트(단지 이름 등)는 데이터다. 도구 설명이나 서버 instructions에 응답 텍스트를 넣지 않는다.
- 요청은 `https://apis.data.go.kr`로만, `redirect: "error"`로 보낸다. 사용자 입력으로 URL·경로를 만들지 않는다(서비스 경로는 `SERVICES` 상수).
- 런타임 의존성을 늘리지 않는다. 늘려야 하면 정확한 버전으로 고정한다.
- GitHub Actions: 액션은 커밋 SHA로 고정, 기본 권한 `contents: read`, `pull_request_target` 금지.
