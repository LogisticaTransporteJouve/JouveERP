import { isToolUIPart, type UIMessage } from "ai";
import { z } from "zod";

/** The assistant's question-card tool. It has no server `execute`: the turn
 *  ends on the call and the user's answers come back as its output. */
export const ASK_QUESTIONS_TOOL = "askQuestions";

export const MAX_QUESTIONS = 8;
const MAX_OPTIONS = 12;
const MAX_PROMPT = 300;
export const MAX_ANSWER_TEXT = 1000;

const optionSchema = z.object({
  value: z.string().trim().min(1).max(100),
  label: z.string().trim().min(1).max(120),
});

const questionSchema = z
  .object({
    id: z
      .string()
      .regex(/^[a-z0-9_-]{1,40}$/, "id: lowercase letters, digits, _ or -"),
    prompt: z.string().trim().min(1).max(MAX_PROMPT),
    kind: z.enum(["single", "multi", "text"]),
    options: z.array(optionSchema).max(MAX_OPTIONS).optional(),
    allowOther: z
      .boolean()
      .optional()
      .describe("single/multi only: also offer a free-text 'Otro'."),
  })
  .refine(
    (q) =>
      q.kind === "text"
        ? (q.options?.length ?? 0) === 0
        : (q.options?.length ?? 0) >= 2,
    {
      message: "single/multi need 2+ options; text takes none",
      path: ["options"],
    },
  )
  .refine(
    (q) =>
      new Set((q.options ?? []).map((o) => o.value)).size ===
      (q.options?.length ?? 0),
    { message: "option values must be unique", path: ["options"] },
  );

export type AiQuestion = z.infer<typeof questionSchema>;

export const askQuestionsInputSchema = z.object({
  questions: z
    .array(questionSchema)
    .min(1)
    .max(MAX_QUESTIONS)
    .refine((qs) => new Set(qs.map((q) => q.id)).size === qs.length, {
      message: "question ids must be unique",
    }),
});

export type AskQuestionsInput = z.infer<typeof askQuestionsInputSchema>;

const answerSchema = z.object({
  id: z.string().min(1).max(40),
  /** Picked option values (single: exactly one unless `other` is set). */
  values: z.array(z.string().max(100)).max(MAX_OPTIONS).default([]),
  /** Free text: the answer to a text question, or the "Otro" entry. */
  text: z.string().trim().max(MAX_ANSWER_TEXT).optional(),
});

export const questionAnswersSchema = z.union([
  z.object({ skipped: z.literal(true) }),
  z.object({ answers: z.array(answerSchema).min(1).max(MAX_QUESTIONS) }),
]);

export type QuestionAnswers = z.infer<typeof questionAnswersSchema>;
export type QuestionAnswer = z.infer<typeof answerSchema>;

/**
 * Checks the answers against the card they answer: every question answered
 * once, picks only among its options, free text only where the question takes
 * it. Returns the first problem, or null when the answers fit.
 */
export function answersProblem(
  input: AskQuestionsInput,
  answers: QuestionAnswers,
): string | null {
  if ("skipped" in answers) return null;
  const byId = new Map(answers.answers.map((a) => [a.id, a]));
  if (byId.size !== answers.answers.length) return "Respuesta duplicada.";
  for (const id of byId.keys()) {
    if (!input.questions.some((q) => q.id === id)) {
      return "Respuesta a una pregunta que no está en la tarjeta.";
    }
  }
  for (const q of input.questions) {
    const a = byId.get(q.id);
    if (!a) return `Falta responder: ${q.prompt}`;
    const text = a.text ?? "";
    if (q.kind === "text") {
      if (a.values.length > 0 || text.length === 0) {
        return `Falta responder: ${q.prompt}`;
      }
      continue;
    }
    const allowed = new Set((q.options ?? []).map((o) => o.value));
    if (a.values.some((v) => !allowed.has(v))) {
      return `Opción inválida en: ${q.prompt}`;
    }
    if (text.length > 0 && !q.allowOther) {
      return `Opción inválida en: ${q.prompt}`;
    }
    const picks = a.values.length + (text.length > 0 ? 1 : 0);
    if (q.kind === "single" ? picks !== 1 : picks < 1) {
      return `Falta responder: ${q.prompt}`;
    }
  }
  return null;
}

/** The answers in the order of the card, as label text (for the card's
 *  read-only state). */
export function answerLabels(
  input: AskQuestionsInput,
  answers: QuestionAnswers,
): { prompt: string; answer: string }[] {
  if ("skipped" in answers) return [];
  return input.questions.map((q) => {
    const a = answers.answers.find((x) => x.id === q.id);
    const labels = (a?.values ?? []).map(
      (v) => q.options?.find((o) => o.value === v)?.label ?? v,
    );
    if (a?.text) labels.push(a.text);
    return { prompt: q.prompt, answer: labels.join(", ") };
  });
}

/**
 * The persisted transcript with the user's answers set as the output of the
 * pending `askQuestions` call — the tool result the model continues from.
 * Only the LAST message may hold the card, and only while it still waits
 * (`input-available`); anything else, or answers that do not fit the card,
 * returns an error instead.
 */
export function applyQuestionAnswers(
  messages: UIMessage[],
  toolCallId: string,
  rawAnswers: unknown,
):
  | { ok: true; messages: UIMessage[]; partIndex: number }
  | { ok: false; error: string } {
  const last = messages.at(-1);
  if (!last || last.role !== "assistant") {
    return { ok: false, error: "No hay preguntas pendientes." };
  }
  const index = last.parts.findIndex(
    (p) =>
      isToolUIPart(p) &&
      p.type === `tool-${ASK_QUESTIONS_TOOL}` &&
      p.toolCallId === toolCallId,
  );
  const part = last.parts[index];
  if (!part || !isToolUIPart(part) || part.state !== "input-available") {
    return { ok: false, error: "Esas preguntas ya no esperan respuesta." };
  }
  const input = askQuestionsInputSchema.safeParse(part.input);
  const answers = questionAnswersSchema.safeParse(rawAnswers);
  if (!input.success || !answers.success) {
    return { ok: false, error: "Respuestas inválidas." };
  }
  const problem = answersProblem(input.data, answers.data);
  if (problem) return { ok: false, error: problem };

  const parts = [...last.parts];
  parts[index] = {
    type: `tool-${ASK_QUESTIONS_TOOL}`,
    toolCallId: part.toolCallId,
    state: "output-available",
    input: part.input,
    output: answers.data,
  };
  return {
    ok: true,
    messages: [...messages.slice(0, -1), { ...last, parts }],
    partIndex: index,
  };
}

/** The user turn that follows an answered card. The answers themselves are
 *  the card's tool result; this turn only makes the model answer them as a
 *  new turn, and the chat hides it (the card shows the answers). */
export const ANSWERS_TURN_TEXT = "Respondí las preguntas de la tarjeta.";

export function answersTurnMessage(toolCallId: string): UIMessage {
  return {
    id: crypto.randomUUID(),
    role: "user",
    metadata: { answersFor: toolCallId },
    parts: [{ type: "text", text: ANSWERS_TURN_TEXT }],
  };
}

export function isAnswersTurn(message: UIMessage): boolean {
  const meta = message.metadata;
  return (
    message.role === "user" &&
    typeof meta === "object" &&
    meta !== null &&
    "answersFor" in meta
  );
}

/** The question card the user still has to answer, if the transcript ends on
 *  one the chat can show. A card whose input does not parse cannot be
 *  answered, so it never holds the composer. */
export function pendingQuestionCall(messages: UIMessage[]): string | null {
  const last = messages.at(-1);
  if (!last || last.role !== "assistant") return null;
  for (const p of last.parts) {
    if (
      isToolUIPart(p) &&
      p.type === `tool-${ASK_QUESTIONS_TOOL}` &&
      p.state === "input-available" &&
      askQuestionsInputSchema.safeParse(p.input).success
    ) {
      return p.toolCallId;
    }
  }
  return null;
}
