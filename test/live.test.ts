import { describe, expect, it } from "vitest";
import { createClient } from "../src/core/client.js";
import { readServiceKey } from "../src/core/key.js";
import { summarize } from "../src/core/query.js";
import { addMonths, todayKst } from "../src/core/time.js";

// 실제 API 호출. LIVE=1이고 키가 있을 때만 돈다 (CI에서는 돌지 않음). 호출 수: 약 3건
const live = process.env.LIVE === "1" && readServiceKey() !== null;

describe.runIf(live)("실제 API", () => {
  it("세종 아파트 매매 지난달", async () => {
    const client = createClient();
    const ym = addMonths(todayKst(), -1).slice(0, 7).replace("-", "");
    const deals = await client.fetchMonth("apt-sale", "36110", ym);
    expect(deals.length).toBeGreaterThan(0);
    expect(deals[0]).toMatchObject({ lawdCode: "36110", kind: "sale" });
  });

  it("시세 요약", async () => {
    const r = await summarize({ client: createClient() }, { propertyType: "apt", region: "세종", months: 1 });
    expect(r.kind).toBe("market");
  });
});
