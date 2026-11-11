# korea-realestate-mcp

국토교통부 실거래가 공개자료로 **아파트·빌라·오피스텔의 시세와 전세가율**을 계산하는 MCP 서버, CLI, TypeScript 라이브러리입니다.
Claude에게 "이 단지 84㎡ 시세가 어때?", "이 빌라 전세 4억이면 시세 대비 몇 %야?"라고 물으면 실거래 원자료로 근거 있는 숫자를 답할 수 있게 합니다.

[English summary](#english)

```
> 세종 종촌동 가재마을4단지 75㎡ 전세 3억이면 어느 정도야?

## 세종특별자치시 종촌동 아파트 전세가율
단지: 가재마을4단지(센트레빌) (종촌동 640)
| 항목 | 값 |
|---|---|
| 전세가율 | 53.7% |
| ㎡당 매매 중앙값 (사분위) | 559만원 (538만원 ~ 567만원) |
| ㎡당 전세 중앙값 (사분위) | 300만원 (293만원 ~ 307만원) |
| 표본 | 매매 38건, 전세 36건 |
| 신뢰도 | 높음 |
| 입력 보증금 | 3억원 |
| 추정 전세가 (같은 면적) | 2억 2,506만원 |
| 보증금 ÷ 추정 전세가 | 133.3% |
| 비교 전세 중 위치 | ㎡당 보증금이 입력값 이하인 계약 100% |
| 추정 매매가 (같은 면적) | 4억 1,936만원 |
| 보증금 ÷ 추정 매매가 | 71.5% |
기준: 계약일 기준 최근 12개월 (2025-11-11 초과 ~ 2026-11-11) / 전용면적 75㎡ ±3% / 해제 거래 제외 (1건) / 직거래 제외 (3건) / …
제외: 해제 1건, 직거래 3건 (매매) / 월세 42건, 갱신 23건 (전세 표본에서)
참고 자료이며 계약·투자 판단의 근거가 아닙니다.
출처: 국토교통부 실거래가 공개자료(공공데이터포털), 조회 2026-11-11 23:12 KST
```

## 무엇이 다른가

- **13종 전부**: 아파트·연립다세대·단독다가구·오피스텔의 매매와 전월세, 분양·입주권, 상업업무용, 토지, 공장·창고.
- **빠짐없이 받기**: 모든 쪽을 받고, 받은 건수가 `totalCount`보다 적으면 다시 받거나 실패로 알립니다. 한 쪽만 받고 끝내지 않습니다.
- **조용한 0건을 막기**: 이 API는 잘못된 지역 코드·미래 달·옛 행정구역 코드에도 오류 없이 0건을 돌려줍니다. 호출 전에 코드표와 날짜로 먼저 검증합니다.
- **2026-07 행정구역 개편 반영**: "인천 중구", "광주광역시 북구", "화성시"를 새 코드(제물포구·영종구, 전남광주통합특별시 북구, 화성시 4개 구)로 바꿔 조회합니다. API가 과거 거래도 새 코드로만 돌려주는 것을 실측으로 확인했습니다.
- **오류를 할 일로 바꾸기**: 403 코드 30은 "키가 틀림"과 "그 서비스 미신청"이 바이트까지 같은 응답입니다. 같은 키로 다른 서비스가 성공했으면 미신청으로 좁히고, 신청할 데이터셋 번호와 링크를 알려 줍니다. `doctor` 명령으로 13종의 신청 상태를 한 번에 봅니다.
- **분석 기준을 숨기지 않기**: 해제·직거래 제외 건수, 면적 허용 오차, 신고 기한 때문에 덜 잡힌 최근 달, 표본 수와 신뢰도 기준을 결과에 함께 냅니다.
- **키를 새지 않게**: 인증키는 URL 쿼리에 실려 가므로, URL과 원본 예외를 오류·로그·도구 결과 어디에도 내보내지 않습니다. 테스트로 확인합니다. [보안 설계](#보안-설계)

## 시작하기

### 1. 인증키 발급과 활용신청

1. [공공데이터포털](https://www.data.go.kr)에 가입하고 아래 데이터셋마다 **활용신청**을 합니다. 자동승인이며 반영까지 최대 1시간 걸릴 수 있습니다.
2. 마이페이지에서 **일반 인증키**를 복사합니다. Encoding·Decoding 어느 쪽이든 됩니다.

| 용도 | 데이터셋 |
|---|---|
| 아파트 시세·전세가율 | [아파트 매매](https://www.data.go.kr/data/15126469/openapi.do), [아파트 전월세](https://www.data.go.kr/data/15126474/openapi.do) |
| 빌라(연립·다세대) | [매매](https://www.data.go.kr/data/15126467/openapi.do), [전월세](https://www.data.go.kr/data/15126473/openapi.do) |
| 오피스텔 | [매매](https://www.data.go.kr/data/15126464/openapi.do), [전월세](https://www.data.go.kr/data/15126475/openapi.do) |
| 그 밖 (조회만) | 단독·다가구 [매매](https://www.data.go.kr/data/15126465/openapi.do)·[전월세](https://www.data.go.kr/data/15126472/openapi.do), [분양·입주권](https://www.data.go.kr/data/15126471/openapi.do), [상업업무용](https://www.data.go.kr/data/15126463/openapi.do), [토지](https://www.data.go.kr/data/15126466/openapi.do), [공장·창고](https://www.data.go.kr/data/15126470/openapi.do), [아파트 매매 상세](https://www.data.go.kr/data/15126468/openapi.do) |

신청 상태 확인:

```bash
DATA_GO_KR_SERVICE_KEY=발급받은키 npx -y korea-realestate-mcp@0.1 doctor
```

### 2. Claude에 연결

**Claude Code**

```bash
claude mcp add korea-realestate -e DATA_GO_KR_SERVICE_KEY=발급받은키 -- npx -y korea-realestate-mcp@0.1
```

**Claude Desktop** (`claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "korea-realestate": {
      "command": "npx",
      "args": ["-y", "korea-realestate-mcp@0.1"],
      "env": { "DATA_GO_KR_SERVICE_KEY": "발급받은키" }
    }
  }
}
```

설정 파일에 키가 평문으로 남습니다. 파일 권한을 확인하고, 키가 새면 포털에서 재발급하세요.

## MCP 도구

| 도구 | 하는 일 |
|---|---|
| `resolve_region` | 지역 이름 → 시군구 코드·법정동. 이름이 겹치면 후보와 "region에 넣을 값"을 돌려줍니다 |
| `search_deals` | 13종 실거래 원자료를 최신순으로 (최대 50건, 24개월) |
| `market_summary` | 매매 시세: 중앙값, 범위, 사분위, ㎡당·3.3㎡당 가격, 월별 추이, 최근 거래 |
| `jeonse_ratio` | 전세가율. 보증금과 면적을 주면 추정 전세가·매매가 대비 비율과 비교 전세 중 위치 |

모든 도구는 읽기 전용이고, 결과 끝에 출처와 조회 시각을 붙입니다.

지역은 이렇게 넣을 수 있습니다:
- 시군구: `강남구`, `서울 강남구`, `수원시 영통구`, `세종`
- 법정동: `마포구 아현동`, `아현동`, `세종 조치원읍`
- 코드: 시군구 5자리, 법정동 10자리
- 행정동·줄임말·옛 이름: `역삼1동`, `강남`, `인천 중구`

## CLI

```bash
export DATA_GO_KR_SERVICE_KEY=발급받은키

korea-realestate-mcp doctor
korea-realestate-mcp region 신사동
korea-realestate-mcp deals   --type apt --deal rent --region "마포구 아현동" --months 3
korea-realestate-mcp summary --type apt --region "마포구 아현동" --name 래미안푸르지오 --area 84
korea-realestate-mcp ratio   --type rh --region "강서구 화곡동" --area 59 --deposit 4억 --json
```

인자 없이 터미널에서 실행하면 도움말이 나오고, 파이프로 실행하면(MCP 클라이언트가 띄울 때) stdio MCP 서버로 동작합니다.

## 라이브러리

```ts
import { createClient, summarize, resolveRegion } from "korea-realestate-mcp";

const client = createClient(); // DATA_GO_KR_SERVICE_KEY를 읽음. 또는 { serviceKey }
const deals = await client.fetchMonth("apt-sale", "11440", "202610"); // 금액은 원 단위
const r = await summarize({ client }, { propertyType: "apt", region: "마포구 아현동", area: 84 });
```

`fetch`, 캐시(`CacheStore`), 시계를 주입할 수 있습니다. 라이브러리 진입점은 MCP SDK를 불러오지 않습니다.

## 계산 기준과 한계

- **기간**: "최근 12개월"은 KST 오늘 기준 계약일 12개월입니다. API 호출은 13개 달입니다.
- **최근 두 달**: 실거래 신고 기한이 30일이라 건수가 덜 잡힙니다. 월별 추이에 `*`로 표시합니다.
- **제외**: 해제 거래는 항상 빼고, 직거래는 기본으로 뺍니다(가족 간 거래 등이 시세를 끌어내릴 수 있음). 뺀 건수는 항상 표시합니다.
- **전세 표본**: 월세 0원이고 갱신 계약이 아닌 것입니다. 계약 구분이 비어 있는 계약은 포함합니다(실측상 많음).
- **면적 허용 오차**: 단지를 지정하면 ±3%, 아파트 지역 범위는 ±10%, 빌라·오피스텔은 ±15%입니다.
- **전세가율 표본**: 매매·전세 각 5건 이상일 때만 냅니다. 신뢰도 "높음"은 단지를 지정하고, 각 10건 이상이며, 최근 6개월에 각 3건 이상일 때입니다. 지역 범위는 최대 "보통"입니다.
- **판단은 하지 않음**: 숫자와 기준만 돌려줍니다. 결과는 공개 실거래 기반 참고 자료이며 계약·투자 판단의 근거가 아닙니다. 계약 전에는 등기부와 전문가 확인이 필요합니다.
- **미검증 서비스**: 단독다가구·분양권·상업업무용·토지·공장창고·아파트 매매 상세·오피스텔 전월세는 실제 응답으로 필드를 확인하지 않았습니다(결과에 표시). 서비스별 자료 시작월도 확인하지 않았습니다.
- **호출 한도**: 한 번의 조회는 API 호출 80건 안에서만 합니다. 개발계정은 하루 10,000건입니다. 구가 여러 개인 시 전체(예: 수원시 24개월 전세가율)는 한도를 넘으니 구로 좁혀 주세요.

## 보안 설계

- 인증키는 환경변수 `DATA_GO_KR_SERVICE_KEY`로만 받습니다. 도구 입력에는 키 필드가 없습니다.
- Encoding 키와 Decoding 키를 같은 원문으로 정규화한 뒤 한 번만 인코딩합니다. 이중 인코딩하면 403이 납니다.
- 요청 URL에 키가 있으므로, URL·원본 예외(`Failed to parse URL from …` 등)·응답 본문을 오류에 담지 않습니다. 모든 출력은 키의 원문·인코딩형·`+`→공백형을 가리는 마스킹을 거칩니다.
- 요청은 `https://apis.data.go.kr`로만, `redirect: "error"`, 타임아웃 15초, 응답 16MB 상한, 동시 4건으로 보냅니다.
- XML은 DOCTYPE을 거부하고 값을 문자열 그대로, 200자 제한으로 읽습니다. 업스트림 코드 값은 숫자일 때만 믿습니다.
- 로그는 stderr로만, 서비스·지역·달·상태만 남깁니다.
- 저장소는 gitleaks(serviceKey 규칙 포함)·Semgrep·zizmor·CodeQL·Dependabot을 쓰고, 액션은 SHA로 고정합니다. npm 배포는 GitHub Actions에서 provenance를 붙여 하고, 첫 배포 뒤에는 trusted publishing(OIDC)만 씁니다.

취약점은 [SECURITY.md](SECURITY.md)의 방법으로 알려 주세요.

## 개발

```bash
pnpm install
pnpm test        # 단위·통합 테스트 (네트워크 없음)
pnpm typecheck && pnpm lint && pnpm build
LIVE=1 DATA_GO_KR_SERVICE_KEY=… pnpm vitest run test/live.test.ts   # 실제 API 스모크 (약 3건 호출)
pnpm gen:regions <법정동코드 전체자료.txt>                            # 지역 코드표 다시 만들기
```

설계 문서: [docs/superpowers/specs/2026-11-11-v0.1-design.md](docs/superpowers/specs/2026-11-11-v0.1-design.md)

## 데이터 출처와 라이선스

- 실거래가: 국토교통부 실거래가 공개 API(공공데이터포털). 이 패키지는 실거래 자료를 담지 않고, 사용자의 키로 직접 호출합니다.
- 지역 코드표(`data/regions.json`): 행정안전부 행정표준코드관리시스템 법정동코드 전체자료 (공공누리 제1유형, 출처: 행정안전부).
- 코드: [MIT](LICENSE)

---

## English

**korea-realestate-mcp** is an MCP server, CLI, and TypeScript library for Korea's official real-estate transaction data (MOLIT, via data.go.kr).

- Queries all 13 transaction datasets (apartments, row houses, detached houses, officetels, presale rights, commercial, land, industrial).
- Computes market summaries (median, IQR, price per ㎡, monthly trend) and *jeonse* (lump-sum deposit lease) ratios, with every exclusion and threshold shown.
- Resolves Korean region names, legal-dong codes, and pre-2026 administrative names to the codes the API actually accepts. The API returns an empty, error-free result for wrong or retired codes, so inputs are validated before calling.
- Turns opaque gateway errors into actionable messages, including which dataset to subscribe to.
- Keeps the API key out of every error, log, and tool result. The key travels in the URL query, so URLs and raw exceptions are never surfaced. Tests enforce this.

Requires a free data.go.kr service key in `DATA_GO_KR_SERVICE_KEY`. Results are reference data, not advice.
