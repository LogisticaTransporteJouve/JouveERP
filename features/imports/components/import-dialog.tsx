"use client";

import { FileUp, Info, Loader2 } from "lucide-react";
import { Suspense, useState } from "react";
import { toast } from "sonner";

import { ChannelsReadError } from "@/components/channels-read-error";
import { DisabledHint, firstReason } from "@/components/disabled-hint";
import { useScope } from "@/components/providers/scope-provider";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAccountsList } from "@/features/accounts/hooks/use-accounts";
import {
  ACCOUNT_TYPE_LABEL,
  isCheckAccount,
  type AccountType,
} from "@/features/accounts/schema";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatArgentineDateTime } from "@/lib/format";

import type { ImportPreview } from "../actions/import-actions";
import { useCommitImport, usePreviewImport } from "../hooks/use-imports";
import { IMPORT_FIELDS, fieldLabel } from "../lib/fields";
import { IMPORT_ROW_STATUS_LABELS, type ImportMapping } from "../lib/rows";
import {
  IMPORT_KIND_LABELS,
  IMPORT_KINDS,
  isImportKind,
  kindNeedsAccount,
  kindNeedsChannel,
  type ImportKind,
} from "../schema";

const NONE = "__none__";

/** What each kind does with the rows, under the kind picker. */
const KIND_NOTES: Record<ImportKind, string> = {
  clients:
    "Crea los clientes que no existen. Se compara por CUIT (o por nombre si no tiene).",
  suppliers:
    "Crea los proveedores que no existen. Se compara por CUIT (o por nombre si no tiene). Categoría, cuenta de gasto y centro de costo se buscan por nombre o código; un proveedor que ya existe no se actualiza.",
  employees:
    "Crea los empleados que no existen. Se compara por CUIL (o por nombre si no tiene). Un chofer guarda su licencia (número, categoría y vencimiento) en su ficha de chofer.",
  vehicles: "Crea los vehículos que no existen. Se compara por patente.",
  historic_payroll:
    "Sueldos de meses anteriores al sistema, solo de referencia: no generan asientos, pagos ni cuenta corriente del empleado. Los empleados tienen que estar cargados.",
  historic_trips:
    "Viajes anteriores al sistema, solo de referencia: no generan facturas, extras de chofer ni rentabilidad. Vehículo, chofer y cliente se buscan por patente, nombre o CUIT; si no se encuentran se guarda el texto.",
  client_tariffs:
    "Crea las tarifas por cliente con su vigencia, como el tarifario del cliente: para todas las áreas, o para un área si la fila la nombra (se busca por nombre dentro del depósito). Una tarifa que se superpone con otra del mismo concepto y área queda con error; la misma tarifa con el mismo inicio se saltea. Los clientes tienen que estar cargados.",
  loans:
    "Crea los préstamos vigentes al arranque con sus cuotas pendientes, como el alta de préstamo. No registra el desembolso: la deuda entra con el ajuste inicial. Cada cuota se edita o desglosa después.",
  checks:
    "Carga los cheques de terceros que están en cartera al arranque, como un cheque cargado a mano: entran a la cuenta de cartera con contrapartida en ajustes de caja (sin cliente). Si ya cargaste el saldo inicial de esa cuenta, no lo dupliques. El mismo banco y número se saltea.",
  opening_balances:
    "Carga lo que debe cada cliente al corte, en pesos, como el saldo inicial del cliente: no crea recibos, movimientos ni asientos, y se imputa a las facturas anteriores al corte si las hay. Un cliente que ya tiene saldo inicial se saltea. Una fila por cliente.",
  bank_statement:
    "Carga las líneas del extracto de la cuenta elegida para conciliarlas en Tesorería › Conciliación. No crea movimientos. Las líneas que ya estaban (por ejemplo, de un extracto superpuesto) se saltean.",
};

/** The accounts a kind's rows can go to. */
function accountFits(kind: ImportKind, type: AccountType): boolean {
  return kind === "checks" ? isCheckAccount(type) : !isCheckAccount(type);
}

function AccountSelect({
  kind,
  value,
  onChange,
  disabled,
}: {
  kind: ImportKind;
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  const { data: accounts } = useAccountsList();
  const options = accounts.filter(
    (a) => a.is_active && accountFits(kind, a.type),
  );
  return (
    <Select
      value={value || undefined}
      onValueChange={onChange}
      disabled={disabled}
    >
      <SelectTrigger id="import-account" className="w-full min-w-0">
        <SelectValue placeholder="Elegí la cuenta" />
      </SelectTrigger>
      <SelectContent>
        {options.map((a) => (
          <SelectItem key={a.id} value={a.id}>
            {a.name} · {ACCOUNT_TYPE_LABEL[a.type]} · {a.currency}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function commitLabel(ready: number, fill: number): string {
  const rows = `Importar ${ready} ${ready === 1 ? "fila" : "filas"}`;
  const codes = `${fill} ${fill === 1 ? "código" : "códigos"}`;
  if (fill === 0) return rows;
  if (ready === 0) return `Completar ${codes}`;
  return `${rows} y completar ${codes}`;
}

export function ImportDialog({
  open,
  onOpenChange,
  kinds,
  canReadAccounts,
  fixedAccountId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The kinds this user may import. */
  kinds: readonly ImportKind[];
  /** accounts:read, to list the accounts of checks and statements. */
  canReadAccounts: boolean;
  /** Opened from an account: its statement goes to that account only. */
  fixedAccountId?: string;
}) {
  const previewMut = usePreviewImport();
  const commitMut = useCommitImport();
  const { channels } = useScope();
  const activeChannels = channels.filter((c) => c.is_active);
  const [kind, setKind] = useState<ImportKind | null>(kinds[0] ?? null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [mapping, setMapping] = useState<ImportMapping | null>(null);
  const [accountId, setAccountId] = useState(fixedAccountId ?? "");
  const [channelId, setChannelId] = useState("");

  function reset() {
    setFile(null);
    setPreview(null);
    setMapping(null);
  }

  const needsAccount = !!kind && kindNeedsAccount(kind);
  const needsChannel = !!kind && kindNeedsChannel(kind);
  const targetsReady =
    (!needsAccount || accountId !== "") && (!needsChannel || channelId !== "");

  function formData(withMapping: ImportMapping | null): FormData | null {
    if (!file || !kind || !targetsReady) return null;
    const data = new FormData();
    data.set("file", file);
    data.set("kind", kind);
    if (withMapping) data.set("mapping", JSON.stringify(withMapping));
    if (needsAccount) data.set("account_id", accountId);
    if (needsChannel) data.set("channel_id", channelId);
    return data;
  }

  function read(withMapping: ImportMapping | null) {
    const data = formData(withMapping);
    if (!data) return;
    previewMut.mutate(data, {
      onSuccess: (result) => {
        setPreview(result);
        setMapping(result.mapping);
      },
      onError: (err) => {
        setPreview(null);
        toast.error(err.message);
      },
    });
  }

  function commit() {
    const data = formData(mapping);
    if (!data) return;
    commitMut.mutate(data, {
      onSuccess: ({ inserted, filled, skipped, invalid }) => {
        const extra = [
          filled
            ? `${filled} ${filled === 1 ? "código completado" : "códigos completados"}`
            : null,
          skipped > 0 ? `${skipped} ya estaban` : null,
          invalid > 0 ? `${invalid} con error quedaron afuera` : null,
        ].filter(Boolean);
        toast.success(
          inserted === 0 && filled
            ? `Se completó el código del banco en ${filled} ${filled === 1 ? "línea" : "líneas"} ya cargadas.`
            : `Se importaron ${inserted} filas${extra.length > 0 ? ` (${extra.join("; ")})` : ""}.`,
        );
        reset();
        onOpenChange(false);
      },
      onError: (err) => toast.error(err.message),
    });
  }

  function setColumn(field: string, value: string) {
    const next: ImportMapping = { ...mapping };
    if (value === NONE) delete next[field];
    else next[field] = Number(value);
    setMapping(next);
  }

  const busy = previewMut.isPending || commitMut.isPending;
  const fields = kind ? IMPORT_FIELDS[kind] : [];
  const ready = preview?.counts.ready ?? 0;
  const fill = preview?.counts.fill ?? 0;
  // The commit reads the file with the mapping it sends: one the user changed
  // after the preview has to be read again first.
  const mappingChanged =
    !!preview &&
    !!mapping &&
    JSON.stringify(mapping) !== JSON.stringify(preview.mapping);
  const committedBefore = preview?.previousRuns.find(
    (r) => r.status === "committed",
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Importar planilla</DialogTitle>
          <DialogDescription>
            Subí un .xlsx (primera hoja) o .csv con una fila de títulos. Nada se
            guarda hasta que confirmes; las filas con error quedan afuera y las
            que ya están cargadas se saltean.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[14rem_1fr_auto] sm:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="import-kind">Qué importar</Label>
            <Select
              value={kind ?? undefined}
              onValueChange={(v) => {
                if (isImportKind(v)) setKind(v);
                setAccountId(fixedAccountId ?? "");
                setPreview(null);
                setMapping(null);
              }}
            >
              <SelectTrigger id="import-kind">
                <SelectValue placeholder="Elegí" />
              </SelectTrigger>
              <SelectContent>
                {IMPORT_KINDS.filter((k) => kinds.includes(k)).map((k) => (
                  <SelectItem key={k} value={k}>
                    {IMPORT_KIND_LABELS[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-0 space-y-1.5">
            <Label htmlFor="import-file">Archivo</Label>
            <Input
              id="import-file"
              type="file"
              accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setPreview(null);
                setMapping(null);
              }}
            />
          </div>
          <DisabledHint
            reason={firstReason(
              [!file, "Elegí un archivo."],
              [!kind, "Elegí qué vas a importar."],
              [
                !targetsReady,
                needsAccount && accountId === ""
                  ? "Elegí la cuenta."
                  : "Elegí el canal.",
              ],
            )}
          >
            <Button
              type="button"
              variant="outline"
              disabled={!file || !kind || !targetsReady || busy}
              onClick={() => read(null)}
            >
              {previewMut.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <FileUp className="size-4" />
              )}
              Leer archivo
            </Button>
          </DisabledHint>
        </div>

        {kind && (needsAccount || needsChannel) && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {needsAccount && (
              <div className="min-w-0 space-y-1.5">
                <Label htmlFor="import-account">
                  {kind === "checks"
                    ? "Cuenta de cartera"
                    : "Cuenta del extracto"}
                </Label>
                {canReadAccounts ? (
                  <Suspense fallback={<Skeleton className="h-9 w-full" />}>
                    <AccountSelect
                      kind={kind}
                      value={accountId}
                      disabled={fixedAccountId !== undefined}
                      onChange={(id) => {
                        setAccountId(id);
                        setPreview(null);
                        setMapping(null);
                      }}
                    />
                  </Suspense>
                ) : (
                  <p className="text-muted-foreground text-sm">
                    No tenés permiso para ver las cuentas.
                  </p>
                )}
              </div>
            )}
            {needsChannel && (
              <div className="min-w-0 space-y-1.5">
                <Label htmlFor="import-channel">Canal</Label>
                <Select
                  value={channelId || undefined}
                  onValueChange={(v) => {
                    setChannelId(v);
                    setPreview(null);
                    setMapping(null);
                  }}
                >
                  <SelectTrigger id="import-channel" className="w-full min-w-0">
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
            )}
          </div>
        )}

        {kind && !preview && (
          <div className="text-muted-foreground space-y-1 text-sm">
            <p>{KIND_NOTES[kind]}</p>
            <p>
              Columnas:{" "}
              {fields
                .map((f) => `${f.label}${f.required ? " (obligatoria)" : ""}`)
                .join(", ")}
              .
            </p>
            {fields.some((f) => f.hint) && (
              <ul className="list-disc pl-5">
                {fields
                  .filter((f) => f.hint)
                  .map((f) => (
                    <li key={f.key}>
                      {f.label}: {f.hint}
                    </li>
                  ))}
              </ul>
            )}
          </div>
        )}

        {preview && mapping && (
          <div className="space-y-2">
            <p className="text-sm font-medium">Columnas</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {fields.map((field) => (
                <div key={field.key} className="min-w-0 space-y-1">
                  <Label
                    htmlFor={`import-col-${field.key}`}
                    className="text-xs"
                  >
                    {field.label}
                    {field.required &&
                      (preview.missing.includes(field.key) ? " (falta)" : " *")}
                  </Label>
                  <Select
                    value={
                      mapping[field.key] === undefined
                        ? NONE
                        : String(mapping[field.key])
                    }
                    onValueChange={(v) => setColumn(field.key, v)}
                  >
                    <SelectTrigger
                      id={`import-col-${field.key}`}
                      className="h-8 text-xs"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>No está</SelectItem>
                      {preview.headers.map((h, i) => (
                        <SelectItem key={i} value={String(i)}>
                          {h || `Columna ${i + 1}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
            <Button
              type="button"
              size="sm"
              variant={mappingChanged ? "default" : "outline"}
              disabled={busy}
              onClick={() => read(mapping)}
            >
              Volver a leer con estas columnas
            </Button>
          </div>
        )}

        {preview && committedBefore && (
          <p className="flex items-start gap-2 text-sm">
            <Info className="mt-0.5 size-4 shrink-0" />
            Este mismo archivo ya se importó el{" "}
            {formatArgentineDateTime(committedBefore.created_at)}: lo que ya
            está cargado se saltea.
          </p>
        )}

        {preview && preview.missing.length > 0 && (
          <p className="text-sm">
            Elegí la columna de{" "}
            {preview.missing
              .map((key) => fieldLabel(preview.kind, key).toLowerCase())
              .join(", ")}{" "}
            y volvé a leer.
          </p>
        )}

        {preview && preview.missing.length === 0 && (
          <div className="space-y-2">
            <p className="text-muted-foreground text-sm">
              {preview.counts.ready} listas ·{" "}
              {fill > 0 && `${fill} completan el código del banco · `}
              {preview.counts.duplicate} ya cargadas · {preview.counts.invalid}{" "}
              con error
              {preview.truncated &&
                " · el archivo tiene más de 5000 filas o celdas muy largas: dividilo para importarlo"}
            </p>
            <div className="max-h-96 overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-14">Fila</TableHead>
                    <TableHead>Registro</TableHead>
                    <TableHead>Estado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.rows.map((r) => (
                    <TableRow key={r.line}>
                      <TableCell className="text-muted-foreground align-top text-xs">
                        {r.line}
                      </TableCell>
                      <TableCell className="align-top">
                        <span className="text-sm">{r.label}</span>
                        {r.detail && (
                          <span className="text-muted-foreground block text-xs">
                            {r.detail}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="align-top text-sm">
                        <span
                          className={
                            r.status === "ready" || r.status === "fill"
                              ? ""
                              : "font-medium"
                          }
                        >
                          {IMPORT_ROW_STATUS_LABELS[r.status]}
                        </span>
                        {[...r.errors, ...r.warnings].map((m) => (
                          <span
                            key={m}
                            className="text-muted-foreground block text-xs"
                          >
                            {m}
                          </span>
                        ))}
                      </TableCell>
                    </TableRow>
                  ))}
                  {preview.rows.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={3}
                        className="text-muted-foreground text-center text-sm"
                      >
                        El archivo no tiene filas debajo de los títulos.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              reset();
              onOpenChange(false);
            }}
          >
            Cancelar
          </Button>
          <DisabledHint
            reason={
              !preview
                ? "Leé el archivo primero."
                : firstReason(
                    [
                      preview.missing.length > 0,
                      "Faltan columnas: elegilas y volvé a leer.",
                    ],
                    [
                      preview.truncated,
                      "El archivo es demasiado grande: dividilo para importarlo.",
                    ],
                    [
                      mappingChanged,
                      "Cambiaste las columnas: volvé a leer el archivo.",
                    ],
                    [ready + fill === 0, "No hay filas listas para importar."],
                  )
            }
          >
            <Button
              type="button"
              disabled={
                !preview ||
                preview.missing.length > 0 ||
                preview.truncated ||
                mappingChanged ||
                ready + fill === 0 ||
                busy
              }
              onClick={commit}
            >
              {commitMut.isPending ? "Importando…" : commitLabel(ready, fill)}
            </Button>
          </DisabledHint>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
