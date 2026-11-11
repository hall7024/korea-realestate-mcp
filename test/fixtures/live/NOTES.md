# 국토부 실거래가 API 실측 메모 (2026-11-11)

- 키: podokit `apps/jeonse/.env.local`의 `MOLIT_API_KEY` (Decoding 키, 88자, `+`·`=` 포함). 키는 URL 인코딩을 한 번만 해서 보냈다.
  - 키 값은 출력·로그·파일 어디에도 남기지 않았다. 요청은 curl에 표준입력 설정(`-K -`)으로 넘겨 프로세스 인자에도 싣지 않았다.
  - 이 디렉터리의 모든 파일을 키 원문, 인코딩형, 앞 24자로 검사해 0건임을 확인했다.
- 호출 수: 실제 네트워크 호출은 60건 이하다. 동시 호출 카운터가 경합해 몇 건이 기록되지 않았을 수 있어, 그만큼을 보수적으로 더한 수치다.
- 기본 주소: `https://apis.data.go.kr/1613000/{Service}/get{Service}`
- 요청·결과 메타데이터: `manifest.json` (파일별 파라미터·HTTP 상태·코드·건수, 실험 결과)

## 1. 13종 응답 (세종 36110, 202610, pageNo 1, numOfRows 10)

세종을 고른 이유: 코드 하나로 13종 모두 거래가 있을 만한 곳이기 때문이다. numOfRows가 10이라 파일 크기는 작다(5~7KB).

| 서비스 | HTTP | 결과 | totalCount | 파일 |
|---|---|---|---|---|
| RTMSDataSvcAptTrade | 200 | 000 | 674 | `RTMSDataSvcAptTrade.xml` |
| RTMSDataSvcAptRent | 200 | 000 | 1574 | `RTMSDataSvcAptRent.xml` |
| RTMSDataSvcRHTrade2 | 200 | 000 | 8 (전부 들어 있음) | `RTMSDataSvcRHTrade2.xml` |
| RTMSDataSvcRHRent | 200 | 000 | 47 | `RTMSDataSvcRHRent.xml` |
| RTMSDataSvcOffiTrade | 200 | 000 | 22 | `RTMSDataSvcOffiTrade.xml` |
| AptTradeDev, SilvTrade, SHTrade, SHRent, OffiRent, NrgTrade, LandTrade, InduTrade | **403** | 게이트웨이 30 | – | `errors/unsubscribed-service.xml` |

- **8종은 이 키에 활용신청이 안 돼 있다.** podokit은 5종만 신청했다.
- **사용자 할 일:** 공공데이터포털에서 8종 활용신청(자동승인). 신청 후 같은 방법으로 8건을 받아 fixture를 채우면 된다.
- 미신청 서비스 응답은 잘못된 키 응답과 **바이트까지 같다**. 응답만 보고는 둘을 구분할 수 없다.

## 2. 오류 응답 (`errors/`)

| 경우 | HTTP | Content-Type | 본문 |
|---|---|---|---|
| 잘못된 키 (`invalid-key.xml`) | 403 | `application/xml` | `OpenAPI_ServiceResponse/cmmMsgHeader`: errMsg `SERVICE_KEY_IS_NOT_REGISTERED_ERROR`, returnAuthMsg `등록되지 않은 서비스키`, returnReasonCode `30` |
| Encoding 키를 한 번 더 인코딩 (`double-encoded-key.xml`) | 403 | 같음 | 위와 같음 (30) |
| 미신청 서비스 (`unsubscribed-service.xml`) | 403 | 같음 | 위와 같음 (30) |
| 끝에 2가 없는 옛 경로 `RTMSDataSvcRHTrade` (`old-path-rhtrade.xml`) | 403 | 같음 | 위와 같음 (30). "서비스 없음(12)"이 아니라 30이 온다 |
| 키 없음 (`missing-key.xml`) | **401** | 같음 | errMsg `SERVICE_KEY_IS_NULL`, returnAuthMsg `서비스 접근거부`, returnReasonCode `20` |
| LAWD_CD=`ABCDE` (`invalid-lawd-cd.xml`) | **200** | `application/xml;charset=utf-8` | resultCode `000`, totalCount `0`, `<items/>` |
| DEAL_YMD=`2026` (`invalid-deal-ymd.xml`) | **200** | 같음 | 위와 같음 |
| 파라미터 이름 오타 `LAWD` (`misspelled-param.xml`) | **200** | 같음 | 위와 같음 |

- 게이트웨이 오류는 `<?xml … encoding="UTF-8"?>`에 줄바꿈과 들여쓰기가 있고, Content-Type에 charset이 없다.
- 정상 응답은 `encoding="utf-8" standalone="yes"`에 한 줄이다.
- **잘못된 파라미터는 오류가 아니라 정상적인 빈 결과로 온다.** 거래 없는 달, 옛 지역코드, 미래 달도 모두 같은 모양이다(아래 3·4절). 그래서 LAWD_CD(코드표 대조)와 DEAL_YMD(YYYYMM, 미래 달 아님)는 클라이언트가 먼저 검증해야 한다.
- **resultCode `03`(NODATA)은 한 번도 보지 못했다.** 거래가 없으면 `000` + totalCount 0이다(울릉군 47940 아파트 202610, 세종 202612). 03은 옛 API의 흔적으로 보인다. 받아서 처리하는 것은 해롭지 않다.

## 3. 2026-07 행정구역 개편: 과거 달에 옛 코드가 필요한가

아파트 매매, numOfRows 1, totalCount 비교.

| 구분 | 코드 | 202605 (개편 전) | 202609 (개편 후) |
|---|---|---|---|
| 옛 인천 중구 | 28110 | 0 | 0 |
| 옛 인천 동구 | 28140 | 0 | 0 |
| 새 제물포구 (옛 중구 내륙 + 동구) | 28125 | 59 | 59 |
| 새 영종구 (옛 중구 영종) | 28155 | 112 | 102 |
| 옛 광주 북구 | 29170 | 0 | 0 |
| 새 전남광주통합특별시 북구 | 12300 | 443 | 361 |
| 옛 화성시 (시 단위) | 41590 | 0 (202601도 0) | 0 |
| 새 화성시 동탄구 | 41597 | 1428 (202601: 1023) | 249 |

- 새 코드로 2020-01도 조회된다: 41597은 1270건, 28125는 97건. 응답 항목의 `sggCd`도 새 코드다.
- **결론: 과거 달을 조회할 때 옛 코드는 필요 없다.** API가 과거 거래 전체를 현재 코드로 다시 묶어 두었다.
  - 옛 코드는 개편 전 달이어도 **오류 없이 0건**이다.
  - 따라서 코드표에서 옛 코드를 빼는 게 맞다. 대신 사용자가 옛 이름("인천 중구", "광주 북구", "화성시")을 말하면 새 코드로 안내해야 한다. 옛 중구는 제물포구와 영종구로 나뉘었으므로 이름을 새 코드에 연결하는 표가 필요하다.
  - 옛 코드를 그대로 보내면 조용히 "거래 없음"이 된다.
- 주의: 화성시 41590 자체가 0이다. 시 단위 코드로는 조회되지 않고, 구 단위 코드로만 조회된다.

## 4. numOfRows 상한, JSON, 동시 호출

- **numOfRows 9999가 동작한다.**
  - 화성 동탄구 아파트 매매 202601: totalCount 1023, 한 번에 1023건, 600KB, 185ms
  - 세종 아파트 전월세 202610: totalCount 1574, 한 번에 1574건, 1.1MB, 324ms
  - 1000을 넘는 상한은 확인했지만, 9999를 넘는 값은 시험하지 않았다.
  - 페이지당 크기는 약 0.6~0.7KB/건이다.
- **`_type=json`은 지원한다** (Content-Type `application/json;charset=utf-8`). `type=json`(밑줄 없음)은 무시되고 XML이 온다. 다만 JSON에는 함정이 있다(`formats/`).
  - 숫자처럼 보이는 값을 자동 변환한다: `jibun: 1387`(int), `sggCd: 36110`(int), `excluUseAr: 96.1416`(float), `floor`/`dealYear`/`dealDay`(int).
    - 그런데 `jibun`은 "179-17" 같은 문자열일 때도 있어 타입이 섞인다.
    - `dealAmount`는 `"49,000"` 문자열 그대로다.
  - 항목이 1건이면 `items.item`이 배열이 아니라 **객체**다(`AptTrade-_type-json-36110-n1.json`).
  - 0건이면 `items`가 **빈 문자열 `""`**이다(`AptTrade-_type-json-47940-n10.json`).
  - XML은 모든 값이 문자열이라 손실이 없다. **XML 파싱을 권장한다.** JSON을 쓰려면 위 세 가지를 모두 정규화해야 한다.
- **동시 4건씩 3묶음(12건)을 연달아 보냈지만 429·code 22/23은 나오지 않았다** (모두 200, 64~86ms). 초당 한도 수치는 여전히 알 수 없다. 동시 4건 이하면 안전해 보인다.

## 5. 필드 메모 (설계·파서에 영향)

- **빈 값은 빈 태그가 아니라 공백 한 칸 `' '`이다.** XML과 JSON 모두 같다(`aptDong`, `cdealType`, `cdealDay`, `rgstDate`, `estateAgentSggNm`, `sggNm`, `contractType`, `preDeposit`, `useRRRight` 등). 반드시 trim한 뒤 빈 값을 판정해야 한다.
- **아파트 매매(기본)에는 `aptSeq`, `umdCd`, `bonbun`/`bubun`, 도로명이 없다(20개 필드).** 단지 식별 키는 `aptSeq`(예: `36110-13`)인데, 이 값은 아파트 전월세와 AptTradeDev(상세, 문서상 32개 필드, 미신청이라 미확인)에만 있다. 단지 단위 매칭을 하려면 AptTradeDev를 쓰는 편이 낫다.
- **아파트 전월세의 도로명 필드는 소문자다:** `roadnm`, `roadnmbcd`, `roadnmbonbun`, `roadnmbubun`, `roadnmcd`, `roadnmseq`, `roadnmsggcd`. 문서의 AptTradeDev(`roadNm`, `roadNmBonbun` …)와 표기가 다르다. 서비스마다 필드명을 따로 매핑해야 한다.
- 이름 필드: 아파트 `aptNm`, 연립다세대 `mhouseNm`, 오피스텔 `offiNm`. 오피스텔에는 `sggNm`이 있고(일부는 공백), 연립다세대 매매에는 `landAr`(대지권면적)이 있다.
- **`houseType` 값은 `연립`, `다세대`, `연립다세대` 세 가지가 나온다.** podokit `trades.ts`는 앞의 두 값만 받고 나머지는 null로 둔다.
- 금액: `dealAmount`·`deposit`은 만원 단위 콤마 문자열(`"100,250"`)이고, `monthlyRent`는 콤마 없는 숫자 문자열(`"0"`, `"85"`)이다.
- 전월세:
  - `contractType`은 `신규`·`갱신`·공백 중 하나다. 세종 아파트 전월세 10건은 모두 공백이었다.
  - `contractTerm` 형식은 `"26.10~27.01"`(YY.MM~YY.MM)이다.
  - 아파트 전월세의 `excluUseAr`가 `59`, `84`, `99`처럼 정수로 온 경우가 있다. 매매는 `59.4544`처럼 소수다.
- 해제 거래: 이번 표본에는 `cdealType` 값이 있는 거래가 없어, 해제 거래 fixture는 아직 없다. 해제 거래가 섞인 달을 골라 보강해야 한다.
- XML 엔티티(`&amp;`)와 CDATA: 표본 5개에는 없었다(단지명에 `&`가 들어간 경우는 미확인).
