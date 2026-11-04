import { beforeEach, describe, expect, it, vi } from "vitest";

import { type Permission, resolveAccess } from "@/lib/auth/permissions";
import { recordingSupabase } from "@/tests/helpers/recording-supabase";

// Importing checks books each one's cartera inflow and undoing the import
// deletes it, so both need transactions:write besides imports:write and
// cheques:write (w6-s4 F2), as «Nuevo cheque» does.

let denied: Permission[] = [];
let fake = recordingSupabase();

vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({
    userId: "u1",
    access: resolveAccess(["admin"], denied),
  }),
}));
vi.mock("@/lib/supabase/service", () => ({
  getServiceClient: () => fake.client,
}));
vi.mock("@/lib/actions/audit", () => ({ logAudit: vi.fn() }));

const { commitImportAction, undoImportRunAction } =
  await import("./import-actions");

const RUN = "00000000-0000-4000-8000-0000000000e1";
const DENIED = { ok: false, error: "No tenés permiso para importar." };

function checksForm() {
  const form = new FormData();
  form.set("kind", "checks");
  return form;
}

beforeEach(() => {
  denied = [];
  fake = recordingSupabase((call) =>
    call.table === "import_runs" && call.op === "select"
      ? { data: { kind: "checks", status: "committed" }, error: null }
      : { data: null, error: null },
  );
});

describe("checks import gate", () => {
  it("refuses to import checks without transactions:write", async () => {
    denied = ["transactions:write"];
    expect(await commitImportAction(checksForm())).toEqual(DENIED);
    expect(fake.calls).toHaveLength(0);
  });

  it("refuses to undo a checks import without transactions:write", async () => {
    denied = ["transactions:write"];
    expect(await undoImportRunAction({ id: RUN })).toEqual(DENIED);
    expect(fake.calls.map((c) => c.op)).toEqual(["select"]);
  });

  it("undoes it with imports:write, cheques:write and transactions:write", async () => {
    const res = await undoImportRunAction({ id: RUN });
    expect(res).toEqual({ ok: true, data: { id: RUN } });
    expect(fake.calls.map((c) => c.table)).toContain("undo_import_run");
  });
});
