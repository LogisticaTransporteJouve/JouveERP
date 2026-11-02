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
  holders: {} as Record<string, string[]>,
}));

function respond(call: RecordedCall): FakeResponse {
  if (call.op === "rpc" && call.table === "materialize_recurring_tasks") {
    return { data: 2, error: null };
  }
  if (call.op === "rpc" && call.table === "sync_automatic_tasks") {
    return { data: h.changes, error: null };
  }
  if (call.op === "update" && call.table === "tasks") {
    const payload = call.payload as { notified_stage: string };
    return {
      data: payload.notified_stage === "due" ? h.claimedDue : [],
      error: null,
    };
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

  it("assigns a new automatic task to who can act on its document and read tasks", async () => {
    h.changes = [
      { task_id: "t1", kind: "employee_document", change: "created" },
      { task_id: "t2", kind: "employee_document", change: "updated" },
    ];
    const summary = await invoke();
    const upserts = callsOf("task_assignees", "upsert");
    expect(upserts).toHaveLength(1);
    expect(upserts[0]?.payload).toEqual([{ task_id: "t1", user_id: "fin" }]);
    expect(summary).toMatchObject({ created: 1, updated: 1, delegated: 1 });
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
