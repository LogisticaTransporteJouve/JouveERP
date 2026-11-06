import { describe, expect, it } from "vitest";

import type { JsonValue } from "@/lib/actions/audit";

import type { AuditEventRow } from "../schema";

import { aiTurnSentence, groupAiTurns } from "./ai-turns";

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

let n = 0;
function row(
  ts: string,
  overrides: Partial<AuditEventRow> & { payload?: JsonValue } = {},
): AuditEventRow {
  n += 1;
  return {
    id: `id-${n}`,
    ts,
    actor_id: USER,
    actor_type: "ai-agent",
    event_type: "ai.tool_call",
    target_resource_id: "s1",
    target_user_id: null,
    sentence: "consultó algo",
    subject: null,
    group: "ai",
    payload: { tool: "getInvoices", session_id: "s1", input: {} },
    ...overrides,
  };
}

function call(ts: string, tool: string, input: JsonValue = {}, session = "s1") {
  return row(ts, {
    target_resource_id: session,
    payload: { tool, session_id: session, input, tool_call_id: "toolu_x" },
  });
}

describe("aiTurnSentence", () => {
  it("lists the queries in the order they ran, with shared filters once", () => {
    const period = { period: "2026-09" };
    expect(
      aiTurnSentence([
        call("2026-11-07T10:00:03Z", "getTaxDocuments", period),
        call("2026-11-07T10:00:02Z", "getLibroIvaCompras", period),
        call("2026-11-07T10:00:01Z", "getLibroIvaVentas", period),
      ]),
    ).toBe("consultó IVA Ventas, IVA Compras e Impuestos (09/2026)");
  });

  it("puts each query's own filters next to it when they differ", () => {
    expect(
      aiTurnSentence([
        call("2026-11-07T10:00:02Z", "getTrips", { patente: "AE463UF" }),
        call("2026-11-07T10:00:01Z", "getInvoices", { from: "2026-10-01" }),
      ]),
    ).toBe("consultó Comprobantes (desde 01/10/2026) y Viajes (AE463UF)");
  });

  it("never shows an internal tool name and caps a long list", () => {
    const calls = Array.from({ length: 8 }, (_, i) =>
      call(`2026-11-07T10:00:0${9 - i}Z`, `secretTool${i}`, { q: `${i}` }),
    );
    const sentence = aiTurnSentence(calls);
    expect(sentence).not.toContain("secretTool");
    expect(sentence).toMatch(/y 2 consultas más$/);
  });
});

describe("groupAiTurns", () => {
  it("folds consecutive queries of one chat into one row", () => {
    const items = groupAiTurns([
      call("2026-11-07T10:05:00Z", "getTaxDocuments"),
      call("2026-11-07T10:04:00Z", "getLibroIvaVentas"),
      row("2026-11-07T10:03:00Z", {
        actor_type: "user",
        event_type: "receipt.created",
        group: "receipts",
      }),
      call("2026-11-07T10:02:00Z", "getInvoices"),
    ]);
    expect(items.map((i) => i.kind)).toEqual(["ai_turn", "event", "event"]);
    const turn = items[0];
    expect(turn?.kind === "ai_turn" && turn.calls).toHaveLength(2);
    expect(turn?.sentence).toBe("consultó IVA Ventas e Impuestos");
  });

  it("keeps other chats, other users and pauses apart", () => {
    const items = groupAiTurns([
      call("2026-11-07T10:30:00Z", "getInvoices"),
      // 20 minutes earlier: another turn
      call("2026-11-07T10:10:00Z", "getInvoices"),
      call("2026-11-07T10:09:00Z", "getInvoices", {}, "s2"),
      row("2026-11-07T10:08:00Z", {
        actor_id: OTHER,
        payload: { tool: "getInvoices", session_id: "s2" },
        target_resource_id: "s2",
      }),
    ]);
    expect(items.map((i) => i.kind)).toEqual([
      "event",
      "event",
      "event",
      "event",
    ]);
  });

  it("groups an automatic task run by its run id", () => {
    const run = (ts: string, tool: string) =>
      row(ts, {
        target_resource_id: "run1",
        payload: { tool, workflow_run_id: "run1", input: {} },
      });
    const items = groupAiTurns([
      run("2026-11-07T06:00:02Z", "getClientAging"),
      run("2026-11-07T06:00:01Z", "getSupplierAging"),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]?.sentence).toBe(
      "consultó Aging de proveedores y Aging de clientes",
    );
  });
});
