import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";

import {
  answersTurnMessage,
  answersProblem,
  applyQuestionAnswers,
  askQuestionsInputSchema,
  isAnswersTurn,
  pendingQuestionCall,
  type AskQuestionsInput,
} from "./questions";

const card: AskQuestionsInput = {
  questions: [
    {
      id: "employee",
      prompt: "¿Qué empleado?",
      kind: "single",
      options: [
        { value: "ana", label: "Ana Pérez" },
        { value: "anabel", label: "Anabel Gómez" },
      ],
      allowOther: true,
    },
    {
      id: "months",
      prompt: "¿Qué meses?",
      kind: "multi",
      options: [
        { value: "2026-08", label: "Agosto" },
        { value: "2026-09", label: "Septiembre" },
      ],
    },
    { id: "note", prompt: "¿Algo más?", kind: "text" },
  ],
};

const full = {
  answers: [
    { id: "employee", values: ["ana"] },
    { id: "months", values: ["2026-08", "2026-09"] },
    { id: "note", values: [], text: "Nada" },
  ],
};

function transcript(
  state: "input-available" | "output-available",
): UIMessage[] {
  return [
    {
      id: "m1",
      role: "user",
      parts: [{ type: "text", text: "Cargale vacaciones a Ana" }],
    },
    {
      id: "m2",
      role: "assistant",
      parts:
        state === "input-available"
          ? [
              { type: "text", text: "Tengo dudas:" },
              {
                type: "tool-askQuestions",
                toolCallId: "call-1",
                state,
                input: card,
              },
            ]
          : [
              {
                type: "tool-askQuestions",
                toolCallId: "call-1",
                state,
                input: card,
                output: full,
              },
            ],
    },
  ];
}

describe("askQuestions input", () => {
  it("accepts 1–8 questions with unique ids", () => {
    expect(askQuestionsInputSchema.safeParse(card).success).toBe(true);
    expect(askQuestionsInputSchema.safeParse({ questions: [] }).success).toBe(
      false,
    );
    const nine = Array.from({ length: 9 }, (_, i) => ({
      id: `q${i}`,
      prompt: "x",
      kind: "text",
    }));
    expect(askQuestionsInputSchema.safeParse({ questions: nine }).success).toBe(
      false,
    );
    expect(
      askQuestionsInputSchema.safeParse({
        questions: [card.questions[2], card.questions[2]],
      }).success,
    ).toBe(false);
  });

  it("requires 2+ options on choices and none on text", () => {
    expect(
      askQuestionsInputSchema.safeParse({
        questions: [
          {
            id: "a",
            prompt: "?",
            kind: "single",
            options: [{ value: "x", label: "X" }],
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      askQuestionsInputSchema.safeParse({
        questions: [
          {
            id: "a",
            prompt: "?",
            kind: "text",
            options: [
              { value: "x", label: "X" },
              { value: "y", label: "Y" },
            ],
          },
        ],
      }).success,
    ).toBe(false);
  });
});

describe("answersProblem", () => {
  it("accepts a complete set of answers, and a skipped card", () => {
    expect(answersProblem(card, full)).toBeNull();
    expect(answersProblem(card, { skipped: true })).toBeNull();
  });

  it("rejects missing, foreign, duplicated and out-of-card answers", () => {
    expect(answersProblem(card, { answers: full.answers.slice(0, 2) })).toMatch(
      /Falta/,
    );
    expect(
      answersProblem(card, {
        answers: [...full.answers, { id: "ghost", values: [] }],
      }),
    ).toMatch(/no está/);
    expect(
      answersProblem(card, { answers: [...full.answers, full.answers[0]!] }),
    ).toMatch(/duplicada/);
    expect(
      answersProblem(card, {
        answers: [
          { id: "employee", values: ["root"] },
          ...full.answers.slice(1),
        ],
      }),
    ).toMatch(/inválida/);
  });

  it("takes one pick on single choice, an 'other' only where allowed", () => {
    expect(
      answersProblem(card, {
        answers: [
          { id: "employee", values: ["ana", "anabel"] },
          ...full.answers.slice(1),
        ],
      }),
    ).toMatch(/Falta/);
    expect(
      answersProblem(card, {
        answers: [
          { id: "employee", values: [], text: "Juan" },
          ...full.answers.slice(1),
        ],
      }),
    ).toBeNull();
    expect(
      answersProblem(card, {
        answers: [
          full.answers[0]!,
          { id: "months", values: [], text: "Octubre" },
          full.answers[2]!,
        ],
      }),
    ).toMatch(/inválida/);
  });
});

describe("applyQuestionAnswers", () => {
  it("sets the answers as the pending call's output", () => {
    const res = applyQuestionAnswers(
      transcript("input-available"),
      "call-1",
      full,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.partIndex).toBe(1);
    const part = res.messages.at(-1)?.parts[1];
    expect(part).toMatchObject({
      type: "tool-askQuestions",
      toolCallId: "call-1",
      state: "output-available",
      output: full,
    });
    // The text before the card is untouched.
    expect(res.messages.at(-1)?.parts[0]).toEqual({
      type: "text",
      text: "Tengo dudas:",
    });
  });

  it("refuses an answered card, an unknown call and bad answers", () => {
    expect(
      applyQuestionAnswers(transcript("output-available"), "call-1", full).ok,
    ).toBe(false);
    expect(
      applyQuestionAnswers(transcript("input-available"), "call-2", full).ok,
    ).toBe(false);
    expect(
      applyQuestionAnswers(transcript("input-available"), "call-1", {
        answers: [{ id: "employee", values: ["root"] }],
      }).ok,
    ).toBe(false);
    expect(
      applyQuestionAnswers(transcript("input-available"), "call-1", "hola").ok,
    ).toBe(false);
  });

  it("only answers a card on the last message", () => {
    const followUp: UIMessage = {
      id: "m3",
      role: "user",
      parts: [{ type: "text", text: "otra cosa" }],
    };
    const messages = [...transcript("input-available"), followUp];
    expect(applyQuestionAnswers(messages, "call-1", full).ok).toBe(false);
  });
});

describe("pendingQuestionCall", () => {
  it("finds the card the transcript ends on while it waits", () => {
    expect(pendingQuestionCall(transcript("input-available"))).toBe("call-1");
    expect(pendingQuestionCall(transcript("output-available"))).toBeNull();
    expect(pendingQuestionCall([])).toBeNull();
  });

  it("never waits on a card whose input does not parse", () => {
    const broken: UIMessage = {
      id: "m9",
      role: "assistant",
      parts: [
        {
          type: "tool-askQuestions",
          toolCallId: "call-9",
          state: "input-available",
          input: { questions: [] },
        },
      ],
    };
    expect(pendingQuestionCall([broken])).toBeNull();
  });
});

describe("answers turn", () => {
  it("is a hidden user turn tied to the card it follows", () => {
    const turn = answersTurnMessage("call-1");
    expect(turn).toMatchObject({
      role: "user",
      metadata: { answersFor: "call-1" },
    });
    expect(isAnswersTurn(turn)).toBe(true);
    expect(isAnswersTurn(transcript("input-available")[0]!)).toBe(false);
    // Once the user turn follows, the card no longer waits.
    const messages = [...transcript("output-available"), turn];
    expect(pendingQuestionCall(messages)).toBeNull();
  });
});
