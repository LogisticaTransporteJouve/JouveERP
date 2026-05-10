"use client";

import { Settings } from "lucide-react";
import { Suspense, useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import {
  useConfigurePos,
  useInvoicingChannels,
} from "../hooks/use-afip-admin";

const NO_CHANNEL_VALUE = "__none__";

type ChannelLabels = Record<string, string>;

export function ConfigurePosDialog({
  point,
  onChannelLabels,
  onUpdated,
}: {
  point: SalesPointRow;
  onChannelLabels: (labels: ChannelLabels) => void;
  onUpdated: (row: SalesPointRow) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Configurar">
          <Settings className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            Punto de venta {String(point.numero).padStart(5, "0")}
          </DialogTitle>
          <DialogDescription>
            Asociá el POS a un canal para que aparezca en el form de emisión.
          </DialogDescription>
        </DialogHeader>
        {open ? (
          <Suspense
            fallback={
              <p className="py-4 text-center text-sm text-muted-foreground">
                Cargando canales…
              </p>
            }
          >
            <ConfigurePosForm
              point={point}
              onChannelLabels={onChannelLabels}
              onUpdated={onUpdated}
              onClose={() => setOpen(false)}
            />
          </Suspense>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ConfigurePosForm({
  point,
  onChannelLabels,
  onUpdated,
  onClose,
}: {
  point: SalesPointRow;
  onChannelLabels: (labels: ChannelLabels) => void;
  onUpdated: (row: SalesPointRow) => void;
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

  useEffect(() => {
    const labels: ChannelLabels = {};
    for (const c of channels) labels[c.id] = c.name;
    onChannelLabels(labels);
  }, [channels, onChannelLabels]);

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
        onSuccess: (data) => {
          toast.success("Configuración guardada.");
          onUpdated(data);
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
          placeholder="Ej: Jouve, DZ Instalaciones"
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
