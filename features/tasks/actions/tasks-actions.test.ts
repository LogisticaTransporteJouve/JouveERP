import { beforeEach, describe, expect, it, vi } from "vitest";

import { type Role, resolveAccess } from "@/lib/auth/permissions";

import { RESTRICTED_TASK_TITLE } from "../lib/sources";

const TASK_ID = "33333333-3333-4333-8333-333333333333";
const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";

type Result = { data: unknown; error: unknown };
type Call = { table: string; method: string; args: unknown[] };

let roles: Role[] = ["finance"];
let taskHolders: string[] = [USER_A, USER_B];
/** Results per table, one per awaited statement, in order. */
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
    access: resolveAccess(roles),
  }),
}));
vi.mock("@/lib/actions/audit", () => ({ logAudit }));
vi.mock("@/lib/auth/users", () => ({
  listUserIdsWithPermission: async () => taskHolders,
  listUsersWithRoles: async () => [],
}));
vi.mock("@/lib/supabase/service", () => ({
  getServiceClient: () => ({ from: (table: string) => builder(table) }),
}));

const {
  createTaskAction,
  getTaskDetailAction,
  listTasksAction,
  setTaskAssigneesAction,
  setTaskStatusAction,
} = await import("./tasks-actions");

function taskRow(overrides: Record<string, unknown>) {
  return {
    id: TASK_ID,
    title: "Renovar licencia de Juan Pérez",
    description: "Detalle",
    due_date: "2026-11-05",
    status: "open",
    origin: "automatic",
    kind: "employee_document",
    auto_closed: false,
    completed_at: null,
    completed_by: null,
    created_at: "2026-11-01T09:00:00Z",
    assignees: [{ user_id: USER_A }],
    ...overrides,
  };
}

const calledWith = (table: string, method: string) =>
  calls.filter((c) => c.table === table && c.method === method);

beforeEach(() => {
  vi.clearAllMocks();
  roles = ["finance"];
  taskHolders = [USER_A, USER_B];
  results = {};
  calls = [];
});

describe("listTasksAction", () => {
  it("refuses a role without tasks:read", async () => {
    roles = ["driver"];
    const res = await listTasksAction({ scope: "all", status: "open" });
    expect(res.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("hides what a task is about from a viewer without its source module", async () => {
    roles = ["operations"];
    results.tasks = [
      {
        data: [
          taskRow({}),
          taskRow({
            id: USER_B,
            origin: "manual",
            kind: null,
            title: "Llamar al cliente",
          }),
        ],
        error: null,
      },
    ];
    const res = await listTasksAction({ scope: "all", status: "open" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const [hr, manual] = res.data.rows;
    expect(hr).toMatchObject({
      title: RESTRICTED_TASK_TITLE,
      description: null,
      kind: null,
      restricted: true,
      source_href: null,
    });
    expect(manual).toMatchObject({
      title: "Llamar al cliente",
      restricted: false,
    });
    expect(res.data.truncated).toBe(false);
  });

  it("shows the document to a viewer who reads its module", async () => {
    results.tasks = [{ data: [taskRow({})], error: null }];
    const res = await listTasksAction({ scope: "all", status: "open" });
    expect(res.ok && res.data.rows[0]).toMatchObject({
      title: "Renovar licencia de Juan Pérez",
      kind: "employee_document",
      source_href: "/hr/document-expirations",
    });
  });

  it("filters to the viewer's own tasks only for 'mine'", async () => {
    await listTasksAction({ scope: "all", status: "open" });
    expect(calledWith("tasks", "not")).toHaveLength(0);
    await listTasksAction({ scope: "mine", status: "overdue" });
    expect(calledWith("tasks", "not")[0]?.args).toEqual(["mine", "is", null]);
    expect(calledWith("tasks", "lt")).toHaveLength(1);
  });

  it("reports an error instead of an empty list", async () => {
    results.tasks = [{ data: null, error: { message: "boom" } }];
    const res = await listTasksAction({ scope: "all", status: "open" });
    expect(res.ok).toBe(false);
  });
});

describe("getTaskDetailAction", () => {
  const comment = {
    id: "c1",
    author_id: USER_B,
    body: "El cliente debe $1.200.000",
    created_at: "2026-11-01T10:00:00Z",
  };
  const event = {
    id: "e1",
    event_type: "task.status_changed",
    actor_id: USER_B,
    ts: "2026-11-01T11:00:00Z",
  };

  function load() {
    results.tasks = [{ data: taskRow({}), error: null }];
    results.task_comments = [{ data: [comment], error: null }];
    results.audit_events = [{ data: [event], error: null }];
    return getTaskDetailAction(TASK_ID);
  }

  it("hides the comments and history of a task whose source module the viewer cannot read", async () => {
    roles = ["operations"];
    const res = await load();
    expect(res.ok && res.data).toMatchObject({
      restricted: true,
      title: RESTRICTED_TASK_TITLE,
      comments: [],
      history: [],
    });
  });

  it("shows them to a viewer who reads the module", async () => {
    const res = await load();
    expect(res.ok && res.data).toMatchObject({
      restricted: false,
      comments: [comment],
      history: [event],
    });
  });
});

describe("setTaskStatusAction", () => {
  it("refuses to change a task whose source the user cannot read", async () => {
    roles = ["operations"];
    results.tasks = [
      {
        data: {
          id: TASK_ID,
          origin: "automatic",
          kind: "employee_document",
          status: "open",
        },
        error: null,
      },
    ];
    const res = await setTaskStatusAction({ id: TASK_ID, status: "done" });
    expect(res.ok).toBe(false);
    expect(calledWith("tasks", "update")).toHaveLength(0);
    expect(logAudit).not.toHaveBeenCalled();
  });

  it("marks a task done by the user and audits it", async () => {
    results.tasks = [
      {
        data: { id: TASK_ID, origin: "manual", kind: null, status: "open" },
        error: null,
      },
      { data: [{ id: TASK_ID }], error: null },
    ];
    const res = await setTaskStatusAction({ id: TASK_ID, status: "done" });
    expect(res.ok).toBe(true);
    expect(calledWith("tasks", "update")[0]?.args[0]).toMatchObject({
      status: "done",
      completed_by: USER_A,
      auto_closed: false,
    });
    expect(logAudit).toHaveBeenCalledWith(
      "task.completed",
      USER_A,
      {},
      TASK_ID,
    );
  });

  it("says so when the task was already done", async () => {
    results.tasks = [
      {
        data: { id: TASK_ID, origin: "manual", kind: null, status: "done" },
        error: null,
      },
      { data: [], error: null },
    ];
    const res = await setTaskStatusAction({ id: TASK_ID, status: "done" });
    expect(res).toEqual({ ok: false, error: "La tarea ya estaba hecha." });
    expect(logAudit).not.toHaveBeenCalled();
  });

  it("needs tasks:write", async () => {
    roles = ["fiscal_reader"];
    expect(
      (await setTaskStatusAction({ id: TASK_ID, status: "done" })).ok,
    ).toBe(false);
  });
});

describe("createTaskAction", () => {
  it("refuses an assignee without tasks:read before writing", async () => {
    taskHolders = [USER_A];
    const res = await createTaskAction({
      title: "Llamar",
      assignee_ids: [USER_B],
    });
    expect(res.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("creates a manual task with its assignees", async () => {
    results.tasks = [{ data: { id: TASK_ID }, error: null }];
    results.task_assignees = [{ data: null, error: null }];
    const res = await createTaskAction({
      title: "Llamar",
      due_date: "2026-11-09",
      assignee_ids: [USER_B],
    });
    expect(res).toEqual({ ok: true, data: { id: TASK_ID } });
    expect(calledWith("tasks", "insert")[0]?.args[0]).toMatchObject({
      origin: "manual",
      created_by: USER_A,
    });
    expect(calledWith("task_assignees", "insert")[0]?.args[0]).toEqual([
      { task_id: TASK_ID, user_id: USER_B, assigned_by: USER_A },
    ]);
  });

  it("takes the task back when its assignees fail", async () => {
    results.tasks = [{ data: { id: TASK_ID }, error: null }];
    results.task_assignees = [{ data: null, error: { message: "fk" } }];
    const res = await createTaskAction({ title: "x", assignee_ids: [USER_B] });
    expect(res.ok).toBe(false);
    expect(calledWith("tasks", "delete")).toHaveLength(1);
    expect(logAudit).not.toHaveBeenCalled();
  });
});

describe("setTaskAssigneesAction", () => {
  it("removes and adds only the difference", async () => {
    results.tasks = [
      {
        data: { id: TASK_ID, origin: "manual", kind: null, status: "open" },
        error: null,
      },
    ];
    results.task_assignees = [
      { data: [{ user_id: USER_A }], error: null },
      { data: null, error: null },
      { data: null, error: null },
    ];
    const res = await setTaskAssigneesAction({
      id: TASK_ID,
      assignee_ids: [USER_B],
    });
    expect(res.ok).toBe(true);
    expect(calledWith("task_assignees", "in")[0]?.args).toEqual([
      "user_id",
      [USER_A],
    ]);
    expect(calledWith("task_assignees", "upsert")[0]?.args[0]).toEqual([
      { task_id: TASK_ID, user_id: USER_B, assigned_by: USER_A },
    ]);
    expect(logAudit).toHaveBeenCalledWith(
      "task.assigned",
      USER_A,
      { added: [USER_B], removed: [USER_A] },
      TASK_ID,
    );
  });
});
