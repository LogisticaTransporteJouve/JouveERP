"use client";

import { Suspense, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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

import type { SalesPointRow } from "../actions/afip-admin-actions";
import { useConfigurePos, useInvoicingChannels } from "../hooks/use-afip-admin";

const NO_CHANNEL_VALUE = "__none__";

/** One dialog for the whole table, opened with the row to edit. Living
 *  outside the table keeps it mounted while the rows re-render; a dialog
 *  unmounted while open leaves Radix's `pointer-events: none` on the body. */
export function ConfigurePosDialog({
  point,
  onClose,
}: {
  point: SalesPointRow | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={point !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        {point ? (
          <>
            <DialogHeader>
              <DialogTitle>
                Punto de venta {String(point.numero).padStart(5, "0")}
              </DialogTitle>
              <DialogDescription>
                Asociá el POS a un canal para que aparezca en el form de
                emisión.
              </DialogDescription>
            </DialogHeader>
            <Suspense
              fallback={
                <p className="py-4 text-center text-sm text-muted-foreground">
                  Cargando canales…
                </p>
              }
            >
              <ConfigurePosForm
                key={point.numero}
                point={point}
                onClose={onClose}
              />
            </Suspense>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ConfigurePosForm({
  point,
  onClose,
}: {
  point: SalesPointRow;
  onClose: () => void;
}) {
  const channelsQuery = useInvoicingChannels();
  const channels = channelsQuery.data;
  const configureMut = useConfigurePos();

  const [channelId, setChannelId] = useState<string>(
    point.channel_id ?? NO_CHANNEL_VALUE,
  );
  const [nickname, setNickname] = useState(point.nickname ?? "");
  const [isEnabled, setIsEnabled] = useState(point.is_enabled);

  const isSaving = configureMut.isPending;

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = nickname.trim();
    configureMut.mutate(
      {
        numero: point.numero,
        channel_id: channelId === NO_CHANNEL_VALUE ? null : channelId,
        nickname: trimmed.length === 0 ? null : trimmed,
        is_enabled: isEnabled,
      },
      {
        onSuccess: () => {
          toast.success("Configuración guardada.");
          onClose();
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  const isDirty =
    (point.channel_id ?? NO_CHANNEL_VALUE) !== channelId ||
    (point.nickname ?? "") !== nickname.trim() ||
    point.is_enabled !== isEnabled;

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid gap-2">
        <Label htmlFor="pos-nickname">Alias</Label>
        <Input
          id="pos-nickname"
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          placeholder="Ej: Jouve fiscal"
          autoComplete="off"
          maxLength={120}
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="pos-channel">Canal</Label>
        <Select value={channelId} onValueChange={setChannelId}>
          <SelectTrigger id="pos-channel">
            <SelectValue placeholder="Sin asignar" />
          </SelectTrigger>
          <SelectContent position="popper">
            <SelectItem value={NO_CHANNEL_VALUE}>Sin asignar</SelectItem>
            {channels.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <label className="flex items-start gap-2 text-sm">
        <Checkbox
          checked={isEnabled}
          onCheckedChange={(value) => setIsEnabled(value === true)}
        />
        <span className="leading-snug">
          Habilitado para emitir desde JouveERP.
          <span className="block text-xs text-muted-foreground">
            Si no, el POS no aparece en el form de comprobantes.
          </span>
        </span>
      </label>

      <div className="flex items-center justify-end gap-2 pt-2">
        <Button
          type="button"
          variant="ghost"
          onClick={() => onClose()}
          disabled={isSaving}
        >
          Cancelar
        </Button>
        <Button type="submit" disabled={isSaving || !isDirty}>
          {isSaving ? "Guardando…" : "Guardar"}
        </Button>
      </div>
    </form>
  );
}
