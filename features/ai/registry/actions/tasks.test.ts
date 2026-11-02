import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAccess } from "@/lib/auth/permissions";

vi.mock("@/features/tasks/actions/tasks-actions", () => ({
  listTasksAction: vi.fn(),
}));

import { listTasksAction } from "@/features/tasks/actions/tasks-actions";
import type { TaskListItem } from "@/features/tasks/schema";

import { getTasks, runTasks } from "./tasks";

function task(overrides: Partial<TaskListItem>): TaskListItem {
  return {
    id: "t1",
    title: "Llamar al cliente",
    description: null,
    due_date: null,
    status: "open",
    origin: "manual",
    kind: null,
    restricted: false,
    source_href: null,
    auto_closed: false,
    completed_at: null,
    completed_by: null,
    created_at: "2026-11-01T09:00:00Z",
    assignee_ids: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runTasks", () => {
  it("defaults to every open task and counts the overdue ones", async () => {
    vi.mocked(listTasksAction).mockResolvedValue({
      ok: true,
      data: {
        rows: [task({ due_date: "2000-01-01" }), task({ id: "t2" })],
        truncated: false,
      },
    });
    const res = await runTasks({});
    expect(listTasksAction).toHaveBeenCalledWith({
      scope: "all",
      status: "open",
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.summary).toBe("2 tasks (1 overdue).");
      expect(res.partial).toBe(false);
    }
  });

  it("flags a truncated list as partial", async () => {
    vi.mocked(listTasksAction).mockResolvedValue({
      ok: true,
      data: { rows: [task({})], truncated: true },
    });
    const res = await runTasks({ scope: "mine", status: "done" });
    expect(listTasksAction).toHaveBeenCalledWith({
      scope: "mine",
      status: "done",
    });
    expect(res.ok && res.partial).toBe(true);
  });

  it("returns the action's error", async () => {
    vi.mocked(listTasksAction).mockResolvedValue({
      ok: false,
      error: "No tenés permiso para ver tareas.",
    });
    const res = await runTasks({});
    expect(res.ok).toBe(false);
  });
});

describe("getTasks gate", () => {
  it("needs tasks:read, like the page", async () => {
    expect(getTasks.permissions).toEqual(["tasks:read"]);
    const res = await getTasks.execute(
      { userId: "u1", access: resolveAccess(["driver"]) },
      {},
    );
    expect(res.ok).toBe(false);
    expect(listTasksAction).not.toHaveBeenCalled();
  });
});
