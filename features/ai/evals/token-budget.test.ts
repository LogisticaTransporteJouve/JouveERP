import { simulateReadableStream, type ToolSet, type UIMessage } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";

import { resolveAccess } from "@/lib/auth/permissions";

import {
  estimateTokens,
  requestBlocks,
  simulateTurn,
  turnCostUsd,
  type CallOptions,
} from "./token-budget";

// Measures the request the chat route sends (agent.ts + the registry tools of
// an owner + the scripted turn below) with no network: the model is a mock
// that records each step's call, priced with lib/pricing.ts. Run
// `AI_TOKEN_REPORT=1 pnpm vitest run features/ai/evals/token-budget.test.ts`
// for the per-part table.

type StreamResult = Awaited<ReturnType<MockLanguageModelV4["doStream"]>>;
type StreamPart =
  StreamResult["stream"] extends ReadableStream<infer P> ? P : never;

const VENTAS_ROWS = 297;
const COMPRAS_ROWS = 180;

function ventasRow(i: number) {
  const neto = 100_000 + i * 1_337;
  return {
    cae: `7${String(4_412_345_678_901 + i)}`,
    cae_vencimiento: "2026-11-10",
    cbte_tipo_afip: 1,
    channel_id: "c0a80000-0000-4000-8000-000000000001",
    channel_name: "Jouve fiscal",
    client_legal_name: `Cliente de prueba ${i % 40} S.A.`,
    cotizacion: 1,
    doc_nro: `30${String(70_000_000 + i)}9`,
    doc_tipo: 80,
    fecha: `2026-10-${String((i % 28) + 1).padStart(2, "0")}`,
    has_items: true,
    imp_op_ex: 0,
    imp_op_ex_orig: 0,
    imp_tot_conc: 0,
    imp_tot_conc_orig: 0,
    imp_total: neto * 1.21,
    imp_total_orig: neto * 1.21,
    imp_trib: 0,
    imp_trib_orig: 0,
    invoice_id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    iva: neto * 0.21,
    iva_orig: neto * 0.21,
    iva_rate_id: 5,
    iva_rate_pct: 21,
    kind: "invoice",
    letter: "A",
    moneda: "PES",
    neto,
    neto_orig: neto,
    numero: 22_000 + i,
    punto_venta: 3,
  };
}

function comprasRow(i: number) {
  const neto = 50_000 + i * 911;
  return {
    cae_proveedor: `7${String(5_512_345_678_901 + i)}`,
    cae_vto_proveedor: "2026-11-10",
    channel_id: "c0a80000-0000-4000-8000-000000000001",
    channel_name: "Jouve fiscal",
    cotizacion: 1,
    exentas: 0,
    exentas_orig: 0,
    fecha: `2026-10-${String((i % 28) + 1).padStart(2, "0")}`,
    has_items: true,
    imp_total: neto * 1.21,
    imp_total_orig: neto * 1.21,
    imp_trib: 0,
    imp_trib_orig: 0,
    impuestos_internos: 0,
    impuestos_internos_orig: 0,
    iva: neto * 0.21,
    iva_orig: neto * 0.21,
    iva_rate_id: 5,
    iva_rate_pct: 21,
    kind: "invoice",
    letter: "A",
    moneda: "PES",
    neto,
    neto_orig: neto,
    no_gravado: 0,
    no_gravado_orig: 0,
    numero: 1_000 + i,
    perc_iibb: 0,
    perc_iibb_orig: 0,
    perc_iva: 0,
    perc_iva_orig: 0,
    perc_municipales: 0,
    perc_municipales_orig: 0,
    perc_nacionales: 0,
    perc_nacionales_orig: 0,
    punto_venta: 2,
    purchase_invoice_id: `10000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    supplier_cuit: `30${String(60_000_000 + i)}1`,
    supplier_legal_name: `Proveedor de prueba ${i % 30} S.R.L.`,
  };
}

vi.mock("@/features/libro-iva/actions/libro-iva-actions", () => ({
  listLibroIvaVentasAction: async () => ({
    ok: true,
    data: Array.from({ length: VENTAS_ROWS }, (_, i) => ventasRow(i)),
  }),
  listLibroIvaComprasAction: async () => ({
    ok: true,
    data: Array.from({ length: COMPRAS_ROWS }, (_, i) => comprasRow(i)),
  }),
}));
vi.mock("@/lib/actions/audit", () => ({ logAudit: async () => undefined }));

let mockModel = new MockLanguageModelV4();
vi.mock("../model", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../model")>()),
  buildChatModel: () => ({
    model: mockModel,
    servedModel: () => "claude-sonnet-5-5",
  }),
}));

const { streamChat } = await import("../agent");
const { buildAiTools, buildCapabilitiesSummary } = await import("../registry");
const { createArtifactSink } = await import("../artifacts/sink");

const usage = {
  inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 0, text: 0, reasoning: 0 },
};

function streamOf(chunks: StreamPart[]): StreamResult {
  return { stream: simulateReadableStream({ chunks }) };
}

const toolStep = (id: string, toolName: string, input: unknown) =>
  streamOf([
    { type: "stream-start", warnings: [] },
    {
      type: "tool-call",
      toolCallId: id,
      toolName,
      input: JSON.stringify(input),
    },
    {
      type: "finish",
      finishReason: { unified: "tool-calls", raw: "tool_use" },
      usage,
    },
  ]);

const ANSWER =
  "En octubre el **IVA débito** fue de **$12.345.678** sobre 297 comprobantes; te dejé el libro en el panel.";

const textStep = () =>
  streamOf([
    { type: "stream-start", warnings: [] },
    { type: "text-start", id: "t" },
    { type: "text-delta", id: "t", delta: ANSWER },
    { type: "text-end", id: "t" },
    {
      type: "finish",
      finishReason: { unified: "stop", raw: "end_turn" },
      usage,
    },
  ]);

const access = resolveAccess(["owner"]);

function chatTools(): ToolSet {
  const sink = createArtifactSink();
  sink.attach(() => undefined);
  return buildAiTools({ userId: "u1", access, artifacts: sink });
}

const capabilities = buildCapabilitiesSummary(access, undefined, {
  artifacts: true,
});

const user = (id: string, text: string): UIMessage => ({
  id,
  role: "user",
  parts: [{ type: "text", text }],
});

async function runTool(
  tools: ToolSet,
  name: string,
  input: unknown,
  toolCallId: string,
): Promise<unknown> {
  const t = tools[name];
  if (!t?.execute) throw new Error(`no tool ${name}`);
  return t.execute(input, { toolCallId, messages: [], context: undefined });
}

/** A past turn as the store replays it: a read, its table, a short answer. */
async function pastTurn(
  tools: ToolSet,
  n: number,
  question: string,
  action: string,
  period: string,
): Promise<UIMessage[]> {
  const input = { period };
  const tableInput = { action, input, table: { title: `Libro ${period}` } };
  const read = await runTool(tools, action, input, `r${n}`);
  const table = await runTool(tools, "renderTable", tableInput, `t${n}`);
  return [
    user(`u${n}`, question),
    {
      id: `a${n}`,
      role: "assistant",
      parts: [
        { type: "step-start" },
        {
          type: `tool-${action}`,
          toolCallId: `r${n}`,
          state: "output-available",
          input,
          output: read,
        },
        { type: "step-start" },
        {
          type: "tool-renderTable",
          toolCallId: `t${n}`,
          state: "output-available",
          input: tableInput,
          output: table,
        },
        { type: "step-start" },
        { type: "text", text: ANSWER },
      ],
    },
  ];
}

async function sixTurnHistory(): Promise<UIMessage[]> {
  const tools = chatTools();
  return [
    ...(await pastTurn(
      tools,
      1,
      "IVA ventas de octubre",
      "getLibroIvaVentas",
      "2026-10",
    )),
    ...(await pastTurn(
      tools,
      2,
      "¿Y las compras?",
      "getLibroIvaCompras",
      "2026-10",
    )),
    ...(await pastTurn(
      tools,
      3,
      "IVA ventas de septiembre",
      "getLibroIvaVentas",
      "2026-09",
    )),
    user("u4", "¿Cuál es el saldo técnico de octubre?"),
    { id: "a4", role: "assistant", parts: [{ type: "text", text: ANSWER }] },
    user("u5", "Gracias, ¿y cuántas notas de crédito hubo?"),
    { id: "a5", role: "assistant", parts: [{ type: "text", text: ANSWER }] },
  ];
}

const QUESTION = "¿Cuánto IVA débito tuve en agosto? Mostrame el libro.";

/** Runs the scripted current turn (read, table, answer) over `history` and
 *  returns what each step sent. */
async function runTurn(
  history: UIMessage[],
  options: { question?: string; notes?: string } = {},
): Promise<CallOptions[]> {
  const calls: CallOptions[] = [];
  const steps = [
    toolStep("c1", "getLibroIvaVentas", { period: "2026-08" }),
    toolStep("c2", "renderTable", {
      action: "getLibroIvaVentas",
      input: { period: "2026-08" },
      table: { title: "Libro IVA Ventas agosto" },
    }),
    textStep(),
  ];
  mockModel = new MockLanguageModelV4({
    doStream: async (call) => {
      calls.push(call);
      const step = steps.shift();
      if (!step) throw new Error("unexpected extra model call");
      return step;
    },
  });
  const result = await streamChat(
    [...history, user("now", options.question ?? QUESTION)],
    {
      tools: chatTools(),
      capabilities,
      notes: options.notes,
      userId: "u1",
      sessionId: "s1",
    },
  );
  await result.consumeStream();
  return calls;
}

const OUTPUT_TOKENS = 1_000;

function report(label: string, calls: CallOptions[]) {
  if (!process.env.AI_TOKEN_REPORT) return;
  const warm = simulateTurn(calls);
  const cold = simulateTurn(calls, "none");
  console.log(`\n${label}`);
  console.table(
    [...warm.calls, warm.total].map((r, i) => ({
      step: i === warm.calls.length ? "TOTAL" : i + 1,
      ...r.tokens,
      input: r.input,
      cacheRead: r.cacheRead,
      cacheWrite: r.cacheWrite,
    })),
  );
  console.log(
    `USD per question (${OUTPUT_TOKENS} output tokens): ` +
      `${turnCostUsd(warm.total, OUTPUT_TOKENS).toFixed(4)} with tools + system cached, ` +
      `${turnCostUsd(cold.total, OUTPUT_TOKENS).toFixed(4)} cold`,
  );
}

/** Largest tool result one step sends, in tokens. */
function largestResult(calls: CallOptions[]): number {
  let max = 0;
  for (const call of calls) {
    for (const block of requestBlocks(call)) {
      if (block.part.endsWith("ToolResults")) {
        max = Math.max(max, estimateTokens(block.text.length));
      }
    }
  }
  return max;
}

describe("chat request token budget", () => {
  it("(a) a fresh question: a 297-row book reaches the model as a summary", async () => {
    const calls = await runTurn([]);
    report("(a) fresh question", calls);
    expect(calls).toHaveLength(3);
    expect(largestResult(calls)).toBeLessThan(3_500);
  });

  it("(b) a 6-turn conversation: earlier large results stay small", async () => {
    const calls = await runTurn(await sixTurnHistory());
    report("(b) 6-turn conversation", calls);
    const { total } = simulateTurn(calls);
    expect(largestResult(calls)).toBeLessThan(3_500);
    expect(total.tokens.historyToolResults / calls.length).toBeLessThan(10_000);
  });

  it("keeps tools, the system block and earlier turns a stable cached prefix", async () => {
    const history = await sixTurnHistory();
    const [a] = await runTurn(history);
    const [b] = await runTurn(history, {
      question: "¿Cómo viene la cobranza? ¿Hay deuda vencida a 90 días?",
      notes: "Propuestas en esta conversación: - proposeReceipt: pendiente",
    });
    if (!a || !b) throw new Error("no model call");
    const blocksA = requestBlocks(a);
    const blocksB = requestBlocks(b);
    const lastUser = (blocks: typeof blocksA) =>
      blocks.findIndex((x) => x.part === "turn" || x.part === "volatile");
    const end = lastUser(blocksA);
    expect(end).toBeGreaterThan(0);
    expect(lastUser(blocksB)).toBe(end);
    expect(blocksB.slice(0, end).map((x) => x.text)).toEqual(
      blocksA.slice(0, end).map((x) => x.text),
    );
    // One breakpoint on the static system block, the other on the tail.
    const breakpoints = blocksB.flatMap((x, i) => (x.breakpoint ? [i] : []));
    expect(breakpoints).toHaveLength(2);
    expect(blocksB[breakpoints[0] ?? -1]?.part).toBe("system");
    expect(blocksB.filter((x) => x.part === "volatile")).toHaveLength(1);
    expect(blocksB.find((x) => x.part === "volatile")?.text).toContain(
      "proposeReceipt",
    );
  });
});
