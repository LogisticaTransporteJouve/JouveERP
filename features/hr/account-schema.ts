import { z } from "zod";

// Cuenta corriente del empleado (decision D1): movements, debt plans, salary
// raises and trip extras. The database owns the balances and the planilla
// discount; these schemas only validate what the forms send.

export const ACCOUNT_CURRENCIES = ["ARS", "USD"] as const;
export type AccountCurrency = (typeof ACCOUNT_CURRENCIES)[number];

export function isAccountCurrency(value: unknown): value is AccountCurrency {
  return (
    typeof value === "string" &&
    (ACCOUNT_CURRENCIES as readonly string[]).includes(value)
  );
}

// ─── Movements ───────────────────────────────────────────────────────────────

export const ACCOUNT_MOVEMENT_KINDS = [
  "advance",
  "charge",
  "payroll_discount",
  "payment",
  "forgiveness",
] as const;
export type AccountMovementKind = (typeof ACCOUNT_MOVEMENT_KINDS)[number];

export const ACCOUNT_MOVEMENT_KIND_LABEL: Record<AccountMovementKind, string> =
  {
    advance: "Adelanto",
    charge: "Cargo",
    payroll_discount: "Descuento de planilla",
    payment: "Pago",
    forgiveness: "Condonación",
  };

export function isAccountMovementKind(
  value: unknown,
): value is AccountMovementKind {
  return (
    typeof value === "string" &&
    (ACCOUNT_MOVEMENT_KINDS as readonly string[]).includes(value)
  );
}

/** Advances and charges add to what the employee owes; the rest subtract. */
export function isDebitKind(kind: AccountMovementKind): boolean {
  return kind === "advance" || kind === "charge";
}

export const CREDITORS = ["empresa", "socio"] as const;
export type Creditor = (typeof CREDITORS)[number];

export const CREDITOR_LABEL: Record<Creditor, string> = {
  empresa: "Empresa",
  socio: "Socio",
};

export function isCreditor(value: unknown): value is Creditor {
  return (
    typeof value === "string" &&
    (CREDITORS as readonly string[]).includes(value)
  );
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida.");
const positiveMoney = z.coerce
  .number()
  .positive("El importe tiene que ser mayor a 0.")
  .max(999999999.99);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v.length === 0 ? null : v))
    .nullable()
    .optional();

/** A charge or a payment typed by hand (no cash movement): a debt to a
 *  partner, an opening balance, a payment received outside the company. */
export const CreateManualMovementSchema = z.object({
  employee_id: z.string().uuid(),
  kind: z.enum(["charge", "payment"]),
  currency: z.enum(ACCOUNT_CURRENCIES),
  amount: positiveMoney,
  movement_date: isoDate,
  description: z
    .string()
    .trim()
    .min(1, "Describí el movimiento.")
    .max(200, "Máximo 200 caracteres."),
  creditor: z.enum(CREDITORS).default("empresa"),
  plan_id: z.string().uuid().nullable().optional(),
});

export type CreateManualMovementInput = z.input<
  typeof CreateManualMovementSchema
>;

/** An advance paid from a cash or bank account, or a cash payment by the
 *  employee. The currency is the account's. */
export const RecordAccountCashSchema = z
  .object({
    employee_id: z.string().uuid(),
    kind: z.enum(["advance", "payment"]),
    account_id: z.string().uuid("Elegí la cuenta."),
    channel_id: z.string().min(1, "Elegí el canal."),
    date: isoDate,
    amount: positiveMoney,
    description: optionalText(200),
    plan_id: z.string().uuid().nullable().optional(),
    installment_amount: positiveMoney.nullable().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.plan_id && v.kind !== "payment") {
      ctx.addIssue({
        code: "custom",
        path: ["plan_id"],
        message:
          "Un adelanto abre su propio plan; solo un pago se imputa a un plan.",
      });
    }
    if (v.installment_amount != null && v.kind !== "advance") {
      ctx.addIssue({
        code: "custom",
        path: ["installment_amount"],
        message: "Solo un adelanto abre un plan en cuotas.",
      });
    }
    if (v.installment_amount != null && v.installment_amount > v.amount) {
      ctx.addIssue({
        code: "custom",
        path: ["installment_amount"],
        message: "La cuota no puede superar el adelanto.",
      });
    }
  });

export type RecordAccountCashInput = z.input<typeof RecordAccountCashSchema>;

export const DeleteAccountMovementSchema = z.object({ id: z.string().uuid() });

export const UpdateAccountMovementSchema = z.object({
  id: z.string().uuid(),
  description: z
    .string()
    .trim()
    .min(1, "Describí el movimiento.")
    .max(200, "Máximo 200 caracteres."),
});

export type AccountMovement = {
  id: string;
  employee_id: string;
  kind: AccountMovementKind;
  currency: AccountCurrency;
  amount: number;
  movement_date: string;
  description: string;
  creditor: Creditor;
  plan_id: string | null;
  plan_description: string | null;
  transaction_id: string | null;
  purchase_invoice_id: string | null;
  payroll_entry_id: string | null;
  /** The rendición whose difference it posted. */
  driver_settlement_id: string | null;
  /** Paid with a card statement: undone from the statement. */
  card_statement: boolean;
};

/** Where a movement comes from, for what the card lets the user do. */
export function movementSource(
  m: Pick<
    AccountMovement,
    | "kind"
    | "transaction_id"
    | "purchase_invoice_id"
    | "payroll_entry_id"
    | "driver_settlement_id"
    | "card_statement"
  >,
):
  | "cash"
  | "card"
  | "purchase"
  | "payroll"
  | "settlement"
  | "forgiveness"
  | "manual" {
  if (m.card_statement) return "card";
  if (m.payroll_entry_id) return "payroll";
  if (m.driver_settlement_id) return "settlement";
  if (m.purchase_invoice_id) return "purchase";
  if (m.kind === "forgiveness") return "forgiveness";
  if (m.transaction_id) return "cash";
  return "manual";
}

export type AccountBalance = {
  currency: AccountCurrency;
  /** Positive: the employee owes. */
  balance: number;
  /** The part owed to a partner. */
  balance_socio: number;
  movements: number;
};

// ─── Debt plans ──────────────────────────────────────────────────────────────

export const PLAN_STATUSES = [
  "activo",
  "pausado",
  "cancelado",
  "condonado",
] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

export const PLAN_STATUS_LABEL: Record<PlanStatus, string> = {
  activo: "Activo",
  pausado: "Pausado",
  cancelado: "Cancelado",
  condonado: "Condonado",
};

export function isPlanStatus(value: unknown): value is PlanStatus {
  return (
    typeof value === "string" &&
    (PLAN_STATUSES as readonly string[]).includes(value)
  );
}

const monthStart = z
  .string()
  .regex(/^\d{4}-\d{2}$/, "Mes inválido.")
  .transform((v) => `${v}-01`);

const planFields = z.object({
  description: z
    .string()
    .trim()
    .min(1, "Describí la deuda.")
    .max(200, "Máximo 200 caracteres."),
  total: positiveMoney,
  installment_amount: positiveMoney,
  start_month: monthStart,
  creditor: z.enum(CREDITORS).default("empresa"),
  creditor_name: optionalText(120),
  notes: optionalText(500),
});

function refinePlan(v: z.infer<typeof planFields>, ctx: z.RefinementCtx) {
  if (v.installment_amount > v.total) {
    ctx.addIssue({
      code: "custom",
      path: ["installment_amount"],
      message: "La cuota no puede superar el total.",
    });
  }
}

export const CreateDebtPlanSchema = planFields
  .extend({
    employee_id: z.string().uuid(),
    currency: z.enum(ACCOUNT_CURRENCIES),
  })
  .superRefine(refinePlan);

export const UpdateDebtPlanSchema = planFields
  .extend({ id: z.string().uuid() })
  .superRefine(refinePlan);

export const SetDebtPlanStatusSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(PLAN_STATUSES),
});

export const DeleteDebtPlanSchema = z.object({ id: z.string().uuid() });

export type CreateDebtPlanInput = z.input<typeof CreateDebtPlanSchema>;

export type DebtPlan = {
  id: string;
  employee_id: string;
  description: string;
  currency: AccountCurrency;
  total: number;
  installment_amount: number;
  /** First day of the first month the planilla discounts it. */
  start_month: string;
  status: PlanStatus;
  creditor: Creditor;
  creditor_name: string | null;
  notes: string | null;
  paid: number;
  remaining: number;
};

/** A debt the company gave in cash: an adelanto is discounted whole in one
 *  planilla, a préstamo in monthly cuotas. Read from the plan, not stored:
 *  a plan whose cuota covers its total is paid in one month. */
export type DebtKind = "advance" | "loan";

export const DEBT_KIND_LABEL: Record<DebtKind, string> = {
  advance: "Adelanto",
  loan: "Préstamo",
};

export function debtPlanKind(
  plan: Pick<DebtPlan, "total" | "installment_amount">,
): DebtKind {
  return plan.installment_amount >= plan.total ? "advance" : "loan";
}

/** The cuotas a préstamo takes: whole ones plus a smaller last one. */
export function loanInstallments(
  total: number,
  installment: number,
): { count: number; last: number } | null {
  if (!(total > 0) || !(installment > 0) || installment >= total) return null;
  const whole = Math.floor(total / installment);
  const rest = Math.round((total - whole * installment) * 100) / 100;
  return rest > 0
    ? { count: whole + 1, last: rest }
    : { count: whole, last: installment };
}

/** What the planilla discounts for the plan this month (ARS plans only). */
export function planInstallmentDue(
  plan: Pick<
    DebtPlan,
    "status" | "currency" | "installment_amount" | "remaining" | "start_month"
  >,
  year: number,
  month: number,
): number {
  const first = `${year}-${String(month).padStart(2, "0")}-01`;
  if (
    plan.status !== "activo" ||
    plan.currency !== "ARS" ||
    plan.start_month > first ||
    plan.remaining <= 0
  ) {
    return 0;
  }
  return Math.min(plan.installment_amount, plan.remaining);
}

// ─── Salary raises (aumentos en %) ───────────────────────────────────────────

export const RAISE_SCOPES = ["all", "position", "convenio"] as const;
export type RaiseScope = (typeof RAISE_SCOPES)[number];

export const RAISE_SCOPE_LABEL: Record<RaiseScope, string> = {
  all: "Todos los empleados",
  position: "Por puesto",
  convenio: "Por convenio",
};

export const ApplySalaryRaiseSchema = z.object({
  employee_ids: z
    .array(z.string().uuid())
    .min(1, "Elegí al menos un empleado.")
    .max(500),
  percentage: z.coerce
    .number()
    .positive("El aumento tiene que ser mayor a 0%.")
    .max(100, "El aumento no puede superar 100%."),
  effective_month: monthStart,
  reason: optionalText(200),
});

export type ApplySalaryRaiseInput = z.input<typeof ApplySalaryRaiseSchema>;

export type RaiseCandidate = {
  id: string;
  legal_name: string;
  position: string | null;
  convenio: string | null;
  base_salary: number | null;
  pay_mode: "recibo" | "acordado";
};

/** The employees a raise reaches: active ones with a base salary and a
 *  sueldo acordado (a «por recibo» salary comes with the next recibo; the
 *  database skips them too), filtered by position or convenio (case- and
 *  space-insensitive). */
export function raiseTargets<T extends RaiseCandidate>(
  employees: readonly T[],
  scope: RaiseScope,
  value: string,
): T[] {
  const norm = (v: string | null) => (v ?? "").trim().toLowerCase();
  const wanted = norm(value);
  if (scope !== "all" && wanted === "") return [];
  return employees.filter((e) => {
    if (e.base_salary === null || e.base_salary <= 0) return false;
    if (e.pay_mode === "recibo") return false;
    if (scope === "position") return norm(e.position) === wanted;
    if (scope === "convenio") return norm(e.convenio) === wanted;
    return true;
  });
}

/** The raised salary, rounded to cents like apply_salary_raise. */
export function raisedSalary(base: number, percentage: number): number {
  return Math.round(base * (1 + percentage / 100) * 100) / 100;
}

export type SalaryChange = {
  id: string;
  effective_month: string;
  previous_salary: number | null;
  new_salary: number | null;
  raise_percentage: number | null;
  reason: string | null;
  created_at: string;
};

// ─── Trip extras (extras desde viajes) ───────────────────────────────────────

export const TripRatesSchema = z.object({
  employee_id: z.string().uuid(),
  trip_rate_per_day: z.coerce.number().min(0).max(999999999.99).nullable(),
  trip_rate_per_km: z.coerce.number().min(0).max(999999999.99).nullable(),
  trip_rate_per_unload: z.coerce.number().min(0).max(999999999.99).nullable(),
});

export type TripRates = {
  trip_rate_per_day: number | null;
  trip_rate_per_km: number | null;
  trip_rate_per_unload: number | null;
};

export type TripForExtras = {
  id: string;
  trip_date: string;
  km: number | null;
  origin: string | null;
  destination: string | null;
  /** Delivered shipments (one unloading each). */
  unloads: number;
};

export type TripExtraLine = {
  concept: "jornadas" | "km" | "descargas";
  description: string;
  quantity: number;
  rate: number;
  amount: number;
};

export type TripExtrasSuggestion = {
  employee_id: string;
  trips: TripForExtras[];
  days: number;
  km: number;
  unloads: number;
  lines: TripExtraLine[];
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const fmtQty = (n: number) =>
  Number.isInteger(n)
    ? String(n)
    : n.toLocaleString("es-AR", { maximumFractionDigits: 2 });

/**
 * The month's extras from the driver's completed trips: one line per concept
 * with a rate (jornadas = distinct trip days, km = the trips' km, descargas =
 * delivered shipments). A concept without rate or quantity gives no line.
 */
export function tripExtrasLines(
  trips: readonly TripForExtras[],
  rates: TripRates,
  periodLabel: string,
): Pick<TripExtrasSuggestion, "days" | "km" | "unloads" | "lines"> {
  const days = new Set(trips.map((t) => t.trip_date)).size;
  const km = round2(trips.reduce((s, t) => s + (t.km ?? 0), 0));
  const unloads = trips.reduce((s, t) => s + t.unloads, 0);
  const lines: TripExtraLine[] = [];
  const push = (
    concept: TripExtraLine["concept"],
    label: string,
    quantity: number,
    rate: number | null,
  ) => {
    if (rate === null || rate <= 0 || quantity <= 0) return;
    lines.push({
      concept,
      description: `Viajes ${periodLabel}: ${fmtQty(quantity)} ${label}`,
      quantity,
      rate,
      amount: round2(quantity * rate),
    });
  };
  push("jornadas", "jornadas", days, rates.trip_rate_per_day);
  push("km", "km", km, rates.trip_rate_per_km);
  push("descargas", "descargas", unloads, rates.trip_rate_per_unload);
  return { days, km, unloads, lines };
}
