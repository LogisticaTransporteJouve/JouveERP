"use client";

import { checkNumberKey } from "@/lib/checks/check-number";
import { FileUp, HandCoins } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { ExportButton } from "@/components/export-button";
import { ListToolbar } from "@/components/list-toolbar";
import { SETTLED_LIST_CAP } from "@/lib/supabase/open-and-recent";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import { useRealtimeInvalidate } from "@/hooks/use-realtime-invalidate";
import type { Access } from "@/lib/auth/permissions";
import { userCan, userCanAll } from "@/lib/auth/permissions";
import { parseDiscountReceipt } from "@/lib/checks/discount-receipt";
import { formatArgentineDate, formatMoney } from "@/lib/format";
import { readPdfText } from "@/lib/pdf/pdf-text";

import type { CheckListItem } from "../actions/checks-actions";
import { useChecksList } from "../hooks/use-checks";
import { CHECK_CASH_PERMISSIONS } from "../lib/check-cash";
import { checksKeys } from "../lib/checks-keys";
import {
  CHECK_KIND_LABEL,
  CHECK_STATUS_LABEL,
  type ChequeStatus,
} from "../schema";
import {
  CreditChequeDialog,
  DepositChequeDialog,
  RejectChequeDialog,
  type CheckChannelOption,
} from "./check-action-dialogs";
import { NewChequeDialog } from "./new-check-dialog";
import { SellChequesDialog, type SellPrefill } from "./sell-checks-dialog";

const STATUS_TONE: Record<ChequeStatus, string> = {
  en_cartera: "bg-muted text-muted-foreground dark:text-muted-foreground",
  depositado: "bg-muted text-muted-foreground dark:text-muted-foreground",
  acreditado: "bg-muted text-muted-foreground dark:text-muted-foreground",
  endosado: "bg-muted text-muted-foreground dark:text-muted-foreground",
  rechazado: "bg-muted text-foreground dark:text-foreground",
  vendido: "bg-muted text-muted-foreground dark:text-muted-foreground",
};

// Money formatter centralizado en lib/format (formatMoney).

export function ChequesTable({
  channels,
  actorAccess,
}: {
  channels: CheckChannelOption[];
  actorAccess: Access;
}) {
  const { data } = useChecksList();
  const items = data.items;
  // Every write this table offers moves treasury money (loading, depositing,
  // crediting, rejecting, selling), so it needs transactions:write as well.
  const canWrite = userCanAll(actorAccess, CHECK_CASH_PERMISSIONS);
  const cashDenied = userCan(actorAccess, "cheques:write") && !canWrite;
  // Depositing, loading and selling a check pick an account: a per-user deny
  // of accounts:read hides them, not the cartera.
  const canPickAccount = userCan(actorAccess, "accounts:read");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sellOpen, setSellOpen] = useState(false);
  const [prefill, setPrefill] = useState<SellPrefill | null>(null);
  const receiptInput = useRef<HTMLInputElement>(null);
  const [readingReceipt, setReadingReceipt] = useState(false);

  // A bank's discount receipt picks the cartera checks it sold (by number
  // and amount) and fills the sale; a check not loaded yet stops it.
  async function onReceipt(file: File) {
    let text: string;
    setReadingReceipt(true);
    try {
      text = await readPdfText(file);
    } catch {
      toast.error("No se pudo leer el PDF.");
      return;
    } finally {
      setReadingReceipt(false);
    }
    const parsed = parseDiscountReceipt(text);
    if (!parsed.ok) {
      toast.error(parsed.error);
      return;
    }
    const r = parsed.receipt;
    const cartera = items.filter((c) => c.status === "en_cartera");
    const picked: string[] = [];
    const missing: string[] = [];
    // A check that already left the cartera (usually sold by this same
    // receipt) is not "missing": loading it again would duplicate it.
    const elsewhere: string[] = [];
    const sameCheck = (ch: (typeof r.cheques)[number]) => (c: CheckListItem) =>
      checkNumberKey(c.check_number) === checkNumberKey(ch.check_number) &&
      Math.abs(Number(c.amount) - ch.amount) < 0.005;
    for (const ch of r.cheques) {
      const found = cartera.find(
        (c) => !picked.includes(c.id) && sameCheck(ch)(c),
      );
      if (found) {
        picked.push(found.id);
        continue;
      }
      const label = `${ch.check_number} (${formatMoney(ch.amount, "ARS")})`;
      const left = items.find(
        (c) => c.status !== "en_cartera" && sameCheck(ch)(c),
      );
      if (left)
        elsewhere.push(
          `${label}: ${CHECK_STATUS_LABEL[left.status].toLowerCase()}`,
        );
      else missing.push(label);
    }
    if (missing.length > 0 || elsewhere.length > 0) {
      const parts: string[] = [];
      if (elsewhere.length > 0)
        parts.push(
          `Ya no están en la cartera: ${elsewhere.join(", ")}. Si el comprobante ya se cargó, no hace falta subirlo de nuevo.`,
        );
      if (missing.length > 0)
        parts.push(
          `Faltan en la cartera: ${missing.join(", ")}. Cargalos y volvé a subir el comprobante.`,
        );
      toast.error(parts.join(" "));
      return;
    }
    setSelected(new Set(picked));
    setPrefill({
      buyer_name: r.buyer?.name ?? "",
      buyer_cuit: r.buyer?.cuit ?? "",
      sale_date: r.date,
      notes: `Operación ${r.operation}. Intereses ${formatMoney(r.interest, "ARS")}, IVA ${formatMoney(r.iva, "ARS")}, percepción IVA ${formatMoney(r.iva_perception, "ARS")}, sellos ${formatMoney(r.stamp_tax, "ARS")} e IIBB ${formatMoney(r.iibb, "ARS")}: se cargan desde el extracto.`,
      account_name: r.buyer ? "galicia" : undefined,
    });
    setSellOpen(true);
  }
  // Only checks still in the cartera can be sold; drop any that left it.
  const selectedChecks = useMemo(
    () => items.filter((c) => selected.has(c.id) && c.status === "en_cartera"),
    [items, selected],
  );

  // Realtime: any check change (status flips: depositado, acreditado,
  // endosado, rechazado) refreshes the list for everyone watching.
  useRealtimeInvalidate([
    {
      table: "checks",
      queryKeys: [checksKeys.all],
    },
  ]);

  const totalsByStatus = useMemo(
    () =>
      items.reduce<Record<ChequeStatus, number>>(
        (acc, c) => {
          acc[c.status] = (acc[c.status] ?? 0) + Number(c.amount);
          return acc;
        },
        {
          en_cartera: 0,
          depositado: 0,
          acreditado: 0,
          endosado: 0,
          rechazado: 0,
          vendido: 0,
        },
      ),
    [items],
  );

  const columns = useMemo<ColumnDef<CheckListItem>[]>(
    () => [
      ...(canWrite
        ? [
            {
              id: "select",
              header: "",
              enableSorting: false,
              meta: { headerClassName: "w-10", mobile: "primary" as const },
              cell: ({ row }: { row: { original: CheckListItem } }) =>
                row.original.status === "en_cartera" ? (
                  <Checkbox
                    checked={selected.has(row.original.id)}
                    onCheckedChange={() =>
                      setSelected((prev) => {
                        const next = new Set(prev);
                        if (next.has(row.original.id)) {
                          next.delete(row.original.id);
                        } else {
                          next.add(row.original.id);
                        }
                        return next;
                      })
                    }
                    aria-label={`Seleccionar cheque ${row.original.check_number}`}
                  />
                ) : null,
            } satisfies ColumnDef<CheckListItem>,
          ]
        : []),
      {
        accessorKey: "kind",
        header: "Tipo",
        meta: { mobile: "secondary" },
        cell: ({ row }) => (
          <span className="text-sm">{CHECK_KIND_LABEL[row.original.kind]}</span>
        ),
      },
      {
        accessorKey: "check_number",
        header: "Número",
        meta: { mobile: "primary" },
        cell: ({ row }) => (
          <span className="font-mono text-xs">{row.original.check_number}</span>
        ),
      },
      {
        accessorKey: "bank_name",
        header: "Banco",
        meta: { mobile: "secondary" },
        cell: ({ row }) => (
          <span className="text-sm">{row.original.bank_name}</span>
        ),
      },
      {
        accessorKey: "drawer_name",
        header: "Firmante",
        meta: { mobile: "secondary" },
        cell: ({ row }) => (
          <div className="text-sm">
            {row.original.drawer_name}
            {row.original.source_client_legal_name && (
              <div className="text-xs text-muted-foreground">
                via {row.original.source_client_legal_name}
              </div>
            )}
          </div>
        ),
      },
      {
        accessorKey: "due_date",
        header: "Vencimiento",
        meta: { mobile: "secondary" },
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {formatArgentineDate(row.original.due_date)}
          </span>
        ),
      },
      {
        accessorKey: "amount",
        header: "Monto",
        meta: { align: "right", mobile: "primary" },
        cell: ({ row }) => (
          <span className="font-mono text-sm">
            {formatMoney(Number(row.original.amount), row.original.currency)}
          </span>
        ),
      },
      {
        accessorKey: "status",
        header: "Estado",
        meta: { mobile: "primary" },
        cell: ({ row }) => (
          <Badge
            variant="secondary"
            className={STATUS_TONE[row.original.status]}
          >
            {CHECK_STATUS_LABEL[row.original.status]}
          </Badge>
        ),
      },
      {
        id: "actions",
        header: "Acciones",
        enableSorting: false,
        meta: {
          align: "right",
          headerClassName: "w-[280px]",
          mobile: "primary",
        },
        cell: ({ row }) => {
          const c = row.original;
          return (
            <div className="flex items-center justify-end gap-1">
              {canWrite && canPickAccount && c.status === "en_cartera" && (
                <DepositChequeDialog check={c} channels={channels} />
              )}
              {canWrite && c.status === "depositado" && (
                <CreditChequeDialog check={c} />
              )}
              {canWrite &&
                (c.status === "en_cartera" ||
                  c.status === "depositado" ||
                  c.status === "endosado" ||
                  c.status === "vendido") && (
                  <RejectChequeDialog
                    check={c}
                    channels={channels}
                    canPickAccount={canPickAccount}
                  />
                )}
            </div>
          );
        },
      },
    ],
    [canWrite, canPickAccount, channels, selected],
  );

  return (
    <>
      {/* Summary cards by status */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {(Object.keys(STATUS_TONE) as ChequeStatus[]).map((status) => (
          <div key={status} className="rounded-md border bg-card p-3 text-sm">
            <div className="text-xs text-muted-foreground">
              {CHECK_STATUS_LABEL[status]}
            </div>
            <div className="font-mono text-base font-semibold">
              {formatMoney(totalsByStatus[status], "ARS")}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4">
        <ListToolbar
          actions={
            <>
              {canWrite && canPickAccount && selectedChecks.length > 0 && (
                <Button variant="outline" onClick={() => setSellOpen(true)}>
                  <HandCoins />
                  Vender ({selectedChecks.length})
                </Button>
              )}
              {canWrite && canPickAccount && (
                <>
                  <input
                    ref={receiptInput}
                    type="file"
                    accept=".pdf,application/pdf"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (file) void onReceipt(file);
                    }}
                  />
                  <Button
                    variant="outline"
                    disabled={readingReceipt}
                    onClick={() => receiptInput.current?.click()}
                  >
                    <FileUp />
                    {readingReceipt ? "Leyendo…" : "Vender con comprobante"}
                  </Button>
                </>
              )}
              <ExportButton resource="checks" />
              {canWrite && canPickAccount && (
                <NewChequeDialog channels={channels} />
              )}
            </>
          }
        />
      </div>

      {cashDenied && (
        <p className="mt-2 text-xs text-muted-foreground">
          Cargar, depositar, acreditar, rechazar o vender cheques mueve plata de
          una cuenta: necesitás también permiso para cargar movimientos.
        </p>
      )}

      <DataTable
        columns={columns}
        data={items}
        getRowId={(c) => c.id}
        emptyMessage="Todavía no hay cheques."
        wrapperClassName="mt-4"
      />
      {data.truncated && (
        <p className="mt-2 text-xs text-muted-foreground">
          Se muestran todos los cheques en cartera y depositados, y de los
          acreditados, endosados, rechazados y vendidos solo los{" "}
          {SETTLED_LIST_CAP} de vencimiento más reciente: los totales de esos
          estados no incluyen los más viejos. Exportá para ver el historial
          completo.
        </p>
      )}

      {canWrite && canPickAccount && (
        <SellChequesDialog
          checks={selectedChecks}
          channels={channels}
          open={sellOpen}
          onOpenChange={(o) => {
            setSellOpen(o);
            if (!o) setPrefill(null);
          }}
          onSold={() => setSelected(new Set())}
          prefill={prefill}
        />
      )}
    </>
  );
}
