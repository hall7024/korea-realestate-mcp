/** 사용자 입력이 잘못됐거나 조회 전에 막아야 하는 경우. 모델이 고쳐 다시 부를 수 있게 hint를 단다 */
export class InputError extends Error {
  override readonly name: string = "InputError";
  constructor(
    message: string,
    readonly hint?: string,
  ) {
    super(message);
  }
}

/** 한 번의 조회가 쓸 API 호출 수가 예산을 넘음 */
export class BudgetError extends InputError {
  override readonly name = "BudgetError";
  constructor(
    readonly requests: number,
    readonly limit: number,
  ) {
    super(
      `이 조회에는 API 호출이 약 ${requests}건 필요해 한도(${limit}건)를 넘습니다.`,
      "기간(months)을 줄이거나, 지역을 구·법정동 단위로 좁혀 주세요. 공공데이터포털 개발계정은 하루 10,000건입니다.",
    );
  }
}

export type ApiErrorKind =
  | "key_or_subscription"
  | "not_subscribed"
  | "no_key"
  | "daily_limit"
  | "rate_limit"
  | "expired"
  | "bad_request"
  | "timeout"
  | "network"
  | "too_large"
  | "upstream";

/**
 * 공공데이터포털 호출 실패. 메시지에는 서비스·HTTP 상태·게이트웨이 코드만 담는다.
 * 요청 URL(키 포함)이나 원본 예외는 절대 담지 않는다.
 */
export class ApiError extends Error {
  override readonly name = "ApiError";
  constructor(
    readonly kind: ApiErrorKind,
    message: string,
    readonly hint: string,
    readonly details: { service?: string; status?: number; gatewayCode?: string } = {},
  ) {
    super(message);
  }
}
