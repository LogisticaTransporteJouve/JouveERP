"use client";

import { Trash2, Undo2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatArgentineDate, formatMoney } from "@/lib/format";

import {
  useCardStatement,
  useDeleteCardStatement,
  useSetCardHolder,
  useSetCardLines,
  useUnsettleCardStatement,
} from "../hooks/use-card-statements";
import { linesFollowingDefault } from "../lib/holder-default";
import {
  isCardLineUndefined,
  type CardStatementDetail,
  type CardStatementLine,
} from "../schema";

import { DestinationPicker, type Destination } from "./destination-picker";

export function CardStatementDetailView({
  id,
  onDeleted,
  canWrite,
  canAdvance,
}: {
  id: string;
  onDeleted: () => void;
  /** Treasury write: define, delete and undo. */
  canWrite: boolean;
  /** Personal's write too: a purchase may be a salary advance. */
  canAdvance: boolean;
}) {
  const q = useCardStatement(id);
  if (q.isPending) {
    return (
      <p className="text-muted-foreground text-sm">Cargando el resumen…</p>
    );
  }
  // A failed refetch keeps what was read: the error goes above it.
  if (!q.data) return <p className="text-sm">{q.error?.message}</p>;
  return (
    <div className="space-y-2">
      {q.isError && <p className="text-sm">{q.error.message}</p>}
      <Detail
        // Another statement starts with nothing selected.
        key={q.data.statement.id}
        data={q.data}
        onDeleted={onDeleted}
        canWrite={canWrite}
        canAdvance={canAdvance}
      />
    </div>
  );
}

function Detail({
  data,
  onDeleted,
  canWrite,
  canAdvance,
}: {
  data: CardStatementDetail;
  onDeleted: () => void;
  canWrite: boolean;
  canAdvance: boolean;
}) {
  const {
    statement: st,
    lines,
    holders,
    accounts,
    employees,
    employees_hidden,
  } = data;
  const setLines = useSetCardLines();
  const setHolder = useSetCardHolder();
  const del = useDeleteCardStatement();
  const unsettle = useUnsettleCardStatement();
  const paidParts = (
    [
      ["ARS", st.paid_ars_on, "pesos"],
      ["USD", st.paid_usd_on, "dólares"],
    ] as const
  ).filter(([, on]) => on !== null);
  const locked = st.status === "pagado";
  const pending = lines.filter(isCardLineUndefined).length;
  const cards = [
    ...new Set(lines.flatMap((l) => (l.card_last4 ? [l.card_last4] : []))),
  ];
  const charges = lines.filter((l) => l.source === "charge");
  const paidCurrencies = paidParts.map(([currency]) => currency);
  const busy = setLines.isPending || setHolder.isPending;

  // A change that books a paid part again is confirmed first.
  const [confirm, setConfirm] = useState<{
    n: number;
    run: () => void;
  } | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [bulk, setBulk] = useState<Destination>({
    treatment: "expense",
    chart_account_id: null,
    employee_id: null,
  });
  const chosen = lines.filter((l) => selected.has(l.id));
  const bulkReady =
    (bulk.treatment === "expense" && bulk.chart_account_id !== null) ||
    (bulk.treatment === "advance" && bulk.employee_id !== null);

  function toggle(ids: string[], on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  function confirmed(n: number, run: () => void) {
    if (n > 0) setConfirm({ n, run });
    else run();
  }

  function applySelected() {
    const ids = chosen.map((l) => l.id);
    const paidCount = chosen.filter((l) => l.paid).length;
    confirmed(paidCount, () =>
      setLines.mutate(
        { statement_id: st.id, line_ids: ids, ...bulk },
        {
          onSuccess: ({ updated }) => {
            setSelected(new Set());
            toast.success(
              `${updated === 1 ? "Se cambió 1 consumo" : `Se cambiaron ${updated} consumos`}${paidCount > 0 ? " y se volvió a registrar el pago" : ""}.`,
            );
          },
          onError: (e) => toast.error(e.message),
        },
      ),
    );
  }

  function applyHolder(last4: string, d: Destination) {
    const h = holders.find((x) => x.last4 === last4) ?? null;
    const rebooked = linesFollowingDefault(lines, {
      last4,
      previous: h,
      next: d,
      paidParts: paidCurrencies,
      hrWrite: canAdvance,
    }).length;
    confirmed(rebooked, () =>
      setHolder.mutate(
        { statement_id: st.id, last4, ...d },
        {
          onSuccess: ({ updated }) =>
            updated > 0 &&
            toast.success(
              `${updated === 1 ? "Aplicado a 1 consumo" : `Aplicado a ${updated} consumos`} de la tarjeta ${last4}${rebooked > 0 ? "; se volvió a registrar el pago" : ""}.`,
            ),
          onError: (e) => toast.error(e.message),
        },
      ),
    );
  }

  function selectHead(own: CardStatementLine[]) {
    const ids = own.map((l) => l.id);
    const all = ids.length > 0 && ids.every((id) => selected.has(id));
    return (
      canWrite && (
        <TableHead className="w-8">
          <Checkbox
            aria-label="Seleccionar todos"
            checked={all}
            disabled={busy}
            onCheckedChange={(v) => toggle(ids, v === true)}
          />
        </TableHead>
      )
    );
  }

  function applyLine(line: CardStatementLine, d: Destination) {
    setLines.mutate(
      { statement_id: st.id, line_ids: [line.id], ...d },
      {
        // A paid line is booked again: its part's expenses change.
        onSuccess: () =>
          line.paid &&
          toast.success(
            "Se cambió el consumo y se volvió a registrar el pago.",
          ),
        onError: (e) => toast.error(e.message),
      },
    );
  }

  function lineRow(l: CardStatementLine) {
    return (
      <TableRow key={l.id}>
        {canWrite && (
          <TableCell className="w-8">
            <Checkbox
              aria-label={`Seleccionar ${l.description}`}
              checked={selected.has(l.id)}
              disabled={busy}
              onCheckedChange={(v) => toggle([l.id], v === true)}
            />
          </TableCell>
        )}
        <TableCell className="whitespace-nowrap">
          {formatArgentineDate(l.line_date)}
        </TableCell>
        <TableCell>
          {l.description}
          {l.installment && (
            <span className="text-muted-foreground">
              {" "}
              · cuota {l.installment}
            </span>
          )}
        </TableCell>
        <TableCell className="text-right font-mono whitespace-nowrap">
          {formatMoney(l.amount, l.currency)}
        </TableCell>
        <TableCell>
          <DestinationPicker
            value={l}
            accounts={accounts}
            employees={employees}
            employeesHidden={employees_hidden}
            allowAdvance={canAdvance && l.source === "purchase"}
            disabled={!canWrite || busy}
            onChange={(d) => applyLine(l, d)}
          />
        </TableCell>
      </TableRow>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">
            {st.brand} {st.account_number} · cierre{" "}
            {formatArgentineDate(st.close_date)}
          </h2>
          <p className="text-muted-foreground text-sm">
            Vence {formatArgentineDate(st.due_date)} · total{" "}
            {formatMoney(st.total_ars, "ARS")}
            {st.total_usd > 0 && ` + ${formatMoney(st.total_usd, "USD")}`} · lo
            paga {st.pay_account_name}
          </p>
          <p className="text-sm">
            {locked
              ? "Pagado: sus gastos y adelantos ya están en la cuenta. Si cambiás un consumo o el destino de una tarjeta, el pago se vuelve a registrar con la misma línea del extracto."
              : pending > 0
                ? `${pending === 1 ? "Falta 1 consumo o cargo" : `Faltan ${pending} consumos o cargos`} por definir (una cuenta, un empleado, o cambiar «no corresponde»). Cuando el banco debite el pago, la línea del extracto lo paga.`
                : "Todo definido. Cuando el banco debite el pago, la línea del extracto lo paga."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canWrite &&
            paidParts.map(([currency, , label]) => (
              <AlertDialog key={currency}>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" disabled={unsettle.isPending}>
                    <Undo2 />
                    Deshacer pago en {label}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      ¿Deshacer el pago en {label}?
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      Se borran los gastos y adelantos que registró, con sus
                      asientos, y la línea del extracto vuelve a pendiente para
                      pagarlo de nuevo.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() =>
                        unsettle.mutate(
                          { id: st.id, currency },
                          {
                            onSuccess: () => toast.success("Pago deshecho."),
                            onError: (e) => toast.error(e.message),
                          },
                        )
                      }
                    >
                      Deshacer pago
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            ))}
          {canWrite && paidParts.length === 0 && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" disabled={del.isPending}>
                  <Trash2 />
                  Borrar resumen
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>¿Borrar el resumen?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Se borran el resumen y lo que definiste de cada consumo. Las
                    tarjetas recuerdan su destino por defecto.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() =>
                      del.mutate(st.id, {
                        onSuccess: () => {
                          toast.success("Resumen borrado.");
                          onDeleted();
                        },
                        onError: (e) => toast.error(e.message),
                      })
                    }
                  >
                    Borrar
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </div>

      {canWrite && chosen.length > 0 && (
        <div className="bg-background sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-lg border p-3">
          <span className="text-sm font-medium">
            {chosen.length === 1
              ? "1 seleccionado"
              : `${chosen.length} seleccionados`}
          </span>
          <span className="text-muted-foreground text-xs">Qué es:</span>
          <DestinationPicker
            value={bulk}
            accounts={accounts}
            employees={employees}
            employeesHidden={employees_hidden}
            allowAdvance={
              canAdvance && chosen.every((l) => l.source === "purchase")
            }
            disabled={busy}
            onChange={setBulk}
          />
          <Button
            size="sm"
            disabled={!bulkReady || busy}
            onClick={applySelected}
          >
            Aplicar
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => setSelected(new Set())}
          >
            Quitar selección
          </Button>
        </div>
      )}

      {cards.map((last4) => {
        const h = holders.find((x) => x.last4 === last4);
        const own = lines.filter((l) => l.card_last4 === last4);
        const ars = own
          .filter((l) => l.currency === "ARS")
          .reduce((s, l) => s + l.amount, 0);
        const usd = own
          .filter((l) => l.currency === "USD")
          .reduce((s, l) => s + l.amount, 0);
        return (
          <section key={last4} className="space-y-2 rounded-lg border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-medium">
                  Tarjeta {last4} · {h?.holder ?? "—"}
                </p>
                <p className="text-muted-foreground text-xs">
                  {own.length === 1 ? "1 consumo" : `${own.length} consumos`} ·{" "}
                  {formatMoney(ars, "ARS")}
                  {usd > 0 && ` + ${formatMoney(usd, "USD")}`}
                </p>
              </div>
              {h && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-muted-foreground text-xs">
                    Por defecto:
                  </span>
                  <DestinationPicker
                    value={h}
                    accounts={accounts}
                    employees={employees}
                    employeesHidden={employees_hidden}
                    allowAdvance={canAdvance}
                    disabled={!canWrite || busy}
                    onChange={(d) => applyHolder(last4, d)}
                  />
                </div>
              )}
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    {selectHead(own)}
                    <TableHead>Fecha</TableHead>
                    <TableHead>Consumo</TableHead>
                    <TableHead className="text-right">Importe</TableHead>
                    <TableHead>Qué es</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>{own.map(lineRow)}</TableBody>
              </Table>
            </div>
          </section>
        );
      })}

      {charges.length > 0 && (
        <section className="space-y-2 rounded-lg border p-3">
          <p className="font-medium">Cargos del banco</p>
          <p className="text-muted-foreground text-xs">
            Impuestos, percepciones y comisiones del resumen: cada uno a su
            cuenta.
          </p>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {selectHead(charges)}
                  <TableHead>Fecha</TableHead>
                  <TableHead>Cargo</TableHead>
                  <TableHead className="text-right">Importe</TableHead>
                  <TableHead>Cuenta</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>{charges.map(lineRow)}</TableBody>
            </Table>
          </div>
        </section>
      )}
      {locked && <Badge variant="outline">Pagado</Badge>}

      <AlertDialog
        open={confirm !== null}
        onOpenChange={(open) => !open && setConfirm(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Volver a registrar el pago?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.n === 1
                ? "Se vuelve a registrar 1 consumo de este resumen pagado con la misma línea del extracto."
                : `Se vuelven a registrar ${confirm?.n ?? 0} consumos de este resumen pagado con la misma línea del extracto.`}{" "}
              La fecha, la conciliación y el total no cambian.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                confirm?.run();
                setConfirm(null);
              }}
            >
              Volver a registrar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
