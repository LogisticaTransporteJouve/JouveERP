// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import type { UIMessage } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildTableArtifact } from "../artifacts/build";
import { buildCalendarArtifact } from "../artifacts/calendar";
import type { Artifact } from "../artifacts/spec";

// The chat stream: each render reads the transcript the test set last.
let transcript: UIMessage[] = [];
vi.mock("@ai-sdk/react", () => ({
  useChat: () => ({
    messages: transcript,
    setMessages: vi.fn(),
    sendMessage: vi.fn(),
    addToolOutput: vi.fn(),
    status: "ready",
  }),
}));
vi.mock("../actions/chat-actions", () => ({
  getAiSessionMessagesAction: vi.fn(),
}));
vi.mock("../attachments/actions", () => ({
  discardChatAttachmentAction: vi.fn(),
  uploadChatAttachmentAction: vi.fn(),
}));
vi.mock("../hooks/use-ai-confirmations", () => ({
  useAiConfirmations: () => ({ data: [] }),
}));
vi.mock("../hooks/use-ai-pins", () => ({
  usePinAiArtifact: () => ({ mutate: vi.fn(), isPending: false }),
}));

const { AiChat } = await import("./ai-chat");

let wide = true;

beforeEach(() => {
  wide = true;
  transcript = [];
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        matches: wide,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }) satisfies Partial<MediaQueryList>,
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function table(title: string): Artifact {
  const res = buildTableArtifact(
    { title },
    {
      source: { action: "getClientAging", input: {} },
      rows: [{ client: "Acme", total: 10 }],
      meta: { sources: ["x"], asOf: "2026-11-01T12:00:00Z", partial: false },
    },
  );
  if (!res.ok) throw new Error(res.error);
  return res.value;
}

function calendar(title: string): Artifact {
  const res = buildCalendarArtifact(
    { title },
    {
      source: {
        action: "getLeavesByRange",
        input: { from: "2026-12-01", to: "2026-12-31" },
      },
      rows: [
        {
          employee: "Gómez Ana",
          kind: "vacaciones",
          kind_label: "Vacaciones",
          start_date: "2026-12-01",
          end_date: "2026-12-05",
        },
        {
          employee: "Pérez Luis",
          kind: "enfermedad",
          kind_label: "Enfermedad",
          start_date: "2026-12-10",
          end_date: "2026-12-10",
        },
      ],
      meta: { sources: ["x"], asOf: "2026-11-01T12:00:00Z", partial: false },
    },
  );
  if (!res.ok) throw new Error(res.error);
  return res.value;
}

function building(
  id: string,
  tool = "renderTable",
): UIMessage["parts"][number] {
  return {
    type: `tool-${tool}`,
    toolCallId: id,
    state: "input-available",
    input: {},
  };
}

function artifact(id: string, title: string): UIMessage["parts"][number] {
  return { type: "data-artifact", id, data: table(title) };
}

function turn(id: string, parts: UIMessage["parts"]): UIMessage {
  return { id, role: "assistant", parts };
}

function chat(initial: UIMessage[] = []) {
  const qc = new QueryClient();
  const ui = () => (
    <QueryClientProvider client={qc}>
      <AiChat sessionId="s1" initialMessages={initial} onPersisted={vi.fn()} />
    </QueryClientProvider>
  );
  const view = render(ui());
  return { rerender: () => view.rerender(ui()) };
}

function canvas() {
  return screen.queryByRole("complementary");
}

describe("AiChat artifact canvas", () => {
  it("keeps the chat full width until an artifact shows up", () => {
    transcript = [turn("m1", [{ type: "text", text: "Hola" }])];
    chat();
    expect(canvas()).toBeNull();
  });

  it("opens a new artifact with a skeleton, then shows it with its card in the chat", () => {
    const view = chat();
    transcript = [turn("m1", [building("t1")])];
    view.rerender();
    expect(within(canvas()!).getByRole("status")).toBeTruthy();

    transcript = [turn("m1", [building("t1"), artifact("t1", "Deudores")])];
    view.rerender();
    expect(
      within(canvas()!).getByRole("heading", { name: "Deudores" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { pressed: true }).textContent).toMatch(
      /Deudores/,
    );
  });

  it("closes, and the chat card reopens it", () => {
    transcript = [turn("m1", [artifact("t1", "Deudores")])];
    const view = chat();
    transcript = [...transcript, turn("m2", [artifact("t2", "Caja")])];
    view.rerender();
    fireEvent.click(screen.getByRole("button", { name: "Cerrar" }));
    expect(canvas()).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Deudores/ }));
    expect(
      within(canvas()!).getByRole("heading", { name: "Deudores" }),
    ).toBeTruthy();
  });

  it("lets the newest artifact win over the one on the canvas", () => {
    transcript = [turn("m1", [artifact("t1", "Deudores")])];
    const view = chat(transcript);
    transcript = [
      ...transcript,
      turn("m2", [building("t2"), artifact("t2", "Caja")]),
    ];
    view.rerender();
    expect(
      within(canvas()!).getByRole("heading", { name: "Caja" }),
    ).toBeTruthy();
  });

  it("opens a saved conversation on its last artifact beside the chat", () => {
    transcript = [
      turn("m1", [artifact("t1", "Deudores")]),
      turn("m2", [artifact("t2", "Caja")]),
    ];
    chat(transcript);
    expect(
      within(canvas()!).getByRole("heading", { name: "Caja" }),
    ).toBeTruthy();
  });

  it("opens a calendar with a skeleton, then its grid, with export and close but no pin", () => {
    const view = chat();
    transcript = [turn("m1", [building("t1", "renderCalendar")])];
    view.rerender();
    expect(
      within(canvas()!).getByRole("status", { name: "Armando calendario…" }),
    ).toBeTruthy();

    transcript = [
      turn("m1", [
        building("t1", "renderCalendar"),
        { type: "data-artifact", id: "t1", data: calendar("Licencias") },
      ]),
    ];
    view.rerender();
    const panel = within(canvas()!);
    expect(panel.getByRole("heading", { name: "Licencias" })).toBeTruthy();
    expect(panel.getByRole("rowheader", { name: "Gómez Ana" })).toBeTruthy();
    expect(panel.getByRole("button", { name: /Exportar/ })).toBeTruthy();
    expect(panel.queryByRole("button", { name: /Fijar/ })).toBeNull();
    expect(screen.getByRole("button", { pressed: true }).textContent).toMatch(
      /Calendario · 2 empleados/,
    );

    fireEvent.click(screen.getByRole("button", { name: "Cerrar" }));
    expect(canvas()).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Licencias/ }));
    expect(
      within(canvas()!).getByRole("heading", { name: "Licencias" }),
    ).toBeTruthy();
  });

  it("says the calendar failed when its call ends without one", () => {
    const view = chat();
    transcript = [turn("m1", [building("t1", "renderCalendar")])];
    view.rerender();
    transcript = [
      turn("m1", [
        {
          type: "tool-renderCalendar",
          toolCallId: "t1",
          state: "output-error",
          input: {},
          errorText: "boom",
        },
      ]),
    ];
    view.rerender();
    expect(canvas()!.textContent).toMatch(/No se pudo armar el calendario/);
  });

  it("on a narrow screen leaves a saved conversation on the chat, and «Volver al chat» returns to it", () => {
    wide = false;
    transcript = [turn("m1", [artifact("t1", "Deudores")])];
    const view = chat(transcript);
    expect(canvas()).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Deudores/ }));
    fireEvent.click(screen.getByRole("button", { name: "Volver al chat" }));
    expect(canvas()).toBeNull();

    transcript = [...transcript, turn("m2", [building("t2")])];
    view.rerender();
    expect(canvas()).not.toBeNull();
  });
});
