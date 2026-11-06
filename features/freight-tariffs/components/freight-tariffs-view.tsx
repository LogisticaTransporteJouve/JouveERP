"use client";

import { Pencil, Percent, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { DisabledHint } from "@/components/disabled-hint";
import { useConfirm } from "@/components/providers/confirm-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { IconButton } from "@/components/ui/icon-button";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatArgentineDate, formatMoney } from "@/lib/format";

import {
  useDeleteFreightTariffList,
  useDeleteFreightTariffVersion,
  useFreightTariffs,
} from "../hooks/use-freight-tariffs";
import {
  lineChange,
  type FreightTariffList,
  type FreightTariffVersion,
} from "../schema";
import { FreightTariffIncreaseDialog } from "./freight-tariff-increase-dialog";
import { FreightTariffListDialog } from "./freight-tariff-list-dialog";
import { FreightTariffVersionDialog } from "./freight-tariff-version-dialog";

const pctText = (n: number) =>
  `${n > 0 ? "+" : ""}${n.toLocaleString("es-AR", { maximumFractionDigits: 1 })}%`;

/** Flota › Tarifas: each tarifario's prices by period, to follow the
 *  increases. A reference only: no carga takes these prices. */
export function FreightTariffsView({ canWrite }: { canWrite: boolean }) {
  const { data: lists } = useFreightTariffs();
  const [listId, setListId] = useState<string | null>(lists[0]?.id ?? null);
  const list = lists.find((l) => l.id === listId) ?? lists[0] ?? null;
  const [dialog, setDialog] = useState<"new" | "edit" | "increase" | null>(
    null,
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tarifas de flete"
        description="Los precios de flete por período, para seguir los aumentos. Son de referencia: no se usan en las cargas."
        actions={
          canWrite && (
            <>
              <DisabledHint
                reason={lists.length === 0 ? "No hay listas de tarifas." : null}
              >
                <Button
                  variant="outline"
                  disabled={lists.length === 0}
                  onClick={() => setDialog("increase")}
                >
                  <Percent className="size-4" />
                  Aplicar aumento
                </Button>
              </DisabledHint>
              <Button onClick={() => setDialog("new")}>
                <Plus className="size-4" />
                Nuevo tarifario
              </Button>
            </>
          )
        }
      />

      {lists.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          Todavía no hay tarifarios. Creá el general y los de los clientes con
          tarifa propia.
        </p>
      ) : (
        <>
          <div className="max-w-sm space-y-1">
            <Label htmlFor="freight-tariff-list">Tarifario</Label>
            <Combobox
              id="freight-tariff-list"
              options={lists.map((l) => ({ value: l.id, label: l.name }))}
              value={list?.id ?? ""}
              onChange={(v) => v && setListId(v)}
              searchPlaceholder="Buscar tarifario…"
              emptyText="Sin tarifarios."
            />
          </div>
          {list && (
            <ListDetail
              key={list.id}
              list={list}
              canWrite={canWrite}
              onEdit={() => setDialog("edit")}
            />
          )}
        </>
      )}

      {dialog === "new" && (
        <FreightTariffListDialog
          onClose={() => setDialog(null)}
          onCreated={(id) => setListId(id)}
        />
      )}
      {dialog === "edit" && list && (
        <FreightTariffListDialog list={list} onClose={() => setDialog(null)} />
      )}
      {dialog === "increase" && (
        <FreightTariffIncreaseDialog
          lists={lists}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}

function ListDetail({
  list,
  canWrite,
  onEdit,
}: {
  list: FreightTariffList;
  canWrite: boolean;
  onEdit: () => void;
}) {
  const confirm = useConfirm();
  const deleteList = useDeleteFreightTariffList();
  const deleteVersion = useDeleteFreightTariffVersion();
  const [versionId, setVersionId] = useState(list.versions[0]?.id ?? "");
  const index = Math.max(
    0,
    list.versions.findIndex((v) => v.id === versionId),
  );
  const version = list.versions[index];
  const previous = list.versions[index + 1];
  const [editing, setEditing] = useState<FreightTariffVersion | null>(null);

  return (
    <section className="space-y-4 rounded-lg border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h2 className="text-lg font-semibold">{list.name}</h2>
          {list.notes && (
            <p className="text-sm text-muted-foreground">{list.notes}</p>
          )}
        </div>
        {canWrite && (
          <div className="flex gap-1">
            <IconButton
              label="Editar tarifario"
              variant="ghost"
              onClick={onEdit}
            >
              <Pencil className="size-4" />
            </IconButton>
            <IconButton
              label="Borrar tarifario"
              variant="ghost"
              disabled={deleteList.isPending}
              onClick={async () => {
                const ok = await confirm({
                  title: "Borrar tarifario",
                  description: `Se borra «${list.name}» con todos sus períodos.`,
                  confirmLabel: "Borrar",
                  tone: "destructive",
                });
                if (!ok) return;
                deleteList.mutate(list.id, {
                  onError: (err) => toast.error(err.message),
                });
              }}
            >
              <Trash2 className="size-4" />
            </IconButton>
          </div>
        )}
      </div>

      {version && (
        <div className="flex flex-wrap items-center gap-2">
          <Select value={version.id} onValueChange={setVersionId}>
            <SelectTrigger aria-label="Período" className="w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {list.versions.map((v) => (
                <SelectItem key={v.id} value={v.id}>
                  {v.label} · desde {formatArgentineDate(v.valid_from)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {version.increase_pct !== null && (
            <Badge variant="outline">
              Aumento {pctText(version.increase_pct)}
            </Badge>
          )}
          {canWrite && (
            <div className="ml-auto flex gap-1">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setEditing(version)}
              >
                <Pencil className="size-4" />
                Editar precios
              </Button>
              {list.versions.length > 1 && (
                <IconButton
                  label="Borrar período"
                  variant="ghost"
                  disabled={deleteVersion.isPending}
                  onClick={async () => {
                    const ok = await confirm({
                      title: "Borrar período",
                      description: `Se borran los precios de «${version.label}».`,
                      confirmLabel: "Borrar",
                      tone: "destructive",
                    });
                    if (!ok) return;
                    deleteVersion.mutate(version.id, {
                      onSuccess: () => setVersionId(""),
                      onError: (err) => toast.error(err.message),
                    });
                  }}
                >
                  <Trash2 className="size-4" />
                </IconButton>
              )}
            </div>
          )}
        </div>
      )}

      {version && <LinesTable version={version} previous={previous} />}

      {list.versions.length > 1 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Historial</h3>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="p-2 font-medium">Período</th>
                  <th className="p-2 font-medium">Desde</th>
                  <th className="p-2 text-right font-medium">Aumento</th>
                </tr>
              </thead>
              <tbody>
                {list.versions.map((v) => (
                  <tr key={v.id} className="border-t">
                    <td className="p-2">{v.label}</td>
                    <td className="p-2">{formatArgentineDate(v.valid_from)}</td>
                    <td className="p-2 text-right tabular-nums">
                      {v.increase_pct !== null ? pctText(v.increase_pct) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {editing && (
        <FreightTariffVersionDialog
          listName={list.name}
          version={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  );
}

function LinesTable({
  version,
  previous,
}: {
  version: FreightTariffVersion;
  previous: FreightTariffVersion | undefined;
}) {
  if (version.lines.length === 0) {
    return (
      <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
        Este período no tiene precios cargados.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full min-w-[560px] text-sm">
        <thead className="text-left text-xs text-muted-foreground">
          <tr>
            <th className="p-2 font-medium">Concepto</th>
            <th className="p-2 text-right font-medium">Precio</th>
            {previous && (
              <>
                <th className="p-2 text-right font-medium">Anterior</th>
                <th className="p-2 text-right font-medium">Variación</th>
              </>
            )}
            <th className="p-2 font-medium">Nota</th>
          </tr>
        </thead>
        <tbody>
          {version.lines.flatMap((l, i) => {
            const rows = [];
            const section = l.section ?? null;
            // A section's title row goes before its first line.
            if (
              section &&
              section !== (version.lines[i - 1]?.section ?? null)
            ) {
              rows.push(
                <tr key={`s-${l.id}`} className="border-t bg-muted/40">
                  <td
                    colSpan={previous ? 5 : 3}
                    className="p-2 text-xs font-semibold"
                  >
                    {section}
                  </td>
                </tr>,
              );
            }
            const change = lineChange(l, previous);
            rows.push(
              <tr key={l.id} className="border-t">
                <td className="p-2">{l.concept}</td>
                <td className="p-2 text-right tabular-nums">
                  {l.price !== null
                    ? formatMoney(l.price)
                    : l.percent !== null
                      ? `${l.percent.toLocaleString("es-AR")}%`
                      : "—"}
                </td>
                {previous && (
                  <>
                    <td className="p-2 text-right text-muted-foreground tabular-nums">
                      {change ? formatMoney(change.previous) : "—"}
                    </td>
                    <td className="p-2 text-right tabular-nums">
                      {change ? pctText(change.pct) : "—"}
                    </td>
                  </>
                )}
                <td className="p-2 text-muted-foreground">{l.note ?? ""}</td>
              </tr>,
            );
            return rows;
          })}
        </tbody>
      </table>
    </div>
  );
}
