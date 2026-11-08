import { beforeEach, describe, expect, it, vi } from "vitest";

import { type Permission, resolveAccess } from "@/lib/auth/permissions";
import { recordingSupabase } from "@/tests/helpers/recording-supabase";

// Card statements and the bank-line writes (transfer, cheque deposit, card
// payment) need the treasury write: a finance user denied
// transactions:write is refused before any database call.

let denied: Permission[] = [];
let fake = recordingSupabase();

vi.mock("@/lib/auth/context", () => ({
  requireUserContext: async () => ({
    userId: "u1",
    access: resolveAccess(["finance"], denied),
  }),
}));
vi.mock("@/lib/supabase/service", () => ({
  getServiceClient: () => fake.client,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => fake.client,
}));
vi.mock("@/lib/actions/audit", () => ({ logAudit: vi.fn() }));

const cards = await import("./card-statements-actions");
const bank =
  await import("@/features/bank-reconciliation/actions/reconciliation-actions");

const cases = [
  ["createCardStatementAction", () => cards.createCardStatementAction({})],
  ["setCardLinesAction", () => cards.setCardLinesAction({})],
  ["setCardHolderAction", () => cards.setCardHolderAction({})],
  ["deleteCardStatementAction", () => cards.deleteCardStatementAction({})],
  ["unsettleCardStatementAction", () => cards.unsettleCardStatementAction({})],
  ["transferFromLineAction", () => bank.transferFromLineAction({})],
  ["depositCheckFromLineAction", () => bank.depositCheckFromLineAction({})],
  [
    "payCardStatementFromLineAction",
    () => bank.payCardStatementFromLineAction({}),
  ],
] as const;

beforeEach(() => {
  denied = [];
  fake = recordingSupabase();
});

describe("treasury writes", () => {
  it.each(cases)(
    "%s refuses a finance user denied transactions:write",
    async (_name, run) => {
      denied = ["transactions:write"];
      const res = await run();
      expect(res.ok === false && res.error).toMatch(/permiso/i);
      expect(fake.calls).toHaveLength(0);
    },
  );

  it.each(cases)(
    "%s lets a finance user through to its input check",
    async (_name, run) => {
      const res = await run();
      expect(res).toMatchObject({ ok: false });
      expect(res.ok === false && res.error).not.toMatch(/permiso/i);
    },
  );

  it("refuses a cheque deposit from a line without cheques:write", async () => {
    denied = ["cheques:write"];
    const res = await bank.depositCheckFromLineAction({});
    expect(res.ok === false && res.error).toMatch(/permiso/i);
    expect(fake.calls).toHaveLength(0);
  });
});

// A part with an advance or a tax line also needs Personal's or Impuestos'
// write; without them, existing advances stay as they are.
describe("card parts and advances", () => {
  const ID = "00000000-0000-4000-8000-0000000000c1";
  const LINE = "00000000-0000-4000-8000-0000000000d1";
  const ACCOUNT = "00000000-0000-4000-8000-0000000000e1";
  const TAX = "00000000-0000-4000-8000-0000000000f1";

  const partWith = (kind: "advance" | "tax") =>
    recordingSupabase((call) => {
      if (call.table === "chart_of_accounts") {
        return { data: [{ id: TAX }], error: null };
      }
      if (call.table === "card_statement_lines" && call.op === "select") {
        const advance = call.filters.some(
          ([k, c, v]) => k === "eq" && c === "treatment" && v === "advance",
        );
        const match = kind === "advance" ? advance : !advance;
        return {
          data: match
            ? [
                {
                  treatment: kind === "advance" ? "advance" : "expense",
                  chart_account_id: kind === "tax" ? TAX : null,
                },
              ]
            : [],
          error: null,
        };
      }
      return { data: null, error: null };
    });

  it.each([
    ["hr:write", "advance", /Personal/],
    ["taxes:write", "tax", /Impuestos/],
  ] as const)(
    "refuses paying or undoing a part without %s",
    async (perm, kind, message) => {
      denied = [perm];
      for (const run of [
        () =>
          bank.payCardStatementFromLineAction({
            statement_id: ID,
            line_id: LINE,
            currency: "ARS",
          }),
        () => cards.unsettleCardStatementAction({ id: ID, currency: "ARS" }),
      ]) {
        fake = partWith(kind);
        const res = await run();
        expect(res.ok === false && res.error).toMatch(message);
        expect(fake.calls.some((c) => c.op === "rpc")).toBe(false);
      }
    },
  );

  it("leaves advances as they are when setting a card's default without hr:write", async () => {
    denied = ["hr:write"];
    fake = recordingSupabase((call) =>
      call.table === "card_statements"
        ? {
            data: { account_number: "0600000001", status: "pendiente" },
            error: null,
          }
        : { data: [], error: null },
    );
    const res = await cards.setCardHolderAction({
      statement_id: ID,
      last4: "1234",
      treatment: "expense",
      chart_account_id: ACCOUNT,
      employee_id: null,
    });
    expect(res.ok).toBe(true);
    const updates = fake.calls.filter((c) => c.op === "update");
    expect(updates.map((c) => c.table)).toEqual([
      "card_holders",
      "card_statement_lines",
    ]);
    for (const u of updates) {
      expect(u.filters).toContainEqual(["neq", "treatment", "advance"]);
    }
  });

  it("leaves advances as they are when changing lines without hr:write", async () => {
    denied = ["hr:write"];
    const ADVANCE = "00000000-0000-4000-8000-0000000000d2";
    fake = recordingSupabase((call) =>
      call.table === "card_statements"
        ? { data: { paid_ars_on: null, paid_usd_on: null }, error: null }
        : call.table === "card_statement_lines"
          ? {
              data: [
                {
                  id: LINE,
                  currency: "ARS",
                  source: "purchase",
                  treatment: "expense",
                },
                {
                  id: ADVANCE,
                  currency: "ARS",
                  source: "purchase",
                  treatment: "advance",
                },
              ],
              error: null,
            }
          : { data: 1, error: null },
    );
    const res = await cards.setCardLinesAction({
      statement_id: ID,
      line_ids: [LINE, ADVANCE],
      treatment: "expense",
      chart_account_id: ACCOUNT,
      employee_id: null,
    });
    expect(res.ok).toBe(true);
    const rpc = fake.calls.find((c) => c.op === "rpc");
    expect(rpc?.payload).toMatchObject({ p_line_ids: [LINE] });
  });
});

describe("a paid part", () => {
  const ID = "00000000-0000-4000-8000-0000000000c1";
  const LINE = "00000000-0000-4000-8000-0000000000d1";
  const ACCOUNT = "00000000-0000-4000-8000-0000000000e1";
  const paid = (partHasAdvance: boolean) =>
    recordingSupabase((call) => {
      if (call.table === "card_statements") {
        return {
          data: {
            account_number: "0600000001",
            status: "pendiente",
            paid_ars_on: "2026-11-11",
            paid_usd_on: null,
          },
          error: null,
        };
      }
      if (call.table === "card_statement_lines") {
        const advanceProbe = call.filters.some(
          ([k, c, v]) => k === "eq" && c === "treatment" && v === "advance",
        );
        if (advanceProbe) {
          return {
            data: partHasAdvance
              ? [{ treatment: "advance", chart_account_id: null }]
              : [],
            error: null,
          };
        }
        return {
          data: [
            {
              id: LINE,
              currency: "ARS",
              source: "purchase",
              treatment: "expense",
            },
          ],
          error: null,
        };
      }
      if (call.op === "rpc") return { data: 1, error: null };
      return { data: [], error: null };
    });
  const destination = {
    statement_id: ID,
    treatment: "expense",
    chart_account_id: ACCOUNT,
    employee_id: null,
  } as const;

  it("books the part again when one of its lines changes", async () => {
    fake = paid(false);
    const res = await cards.setCardLinesAction({
      ...destination,
      line_ids: [LINE],
    });
    expect(res).toMatchObject({ ok: true, data: { updated: 1 } });
    const rpc = fake.calls.find((c) => c.op === "rpc");
    expect(rpc?.table).toBe("reclassify_card_statement_lines");
    expect(rpc?.payload).toMatchObject({
      p_line_ids: [LINE],
      p_chart_account_id: ACCOUNT,
    });
  });

  it("refuses booking a part with advances again without hr:write", async () => {
    denied = ["hr:write"];
    fake = paid(true);
    const res = await cards.setCardLinesAction({
      ...destination,
      line_ids: [LINE],
    });
    expect(res.ok === false && res.error).toMatch(/Personal/);
    expect(fake.calls.some((c) => c.op === "rpc")).toBe(false);
  });

  it("applies a card's default only to its parts not paid yet", async () => {
    fake = paid(false);
    await cards.setCardHolderAction({ ...destination, last4: "1234" });
    const lineUpdate = fake.calls.find(
      (c) => c.op === "update" && c.table === "card_statement_lines",
    );
    expect(lineUpdate?.filters).toContainEqual([
      "not",
      "currency",
      ["in", "(ARS)"],
    ]);
  });
});

describe("unmatching a card payment", () => {
  const LINE_ID = "00000000-0000-4000-8000-0000000000b1";

  it("refuses a line that paid a card statement, before the RPC", async () => {
    fake = recordingSupabase((call) =>
      call.table === "card_statement_lines"
        ? { data: [{ id: "x" }], error: null }
        : { data: null, error: null },
    );
    const res = await bank.unmatchLineAction({ line_id: LINE_ID });
    expect(res.ok === false && res.error).toMatch(/deshacé el pago/);
    expect(fake.calls.some((c) => c.op === "rpc")).toBe(false);
    expect(
      fake.calls.find((c) => c.table === "card_statement_lines")?.filters,
    ).toContainEqual([
      "eq",
      "transactions.bank_statement_matches.line_id",
      LINE_ID,
    ]);
  });

  it("unmatches any other line", async () => {
    fake = recordingSupabase((call) =>
      call.table === "card_statement_lines"
        ? { data: [], error: null }
        : { data: null, error: null },
    );
    const res = await bank.unmatchLineAction({ line_id: LINE_ID });
    expect(res.ok).toBe(true);
    expect(
      fake.calls.some(
        (c) => c.op === "rpc" && c.table === "unmatch_bank_statement_line",
      ),
    ).toBe(true);
  });
});
