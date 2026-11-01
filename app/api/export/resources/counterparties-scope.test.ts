import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  recordingSupabase,
  type RecordedCall,
} from "@/tests/helpers/recording-supabase";

import { ExportInputError } from "../shared";

// The clients / suppliers exports read with the user's client (RLS keeps a
// fiscal_reader on fiscal counterparties); the export narrows by the scope the
// page's button sent.

const h = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[] }));

let fake = recordingSupabase(respond);

function respond(call: RecordedCall) {
  const first = fake.calls.filter((c) => c.table === call.table)[0] === call;
  return { data: first ? h.rows : [], error: null };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => fake.client,
}));

const { clients } = await import("./clients");
const { suppliers } = await import("./suppliers");

const RANGE = { from: null, to: null };

function sideFilters(table: string) {
  const call = fake.calls.find((c) => c.table === table);
  return (call?.filters ?? []).filter(([, column]) => column === "is_fiscal");
}

beforeEach(() => {
  fake = recordingSupabase(respond);
  h.rows = [];
});

describe.each([
  ["clients", clients],
  ["suppliers", suppliers],
] as const)("%s export", (table, exporter) => {
  it.each([
    ["fiscal", true],
    ["internal", false],
  ] as const)("scope=%s filters is_fiscal = %s", async (scope, isFiscal) => {
    await exporter.load(new URLSearchParams({ scope }), RANGE);
    expect(sideFilters(table)).toEqual([["eq", "is_fiscal", isFiscal]]);
  });

  it("without scope lists both sides (RLS still bounds the role)", async () => {
    const out = await exporter.load(new URLSearchParams(), RANGE);
    expect(sideFilters(table)).toEqual([]);
    expect(out.subtitle).toBe("Todos los canales");
  });

  it("rejects an unknown scope instead of exporting everything", async () => {
    await expect(
      exporter.load(new URLSearchParams({ scope: "dz" }), RANGE),
    ).rejects.toBeInstanceOf(ExportInputError);
    expect(fake.calls).toHaveLength(0);
  });

  it("prints an internal counterparty without CUIT or IVA condition", async () => {
    h.rows = [
      {
        legal_name: "Cliente interno",
        display_name: null,
        cuit: null,
        iva_condition: null,
        is_active: true,
        created_at: "2026-11-01",
        supplier_categories: null,
      },
    ];
    const out = await exporter.load(
      new URLSearchParams({ scope: "internal" }),
      RANGE,
    );
    expect(out.subtitle).toBe("Solo interno");
    const [row] = out.rows;
    expect(row).toBeDefined();
    expect(row?.filter((cell) => cell === "—").length).toBeGreaterThanOrEqual(
      2,
    );
    expect(row?.some((cell) => cell === "null")).toBe(false);
  });
});
