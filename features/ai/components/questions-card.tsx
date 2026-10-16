"use client";

import { MessageCircleQuestion } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import {
  answerLabels,
  answersProblem,
  askQuestionsInputSchema,
  MAX_ANSWER_TEXT,
  questionAnswersSchema,
  type AiQuestion,
  type AskQuestionsInput,
  type QuestionAnswers,
} from "../lib/questions";

type Draft = { values: string[]; text: string };

/**
 * The assistant's question card. While it waits, the user picks or writes
 * the answers and sends them (or skips the card); once answered it stays
 * read-only, showing what was answered.
 */
export function QuestionsCard({
  input,
  output,
  waiting,
  disabled,
  onSubmit,
}: {
  input: unknown;
  output: unknown;
  /** True while the tool call has no output yet. */
  waiting: boolean;
  disabled: boolean;
  onSubmit: (answers: QuestionAnswers) => void;
}) {
  const parsed = askQuestionsInputSchema.safeParse(input);
  if (!parsed.success) {
    return (
      <p className="text-muted-foreground text-xs italic">
        No se pudieron mostrar las preguntas. Podés seguir escribiendo.
      </p>
    );
  }
  if (!waiting) {
    const answers = questionAnswersSchema.safeParse(output);
    return (
      <AnsweredCard
        input={parsed.data}
        answers={answers.success ? answers.data : null}
      />
    );
  }
  return (
    <OpenCard input={parsed.data} disabled={disabled} onSubmit={onSubmit} />
  );
}

function CardShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-full max-w-[85%] space-y-3 rounded-lg border bg-card p-4 text-sm">
      <p className="flex items-center gap-2 font-medium">
        <MessageCircleQuestion className="size-4" /> Preguntas del asistente
      </p>
      {children}
    </div>
  );
}

function AnsweredCard({
  input,
  answers,
}: {
  input: AskQuestionsInput;
  answers: QuestionAnswers | null;
}) {
  if (!answers || "skipped" in answers) {
    return (
      <CardShell>
        <p className="text-muted-foreground text-xs">Preguntas omitidas.</p>
      </CardShell>
    );
  }
  return (
    <CardShell>
      <dl className="space-y-2">
        {answerLabels(input, answers).map((row) => (
          <div key={row.prompt}>
            <dt className="text-muted-foreground text-xs">{row.prompt}</dt>
            <dd>{row.answer || "—"}</dd>
          </div>
        ))}
      </dl>
    </CardShell>
  );
}

function OpenCard({
  input,
  disabled,
  onSubmit,
}: {
  input: AskQuestionsInput;
  disabled: boolean;
  onSubmit: (answers: QuestionAnswers) => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [problem, setProblem] = useState<string | null>(null);

  const draftOf = (id: string): Draft => drafts[id] ?? { values: [], text: "" };
  const update = (id: string, next: Draft) => {
    setProblem(null);
    setDrafts((prev) => ({ ...prev, [id]: next }));
  };

  function send() {
    const answers: QuestionAnswers = {
      answers: input.questions.map((q) => {
        const d = draftOf(q.id);
        const text = d.text.trim();
        return { id: q.id, values: d.values, ...(text ? { text } : {}) };
      }),
    };
    const issue = answersProblem(input, answers);
    if (issue) {
      setProblem(issue);
      return;
    }
    onSubmit(answers);
  }

  return (
    <CardShell>
      {input.questions.map((q) => (
        <QuestionField
          key={q.id}
          question={q}
          draft={draftOf(q.id)}
          disabled={disabled}
          onChange={(next) => update(q.id, next)}
        />
      ))}
      {problem && <p className="text-xs font-medium">{problem}</p>}
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={() => onSubmit({ skipped: true })}
        >
          Omitir
        </Button>
        <Button type="button" size="sm" disabled={disabled} onClick={send}>
          Enviar respuestas
        </Button>
      </div>
    </CardShell>
  );
}

function QuestionField({
  question: q,
  draft,
  disabled,
  onChange,
}: {
  question: AiQuestion;
  draft: Draft;
  disabled: boolean;
  onChange: (next: Draft) => void;
}) {
  const fieldId = `q-${q.id}`;
  if (q.kind === "text") {
    return (
      <div className="space-y-1">
        <Label htmlFor={fieldId}>{q.prompt}</Label>
        <Textarea
          id={fieldId}
          value={draft.text}
          maxLength={MAX_ANSWER_TEXT}
          disabled={disabled}
          onChange={(e) => onChange({ values: [], text: e.target.value })}
        />
      </div>
    );
  }

  const toggle = (value: string) => {
    if (q.kind === "single") {
      onChange({ values: [value], text: "" });
      return;
    }
    const has = draft.values.includes(value);
    onChange({
      ...draft,
      values: has
        ? draft.values.filter((v) => v !== value)
        : [...draft.values, value],
    });
  };

  return (
    <fieldset className="space-y-2" disabled={disabled}>
      <legend className="mb-1 text-sm">{q.prompt}</legend>
      {q.kind === "single" ? (
        <div className="flex flex-wrap gap-2">
          {(q.options ?? []).map((o) => {
            const selected = draft.values.includes(o.value);
            return (
              <Button
                key={o.value}
                type="button"
                size="sm"
                variant={selected ? "default" : "outline"}
                aria-pressed={selected}
                onClick={() => toggle(o.value)}
              >
                {o.label}
              </Button>
            );
          })}
        </div>
      ) : (
        <div className="space-y-1">
          {(q.options ?? []).map((o) => {
            const id = `${fieldId}-${o.value}`;
            return (
              <div key={o.value} className="flex items-center gap-2">
                <Checkbox
                  id={id}
                  checked={draft.values.includes(o.value)}
                  onCheckedChange={() => toggle(o.value)}
                />
                <Label htmlFor={id} className="font-normal">
                  {o.label}
                </Label>
              </div>
            );
          })}
        </div>
      )}
      {q.allowOther && (
        <Input
          aria-label={`Otro: ${q.prompt}`}
          placeholder="Otro…"
          value={draft.text}
          maxLength={MAX_ANSWER_TEXT}
          className="h-8"
          onChange={(e) =>
            onChange({
              values: q.kind === "single" && e.target.value ? [] : draft.values,
              text: e.target.value,
            })
          }
        />
      )}
    </fieldset>
  );
}
