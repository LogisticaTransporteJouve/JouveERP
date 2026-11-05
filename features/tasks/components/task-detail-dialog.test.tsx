// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TaskDetail, TaskUserOption } from "../schema";

// The task detail's actions: an automatic task offers what settles its
// document («Cobrar» / «Pagar» / «Ir al documento») and says it closes by
// itself instead of «Marcar como hecha»; the list shows the assignees as
// initials.

const h = vi.hoisted(() => ({
  task: null as TaskDetail | null,
  users: [] as TaskUserOption[],
  rows: [] as TaskDetail[],
  mutate: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => "/tasks",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/ui/date-picker", () => ({ DatePicker: () => null }));
vi.mock("../hooks/use-tasks", () => {
  const mutation = () => ({ mutate: h.mutate, isPending: false });
  return {
    useTasks: () => ({ data: { rows: h.rows, truncated: false } }),
    useRecurringTasks: () => ({ data: [] }),
    useCreateTask: mutation,
    useCreateRecurringTask: mutation,
    useUpdateRecurringTask: mutation,
    useTaskDetail: () => ({ data: h.task }),
    useTaskUsers: () => ({ data: h.users }),
    useSetTaskStatus: mutation,
    useSetTaskDueDate: mutation,
    useSetTaskAssignees: mutation,
    useAddTaskComment: mutation,
  };
});

const { TaskDetailDialog } = await import("./task-detail-dialog");
const { AssigneeInitials } = await import("./assignee-picker");
const { TasksView } = await import("./tasks-view");

function task(overrides: Partial<TaskDetail>): TaskDetail {
  return {
    id: "t1",
    title: "Cobrar a INELEC: Factura A 0003-00022273",
    description: null,
    due_date: "2026-11-09",
    status: "open",
    origin: "automatic",
    kind: "collection",
    restricted: false,
    source_href: "/invoices/i1",
    settle: { label: "Cobrar", href: "/invoices/i1?cobrar=1" },
    auto_closed: false,
    completed_at: null,
    completed_by: null,
    created_at: "2026-11-03T09:00:00Z",
    assignee_ids: [],
    comments: [],
    history: [],
    ...overrides,
  };
}

function renderDialog(canWrite = true) {
  render(
    <TaskDetailDialog
      taskId="t1"
      canWrite={canWrite}
      onOpenChange={() => {}}
    />,
  );
  return screen.getByRole("dialog");
}

beforeEach(() => {
  h.users = [];
  h.mutate.mockReset();
});
afterEach(cleanup);

describe("TaskDetailDialog — an automatic task", () => {
  it("offers «Cobrar» on the invoice's page as the main action, not «Marcar como hecha»", () => {
    h.task = task({});
    const dialog = within(renderDialog());
    expect(
      dialog.getByRole("link", { name: "Cobrar" }).getAttribute("href"),
    ).toBe("/invoices/i1?cobrar=1");
    expect(
      dialog
        .getByRole("link", { name: "Ir al documento" })
        .getAttribute("href"),
    ).toBe("/invoices/i1");
    expect(
      dialog.queryByRole("button", { name: /Marcar como hecha/ }),
    ).toBeNull();
    expect(dialog.getByText("Se cierra sola cuando se cobre.")).toBeTruthy();
  });

  it("offers «Pagar» on a supplier payment", () => {
    h.task = task({
      kind: "supplier_payment",
      source_href: "/purchases/p1",
      settle: { label: "Pagar", href: "/purchases/p1?pagar=1" },
    });
    const dialog = within(renderDialog());
    expect(
      dialog.getByRole("link", { name: "Pagar" }).getAttribute("href"),
    ).toBe("/purchases/p1?pagar=1");
    expect(dialog.getByText("Se cierra sola cuando se pague.")).toBeTruthy();
  });

  it("leaves «Ir al documento» as the action when the viewer cannot settle it", () => {
    h.task = task({ settle: null });
    const dialog = within(renderDialog());
    expect(dialog.queryByRole("link", { name: "Cobrar" })).toBeNull();
    expect(
      dialog
        .getByRole("link", { name: "Ir al documento" })
        .getAttribute("href"),
    ).toBe("/invoices/i1");
    expect(
      dialog.queryByRole("button", { name: /Marcar como hecha/ }),
    ).toBeNull();
  });

  it("links a renewal to its record and says what closes it", () => {
    h.task = task({
      kind: "loan_installment",
      source_href: "/loans/l1",
      settle: null,
    });
    const dialog = within(renderDialog());
    expect(
      dialog
        .getByRole("link", { name: "Ir al documento" })
        .getAttribute("href"),
    ).toBe("/loans/l1");
    expect(
      dialog.getByText("Se cierra sola cuando se pague la cuota."),
    ).toBeTruthy();
  });

  it("still offers «Reabrir» once it is done", () => {
    h.task = task({
      status: "done",
      auto_closed: true,
      completed_at: "2026-11-05T09:00:00Z",
      settle: null,
    });
    const dialog = within(renderDialog());
    expect(dialog.getByRole("button", { name: /Reabrir/ })).toBeTruthy();
    expect(dialog.queryByText(/Se cierra sola cuando/)).toBeNull();
  });

  it("shows nothing about the document when the task is restricted", () => {
    h.task = task({
      restricted: true,
      kind: null,
      source_href: null,
      settle: null,
    });
    const dialog = within(renderDialog());
    expect(dialog.queryByRole("link")).toBeNull();
  });
});

describe("TaskDetailDialog — a manual task", () => {
  it("is marked done by hand", () => {
    h.task = task({
      origin: "manual",
      kind: null,
      source_href: null,
      settle: null,
    });
    const dialog = within(renderDialog());
    expect(
      dialog.getByRole("button", { name: /Marcar como hecha/ }),
    ).toBeTruthy();
    expect(dialog.queryByText(/Se cierra sola/)).toBeNull();
  });

  it("offers no status change without tasks:write", () => {
    h.task = task({
      origin: "manual",
      kind: null,
      source_href: null,
      settle: null,
    });
    const dialog = within(renderDialog(false));
    expect(
      dialog.queryByRole("button", { name: /Marcar como hecha/ }),
    ).toBeNull();
  });
});

describe("AssigneeInitials", () => {
  it("shows each assignee as initials, named in its label", () => {
    h.users = [
      { id: "u1", label: "Milagros Dziurdzia", initials: "MD" },
      { id: "u2", label: "tomas@jouve.test", initials: "TO" },
    ];
    render(<AssigneeInitials ids={["u1", "u2", "gone"]} />);
    const list = within(screen.getByRole("list", { name: "Responsables" }));
    expect(list.getByLabelText("Milagros Dziurdzia").textContent).toBe("MD");
    expect(list.getByLabelText("tomas@jouve.test").textContent).toBe("TO");
    expect(list.getByLabelText("Usuario sin acceso a Tareas").textContent).toBe(
      "?",
    );
  });

  it("says when there is nobody", () => {
    render(<AssigneeInitials ids={[]} />);
    expect(screen.getByText("Sin responsables")).toBeTruthy();
  });
});

describe("TasksView — «Hecha»", () => {
  it("is offered on a manual task, not on an automatic one", () => {
    h.rows = [
      task({ id: "auto", title: "Cobrar a INELEC" }),
      task({
        id: "manual",
        title: "Llamar al cliente",
        origin: "manual",
        kind: null,
        source_href: null,
        settle: null,
      }),
    ];
    render(<TasksView canWrite />);
    const rows = screen.getAllByRole("row");
    const auto = rows.find((r) => r.textContent?.includes("Cobrar a INELEC"));
    const manual = rows.find((r) =>
      r.textContent?.includes("Llamar al cliente"),
    );
    expect(
      auto && within(auto).queryByRole("button", { name: /Hecha/ }),
    ).toBeNull();
    expect(
      manual && within(manual).getByRole("button", { name: /Hecha/ }),
    ).toBeTruthy();
  });
});
