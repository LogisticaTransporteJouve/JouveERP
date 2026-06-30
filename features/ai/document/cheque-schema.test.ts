import { describe, expect, it } from "vitest";

import { ChequeBatchExtractionSchema, EXTRACTION_SCHEMAS } from "./schemas";

describe("ChequeBatchExtractionSchema", () => {
  it("parses several checks from one photo", () => {
    const r = ChequeBatchExtractionSchema.safeParse({
      cheques: [
        {
          banco: "Santander",
          serie: "M",
          numero: "00000007",
          importe: 3500000,
          fecha: "2025-12-06",
          fecha_pago: "2026-04-20",
          librador: "VCH SAS",
          librador_cuit: "30718775597",
          cuenta: "179-133819/9",
          moneda: "ARS",
          tipo: "diferido",
        },
        { banco: "Banco San Juan", numero: "49611389", importe: 1000000 },
      ],
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.cheques).toHaveLength(2);
      expect(r.data.cheques[0]?.serie).toBe("M");
      expect(r.data.cheques[0]?.librador_cuit).toBe("30718775597");
    }
  });

  it("defaults to an empty list when none are present", () => {
    const r = ChequeBatchExtractionSchema.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.cheques).toEqual([]);
  });

  it("is wired as the cheque extraction schema", () => {
    expect(EXTRACTION_SCHEMAS.cheque).toBe(ChequeBatchExtractionSchema);
  });
});
