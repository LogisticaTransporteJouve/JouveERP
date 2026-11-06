import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveAccess } from "@/lib/auth/permissions";

type Row = Record<string, unknown>;

const h = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  upserts: [] as Row[][],
  updates: [] as Row[],
  warn: vi.fn(),
  failCounts: false,
  /** The next `update … maybeSingle` fails with this error. */
  updateError: null as { code: string; message: string } | null,
  afipPoints: [] as Array<{
    number: number;
    emissionType: string;
    blocked: boolean;
  }>,
}));

function from(table: string) {
  const filters: Array<(r: Row) => boolean> = [];
  let patch: Row | null = null;
  const rows = () =>
    (h.tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
  const withChannel = (r: Row) => ({
    ...r,
    channel:
      (h.tables.invoicing_channels ?? []).find((c) => c.id === r.channel_id) ??
      null,
  });
  let head = false;
  const builder = {
    select: (_cols?: string, opts?: { head?: boolean }) => {
      head = opts?.head ?? false;
      return builder;
    },
    is: (col: string, value: unknown) => {
      filters.push((r) => (r[col] ?? null) === value);
      return builder;
    },
    eq: (col: string, value: unknown) => {
      filters.push((r) => r[col] === value);
      return builder;
    },
    neq: (col: string, value: unknown) => {
      filters.push((r) => r[col] !== value);
      return builder;
    },
    order: () => builder,
    limit: () => builder,
    update: (values: Row) => {
      patch = values;
      return builder;
    },
    upsert: async (values: Row[]) => {
      h.upserts.push(values);
      return { error: null };
    },
    maybeSingle: async () => {
      if (patch && h.updateError) {
        const error = h.updateError;
        h.updateError = null;
        return { data: null, error };
      }
      const found = rows()[0] ?? null;
      if (patch && found) {
        Object.assign(found, patch);
        h.updates.push(patch);
      }
      return { data: found, error: null };
    },
    then: (
      resolve: (v: {
        data: Row[] | null;
        count?: number | null;
        error: { message: string } | null;
      }) => unknown,
    ) => {
      if (head && h.failCounts) {
        return resolve({ data: null, count: null, error: { message: "down" } });
      }
      if (head)
        return resolve({ data: null, count: rows().length, error: null });
      return resolve({ data: rows().map(withChannel), error: null });
    },
  };
  return builder;
}

vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({
    userId: "u1",
    access: resolveAccess(["owner"]),
  }),
}));
vi.mock("@/lib/supabase/service", () => ({
  getServiceClient: () => ({ from }),
}));
vi.mock("@/lib/actions/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/logger", () => ({
  logger: { warn: h.warn, error: vi.fn(), info: vi.fn() },
}));
vi.mock("@/lib/afip/wsfev1", () => ({
  getSalesPoints: async () => h.afipPoints,
}));
vi.mock("@/lib/afip/diagnostics", () => ({ runAfipDiagnostics: vi.fn() }));
vi.mock("@/lib/afip/env", () => ({ getAfipCuit: () => "30000000000" }));

const { configurePosAction, syncAfipPosAction, getCaeaStatusAction } =
  await import("./afip-admin-actions");

beforeEach(() => {
  h.failCounts = false;
  h.updateError = null;
  h.upserts.length = 0;
  h.updates.length = 0;
  h.warn.mockClear();
  h.tables = {
    invoicing_channels: [
      { id: "jouve_fiscal", is_fiscal: true, is_active: true },
      { id: "jouve_internal", is_fiscal: false, is_active: true },
      { id: "dz_fiscal", is_fiscal: true, is_active: false },
    ],
    sales_points: [
      { numero: 3, channel_id: "jouve_fiscal", is_enabled: true },
      { numero: 4, channel_id: "dz_fiscal", is_enabled: true },
      { numero: 7, channel_id: null, is_enabled: false },
      { numero: 9, channel_id: "jouve_internal", is_enabled: true },
    ],
  };
});

describe("configurePosAction", () => {
  it("refuses an inactive channel", async () => {
    const res = await configurePosAction({
      numero: 7,
      channel_id: "dz_fiscal",
      nickname: null,
      is_enabled: false,
    });
    expect(res).toEqual({
      ok: false,
      error: "El canal no existe o está inactivo.",
    });
    expect(h.updates).toEqual([]);
  });

  it("refuses a second enabled POS on the same channel", async () => {
    const res = await configurePosAction({
      numero: 7,
      channel_id: "jouve_fiscal",
      nickname: null,
      is_enabled: true,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/ya tiene habilitado el POS 3/);
    expect(h.updates).toEqual([]);
  });

  it("still disables a POS of an inactive channel", async () => {
    const res = await configurePosAction({
      numero: 4,
      channel_id: "dz_fiscal",
      nickname: null,
      is_enabled: false,
    });
    expect(res.ok).toBe(true);
    expect(h.updates).toEqual([
      { channel_id: "dz_fiscal", nickname: null, is_enabled: false },
    ]);
  });

  it("says so when another enable on the channel won the race (unique index)", async () => {
    // The check saw no other enabled POS; the index refused the update.
    h.updateError = { code: "23505", message: "duplicate key value" };
    const res = await configurePosAction({
      numero: 7,
      channel_id: "jouve_internal",
      nickname: null,
      is_enabled: false,
    });
    expect(res).toEqual({
      ok: false,
      error:
        "El canal ya tiene otro POS habilitado. Deshabilitalo antes de habilitar otro.",
    });
  });

  it("does not show the database's message on another failure", async () => {
    h.updateError = { code: "XX000", message: "relation sales_points broke" };
    const res = await configurePosAction({
      numero: 7,
      channel_id: "jouve_internal",
      nickname: null,
      is_enabled: false,
    });
    expect(res).toEqual({
      ok: false,
      error: "No se pudo guardar el POS. Reintentá.",
    });
  });

  it("assigns a free POS to an active channel", async () => {
    const res = await configurePosAction({
      numero: 7,
      channel_id: "jouve_internal",
      nickname: "Interno",
      is_enabled: false,
    });
    expect(res.ok).toBe(true);
  });
});

describe("syncAfipPosAction", () => {
  it("skips the numbers of internal channels and warns with the count", async () => {
    h.afipPoints = [
      { number: 3, emissionType: "CAE", blocked: false },
      { number: 9, emissionType: "CAE", blocked: false },
      { number: 12, emissionType: "CAEA", blocked: false },
    ];
    const res = await syncAfipPosAction();
    expect(res.ok).toBe(true);
    expect(h.upserts[0]?.map((r) => r.numero)).toEqual([3, 12]);
    expect(h.warn).toHaveBeenCalledWith("afip.pos_sync.internal_conflict", {
      count: 1,
    });
    if (res.ok) {
      expect(res.data.inserted).toBe(1);
      expect(res.data.updated).toBe(1);
    }
  });
});

describe("getCaeaStatusAction", () => {
  it("counts the CAEA vouchers not yet informed", async () => {
    h.tables.caea_codes = [];
    h.tables.invoices = [
      { emission_type: "caea", status: "emitted", caea_informed_at: null },
      { emission_type: "caea", status: "emitted", caea_informed_at: "x" },
    ];
    const res = await getCaeaStatusAction();
    expect(res).toEqual({ ok: true, data: { codes: [], pendingToInform: 1 } });
  });

  it("reports an error, not zero pending, when the count fails", async () => {
    h.tables.caea_codes = [];
    h.failCounts = true;
    const res = await getCaeaStatusAction();
    expect(res).toEqual({
      ok: false,
      error: "No se pudo leer el estado CAEA.",
    });
  });
});
