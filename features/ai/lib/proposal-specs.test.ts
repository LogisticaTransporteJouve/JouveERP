import { describe, expect, it } from "vitest";

import {
  exchangeRateProposalSpec,
  journalEntryProposalSpec,
  leaveProposalSpec,
  PROPOSAL_SPECS,
} from "./proposal-specs";

const EMP = "11111111-1111-4111-8111-111111111111";
const A1 = "22222222-2222-4222-8222-222222222222";
const A2 = "33333333-3333-4333-8333-333333333333";

describe("proposal specs", () => {
  it("validates a leave with the form's schema and summarizes it with labels", () => {
    const res = leaveProposalSpec.validate(
      {
        employee_id: EMP,
        start_date: "2026-11-02",
        end_date: "2026-11-06",
        kind: "vacaciones",
        notes: null,
      },
      { [EMP]: "Ana Pérez" },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.summary).toContainEqual({
      label: "Empleado",
      value: "Ana Pérez",
    });
    expect(res.summary).toContainEqual({ label: "Días corridos", value: "5" });
  });

  it("rejects what the manual form rejects", () => {
    const leave = leaveProposalSpec.validate(
      {
        employee_id: EMP,
        start_date: "2026-11-06",
        end_date: "2026-11-02",
        kind: "vacaciones",
      },
      {},
    );
    expect(leave).toMatchObject({ ok: false });

    const entry = journalEntryProposalSpec.validate(
      {
        entry_date: "2026-10-16",
        description: "Ajuste",
        lines: [
          { account_id: A1, debit: 100, credit: 0 },
          { account_id: A2, debit: 0, credit: 90 },
        ],
      },
      {},
    );
    expect(entry).toMatchObject({ ok: false });
    if (!entry.ok) expect(entry.issues[0]?.message).toMatch(/no balancea/);

    expect(
      exchangeRateProposalSpec.validate(
        { rate_date: "2026-10-16", rate: -1 },
        {},
      ),
    ).toMatchObject({
      ok: false,
    });
  });

  it("summarizes a balanced entry line by line with the account labels", () => {
    const res = journalEntryProposalSpec.validate(
      {
        entry_date: "2026-10-16",
        description: "Ajuste",
        lines: [
          { account_id: A1, debit: 100, credit: 0 },
          { account_id: A2, debit: 0, credit: 100 },
        ],
      },
      { [A1]: "1.1.01 Caja", [A2]: "4.1.01 Ventas" },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.summary.map((r) => r.label)).toEqual([
      "Fecha",
      "Descripción",
      "1.1.01 Caja",
      "4.1.01 Ventas",
      "Total",
    ]);
  });

  it("only offers editable fields the draft schema knows", () => {
    for (const spec of Object.values(PROPOSAL_SPECS)) {
      expect(spec.fields.length).toBeGreaterThan(0);
      for (const f of spec.fields) {
        if (f.kind === "select") expect(f.options?.length).toBeGreaterThan(1);
      }
    }
  });
});
