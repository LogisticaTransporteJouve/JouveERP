"use client";

import {
  CalendarClock,
  HandCoins,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { Suspense, useMemo, useState } from "react";
import { toast } from "sonner";

import { ChannelsReadError } from "@/components/channels-read-error";
import { DisabledHint, firstReason } from "@/components/disabled-hint";
import {
  useDefaultChannel,
  useScope,
} from "@/components/providers/scope-provider";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { MoneyInput } from "@/components/money-input";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AccountOptionsGate } from "@/features/accounts/components/account-options-gate";
import { isCheckAccount, type Account } from "@/features/accounts/schema";
import { formatMoneyWithCode, parseArAmount, todayInAR } from "@/lib/format";

import { useRecordAccountCash } from "../hooks/use-employee-account";
import { useEmployeesList } from "../hooks/use-employees";
import { loanInstallments, type DebtPlan } from "../account-schema";

/** advance: discounted whole in the month's planilla; loan: in cuotas. Both
 *  are an "advance" movement with its plan; they differ in the cuota. */
type CashKind = "advance" | "loan" | "payment";

const TITLE: Record<CashKind, string> = {
  advance: "Adelanto a empleado",
  loan: "Préstamo a empleado",
  payment: "Pago del empleado",
};

const ICON: Record<CashKind, LucideIcon> = {
  advance: Wallet,
  loan: CalendarClock,
  payment: HandCoins,
};

const DESCRIPTION: Record<CashKind, string> = {
  advance:
    "Sale de la cuenta elegida y va a la cuenta corriente del empleado (no es un gasto). Se descuenta entero en la planilla del mes de la fecha.",
  loan: "Sale de la cuenta elegida y va a la cuenta corriente del empleado (no es un gasto). Se descuenta en la planilla en cuotas mensuales, desde el mes de la fecha.",
  payment: "Entra en la cuenta elegida y baja lo que el empleado debe.",
};

const NONE = "__none__";

/**
 * "Adelanto a empleado" (egreso de caja) or "Pago del empleado" (ingreso): a
 * treasury movement that goes to the employee's current account, not to
 * cost. Opened from Tesorería / Caja (employee picked here) or from the
 * employee's card (fixed). The currency is the account's.
 */
export function EmployeeCashDialog({
  kind,
  employeeId,
  employeeName,
  plans = [],
  trigger,
}: {
  kind: CashKind;
  employeeId?: string;
  employeeName?: string;
  /** The employee's plans, to credit a payment to one. */
  plans?: DebtPlan[];
  trigger?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const Icon = ICON[kind];
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline">
            <Icon className="size-4" />
            {TITLE[kind]}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {TITLE[kind]}
            {employeeName ? ` — ${employeeName}` : ""}
          </DialogTitle>
          <DialogDescription>{DESCRIPTION[kind]}</DialogDescription>
        </DialogHeader>
        {open && (
          <Suspense
            fallback={
              <div className="py-6 text-center text-sm text-muted-foreground">
                Cargando…
              </div>
            }
          >
            {employeeId ? (
              <CashForm
                kind={kind}
                employeeId={employeeId}
                employeeName={employeeName}
                plans={plans}
                onDone={() => setOpen(false)}
              />
            ) : (
              <PickEmployeeThenForm kind={kind} onDone={() => setOpen(false)} />
            )}
          </Suspense>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PickEmployeeThenForm({
  kind,
  onDone,
}: {
  kind: CashKind;
  onDone: () => void;
}) {
  const { data: employees } = useEmployeesList();
  const active = useMemo(
    () => employees.filter((e) => e.is_active),
    [employees],
  );
  const [employeeId, setEmployeeId] = useState("");
  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor="cash-employee">Empleado</Label>
        <Select value={employeeId} onValueChange={setEmployeeId}>
          <SelectTrigger id="cash-employee">
            <SelectValue placeholder="Elegí el empleado" />
          </SelectTrigger>
          <SelectContent>
            {active.map((e) => (
              <SelectItem key={e.id} value={e.id}>
                {e.legal_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {employeeId ? (
        <CashForm
          key={employeeId}
          kind={kind}
          employeeId={employeeId}
          employeeName={active.find((e) => e.id === employeeId)?.legal_name}
          plans={[]}
          onDone={onDone}
        />
      ) : null}
    </div>
  );
}

type CashFormProps = {
  kind: CashKind;
  employeeId: string;
  employeeName?: string;
  plans: DebtPlan[];
  onDone: () => void;
};

function CashForm(props: CashFormProps) {
  return (
    <AccountOptionsGate>
      {(accounts) => <CashFormFields {...props} accounts={accounts} />}
    </AccountOptionsGate>
  );
}

function CashFormFields({
  kind,
  employeeId,
  employeeName,
  plans,
  onDone,
  accounts,
}: CashFormProps & { accounts: Account[] }) {
  const { channels } = useScope();
  const defaultChannel = useDefaultChannel();
  const mutation = useRecordAccountCash(employeeId);

  const usable = useMemo(
    () => accounts.filter((a) => a.is_active && !isCheckAccount(a.type)),
    [accounts],
  );
  const activeChannels = channels.filter((c) => c.is_active);

  const [accountId, setAccountId] = useState(usable[0]?.id ?? "");
  const [channelId, setChannelId] = useState(defaultChannel ?? "");
  const [date, setDate] = useState(todayInAR());
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [installment, setInstallment] = useState("");
  const [planId, setPlanId] = useState(NONE);

  const account = usable.find((a) => a.id === accountId);
  const currency = account?.currency ?? "ARS";
  const plansForPayment = plans.filter(
    (p) => p.currency === currency && p.remaining > 0,
  );

  function parse(v: string): number {
    return parseArAmount(v) ?? Number.NaN;
  }

  const amountValue = parse(amount);
  const installmentValue = parse(installment);
  const cuotas =
    kind === "loan" ? loanInstallments(amountValue, installmentValue) : null;
  const loanIssue =
    kind !== "loan"
      ? null
      : !(installmentValue > 0)
        ? "Cargá la cuota mensual."
        : amountValue > 0 && installmentValue >= amountValue
          ? "La cuota tiene que ser menor que el préstamo: si se descuenta entero en un mes, es un adelanto."
          : null;

  function onSave() {
    if (!Number.isFinite(amountValue) || amountValue <= 0) {
      toast.error("Importe inválido.");
      return;
    }
    if (loanIssue) {
      toast.error(loanIssue);
      return;
    }
    mutation.mutate(
      {
        employee_id: employeeId,
        kind: kind === "payment" ? "payment" : "advance",
        account_id: accountId,
        channel_id: channelId,
        date,
        amount: amountValue,
        description:
          kind === "loan" && description.trim() === "" && employeeName
            ? `Préstamo a ${employeeName}`
            : description,
        plan_id: kind === "payment" && planId !== NONE ? planId : null,
        installment_amount:
          kind === "advance"
            ? amountValue
            : kind === "loan"
              ? installmentValue
              : null,
      },
      {
        onSuccess: () => {
          toast.success(
            kind === "payment"
              ? "Pago registrado."
              : kind === "loan"
                ? "Préstamo registrado."
                : "Adelanto registrado.",
          );
          onDone();
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  if (usable.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No hay cajas ni bancos activos. Creá o activá una cuenta en Tesorería.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="cash-account">Cuenta</Label>
          <Select value={accountId} onValueChange={setAccountId}>
            <SelectTrigger id="cash-account">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {usable.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name} ({a.currency})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="cash-channel">Canal</Label>
          <Select value={channelId} onValueChange={setChannelId}>
            <SelectTrigger id="cash-channel">
              <SelectValue placeholder="Elegí el canal" />
            </SelectTrigger>
            <SelectContent>
              {activeChannels.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <ChannelsReadError inline />
        </div>
        <div className="space-y-2">
          <Label htmlFor="cash-date">Fecha</Label>
          <DatePicker id="cash-date" value={date} onChange={setDate} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="cash-amount">Importe ({currency})</Label>
          <MoneyInput
            id="cash-amount"
            className="text-right font-mono"
            value={amount}
            onChange={setAmount}
          />
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="cash-description">Descripción (opcional)</Label>
          <Input
            id="cash-description"
            placeholder={
              kind === "advance"
                ? "Ej. adelanto de sueldo"
                : kind === "loan"
                  ? "Ej. préstamo personal"
                  : "Ej. devolución"
            }
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
      </div>

      {kind === "loan" && (
        <div className="space-y-2 rounded-md border p-3">
          <Label htmlFor="cash-installment">Cuota mensual</Label>
          <MoneyInput
            id="cash-installment"
            className="text-right font-mono"
            value={installment}
            onChange={setInstallment}
          />
          {cuotas && (
            <p className="text-xs text-muted-foreground">
              {cuotas.count} cuotas de{" "}
              {formatMoneyWithCode(installmentValue, currency)}
              {cuotas.last !== installmentValue &&
                ` (la última de ${formatMoneyWithCode(cuotas.last, currency)})`}
              .
            </p>
          )}
          {currency !== "ARS" && (
            <p className="text-xs text-muted-foreground">
              La planilla solo descuenta planes en pesos: uno en dólares se
              salda con pagos del empleado.
            </p>
          )}
        </div>
      )}

      {kind === "advance" && currency !== "ARS" && (
        <p className="text-xs text-muted-foreground">
          La planilla solo descuenta planes en pesos: un adelanto en dólares se
          salda con pagos del empleado.
        </p>
      )}

      {kind === "payment" && plansForPayment.length > 0 && (
        <div className="space-y-2">
          <Label htmlFor="cash-plan">Imputar a un plan (opcional)</Label>
          <Select value={planId} onValueChange={setPlanId}>
            <SelectTrigger id="cash-plan">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Sin plan</SelectItem>
              {plansForPayment.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.description}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          onClick={onDone}
          disabled={mutation.isPending}
        >
          Cancelar
        </Button>
        <DisabledHint
          reason={firstReason(
            [!accountId, "Elegí la cuenta."],
            [!channelId, "Elegí el canal."],
            [loanIssue !== null, loanIssue ?? ""],
          )}
        >
          <Button
            onClick={onSave}
            disabled={
              mutation.isPending ||
              !accountId ||
              !channelId ||
              loanIssue !== null
            }
          >
            {mutation.isPending ? "Guardando…" : "Registrar"}
          </Button>
        </DisabledHint>
      </DialogFooter>
    </div>
  );
}
