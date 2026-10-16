import { z } from "zod";

export const WORKFLOW_CADENCES = ["daily", "weekly", "monthly"] as const;
export type WorkflowCadence = (typeof WORKFLOW_CADENCES)[number];

export const CADENCE_LABEL: Record<WorkflowCadence, string> = {
  daily: "Todos los días",
  weekly: "Todas las semanas",
  monthly: "Todos los meses",
};

/** ISO weekdays as the select offers them (strings: the Modify dialog's
 *  select keeps string values). */
export const WEEKDAYS = ["1", "2", "3", "4", "5", "6", "7"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export const WEEKDAY_LABEL: Record<Weekday, string> = {
  "1": "lunes",
  "2": "martes",
  "3": "miércoles",
  "4": "jueves",
  "5": "viernes",
  "6": "sábado",
  "7": "domingo",
};

export const RUN_MINUTES = [0, 15, 30, 45] as const;

/** "HH:MM" on the cron's 15-minute grid, Buenos Aires local time. */
export const runTimeSchema = z
  .string()
  .trim()
  .regex(/^([01]\d|2[0-3]):(00|15|30|45)$/, {
    message: "Hora inválida: usá HH:MM en intervalos de 15 minutos.",
  });

/** An empty select or number input (the Modify dialog sends "" or NaN). */
const emptyToNull = (v: unknown) =>
  v === "" || v === undefined || (typeof v === "number" && Number.isNaN(v))
    ? null
    : v;

/**
 * A recurring AI task as the proposal card and the dialog both submit it.
 * `weekday` only for weekly, `monthDay` (1–28, every month has it) only for
 * monthly; the database checks the same shape.
 */
export const AiWorkflowDraftSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, { message: "Poné un nombre." })
      .max(120, { message: "Máximo 120 caracteres." }),
    prompt: z
      .string()
      .trim()
      .min(10, { message: "Describí la tarea (mínimo 10 caracteres)." })
      .max(2000, { message: "Máximo 2000 caracteres." }),
    cadence: z.enum(WORKFLOW_CADENCES),
    runTime: runTimeSchema,
    weekday: z.preprocess(emptyToNull, z.enum(WEEKDAYS).nullable()),
    monthDay: z.preprocess(
      emptyToNull,
      z.coerce
        .number()
        .int()
        .min(1, { message: "Día del mes entre 1 y 28." })
        .max(28, { message: "Día del mes entre 1 y 28." })
        .nullable(),
    ),
  })
  .superRefine((d, ctx) => {
    if (d.cadence === "weekly" && d.weekday === null) {
      ctx.addIssue({
        code: "custom",
        path: ["weekday"],
        message: "Elegí el día de la semana.",
      });
    }
    if (d.cadence === "monthly" && d.monthDay === null) {
      ctx.addIssue({
        code: "custom",
        path: ["monthDay"],
        message: "Elegí el día del mes.",
      });
    }
  })
  .transform((d) => ({
    ...d,
    weekday: d.cadence === "weekly" ? d.weekday : null,
    monthDay: d.cadence === "monthly" ? d.monthDay : null,
  }));

export type AiWorkflowDraft = z.output<typeof AiWorkflowDraftSchema>;
export type AiWorkflowDraftInput = z.input<typeof AiWorkflowDraftSchema>;

/** The schedule as stored (ai_workflows columns). */
export type WorkflowSchedule = {
  cadence: WorkflowCadence;
  runHour: number;
  runMinute: number;
  /** ISO weekday 1–7, weekly only. */
  weekday: number | null;
  /** 1–28, monthly only. */
  monthDay: number | null;
};

export function draftSchedule(draft: AiWorkflowDraft): WorkflowSchedule {
  const [hour, minute] = draft.runTime.split(":").map(Number);
  return {
    cadence: draft.cadence,
    runHour: hour ?? 0,
    runMinute: minute ?? 0,
    weekday: draft.weekday === null ? null : Number(draft.weekday),
    monthDay: draft.monthDay,
  };
}

function isWeekday(value: string): value is Weekday {
  return WEEKDAYS.some((w) => w === value);
}

/** "Todos los lunes a las 08:00", in Buenos Aires time. */
export function describeSchedule(s: WorkflowSchedule): string {
  const time = `${String(s.runHour).padStart(2, "0")}:${String(s.runMinute).padStart(2, "0")}`;
  if (s.cadence === "weekly" && s.weekday !== null) {
    const key = String(s.weekday);
    const day = isWeekday(key) ? WEEKDAY_LABEL[key] : key;
    return `Todos los ${day} a las ${time}`;
  }
  if (s.cadence === "monthly" && s.monthDay !== null) {
    return `Todos los meses, el día ${s.monthDay}, a las ${time}`;
  }
  return `Todos los días a las ${time}`;
}

export const RUN_STATUSES = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "skipped",
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const RUN_STATUS_LABEL: Record<RunStatus, string> = {
  queued: "En cola",
  running: "Corriendo",
  succeeded: "Lista",
  failed: "Falló",
  skipped: "Salteada",
};

export const SKIP_REASON_LABEL: Record<string, string> = {
  user_disabled: "El usuario está deshabilitado.",
  permission_revoked: "El usuario ya no tiene acceso al asistente.",
  headless_unavailable: "Las tareas en segundo plano no están configuradas.",
  daily_cap: "Se alcanzó el límite diario de IA.",
  workflow_paused: "La tarea estaba pausada.",
  expired: "No llegó a correr a tiempo.",
};

export const WorkflowIdSchema = z.object({ id: z.uuid() });

export const SetWorkflowActiveSchema = z.object({
  id: z.uuid(),
  active: z.boolean(),
});
