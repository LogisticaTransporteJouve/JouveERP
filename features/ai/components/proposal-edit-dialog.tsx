"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

import { useReviseAiProposal } from "../hooks/use-ai-confirmations";
import type { AiConfirmation } from "../lib/confirmation-schema";
import {
  fieldInputText,
  fieldInputValue,
  formatFieldInput,
  type ProposalSpec,
} from "../lib/proposal-specs";

/**
 * Edits a pending proposal's editable fields in a centered dialog. The edit is
 * checked with the form's own schema here and again on the server, and saved
 * as the card's next revision.
 */
export function ProposalEditDialog({
  open,
  onOpenChange,
  sessionId,
  confirmation,
  spec,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionId: string;
  confirmation: AiConfirmation;
  spec: ProposalSpec;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Modificar propuesta</DialogTitle>
          <DialogDescription>{spec.title}</DialogDescription>
        </DialogHeader>
        {open && (
          <EditForm
            key={confirmation.id}
            sessionId={sessionId}
            confirmation={confirmation}
            spec={spec}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function EditForm({
  sessionId,
  confirmation,
  spec,
  onDone,
}: {
  sessionId: string;
  confirmation: AiConfirmation;
  spec: ProposalSpec;
  onDone: () => void;
}) {
  const revise = useReviseAiProposal(sessionId);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      spec.fields.map((f) => [f.key, fieldInputText(confirmation.draft, f)]),
    ),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const edit: Record<string, unknown> = {};
    for (const f of spec.fields)
      edit[f.key] = fieldInputValue(f, values[f.key] ?? "");
    const base =
      typeof confirmation.draft === "object" && confirmation.draft !== null
        ? confirmation.draft
        : {};
    const checked = spec.validate({ ...base, ...edit }, confirmation.labels);
    if (!checked.ok) {
      const next: Record<string, string> = {};
      for (const issue of checked.issues) {
        const key = spec.fields.some((f) => f.key === issue.field)
          ? issue.field
          : "_form";
        next[key] ??= issue.message;
      }
      setErrors(next);
      return;
    }
    revise.mutate(
      { id: confirmation.id, draft: edit },
      {
        onSuccess: onDone,
        onError: (err) => toast.error(err.message),
      },
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {spec.fields.map((f) => {
        const id = `edit-${f.key}`;
        const value = values[f.key] ?? "";
        const set = (next: string) => {
          setErrors((prev) => ({ ...prev, [f.key]: "", _form: "" }));
          setValues((prev) => ({ ...prev, [f.key]: next }));
        };
        return (
          <div key={f.key} className="space-y-1">
            <Label htmlFor={id}>{f.label}</Label>
            {f.kind === "date" ? (
              <DatePicker id={id} value={value} onChange={set} />
            ) : f.kind === "select" ? (
              <Select value={value} onValueChange={set}>
                <SelectTrigger id={id} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(f.options ?? []).map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : f.kind === "textarea" ? (
              <Textarea
                id={id}
                value={value}
                onChange={(e) => set(e.target.value)}
              />
            ) : (
              <Input
                id={id}
                value={value}
                inputMode={f.kind === "number" ? "decimal" : undefined}
                onChange={(e) => set(formatFieldInput(f, e.target.value))}
              />
            )}
            {errors[f.key] && (
              <p className="text-xs font-medium">{errors[f.key]}</p>
            )}
          </div>
        );
      })}
      {errors._form && <p className="text-xs font-medium">{errors._form}</p>}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancelar
        </Button>
        <Button type="submit" disabled={revise.isPending}>
          {revise.isPending ? "Guardando…" : "Guardar cambios"}
        </Button>
      </DialogFooter>
    </form>
  );
}
