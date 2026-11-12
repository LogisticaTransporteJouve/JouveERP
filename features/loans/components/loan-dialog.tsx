"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { ChannelsReadError } from "@/components/channels-read-error";
import { MoneyInput } from "@/components/money-input";
import { useScope } from "@/components/providers/scope-provider";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useAccountOptions } from "@/features/accounts/hooks/use-accounts";
import { formatArgentineDate, formatMoney, parseArAmount } from "@/lib/format";
import { generateInstallments } from "@/lib/loans/amortization";
import {
  fixedCapitalPlan,
  frenchPlanWith,
  parseBankPlan,
  withOpeningCuotas,
  type PlanInstallment,
} from "@/lib/loans/bank-plan";
import { positiveArAmountField } from "@/lib/validation/common";

import { useCreateLoan } from "../hooks/use-loans";
import { LOAN_KINDS, LOAN_KIND_LABEL } from "../schema";

const NONE = "__none__";

const rateField = z
  .string()
  .trim()
  .refine((v) => v === "" || parseArAmount(v) !== null, "Tasa inválida.");

const FormSchema = z.object({
  kind: z.enum(LOAN_KINDS),
  description: z.string().trim().min(1, "Descripción requerida.").max(200),
  lender: z.string().trim().max(200),
  loan_number: z.string().trim().max(60),
  account_id: z.string(),
  start_date: z.string(),
  principal: positiveArAmountField,
  currency: z.enum(["ARS", "USD"]),
  tna: rateField,
  tea: rateField,
  cft: rateField,
  installments_count: z.string(),
  first_due_date: z.string(),
  notes: z.string().trim().max(2000),
});

type FormValues = z.infer<typeof FormSchema>;

const DEFAULTS: FormValues = {
  kind: "prestamo",
  description: "",
  lender: "",
  loan_number: "",
  account_id: NONE,
  start_date: "",
  principal: "",
  currency: "ARS",
  tna: "",
  tea: "",
  cft: "",
  installments_count: "",
  first_due_date: "",
  notes: "",
};

/** How the cuotas are set: the bank's plan pasted, the French system or
 *  fixed capital (German) from the TNA, or equal parts of the capital. */
type PlanMode = "bank" | "french" | "fixed" | "equal";
const PLAN_MODES: readonly PlanMode[] = ["bank", "french", "fixed", "equal"];
const isPlanMode = (v: string): v is PlanMode =>
  PLAN_MODES.some((m) => m === v);

const rateOrNull = (v: string) => (v === "" ? null : parseArAmount(v));

export function LoanDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { channels } = useScope();
  // A loan is the company's debt: it goes to the fiscal channel.
  const fiscalChannel =
    channels.find((c) => c.is_active && c.is_fiscal)?.id ?? "";
  const { accounts } = useAccountOptions();
  const createMut = useCreateLoan();
  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: DEFAULTS,
  });
  const [mode, setMode] = useState<PlanMode>("bank");
  const [planText, setPlanText] = useState("");
  const [byDays, setByDays] = useState(false);
  const [separateInterest, setSeparateInterest] = useState(false);
  const [paidRaw, setPaidRaw] = useState("");
  const [openingRaw, setOpeningRaw] = useState("");
  const [openingTaxesRaw, setOpeningTaxesRaw] = useState("");

  useEffect(() => {
    if (!open) return;
    form.reset(DEFAULTS);
    setMode("bank");
    setPlanText("");
    setByDays(false);
    setSeparateInterest(false);
    setPaidRaw("");
    setOpeningRaw("");
    setOpeningTaxesRaw("");
  }, [open, form]);

  const [kind, currency, principalRaw, tnaRaw, countRaw, firstDue, startDate] =
    useWatch({
      control: form.control,
      name: [
        "kind",
        "currency",
        "principal",
        "tna",
        "installments_count",
        "first_due_date",
        "start_date",
      ],
    });

  const bankAccounts = accounts.filter(
    (a) =>
      a.is_active &&
      a.currency === currency &&
      (a.type === "bank" || a.type === "wallet"),
  );

  const pasted = useMemo(
    () => (planText.trim() === "" ? null : parseBankPlan(planText)),
    [planText],
  );

  // The cuotas the loan will have, shown before creating it.
  const plan: PlanInstallment[] | null = useMemo(() => {
    if (mode === "bank") return pasted?.ok ? pasted.rows : null;
    const principal = parseArAmount(principalRaw);
    const count = Number(countRaw);
    if (!principal || !Number.isInteger(count) || count < 1 || !firstDue) {
      return null;
    }
    const paidCount = Math.max(0, Math.trunc(Number(paidRaw) || 0));
    const opening = {
      count: Math.max(0, Math.trunc(Number(openingRaw) || 0)),
      date: startDate || firstDue,
      taxes: parseArAmount(openingTaxesRaw) ?? 0,
    };
    let base: PlanInstallment[];
    if (mode === "french" || mode === "fixed") {
      const tna = rateOrNull(tnaRaw);
      if (tna === null) return null;
      const options = { interestByDays: byDays, startDate: startDate || null };
      base =
        mode === "french"
          ? frenchPlanWith(principal, tna, count, firstDue, options)
          : fixedCapitalPlan(principal, tna, count, firstDue, {
              ...options,
              separateInterest,
            });
    } else {
      base = generateInstallments(principal, count, firstDue).map((g) => ({
        ...g,
        capital: g.amount,
        interest: 0,
        iva: 0,
        perception: 0,
        iva_perception: 0,
        other: 0,
        paid: false,
      }));
    }
    return withOpeningCuotas(base, opening, paidCount);
  }, [
    openingRaw,
    openingTaxesRaw,
    mode,
    pasted,
    principalRaw,
    countRaw,
    firstDue,
    tnaRaw,
    byDays,
    separateInterest,
    paidRaw,
    startDate,
  ]);

  function onSubmit(values: FormValues) {
    if (!plan) {
      toast.error(
        mode === "bank"
          ? "Pegá el plan de cuotas del banco."
          : "Completá las cuotas, la 1ª cuota" +
              (mode === "french" ? " y la TNA." : "."),
      );
      return;
    }
    const principal = parseArAmount(values.principal) ?? 0;
    createMut.mutate(
      {
        kind: values.kind,
        description: values.description,
        lender: values.lender,
        loan_number: values.loan_number,
        account_id: values.account_id === NONE ? null : values.account_id,
        start_date: values.start_date || null,
        principal,
        original_amount: principal,
        currency: values.currency,
        channel_id: fiscalChannel,
        tna: rateOrNull(values.tna),
        tea: rateOrNull(values.tea),
        cft: rateOrNull(values.cft),
        installments_count: plan.length,
        first_due_date: plan[0]?.due_date,
        notes: values.notes,
        // Equal parts carry no split: the DB keeps them as before.
        plan: mode === "equal" ? null : plan,
      },
      {
        onSuccess: () => {
          toast.success("Préstamo creado.");
          onOpenChange(false);
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  const paidBefore = plan?.filter((p) => p.paid).length ?? 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Nuevo préstamo, leasing o plan de ahorro</DialogTitle>
          <DialogDescription>
            Cargá los datos del préstamo como los muestra el banco y su plan de
            cuotas. Las cuotas que el banco da por pagadas quedan pagadas, sin
            movimiento en Caja.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <FormField
                control={form.control}
                name="kind"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tipo</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {LOAN_KINDS.map((k) => (
                          <SelectItem key={k} value={k}>
                            {LOAN_KIND_LABEL[k]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="currency"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Moneda</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="ARS">ARS</SelectItem>
                        <SelectItem value="USD">USD</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="lender"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Banco</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Banco Macro" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="loan_number"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Número de préstamo</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="7670122511" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            {kind === "plan_ahorro" && (
              <p className="text-muted-foreground text-sm">
                Las cuotas suman a Rodados en plan de ahorro; no hay desembolso.
              </p>
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Descripción</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Préstamo a Sola Firma" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="account_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Cuenta de débito</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value={NONE}>Ninguna</SelectItem>
                        {bankAccounts.map((a) => (
                          <SelectItem key={a.id} value={a.id}>
                            {a.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              <FormField
                control={form.control}
                name="start_date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Fecha de alta</FormLabel>
                    <FormControl>
                      <DatePicker {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="principal"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Monto original</FormLabel>
                    <FormControl>
                      <MoneyInput {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {(
                [
                  ["tna", "TNA (%)"],
                  ["tea", "TEA (%)"],
                  ["cft", "CFT (%)"],
                ] as const
              ).map(([name, label]) => (
                <FormField
                  key={name}
                  control={form.control}
                  name={name}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{label}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          inputMode="decimal"
                          placeholder="40,00"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ))}
            </div>
            <ChannelsReadError inline />

            <div className="space-y-3 rounded-lg border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium">Plan de cuotas</p>
                <Tabs
                  value={mode}
                  onValueChange={(v) => setMode(isPlanMode(v) ? v : "bank")}
                >
                  <TabsList>
                    <TabsTrigger value="bank">Pegar del banco</TabsTrigger>
                    <TabsTrigger value="french">Francés (TNA)</TabsTrigger>
                    <TabsTrigger value="fixed">Capital fijo (TNA)</TabsTrigger>
                    <TabsTrigger value="equal">Cuotas iguales</TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>
              {mode === "bank" ? (
                <div className="space-y-1.5">
                  <Textarea
                    aria-label="Plan de cuotas del banco"
                    rows={4}
                    value={planText}
                    onChange={(e) => setPlanText(e.target.value)}
                    placeholder="En el home banking abrí el préstamo › Plan de cuotas, seleccioná la tabla entera, copiala y pegala acá."
                  />
                  {pasted && !pasted.ok && (
                    <p className="text-sm">{pasted.error}</p>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="grid grid-cols-3 gap-3 sm:max-w-lg">
                    <FormField
                      control={form.control}
                      name="installments_count"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Cuotas</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              type="number"
                              inputMode="numeric"
                              min={1}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="first_due_date"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>1ª cuota</FormLabel>
                          <FormControl>
                            <DatePicker {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <div className="space-y-2">
                      <Label htmlFor="loan-paid-count">
                        Ya pagadas (hasta la Nº)
                      </Label>
                      <Input
                        id="loan-paid-count"
                        type="number"
                        inputMode="numeric"
                        min={0}
                        value={paidRaw}
                        onChange={(e) => setPaidRaw(e.target.value)}
                        placeholder="0"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3 sm:max-w-md">
                    <div className="space-y-2">
                      <Label htmlFor="loan-opening-count">
                        Cuotas del otorgamiento
                      </Label>
                      <Input
                        id="loan-opening-count"
                        type="number"
                        inputMode="numeric"
                        min={0}
                        value={openingRaw}
                        onChange={(e) => setOpeningRaw(e.target.value)}
                        placeholder="0"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="loan-opening-taxes">
                        Impuestos al otorgamiento
                      </Label>
                      <MoneyInput
                        id="loan-opening-taxes"
                        value={openingTaxesRaw}
                        onChange={setOpeningTaxesRaw}
                        disabled={!Number(openingRaw)}
                      />
                    </div>
                  </div>
                  <p className="text-muted-foreground text-xs">
                    Algunos bancos numeran cuotas al otorgar el préstamo (Banco
                    Provincia: la 1 con los impuestos y la 2 en $0). Cargalas
                    acá para que los números coincidan con los del banco.
                  </p>
                  {(mode === "french" || mode === "fixed") && (
                    <div className="space-y-2 text-sm">
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id="loan-by-days"
                          checked={byDays}
                          onCheckedChange={(v) => setByDays(v === true)}
                        />
                        <Label htmlFor="loan-by-days" className="font-normal">
                          Interés por días reales (saldo × TNA × días / 365,
                          desde la fecha de alta)
                        </Label>
                      </div>
                      {mode === "fixed" && (
                        <div className="flex items-center gap-2">
                          <Checkbox
                            id="loan-separate-interest"
                            checked={separateInterest}
                            onCheckedChange={(v) =>
                              setSeparateInterest(v === true)
                            }
                          />
                          <Label
                            htmlFor="loan-separate-interest"
                            className="font-normal"
                          >
                            Interés en cuota aparte (el banco lista capital e
                            interés como dos cuotas)
                          </Label>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
              {plan && (
                <>
                  <p className="text-muted-foreground text-xs">
                    {plan.length} cuotas
                    {paidBefore > 0 &&
                      ` · ${paidBefore} pagadas antes (quedan pagadas, sin movimiento)`}
                  </p>
                  <PlanPreview plan={plan} currency={currency} />
                </>
              )}
            </div>

            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notas (opcional)</FormLabel>
                  <FormControl>
                    <Textarea {...field} rows={2} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={createMut.isPending}>
                Crear
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function PlanPreview({
  plan,
  currency,
}: {
  plan: PlanInstallment[];
  currency: string;
}) {
  const money = (n: number) => formatMoney(n, currency);
  return (
    <div className="max-h-64 overflow-auto rounded-md border">
      <table className="w-full min-w-[44rem] text-xs [&_td]:whitespace-nowrap">
        <thead className="bg-muted/40 text-muted-foreground sticky top-0">
          <tr>
            <th className="px-2 py-1.5 text-left">#</th>
            <th className="px-2 py-1.5 text-left">Vencimiento</th>
            <th className="px-2 py-1.5 text-right">Total</th>
            <th className="px-2 py-1.5 text-right">Capital</th>
            <th className="px-2 py-1.5 text-right">Intereses</th>
            <th className="px-2 py-1.5 text-right">Otros</th>
            <th className="px-2 py-1.5 text-right">IVA</th>
            <th className="px-2 py-1.5 text-left">Estado</th>
          </tr>
        </thead>
        <tbody>
          {plan.map((p) => (
            <tr key={p.number} className="border-t">
              <td className="px-2 py-1">{p.number}</td>
              <td className="px-2 py-1">{formatArgentineDate(p.due_date)}</td>
              <td className="px-2 py-1 text-right font-mono">
                {money(p.amount)}
              </td>
              <td className="px-2 py-1 text-right font-mono">
                {money(p.capital)}
              </td>
              <td className="px-2 py-1 text-right font-mono">
                {money(p.interest)}
              </td>
              <td className="px-2 py-1 text-right font-mono">
                {money(p.other)}
              </td>
              <td className="px-2 py-1 text-right font-mono">{money(p.iva)}</td>
              <td className="px-2 py-1">{p.paid ? "Pagada" : "Pendiente"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
