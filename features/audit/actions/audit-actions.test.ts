import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  type Permission,
  type Role,
  resolveAccess,
} from "@/lib/auth/permissions";

import { MASK } from "../lib/mask";

const USER_A = "11111111-1111-4111-8111-111111111111";
const EVENT_ID = "33333333-3333-4333-8333-333333333333";

type Result = { data: unknown; error: unknown };
type Call = { table: string; method: string; args: unknown[] };

let roles: Role[] = ["owner"];
let denied: Permission[] = [];
let results: Record<string, Result[]> = {};
let calls: Call[] = [];
const logAudit = vi.fn(async () => undefined);

function builder(table: string): unknown {
  const chain: unknown = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "then") {
          const next = results[table]?.shift() ?? { data: [], error: null };
          return (
            resolve: (value: Result) => unknown,
            reject: (reason: unknown) => unknown,
          ) => Promise.resolve(next).then(resolve, reject);
        }
        return (...args: unknown[]) => {
          calls.push({ table, method: String(prop), args });
          return chain;
        };
      },
    },
  );
  return chain;
}

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({
    userId: USER_A,
    access: resolveAccess(roles, denied),
  }),
}));
vi.mock("@/lib/actions/audit", () => ({ logAudit }));
vi.mock("@/lib/auth/users", () => ({
  listUsersWithRoles: async () => [
    { id: USER_A, email: "ana@example.com", roles: ["owner"] },
  ],
}));
vi.mock("@/lib/supabase/service", () => ({
  getServiceClient: () => ({
    from: (table: string) => builder(table),
    rpc: (fn: string) => builder(`rpc:${fn}`),
  }),
}));

const {
  exportAuditEventsCsvAction,
  getRecordHistoryAction,
  listAuditEventsAction,
} = await import("./audit-actions");

function event(overrides: Record<string, unknown> = {}) {
  return {
    id: EVENT_ID,
    ts: "2026-11-02T13:00:00+00:00",
    actor_id: USER_A,
    actor_type: "user",
    event_type: "employee.updated",
    target_resource_id: "e1",
    target_user_id: null,
    payload: { cbu: "0170099220000067797370", position: "chofer" },
    ...overrides,
  };
}

beforeEach(() => {
  roles = ["owner"];
  denied = [];
  results = {};
  calls = [];
  logAudit.mockClear();
});

describe("audit actions gate", () => {
  it.each<[string, Role[], Permission[]]>([
    ["finance", ["finance"], []],
    ["fiscal_reader", ["fiscal_reader"], []],
    ["admin with audit:read denied", ["admin"], ["audit:read"]],
  ])("refuses %s before reading", async (_, r, d) => {
    roles = r;
    denied = d;
    const list = await listAuditEventsAction({ filters: {}, cursor: null });
    const history = await getRecordHistoryAction("e1");
    const exported = await exportAuditEventsCsvAction({});
    expect(list.ok || history.ok || exported.ok).toBe(false);
    expect(calls).toEqual([]);
  });
});

describe("listAuditEventsAction", () => {
  it("masks the payload, links the record and pages by keyset", async () => {
    const rows = Array.from({ length: 51 }, (_, i) =>
      event({ id: `3333333${i % 10}-3333-4333-8333-333333333333` }),
    );
    results.audit_events = [{ data: rows, error: null }];
    const res = await listAuditEventsAction({
      filters: { module: "fuel_load" },
      cursor: null,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.rows).toHaveLength(50);
    expect(res.data.rows[0]?.payload).toEqual({
      cbu: `${MASK}7370`,
      position: "chofer",
    });
    expect(res.data.rows[0]?.record_href).toBe("/employees/e1");
    expect(res.data.nextCursor).not.toBeNull();
    // `_` in the module is matched literally, not as LIKE's wildcard.
    expect(calls).toContainEqual({
      table: "audit_events",
      method: "like",
      args: ["event_type", "fuel\\_load.%"],
    });
  });

  it("reports a failed read instead of an empty log", async () => {
    results.audit_events = [{ data: null, error: { message: "boom" } }];
    const res = await listAuditEventsAction({ filters: {}, cursor: null });
    expect(res.ok).toBe(false);
  });
});

describe("exportAuditEventsCsvAction", () => {
  it("exports masked rows with names and logs the export", async () => {
    results.user_profiles = [
      {
        data: [{ user_id: USER_A, first_name: "Ana", last_name: "Pérez" }],
        error: null,
      },
    ];
    results.audit_events = [{ data: [event()], error: null }];
    const res = await exportAuditEventsCsvAction({});
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.rows).toBe(1);
    expect(res.data.csv).toContain("Ana Pérez");
    expect(res.data.csv).not.toContain("0170099220000067797370");
    expect(logAudit).toHaveBeenCalledWith(
      "audit.exported",
      USER_A,
      expect.objectContaining({ rows: 1, truncated: false }),
    );
  });
});
