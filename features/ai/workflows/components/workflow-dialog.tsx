"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
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

import { useCreateAiWorkflow } from "../hooks/use-ai-workflows";
import {
  AiWorkflowDraftSchema,
  CADENCE_LABEL,
  RUN_MINUTES,
  WEEKDAY_LABEL,
  WEEKDAYS,
  WORKFLOW_CADENCES,
  type WorkflowCadence,
} from "../schema";

const TIME_OPTIONS = Array.from({ length: 24 }, (_, h) =>
  RUN_MINUTES.map(
    (m) => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`,
  ),
).flat();

const MONTH_DAYS = Array.from({ length: 28 }, (_, i) => String(i + 1));

type FormState = {
  title: string;
  prompt: string;
  cadence: WorkflowCadence;
  runTime: string;
  weekday: string;
  monthDay: string;
};

const INITIAL: FormState = {
  title: "",
  prompt: "",
  cadence: "weekly",
  runTime: "08:00",
  weekday: "1",
  monthDay: "1",
};

function isCadence(value: string): value is WorkflowCadence {
  return WORKFLOW_CADENCES.some((c) => c === value);
}

/** Creates a recurring AI task (same schema as the assistant's proposal). */
export function WorkflowDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const create = useCreateAiWorkflow();
  const [form, setForm] = useState<FormState>(INITIAL);
  const [error, setError] = useState("");

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setError("");
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = AiWorkflowDraftSchema.safeParse({
      ...form,
      weekday: form.cadence === "weekly" ? form.weekday : null,
      monthDay: form.cadence === "monthly" ? form.monthDay : null,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Datos inválidos.");
      return;
    }
    create.mutate(parsed.data, {
      onSuccess: () => {
        toast.success("Tarea programada.");
        setForm(INITIAL);
        onOpenChange(false);
      },
      onError: (err) => toast.error(err.message),
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Nueva tarea de IA</DialogTitle>
          <DialogDescription>
            El asistente la corre solo, con tus permisos de lectura, y deja el
            resultado acá. Horario de Buenos Aires.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="wf-title">Nombre</Label>
            <Input
              id="wf-title"
              value={form.title}
              placeholder="Cobranzas vencidas"
              onChange={(e) => set("title", e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="wf-prompt">Qué tiene que hacer</Label>
            <Textarea
              id="wf-prompt"
              value={form.prompt}
              placeholder="Resumime las cobranzas vencidas por cliente y qué cambió desde la semana pasada."
              onChange={(e) => set("prompt", e.target.value)}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="wf-cadence">Frecuencia</Label>
              <Select
                value={form.cadence}
                onValueChange={(v) => {
                  if (isCadence(v)) set("cadence", v);
                }}
              >
                <SelectTrigger id="wf-cadence" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WORKFLOW_CADENCES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {CADENCE_LABEL[c]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="wf-time">Hora</Label>
              <Select
                value={form.runTime}
                onValueChange={(v) => set("runTime", v)}
              >
                <SelectTrigger id="wf-time" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIME_OPTIONS.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {form.cadence === "weekly" && (
              <div className="space-y-1">
                <Label htmlFor="wf-weekday">Día</Label>
                <Select
                  value={form.weekday}
                  onValueChange={(v) => set("weekday", v)}
                >
                  <SelectTrigger id="wf-weekday" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {WEEKDAYS.map((d) => (
                      <SelectItem key={d} value={d}>
                        {WEEKDAY_LABEL[d]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {form.cadence === "monthly" && (
              <div className="space-y-1">
                <Label htmlFor="wf-monthday">Día del mes</Label>
                <Select
                  value={form.monthDay}
                  onValueChange={(v) => set("monthDay", v)}
                >
                  <SelectTrigger id="wf-monthday" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MONTH_DAYS.map((d) => (
                      <SelectItem key={d} value={d}>
                        {d}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          {error && <p className="text-xs font-medium">{error}</p>}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? "Guardando…" : "Programar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
