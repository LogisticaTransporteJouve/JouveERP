import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import type { Database } from "@/lib/db/database.types";
import { recordingSupabase } from "@/tests/helpers/recording-supabase";

import { loadEmisor, redactEmisor, type Emisor } from "./emisor";

const EMISOR: Emisor = {
  legal_name: "DZ & Sons S.A.",
  cuit: "30-71234567-8",
  iva_condition: "IVA Responsable Inscripto",
  address: "Av. Siempre Viva 123",
  division_label: "Logística Jouve",
  iibb_number: "901-123456-7",
  inicio_actividades: "2020-01-01",
};

describe("redactEmisor", () => {
  it("returns a fiscal issuer untouched", () => {
    expect(redactEmisor({ isFiscal: true, emisor: EMISOR })).toBe(EMISOR);
  });

  it("strips every fiscal datum of an internal issuer, keeping the division", () => {
    const internal = redactEmisor({ isFiscal: false, emisor: EMISOR });
    expect(internal).toEqual({
      legal_name: "Logística Jouve",
      cuit: "",
      iva_condition: "",
      address: null,
      division_label: "",
      iibb_number: null,
      inicio_actividades: null,
    });
    expect(JSON.stringify(internal)).not.toContain("30-71234567-8");
    expect(JSON.stringify(internal)).not.toContain("DZ & Sons");
  });
});

function fakeClient(bu: Record<string, unknown> | null, error: unknown = null) {
  const fake = recordingSupabase(() => ({ data: bu, error }));
  // The recording fake answers `.from(...)...maybeSingle()` like supabase-js.
  return fake.client as unknown as SupabaseClient<Database>;
}

describe("loadEmisor", () => {
  const channel = { business_unit_id: "dz_sons" };

  it("reads the business unit's fiscal fields", async () => {
    const emisor = await loadEmisor(
      fakeClient({
        name: "DZ & Sons S.A.",
        cuit: "30-71234567-8",
        tax_condition: "IVA Responsable Inscripto",
        tax_address: "Av. Siempre Viva 123",
        iibb_number: "901-123456-7",
        inicio_actividades: "2020-01-01",
      }),
      channel,
    );
    expect(emisor).toEqual(EMISOR);
  });

  it("keeps the defaults when the unit is missing", async () => {
    const emisor = await loadEmisor(fakeClient(null), channel);
    expect(emisor.legal_name).toBe("DZ & Sons S.A.");
    expect(emisor.cuit).toBe("");
    expect(emisor.division_label).toBe("Logística Jouve");
  });

  it("throws on a read error", async () => {
    await expect(
      loadEmisor(fakeClient(null, { message: "down" }), channel),
    ).rejects.toThrow(/load-business-unit/);
  });
});
