import { describe, expect, it } from "vitest";

import {
  RecurringTaskCreateSchema,
  RecurringTaskUpdateSchema,
  TaskAssigneesUpdateSchema,
  TaskCommentCreateSchema,
  TaskCreateSchema,
  TaskDueDateUpdateSchema,
  TaskListInputSchema,
  isAutomaticTaskKind,
} from "./schema";

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

describe("TaskCreateSchema", () => {
  it("trims, drops an empty description and dedupes assignees", () => {
    const parsed = TaskCreateSchema.parse({
      title: "  Llamar al cliente  ",
      description: "  ",
      due_date: "2026-11-10",
      assignee_ids: [USER, USER, OTHER],
    });
    expect(parsed).toEqual({
      title: "Llamar al cliente",
      description: null,
      due_date: "2026-11-10",
      assignee_ids: [USER, OTHER],
    });
  });

  it("allows no due date and no assignees", () => {
    const parsed = TaskCreateSchema.parse({ title: "x", assignee_ids: [] });
    expect(parsed.due_date).toBeNull();
    expect(parsed.description).toBeNull();
  });

  it("rejects a blank title, a bad date and a non-uuid assignee", () => {
    expect(
      TaskCreateSchema.safeParse({ title: "  ", assignee_ids: [] }).success,
    ).toBe(false);
    expect(
      TaskCreateSchema.safeParse({
        title: "x",
        due_date: "10/11/2026",
        assignee_ids: [],
      }).success,
    ).toBe(false);
    expect(
      TaskCreateSchema.safeParse({ title: "x", assignee_ids: ["u1"] }).success,
    ).toBe(false);
  });
});

describe("other task inputs", () => {
  it("validates the list filter", () => {
    expect(
      TaskListInputSchema.safeParse({ scope: "mine", status: "overdue" })
        .success,
    ).toBe(true);
    expect(
      TaskListInputSchema.safeParse({ scope: "everyone", status: "open" })
        .success,
    ).toBe(false);
  });

  it("takes a null due date to clear it", () => {
    expect(
      TaskDueDateUpdateSchema.safeParse({ id: USER, due_date: null }).success,
    ).toBe(true);
  });

  it("caps assignees at 20", () => {
    const many = Array.from(
      { length: 21 },
      (_, i) => `11111111-1111-4111-8111-${String(i).padStart(12, "0")}`,
    );
    expect(
      TaskAssigneesUpdateSchema.safeParse({ id: USER, assignee_ids: many })
        .success,
    ).toBe(false);
  });

  it("rejects an empty comment", () => {
    expect(
      TaskCommentCreateSchema.safeParse({ task_id: USER, body: "   " }).success,
    ).toBe(false);
  });
});

describe("RecurringTaskCreateSchema", () => {
  it("coerces the day of the month and bounds it to 1..31", () => {
    expect(
      RecurringTaskCreateSchema.parse({
        title: "Cierre de mes",
        day_of_month: "1",
        assignee_ids: [],
      }).day_of_month,
    ).toBe(1);
    for (const day of ["0", "32", "1.5"]) {
      expect(
        RecurringTaskCreateSchema.safeParse({
          title: "x",
          day_of_month: day,
          assignee_ids: [],
        }).success,
        day,
      ).toBe(false);
    }
  });

  it("updates a subset of fields", () => {
    expect(
      RecurringTaskUpdateSchema.parse({ id: USER, is_active: false }),
    ).toEqual({ id: USER, is_active: false });
  });
});

describe("isAutomaticTaskKind", () => {
  it("knows the document kinds only", () => {
    expect(isAutomaticTaskKind("collection")).toBe(true);
    expect(isAutomaticTaskKind("payroll")).toBe(false);
    expect(isAutomaticTaskKind(null)).toBe(false);
  });
});
