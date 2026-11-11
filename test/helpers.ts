import { readFileSync } from "node:fs";

export const KEY = "testKEY1234+abcd/efgh==";

export const fixture = (path: string) => readFileSync(new URL(`./fixtures/${path}`, import.meta.url), "utf8");

/** 실측 fixture의 item 하나를 틀로, 원하는 값만 바꾼 정상 응답 XML을 만든다 */
export function tradeXml(items: Record<string, string>[], opts: { totalCount?: number; template?: string } = {}): string {
  const base = fixture(opts.template ?? "live/RTMSDataSvcAptTrade.xml");
  const first = /<item>.*?<\/item>/s.exec(base)![0];
  const body = items
    .map((fields) => Object.entries(fields).reduce((xml, [k, v]) => xml.replace(new RegExp(`<${k}>[^<]*</${k}>`), `<${k}>${v}</${k}>`), first))
    .join("");
  const total = opts.totalCount ?? items.length;
  return base
    .replace(/<items>.*<\/items>/s, items.length ? `<items>${body}</items>` : "<items/>")
    .replace(/<totalCount>\d+<\/totalCount>/, `<totalCount>${total}</totalCount>`);
}

export const emptyXml = () => tradeXml([]);
export const gatewayXml = (code: string) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<OpenAPI_ServiceResponse>\n<cmmMsgHeader>\n  <errMsg>E</errMsg>\n  <returnAuthMsg>m</returnAuthMsg>\n  <returnReasonCode>${code}</returnReasonCode>\n</cmmMsgHeader>\n</OpenAPI_ServiceResponse>`;

export interface Call {
  url: URL;
}

type Responder = (url: URL, n: number) => Response | Promise<Response>;

/** 호출을 기록하는 가짜 fetch */
export function fakeFetch(responder: Responder): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fn = (async (input: string | URL | Request) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    calls.push({ url });
    return responder(url, calls.length);
  }) as typeof fetch;
  return { fetch: fn, calls };
}

export const xmlResponse = (body: string, status = 200) => new Response(body, { status, headers: { "content-type": "application/xml;charset=utf-8" } });
