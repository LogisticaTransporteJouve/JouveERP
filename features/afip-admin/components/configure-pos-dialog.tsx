"use client";

import { Settings } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
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

import {
  configurePosAction,
  listInvoicingChannelsAction,
  type SalesPointRow,
} from "../actions/afip-admin-actions";

const NO_CHANNEL_VALUE = "__none__";

type Channel = { id: string; name: string };
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
  const [channels, setChannels] = useState<Channel[]>([]);
  const [channelId, setChannelId] = useState<string>(
    point.channel_id ?? NO_CHANNEL_VALUE,
  );
  const [nickname, setNickname] = useState(point.nickname ?? "");
  const [isEnabled, setIsEnabled] = useState(point.is_enabled);
  const [isSaving, startSaving] = useTransition();

  useEffect(() => {
    if (!open) return;
    setChannelId(point.channel_id ?? NO_CHANNEL_VALUE);
    setNickname(point.nickname ?? "");
    setIsEnabled(point.is_enabled);
    void (async () => {
      const res = await listInvoicingChannelsAction();
      if (!res.ok) return;
      setChannels(res.data.map(({ id, name }) => ({ id, name })));
      const labels: ChannelLabels = {};
      for (const c of res.data) labels[c.id] = c.name;
      onChannelLabels(labels);
    })();
  }, [open, point, onChannelLabels]);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    startSaving(async () => {
      const trimmed = nickname.trim();
      const res = await configurePosAction({
        numero: point.numero,
        channel_id: channelId === NO_CHANNEL_VALUE ? null : channelId,
        nickname: trimmed.length === 0 ? null : trimmed,
        is_enabled: isEnabled,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Configuración guardada.");
      onUpdated(res.data);
      setOpen(false);
    });
  }

  const isDirty =
    (point.channel_id ?? NO_CHANNEL_VALUE) !== channelId ||
    (point.nickname ?? "") !== nickname.trim() ||
    point.is_enabled !== isEnabled;

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
              onClick={() => setOpen(false)}
              disabled={isSaving}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={isSaving || !isDirty}>
              {isSaving ? "Guardando…" : "Guardar"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
