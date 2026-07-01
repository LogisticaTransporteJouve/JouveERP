import { describe, expect, it } from "vitest";

import { ChequeBatchExtractionSchema, EXTRACTION_SCHEMAS } from "./schemas";

describe("ChequeBatchExtractionSchema", () => {
  it("parses several checks from one photo", () => {
    const r = ChequeBatchExtractionSchema.safeParse({
      cheques: [
        {
          bank: "Santander",
          series: "M",
          number: "00000007",
          amount: 3500000,
          date: "2025-12-06",
          payment_date: "2026-04-20",
          drawer: "VCH SAS",
          drawer_cuit: "30718775597",
          account: "179-133819/9",
          currency: "ARS",
          type: "deferred",
        },
        { bank: "Banco San Juan", number: "49611389", amount: 1000000 },
      ],
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.cheques).toHaveLength(2);
      expect(r.data.cheques[0]?.series).toBe("M");
      expect(r.data.cheques[0]?.drawer_cuit).toBe("30718775597");
    }
  });

  it("defaults to an empty list when none are present", () => {
    const r = ChequeBatchExtractionSchema.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.cheques).toEqual([]);
  });

  it("is wired as the cheque extraction schema", () => {
    expect(EXTRACTION_SCHEMAS.check).toBe(ChequeBatchExtractionSchema);
  });
});
