import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAccess } from "@/lib/auth/permissions";
import {
  recordingSupabase,
  type RecordedCall,
} from "@/tests/helpers/recording-supabase";

// An own driver (employee_id set) mirrors its employee: syncEmployeeDriver
// rewrites full_name, cuit and is_active on every save of the legajo, so the
// drivers screen may not change them (it would be silently undone).

const DRIVER_ID = "00000000-0000-4000-8000-0000000000d1";
const EMPLOYEE_ID = "00000000-0000-4000-8000-0000000000e1";

let stored: {
  employee_id: string | null;
  full_name: string;
  cuit: string | null;
  is_active: boolean;
} | null = null;
const logAudit = vi.fn();

/** A write matches the row only if its employee_id filter agrees. */
function matches(call: RecordedCall): boolean {
  if (!stored) return false;
  return call.filters.every(([kind, column, value]) => {
    if (column !== "employee_id") return true;
    if (kind === "is") return stored?.employee_id === null;
    return stored?.employee_id === value;
  });
}

let fake = recordingSupabase();
function respond(call: RecordedCall) {
  if (call.op === "select") return { data: stored, error: null };
  return {
    data: matches(call) ? [{ id: DRIVER_ID }] : [],
    error: null,
  };
}

vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({
    userId: "u1",
    access: resolveAccess(["operations"]),
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => fake.client,
}));
vi.mock("@/lib/actions/audit", () => ({ logAudit }));

const { deleteDriverAction, setDriverActiveAction, updateDriverAction } =
  await import("./drivers-actions");

const own = {
  employee_id: EMPLOYEE_ID,
  full_name: "Juan Pérez",
  cuit: "20123456789",
  is_active: true,
};

beforeEach(() => {
  stored = { ...own };
  fake = recordingSupabase(respond);
  logAudit.mockReset();
});

describe("own driver: fields its employee owns", () => {
  it("refuses a new name, writing nothing", async () => {
    expect(
      await updateDriverAction({ id: DRIVER_ID, full_name: "Otro Nombre" }),
    ).toEqual({
      ok: false,
      error:
        "Chofer propio: el nombre, el CUIT y si está activo se cambian en su legajo (Personal → Empleados).",
    });
    expect(fake.calls.some((c) => c.op === "update")).toBe(false);
  });

  it("saves the license and phone when the form sends the same name and CUIT", async () => {
    const res = await updateDriverAction({
      id: DRIVER_ID,
      full_name: "Juan Pérez",
      cuit: "20123456789",
      license_number: "L-1",
      phone: "11 5555 5555",
    });
    expect(res).toEqual({ ok: true, data: undefined });
    const update = fake.calls.find((c) => c.op === "update");
    expect(update?.filters).toContainEqual(["eq", "employee_id", EMPLOYEE_ID]);
    expect(update?.payload).not.toHaveProperty("employee_id");
  });

  it("refuses the Activo switch", async () => {
    expect(
      await setDriverActiveAction({ id: DRIVER_ID, is_active: false }),
    ).toEqual({
      ok: false,
      error:
        "Chofer propio: se activa, desactiva o da de baja desde su legajo (Personal → Empleados).",
    });
    expect(logAudit).not.toHaveBeenCalled();
  });

  it("refuses a delete", async () => {
    expect((await deleteDriverAction({ id: DRIVER_ID })).ok).toBe(false);
    expect(logAudit).not.toHaveBeenCalled();
  });
});

describe("contracted driver", () => {
  beforeEach(() => {
    stored = { ...own, employee_id: null };
  });

  it("edits its name and toggles it", async () => {
    expect(
      (await updateDriverAction({ id: DRIVER_ID, full_name: "Nuevo" })).ok,
    ).toBe(true);
    expect(
      (await setDriverActiveAction({ id: DRIVER_ID, is_active: false })).ok,
    ).toBe(true);
    expect(logAudit).toHaveBeenCalledTimes(2);
  });

  it("an update that a link made meanwhile matches no row says so", async () => {
    // Read as contracted, linked before the guarded write.
    fake = recordingSupabase((call) =>
      call.op === "select"
        ? { data: { ...own, employee_id: null }, error: null }
        : { data: [], error: null },
    );
    expect(await updateDriverAction({ id: DRIVER_ID, phone: "1" })).toEqual({
      ok: false,
      error: "El chofer cambió mientras lo editabas. Actualizá la página.",
    });
  });

  it("a missing driver is not found", async () => {
    stored = null;
    expect(await updateDriverAction({ id: DRIVER_ID, phone: "1" })).toEqual({
      ok: false,
      error: "No se encontró el chofer. Actualizá la página.",
    });
  });
});
