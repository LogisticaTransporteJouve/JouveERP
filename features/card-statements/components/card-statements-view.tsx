"use client";

import { FileUp } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAccountsList } from "@/features/accounts/hooks/use-accounts";
import {
  parseCardStatement,
  type CardStatement,
} from "@/lib/cards/card-statement";
import { formatArgentineDate, formatMoney } from "@/lib/format";
import { readPdfLines } from "@/lib/pdf/pdf-text";

import {
  useCardStatements,
  useCreateCardStatement,
} from "../hooks/use-card-statements";
import { CARD_STATUS_LABEL } from "../schema";

import { CardStatementDetailView } from "./card-statement-detail";

export function CardStatementsView({
  canWrite,
  canAdvance,
}: {
  /** Treasury write: load, define, delete and undo statements. */
  canWrite: boolean;
  /** Personal's write too: a purchase may be a salary advance. */
  canAdvance: boolean;
}) {
  const { data: statements } = useCardStatements();
  const { data: accounts } = useAccountsList();
  const create = useCreateCardStatement();
  const input = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<string | null>(
    statements[0]?.id ?? null,
  );
  const [read, setRead] = useState<CardStatement | null>(null);
  const [payAccount, setPayAccount] = useState("");
  const [reading, setReading] = useState(false);
  const banks = accounts.filter(
    (a) => a.is_active && a.type === "bank" && a.currency === "ARS",
  );

  async function onFile(file: File) {
    let lines: string[];
    setReading(true);
    try {
      lines = await readPdfLines(file);
    } catch {
      toast.error("No se pudo leer el PDF.");
      return;
    } finally {
      setReading(false);
    }
    const parsed = parseCardStatement(lines);
    if (!parsed.ok) {
      toast.error(parsed.error);
      return;
    }
    setRead(parsed.statement);
    setPayAccount(banks.find((b) => /galicia/i.test(b.name))?.id ?? "");
  }

  function save() {
    if (!read) return;
    create.mutate(
      {
        pay_account_id: payAccount,
        statement: {
          number: read.number,
          account_number: read.account_number,
          close_date: read.close_date,
          due_date: read.due_date,
          total_ars: read.total_ars,
          total_usd: read.total_usd,
          cards: read.cards.map((c) => ({
            last4: c.last4,
            holder: c.holder,
            purchases: c.purchases.map((p) => ({
              date: p.date,
              description: p.description,
              installment: p.installment,
              amount: p.amount,
              currency: p.currency,
            })),
          })),
          charges: read.charges,
        },
      },
      {
        onSuccess: ({ id }) => {
          toast.success("Resumen cargado. Definí qué es cada consumo.");
          setRead(null);
          setSelected(id);
        },
        onError: (e) => toast.error(e.message),
      },
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Tarjetas</h1>
          <p className="text-muted-foreground text-sm">
            Resúmenes de las tarjetas de crédito de la empresa: cada consumo es
            un gasto de la empresa o un adelanto de sueldo. Se registran cuando
            el banco debita el pago.
          </p>
        </div>
        <input
          ref={input}
          type="file"
          accept=".pdf,application/pdf"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void onFile(f);
          }}
        />
        {canWrite && (
          <Button disabled={reading} onClick={() => input.current?.click()}>
            <FileUp />
            {reading ? "Leyendo…" : "Subir resumen"}
          </Button>
        )}
      </div>

      {statements.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Todavía no hay resúmenes. Subí el PDF que bajás del home banking.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tarjeta</TableHead>
                <TableHead>Cierre</TableHead>
                <TableHead>Vence</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {statements.map((s) => (
                <TableRow
                  key={s.id}
                  className="cursor-pointer"
                  data-state={selected === s.id ? "selected" : undefined}
                  onClick={() => setSelected(s.id)}
                >
                  <TableCell>
                    {s.brand} {s.account_number}
                  </TableCell>
                  <TableCell>{formatArgentineDate(s.close_date)}</TableCell>
                  <TableCell>{formatArgentineDate(s.due_date)}</TableCell>
                  <TableCell className="text-right font-mono">
                    {formatMoney(s.total_ars, "ARS")}
                    {s.total_usd > 0 && ` + ${formatMoney(s.total_usd, "USD")}`}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {CARD_STATUS_LABEL[s.status]}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {selected && (
        <CardStatementDetailView
          id={selected}
          onDeleted={() => setSelected(null)}
          canWrite={canWrite}
          canAdvance={canAdvance}
        />
      )}

      <Dialog open={read !== null} onOpenChange={(o) => !o && setRead(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cargar resumen</DialogTitle>
            <DialogDescription>
              {read &&
                `${read.cards.length} tarjetas, ${read.cards.reduce((n, c) => n + c.purchases.length, 0)} consumos y ${read.charges.length} cargos del banco. Total ${formatMoney(read.total_ars, "ARS")}${read.total_usd > 0 ? ` + ${formatMoney(read.total_usd, "USD")}` : ""}, vence ${formatArgentineDate(read.due_date)}.`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <Label htmlFor="card-pay-account">Cuenta que paga la tarjeta</Label>
            <Select value={payAccount} onValueChange={setPayAccount}>
              <SelectTrigger id="card-pay-account" className="w-full">
                <SelectValue placeholder="Elegí el banco" />
              </SelectTrigger>
              <SelectContent>
                {banks.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRead(null)}>
              Cancelar
            </Button>
            <Button disabled={!payAccount || create.isPending} onClick={save}>
              Cargar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
