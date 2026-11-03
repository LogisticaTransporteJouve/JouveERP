import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Permission } from "@/lib/auth/permissions";
import {
  filterValue,
  recordingSupabase,
  type FakeResponse,
  type RecordedCall,
} from "@/tests/helpers/recording-supabase";

const h = vi.hoisted(() => ({
  changes: [] as { task_id: string; kind: string; change: string }[],
  claimedDue: [] as unknown[],
  unassigned: [] as { id: string; kind: string }[],
  reassigned: [] as string[],
  overdueFailures: 0,
  holders: {} as Record<string, string[]>,
}));

function respond(call: RecordedCall): FakeResponse {
  if (call.op === "rpc" && call.table === "materialize_recurring_tasks") {
    return { data: 2, error: null };
  }
  if (call.op === "rpc" && call.table === "sync_automatic_tasks") {
    return { data: h.changes, error: null };
  }
  if (call.op === "select" && call.table === "tasks") {
    // One page, then the empty page that ends the drain.
    const served = fake.calls.filter(
      (c) => c.table === "tasks" && c.op === "select",
    ).length;
    return { data: served === 1 ? h.unassigned : [], error: null };
  }
  if (call.op === "select" && call.table === "audit_events") {
    const served = fake.calls.filter(
      (c) => c.table === "audit_events" && c.op === "select",
    ).length;
    const rows = h.reassigned.map((id, i) => ({
      id: `e${i}`,
      target_resource_id: id,
    }));
    return { data: served === 1 ? rows : [], error: null };
  }
  if (call.op === "update" && call.table === "tasks") {
    const payload = call.payload as { notified_stage: string };
    if (payload.notified_stage === "overdue" && h.overdueFailures > 0) {
      h.overdueFailures -= 1;
      return { data: null, error: { message: "timeout" } };
    }
    if (payload.notified_stage === "due") {
      // The claim stamps the rows: a second run of it matches nothing.
      const rows = h.claimedDue;
      h.claimedDue = [];
      return { data: rows, error: null };
    }
    return { data: [], error: null };
  }
  return { data: null, error: null };
}

let fake = recordingSupabase(respond);

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/service", () => ({
  getServiceClient: () => fake.client,
}));
vi.mock("@/lib/auth/users", () => ({
  listUserIdsWithPermission: async (p: Permission) => h.holders[p] ?? [],
}));
vi.mock("@/lib/format", () => ({ todayInAR: () => "2026-11-02" }));

const { tasksDaily } = await import("./tasks-daily");

const step = {
  run: async (_id: string, fn: () => Promise<unknown>) => fn(),
};

function invoke() {
  const handler = Reflect.get(Object(tasksDaily), "fn");
  if (typeof handler !== "function") throw new Error("no handler");
  return handler({ event: { data: {} }, step });
}

const callsOf = (table: string, op: RecordedCall["op"]) =>
  fake.calls.filter((c) => c.table === table && c.op === op);

beforeEach(() => {
  fake = recordingSupabase(respond);
  h.changes = [];
  h.claimedDue = [];
  h.unassigned = [];
  h.reassigned = [];
  h.overdueFailures = 0;
  h.holders = {
    "tasks:read": ["fin", "ops"],
    "hr:write": ["fin"],
    "hr:read": ["fin"],
  };
});

describe("tasksDaily job", () => {
  it("runs both RPCs with the Argentine day", async () => {
    await invoke();
    expect(callsOf("materialize_recurring_tasks", "rpc")[0]?.payload).toEqual({
      p_today: "2026-11-02",
    });
    expect(callsOf("sync_automatic_tasks", "rpc")[0]?.payload).toEqual({
      p_today: "2026-11-02",
    });
  });

  it("assigns every unassigned automatic task to who can act on its document and read tasks", async () => {
    h.changes = [
      { task_id: "t1", kind: "employee_document", change: "created" },
      { task_id: "t2", kind: "employee_document", change: "updated" },
    ];
    // t2 was created on a day its assign step failed: it is `updated` now.
    h.unassigned = [
      { id: "t1", kind: "employee_document" },
      { id: "t2", kind: "employee_document" },
    ];
    const summary = await invoke();
    const [read] = callsOf("tasks", "select");
    expect(filterValue(read!, "eq", "origin")).toBe("automatic");
    expect(filterValue(read!, "eq", "status")).toBe("open");
    expect(filterValue(read!, "is", "task_assignees")).toBeNull();
    const upserts = callsOf("task_assignees", "upsert");
    expect(upserts).toHaveLength(1);
    expect(upserts[0]?.payload).toEqual([
      { task_id: "t1", user_id: "fin" },
      { task_id: "t2", user_id: "fin" },
    ]);
    expect(summary).toMatchObject({ created: 1, updated: 1, delegated: 2 });
  });

  it("leaves alone an automatic task whose assignees a user cleared", async () => {
    h.unassigned = [
      { id: "t1", kind: "employee_document" },
      { id: "t3", kind: "employee_document" },
    ];
    // t3 was reassigned by hand (task.assigned) down to nobody.
    h.reassigned = ["t3"];
    await invoke();
    const [audit] = callsOf("audit_events", "select");
    expect(filterValue(audit!, "eq", "event_type")).toBe("task.assigned");
    expect(filterValue(audit!, "in", "target_resource_id")).toEqual([
      "t1",
      "t3",
    ]);
    expect(callsOf("task_assignees", "upsert")[0]?.payload).toEqual([
      { task_id: "t1", user_id: "fin" },
    ]);
  });

  it("keeps the due notices when only the overdue claim fails and is retried", async () => {
    h.claimedDue = [
      {
        id: "t1",
        title: "Renovar licencia de Juan",
        origin: "automatic",
        kind: "employee_document",
        due_date: "2026-11-02",
        assignees: [{ user_id: "fin" }],
      },
    ];
    h.overdueFailures = 1;
    // Inngest memoizes a step that succeeded and re-runs the function.
    const memo = new Map<string, unknown>();
    const memoStep = {
      run: async (id: string, fn: () => Promise<unknown>) => {
        if (memo.has(id)) return memo.get(id);
        const value = await fn();
        memo.set(id, value);
        return value;
      },
    };
    const handler = Reflect.get(Object(tasksDaily), "fn");
    if (typeof handler !== "function") throw new Error("no handler");
    await expect(
      handler({ event: { data: {} }, step: memoStep }),
    ).rejects.toThrow("claim-overdue");
    await handler({ event: { data: {} }, step: memoStep });
    const inserted = callsOf("notifications", "insert")[0]?.payload as {
      recipient_id: string;
    }[];
    expect(inserted.map((n) => n.recipient_id)).toEqual(["fin"]);
  });

  it("claims due and overdue tasks before notifying their assignees", async () => {
    h.claimedDue = [
      {
        id: "t1",
        title: "Renovar licencia de Juan",
        origin: "automatic",
        kind: "employee_document",
        due_date: "2026-11-02",
        assignees: [{ user_id: "fin" }, { user_id: "ops" }],
      },
    ];
    await invoke();
    const [due, overdue] = callsOf("tasks", "update");
    expect(filterValue(due!, "eq", "due_date")).toBe("2026-11-02");
    expect(filterValue(due!, "is", "notified_stage")).toBeNull();
    expect(filterValue(overdue!, "lt", "due_date")).toBe("2026-11-02");
    expect(filterValue(overdue!, "gte", "due_date")).toBe("2026-10-26");

    const notifyAt = fake.calls.findIndex(
      (c) => c.table === "notifications" && c.op === "insert",
    );
    expect(notifyAt).toBeGreaterThan(fake.calls.indexOf(due!));
    expect(notifyAt).toBeGreaterThan(fake.calls.indexOf(overdue!));

    const inserted = callsOf("notifications", "insert")[0]?.payload as {
      recipient_id: string;
      metadata: { preview: string };
    }[];
    expect(inserted.map((n) => [n.recipient_id, n.metadata.preview])).toEqual([
      ["fin", "Renovar licencia de Juan"],
      ["ops", "Tarea de un módulo sin acceso"],
    ]);
  });

  it("inserts nothing when no task is due", async () => {
    await invoke();
    expect(callsOf("notifications", "insert")).toHaveLength(0);
  });
});
