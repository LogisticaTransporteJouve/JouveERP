"use client";

import {
  Ban,
  Check,
  CheckCheck,
  FileUp,
  Link2,
  MoreHorizontal,
  Plus,
  Undo2,
  Unlink,
} from "lucide-react";
import Link from "next/link";
import { Suspense, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { StatGrid, StatTile, StatValue } from "@/components/ui/stat-tile";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ACCOUNT_TYPE_LABEL, isAccountType } from "@/features/accounts/schema";
import { formatArgentineDate, formatMoneySigned } from "@/lib/format";

import {
  useAcceptSuggestions,
  useReconciliation,
  useReconciliationAccounts,
  useRestoreLine,
  useUnmatchLine,
} from "../hooks/use-reconciliation";
import {
  STATEMENT_LINE_STATUS_LABELS,
  type BookMovement,
  type StatementLine,
} from "../schema";
import {
  CreateLineTransactionDialog,
  IgnoreLineDialog,
  MatchLineDialog,
} from "./line-dialogs";

function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y ?? 2000, m ?? 1, 0)).getUTCDate();
  return {
    from: `${month}-01`,
    to: `${month}-${String(last).padStart(2, "0")}`,
  };
}

export function ReconciliationPage({
  today,
  canWrite,
  canPayTaxes,
  canImport,
}: {
  /** The Argentine today, YYYY-MM-DD. */
  today: string;
  /** transactions:write: match, unmatch, ignore, create. */
  canWrite: boolean;
  /** taxes:write too: a debit line can be booked as a tax payment. */
  canPayTaxes: boolean;
  /** May import statements (imports:write + transactions:write). */
  canImport: boolean;
}) {
  const [accountId, setAccountId] = useState("");
  const [month, setMonth] = useState(today.slice(0, 7));
  const { from, to } = monthRange(month);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Conciliación bancaria
          </h1>
          <p className="text-muted-foreground max-w-2xl text-sm">
            Las líneas del extracto de una cuenta contra sus movimientos de
            Caja, por mes. Un movimiento conciliado no se edita ni se borra
            hasta desconciliar su línea.
          </p>
        </div>
        {canImport && (
          <Button asChild variant="outline">
            <Link href="/admin/imports">
              <FileUp className="size-4" />
              Importar extracto
            </Link>
          </Button>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-[minmax(0,20rem)_12rem]">
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor="recon-account">Cuenta</Label>
          <Suspense fallback={<Skeleton className="h-9 w-full" />}>
            <AccountPicker value={accountId} onChange={setAccountId} />
          </Suspense>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="recon-month">Mes</Label>
          <Input
            id="recon-month"
            type="month"
            value={month}
            onChange={(e) => {
              if (/^\d{4}-\d{2}$/.test(e.target.value))
                setMonth(e.target.value);
            }}
          />
        </div>
      </div>

      {accountId ? (
        <Suspense fallback={<Skeleton className="h-96 w-full" />}>
          <ReconciliationBody
            accountId={accountId}
            from={from}
            to={to}
            canWrite={canWrite}
            canPayTaxes={canPayTaxes}
          />
        </Suspense>
      ) : (
        <p className="text-muted-foreground text-sm">
          Elegí la cuenta que querés conciliar.
        </p>
      )}
    </div>
  );
}

function AccountPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  const { data: accounts } = useReconciliationAccounts();
  if (accounts.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No hay cuentas para conciliar.
      </p>
    );
  }
  return (
    <Select value={value || undefined} onValueChange={onChange}>
      <SelectTrigger id="recon-account" className="w-full min-w-0">
        <SelectValue placeholder="Elegí la cuenta" />
      </SelectTrigger>
      <SelectContent>
        {accounts.map((a) => (
          <SelectItem key={a.id} value={a.id}>
            {a.name} ·{" "}
            {isAccountType(a.type) ? ACCOUNT_TYPE_LABEL[a.type] : a.type} ·{" "}
            {a.currency}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

type LineDialog = "match" | "ignore" | "create";

function ReconciliationBody({
  accountId,
  from,
  to,
  canWrite,
  canPayTaxes,
}: {
  accountId: string;
  from: string;
  to: string;
  canWrite: boolean;
  canPayTaxes: boolean;
}) {
  const { data } = useReconciliation(accountId, from, to);
  const accept = useAcceptSuggestions();
  const unmatch = useUnmatchLine();
  const restore = useRestoreLine();
  const [dialog, setDialog] = useState<{
    kind: LineDialog;
    line: StatementLine;
  } | null>(null);
  const currency = data.account.currency;
  const s = data.summary;
  const lineById = new Map(data.lines.map((l) => [l.id, l]));
  const movementById = new Map(data.movements.map((m) => [m.id, m]));
  const free = data.movements.filter((m) => m.line_id === null);
  const unmatchedInPeriod = free.filter(
    (m) => m.transaction_date >= from && m.transaction_date <= to,
  );
  const money = (v: number) => formatMoneySigned(v, currency);

  function acceptAll(list: typeof data.suggestions) {
    accept.mutate(
      list.map((sg) => ({
        line_id: sg.line_id,
        transaction_ids: [sg.transaction_id],
      })),
      {
        onSuccess: ({ matched, failed }) => {
          if (failed.length === 0) {
            toast.success(
              matched === 1
                ? "Línea conciliada."
                : `${matched} líneas conciliadas.`,
            );
          } else {
            toast.error(
              `${matched} conciliadas; ${failed.length} no: ${failed[0]?.error ?? ""}`,
            );
          }
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  function close() {
    setDialog(null);
  }

  return (
    <div className="space-y-4">
      <StatGrid>
        <StatTile label="Saldo según extracto">
          <StatValue>
            {s.statement_balance === null ? "—" : money(s.statement_balance)}
          </StatValue>
          <p className="text-muted-foreground text-xs">
            {s.statement_balance_date
              ? `Al ${formatArgentineDate(s.statement_balance_date)}`
              : "El extracto del mes no trae saldo."}
          </p>
        </StatTile>
        <StatTile label="Saldo según libros">
          <StatValue>{money(s.book_balance)}</StatValue>
          <p className="text-muted-foreground text-xs">
            Al {formatArgentineDate(to)}
          </p>
        </StatTile>
        <StatTile label="Diferencia">
          <StatValue>
            {s.difference === null ? "—" : money(s.difference)}
          </StatValue>
          <p className="text-muted-foreground text-xs">
            {s.difference === 0
              ? "El extracto y los libros coinciden."
              : `Pendientes del extracto ${money(s.open_total)} · movimientos sin conciliar ${money(s.unmatched_book_total)}`}
          </p>
        </StatTile>
        <StatTile label="Líneas">
          <StatValue>
            {s.matched_count} / {data.lines.length}
          </StatValue>
          <p className="text-muted-foreground text-xs">
            Conciliadas {money(s.matched_total)} · {s.open_count} pendientes ·{" "}
            {s.ignored_count} no corresponden
          </p>
        </StatTile>
      </StatGrid>

      {canWrite && data.suggestions.length > 0 && (
        <section className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold">
              Sugerencias ({data.suggestions.length})
            </h2>
            <Button
              size="sm"
              variant="outline"
              disabled={accept.isPending}
              onClick={() => acceptAll(data.suggestions)}
            >
              <CheckCheck className="size-4" />
              Aceptar todas
            </Button>
          </div>
          <p className="text-muted-foreground text-sm">
            Mismo importe, hasta 5 días de diferencia; primero las que también
            coinciden en la referencia.
          </p>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Extracto</TableHead>
                  <TableHead>Movimiento</TableHead>
                  <TableHead className="text-right">Importe</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.suggestions.map((sg) => {
                  const line = lineById.get(sg.line_id);
                  const m = movementById.get(sg.transaction_id);
                  if (!line || !m) return null;
                  return (
                    <TableRow key={sg.line_id}>
                      <TableCell className="align-top text-sm">
                        <span className="block">{line.description}</span>
                        <span className="text-muted-foreground text-xs">
                          {formatArgentineDate(line.line_date)}
                        </span>
                      </TableCell>
                      <TableCell className="align-top text-sm">
                        <span className="block">
                          {m.description || "(sin descripción)"}
                        </span>
                        <span className="text-muted-foreground text-xs">
                          {formatArgentineDate(m.transaction_date)}
                          {sg.reference_match
                            ? " · coincide la referencia"
                            : ""}
                        </span>
                      </TableCell>
                      <TableCell className="text-right align-top tabular-nums">
                        {money(line.amount)}
                      </TableCell>
                      <TableCell className="text-right align-top">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={accept.isPending}
                          onClick={() => acceptAll([sg])}
                        >
                          <Check className="size-4" />
                          Aceptar
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </section>
      )}

      <section className="space-y-2">
        <h2 className="text-base font-semibold">Extracto</h2>
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-28">Fecha</TableHead>
                <TableHead>Descripción</TableHead>
                <TableHead className="text-right">Importe</TableHead>
                <TableHead className="text-right">Saldo</TableHead>
                <TableHead>Estado</TableHead>
                {canWrite && <TableHead className="w-12" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.lines.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={canWrite ? 6 : 5}
                    className="text-muted-foreground text-center text-sm"
                  >
                    No hay líneas de extracto importadas para este mes.
                  </TableCell>
                </TableRow>
              )}
              {data.lines.map((line) => (
                <TableRow key={line.id}>
                  <TableCell className="align-top text-sm whitespace-nowrap">
                    {formatArgentineDate(line.line_date)}
                  </TableCell>
                  <TableCell className="align-top text-sm">
                    <span className="block">{line.description}</span>
                    {line.reference && (
                      <span className="text-muted-foreground block text-xs">
                        Ref. {line.reference}
                      </span>
                    )}
                    {line.transaction_ids.map((id) => (
                      <MatchedMovement
                        key={id}
                        movement={movementById.get(id)}
                        currency={currency}
                      />
                    ))}
                  </TableCell>
                  <TableCell className="text-right align-top tabular-nums">
                    {money(line.amount)}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-right align-top tabular-nums">
                    {line.balance === null ? "—" : money(line.balance)}
                  </TableCell>
                  <TableCell className="align-top text-sm">
                    <span
                      className={line.status === "open" ? "font-medium" : ""}
                    >
                      {STATEMENT_LINE_STATUS_LABELS[line.status]}
                    </span>
                    {line.ignore_reason && (
                      <span className="text-muted-foreground block text-xs">
                        {line.ignore_reason}
                      </span>
                    )}
                  </TableCell>
                  {canWrite && (
                    <TableCell className="text-right align-top">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label="Acciones de la línea"
                          >
                            <MoreHorizontal className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {line.status === "open" && (
                            <>
                              <DropdownMenuItem
                                onSelect={() =>
                                  setDialog({ kind: "match", line })
                                }
                              >
                                <Link2 className="size-4" />
                                Conciliar…
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onSelect={() =>
                                  setDialog({ kind: "create", line })
                                }
                              >
                                <Plus className="size-4" />
                                Crear movimiento…
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onSelect={() =>
                                  setDialog({ kind: "ignore", line })
                                }
                              >
                                <Ban className="size-4" />
                                No corresponde…
                              </DropdownMenuItem>
                            </>
                          )}
                          {line.status === "matched" && (
                            <DropdownMenuItem
                              disabled={unmatch.isPending}
                              onSelect={() =>
                                unmatch.mutate(line.id, {
                                  onSuccess: () =>
                                    toast.success("Línea desconciliada."),
                                  onError: (err) => toast.error(err.message),
                                })
                              }
                            >
                              <Unlink className="size-4" />
                              Desconciliar
                            </DropdownMenuItem>
                          )}
                          {line.status === "ignored" && (
                            <DropdownMenuItem
                              disabled={restore.isPending}
                              onSelect={() =>
                                restore.mutate(line.id, {
                                  onSuccess: () =>
                                    toast.success(
                                      "La línea volvió a pendiente.",
                                    ),
                                  onError: (err) => toast.error(err.message),
                                })
                              }
                            >
                              <Undo2 className="size-4" />
                              Volver a pendiente
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold">
          Movimientos del mes sin conciliar ({unmatchedInPeriod.length})
        </h2>
        <p className="text-muted-foreground text-sm">
          Están en Caja pero ninguna línea del extracto los explica: cheques sin
          cobrar, transferencias en tránsito o un error de carga.
        </p>
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-28">Fecha</TableHead>
                <TableHead>Descripción</TableHead>
                <TableHead className="text-right">Importe</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {unmatchedInPeriod.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={3}
                    className="text-muted-foreground text-center text-sm"
                  >
                    Todos los movimientos del mes están conciliados.
                  </TableCell>
                </TableRow>
              )}
              {unmatchedInPeriod.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="text-sm whitespace-nowrap">
                    {formatArgentineDate(m.transaction_date)}
                  </TableCell>
                  <TableCell className="text-sm">
                    {m.description || "(sin descripción)"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {money(m.signed_amount)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      <MatchLineDialog
        line={dialog?.kind === "match" ? dialog.line : null}
        movements={free}
        currency={currency}
        onOpenChange={(o) => (o ? null : close())}
      />
      <IgnoreLineDialog
        line={dialog?.kind === "ignore" ? dialog.line : null}
        currency={currency}
        onOpenChange={(o) => (o ? null : close())}
      />
      <CreateLineTransactionDialog
        line={dialog?.kind === "create" ? dialog.line : null}
        currency={currency}
        canPayTaxes={canPayTaxes}
        onOpenChange={(o) => (o ? null : close())}
      />
    </div>
  );
}

function MatchedMovement({
  movement,
  currency,
}: {
  movement: BookMovement | undefined;
  currency: string;
}) {
  if (!movement) {
    return (
      <span className="text-muted-foreground block text-xs">
        ↳ movimiento fuera de las fechas mostradas
      </span>
    );
  }
  return (
    <span className="text-muted-foreground block text-xs">
      ↳ {formatArgentineDate(movement.transaction_date)} ·{" "}
      {movement.description || "(sin descripción)"} ·{" "}
      {formatMoneySigned(movement.signed_amount, currency)}
    </span>
  );
}
