import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { resolveAccess } from "@/lib/auth/permissions";

import { defineAiAction } from "../registry/define";
import { okResult } from "../registry/result";

import { buildCalendarArtifact, monthDays } from "./calendar";
import { artifactCsv } from "./export";
import { artifactSchema } from "./spec";
import { buildArtifactTools, RENDER_CALENDAR_TOOL } from "./tools";

const meta = {
  sources: ["employee_leaves"],
  asOf: "2026-11-06",
  partial: false,
};
const source = {
  action: "getLeavesByRange",
  input: { from: "2026-12-01", to: "2026-12-31" },
};

const leaves = [
  {
    employee_id: "e2",
    employee: "Pérez Luis",
    kind: "vacaciones",
    kind_label: "Vacaciones",
    start_date: "2026-12-28",
    end_date: "2027-01-10",
  },
  {
    employee_id: "e1",
    employee: "Gómez Ana",
    kind: "vacaciones",
    kind_label: "Vacaciones",
    start_date: "2026-11-30",
    end_date: "2026-12-06",
  },
  {
    employee_id: "e1",
    employee: "Gómez Ana",
    kind: "enfermedad",
    kind_label: "Enfermedad",
    start_date: "2026-12-06",
    end_date: "2026-12-07",
  },
  {
    employee_id: "e3",
    employee: "Ruiz Eva",
    kind: "franco",
    kind_label: "Franco",
    start_date: "2027-02-01",
    end_date: "2027-02-01",
  },
];

describe("monthDays", () => {
  it("lists every day of the month", () => {
    expect(monthDays("2026-12")).toHaveLength(31);
    expect(monthDays("2026-02")).toHaveLength(28);
    expect(monthDays("2028-02").at(-1)).toBe("2028-02-29");
  });
});

describe("buildCalendarArtifact", () => {
  it("marks each employee's days by kind, clipped to the month", () => {
    const built = buildCalendarArtifact(
      { title: "Vacaciones de diciembre" },
      { source, rows: leaves, meta },
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const a = built.value;
    expect(a.month).toBe("2026-12");
    expect(a.legend).toEqual([
      { code: "V", label: "Vacaciones" },
      { code: "E", label: "Enfermedad" },
    ]);
    // Sorted by name; the February franco falls outside and adds no row.
    expect(a.rows.map((r) => r.label)).toEqual(["Gómez Ana", "Pérez Luis"]);
    const [ana, luis] = a.rows;
    expect(ana?.cells).toHaveLength(31);
    expect(ana?.cells.slice(0, 8)).toEqual([
      "V",
      "V",
      "V",
      "V",
      "V",
      "V/E",
      "E",
      "",
    ]);
    expect(luis?.cells.slice(26)).toEqual(["", "V", "V", "V", "V"]);
    expect(artifactSchema.safeParse(a).success).toBe(true);
  });

  it("takes the month from the config over the query's from", () => {
    const built = buildCalendarArtifact(
      { title: "Enero", month: "2027-01" },
      { source, rows: leaves, meta },
    );
    expect(built.ok && built.value.rows.map((r) => r.label)).toEqual([
      "Pérez Luis",
    ]);
  });

  it("refuses rows that are not ranges, naming the fields it needs", () => {
    const built = buildCalendarArtifact(
      { title: "X" },
      { source, rows: [{ category: "Peajes", total: 1 }], meta },
    );
    expect(built).toMatchObject({ ok: false });
    expect(!built.ok && built.error).toContain("start_date");
  });

  it("exports the grid with one column per day", () => {
    const built = buildCalendarArtifact(
      { title: "Diciembre" },
      { source, rows: leaves, meta },
    );
    if (!built.ok) throw new Error(built.error);
    const { csv } = artifactCsv(built.value);
    const header = csv.split(/\r?\n/)[0] ?? "";
    expect(header.split(",")).toHaveLength(32);
    expect(header.startsWith("Empleado,1,2,3")).toBe(true);
  });
});

describe("renderCalendar", () => {
  const getLeavesByRange = defineAiAction({
    name: "getLeavesByRange",
    domain: "rrhh",
    permission: "hr:read",
    sideEffect: "read",
    sources: ["employee_leaves"],
    description: "Leaves.",
    input: z.object({ from: z.string(), to: z.string() }),
    run: async () => okResult("rows", { rows: leaves }),
  });
  const call = { toolCallId: "call-1", messages: [], context: undefined };

  it("runs the query as the user, emits the grid and tells the model the marked days", async () => {
    const emit = vi.fn(() => true);
    const tools = buildArtifactTools(
      { userId: "u1", access: resolveAccess(["admin"]) },
      { emit },
      [getLeavesByRange],
    );
    const out = await tools[RENDER_CALENDAR_TOOL]?.execute?.(
      { ...source, calendar: { title: "Vacaciones de diciembre" } },
      call,
    );
    expect(emit).toHaveBeenCalledWith(
      "call-1",
      expect.objectContaining({ kind: "calendar", month: "2026-12" }),
    );
    expect(out).toMatchObject({
      ok: true,
      data: {
        rows: [
          { label: "Gómez Ana", days: { V: [1, 2, 3, 4, 5, 6], E: [6, 7] } },
          { label: "Pérez Luis", days: { V: [28, 29, 30, 31], E: [] } },
        ],
      },
    });
  });

  it("is refused to a role without the query's permission", async () => {
    const emit = vi.fn(() => true);
    const tools = buildArtifactTools(
      { userId: "u1", access: resolveAccess(["operations"]) },
      { emit },
      [getLeavesByRange],
    );
    const out = await tools[RENDER_CALENDAR_TOOL]?.execute?.(
      { ...source, calendar: { title: "X" } },
      call,
    );
    expect(out).toMatchObject({ ok: false });
    expect(emit).not.toHaveBeenCalled();
  });
});
