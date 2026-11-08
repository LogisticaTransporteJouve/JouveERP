import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAccess, type Access, type Role } from "@/lib/auth/permissions";
import {
  recordingSupabase,
  type RecordedCall,
} from "@/tests/helpers/recording-supabase";

import { LEDGER_MAX_ROWS } from "../lib/libro-mayor-pagination";

const h = vi.hoisted(() => ({
  access: null as Access | null,
  rowCount: 0,
  opening: 0,
}));

const ACCOUNT = "11111111-1111-4111-8111-111111111111";

function ledgerRow(i: number) {
  return {
    entry_id: `e${i}`,
    line_id: `l${i}`,
    entry_date: "2026-05-01",
    accrual_period: "2026-05",
    description: "",
    source_table: null,
    source_id: null,
    channel_id: null,
    is_reversal: false,
    debit: 1,
    credit: 0,
    line_desc: null,
    running: h.opening + i + 1,
    account_code: "1.1.1.2",
    account_name: "Bancos",
  };
}

function respond(call: RecordedCall) {
  if (call.table === "get_ledger") {
    return {
      data: Array.from({ length: h.rowCount }, (_, i) => ledgerRow(i)),
      error: null,
    };
  }
  if (call.table === "get_ledger_opening") {
    return { data: h.opening, error: null };
  }
  return { data: null, error: null };
}

let fake = recordingSupabase(respond);

vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({ userId: "u1", access: h.access }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => fake.client,
}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { getLedgerAction } = await import("./libro-mayor-actions");

function as(roles: Role[], denied: string[] = []) {
  h.access = resolveAccess(roles, denied);
}

beforeEach(() => {
  fake = recordingSupabase(respond);
  as(["owner"]);
  h.rowCount = 0;
  h.opening = 0;
});

describe("getLedgerAction", () => {
  it("is refused without accounting:read", async () => {
    as(["admin"], ["accounting:read"]);
    const res = await getLedgerAction({ accountId: ACCOUNT });
    expect(res.ok).toBe(false);
    expect(fake.calls).toHaveLength(0);
  });

  it("is complete when the server returns fewer rows than a full page", async () => {
    h.rowCount = LEDGER_MAX_ROWS;
    const res = await getLedgerAction({ accountId: ACCOUNT });
    expect(res.ok && res.data.truncated).toBe(false);
    expect(res.ok && res.data.rows).toHaveLength(LEDGER_MAX_ROWS);
  });

  it("flags a full PostgREST page (max_rows) as truncated", async () => {
    h.rowCount = LEDGER_MAX_ROWS + 1;
    const res = await getLedgerAction({ accountId: ACCOUNT });
    expect(res.ok && res.data.truncated).toBe(true);
    expect(res.ok && res.data.rows).toHaveLength(LEDGER_MAX_ROWS);
  });

  it("reads the opening balance only for a dated range", async () => {
    h.opening = 500;
    const dated = await getLedgerAction({
      accountId: ACCOUNT,
      from: "2026-05-01",
    });
    expect(dated.ok && dated.data.opening).toBe(500);
    expect(
      fake.calls.find((c) => c.table === "get_ledger_opening")?.payload,
    ).toEqual({ p_account_id: ACCOUNT, p_date_from: "2026-05-01" });

    fake = recordingSupabase(respond);
    const undated = await getLedgerAction({ accountId: ACCOUNT });
    expect(undated.ok && undated.data.opening).toBe(0);
    expect(fake.calls.some((c) => c.table === "get_ledger_opening")).toBe(
      false,
    );
  });
});
