import { describe, expect, it } from "vitest";

import {
  exchangeRateProposalSpec,
  fieldInputText,
  fieldInputValue,
  formatFieldInput,
  journalEntryProposalSpec,
  leaveProposalSpec,
  PROPOSAL_SPECS,
  type ProposalField,
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

describe("rate field precision", () => {
  const rateField = exchangeRateProposalSpec.fields.find(
    (f) => f.key === "rate",
  );

  it("keeps up to 6 decimals in the Modify dialog and on the card", () => {
    expect(rateField?.decimals).toBe(6);
    if (!rateField) return;
    const text = fieldInputText({ rate: 1180.123456 }, rateField);
    expect(text).toBe("1.180,123456");
    expect(fieldInputValue(rateField, text)).toBe(1180.123456);
    expect(formatFieldInput(rateField, "1180,1234567")).toBe("1.180,123456");
    expect(fieldInputText({ rate: 1180.5 }, rateField)).toBe("1.180,50");

    const res = exchangeRateProposalSpec.validate(
      { rate_date: "2026-10-16", rate: 1180.123456 },
      {},
    );
    expect(res.ok && res.summary).toContainEqual({
      label: "Cotización",
      value: "$ 1.180,123456",
    });
  });

  it("keeps money fields at 2 decimals", () => {
    const money: ProposalField = {
      key: "amount",
      label: "Importe",
      kind: "number",
    };
    expect(formatFieldInput(money, "10,129")).toBe("10,12");
  });
});

describe("journal entry card", () => {
  it("shows each line's description", () => {
    const res = journalEntryProposalSpec.validate(
      {
        entry_date: "2026-10-16",
        description: "Ajuste",
        lines: [
          { account_id: A1, debit: 100, credit: 0, description: "Caja chica" },
          { account_id: A2, debit: 0, credit: 100 },
        ],
      },
      {},
    );
    expect(res.ok && res.summary[2]?.value).toBe("Debe $ 100,00 · Caja chica");
  });
});
