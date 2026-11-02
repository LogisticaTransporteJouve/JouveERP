import { describe, expect, it } from "vitest";

import { resolveAccess } from "@/lib/auth/permissions";

import { AUTOMATIC_TASK_KINDS } from "../schema";

import { buildDueNotifications, type DueTask } from "./notify";
import { canSeeTaskSource, RESTRICTED_TASK_TITLE } from "./sources";

describe("canSeeTaskSource", () => {
  it("shows manual and recurring tasks to anyone", () => {
    const warehouse = resolveAccess(["warehouse"]);
    expect(canSeeTaskSource(warehouse, { origin: "manual", kind: null })).toBe(
      true,
    );
    expect(
      canSeeTaskSource(warehouse, { origin: "recurring", kind: null }),
    ).toBe(true);
  });

  it("needs the source module's read permission for an automatic task", () => {
    const hrTask = { origin: "automatic", kind: "employee_document" } as const;
    expect(canSeeTaskSource(resolveAccess(["finance"]), hrTask)).toBe(true);
    expect(canSeeTaskSource(resolveAccess(["operations"]), hrTask)).toBe(false);
    expect(
      canSeeTaskSource(resolveAccess(["finance"], ["hr:read"]), hrTask),
    ).toBe(false);
    const fleetTask = { origin: "automatic", kind: "fleet_document" } as const;
    expect(canSeeTaskSource(resolveAccess(["operations"]), fleetTask)).toBe(
      true,
    );
    expect(canSeeTaskSource(resolveAccess(["finance"]), fleetTask)).toBe(false);
    const kmTask = { origin: "automatic", kind: "vehicle_km" } as const;
    expect(canSeeTaskSource(resolveAccess(["operations"]), kmTask)).toBe(true);
    expect(canSeeTaskSource(resolveAccess(["finance"]), kmTask)).toBe(false);
    expect(
      canSeeTaskSource(
        resolveAccess(["operations"], ["fleet_km:read"]),
        kmTask,
      ),
    ).toBe(false);
  });

  it("hides an automatic task of an unknown kind", () => {
    expect(
      canSeeTaskSource(resolveAccess(["owner"]), {
        origin: "automatic",
        kind: null,
      }),
    ).toBe(false);
  });

  it("lets owner and admin see every source", () => {
    for (const role of ["owner", "admin"] as const) {
      for (const kind of AUTOMATIC_TASK_KINDS) {
        expect(
          canSeeTaskSource(resolveAccess([role]), {
            origin: "automatic",
            kind,
          }),
          `${role} ${kind}`,
        ).toBe(true);
      }
    }
  });
});

describe("buildDueNotifications", () => {
  const base: DueTask = {
    id: "t1",
    title: "Renovar licencia de Juan",
    origin: "automatic",
    kind: "employee_document",
    due_date: "2026-11-02",
    stage: "due",
    assignee_ids: ["hr-user", "ops-user"],
  };

  it("sends one per assignee with the neutral title to who cannot read the source", () => {
    const rows = buildDueNotifications(
      [base],
      (userId, kind) => userId === "hr-user" && kind === "employee_document",
    );
    expect(rows).toEqual([
      {
        recipient_id: "hr-user",
        sender_id: null,
        type: "task_due",
        metadata: {
          task_id: "t1",
          due_date: "2026-11-02",
          stage: "due",
          preview: "Renovar licencia de Juan",
        },
      },
      {
        recipient_id: "ops-user",
        sender_id: null,
        type: "task_due",
        metadata: {
          task_id: "t1",
          due_date: "2026-11-02",
          stage: "due",
          preview: RESTRICTED_TASK_TITLE,
        },
      },
    ]);
  });

  it("keeps a manual task's title and skips tasks with no assignees", () => {
    const rows = buildDueNotifications(
      [
        { ...base, origin: "manual", kind: null, stage: "overdue" },
        { ...base, id: "t2", assignee_ids: [] },
      ],
      () => false,
    );
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.metadata.preview === base.title)).toBe(true);
    expect(rows.every((r) => r.metadata.stage === "overdue")).toBe(true);
  });
});
