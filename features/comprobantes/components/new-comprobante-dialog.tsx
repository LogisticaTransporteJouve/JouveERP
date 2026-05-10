"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
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
import { Textarea } from "@/components/ui/textarea";
import {
  CONCEPTO,
  IVA_RATE,
  ivaRatePercent,
  letterFor,
  condicionIvaReceptorFor,
  type IvaRateId,
} from "@/lib/afip/codes";
import { computeTotals } from "@/features/comprobantes/schema";

import type { PosOption } from "../actions/comprobantes-actions";
import {
  useEnabledPos,
  useIssueFiscalInvoice,
} from "../hooks/use-comprobantes";
import { ClientPicker, type PickedClient } from "./client-picker";

const DEFAULT_CHANNEL_ID = "jouve_fiscal";

interface ChannelOption {
  id: string;
  name: string;
  division: string; // 'jouve' | 'dz'
  is_fiscal: boolean;
}

// Each division has a default Concepto AFIP code, derived from what the
// division actually invoices. Jouve sells transport (services); DZ
// Instalaciones sells equipment + installation (productos+servicios).
function conceptoForDivision(division: string): 1 | 2 | 3 {
  if (division === "dz") return CONCEPTO.PRODUCTOS_Y_SERVICIOS;
  return CONCEPTO.SERVICIOS;
}

type ItemDraft = {
  description: string;
  quantity: string;
  unit_price: string;
  iva_rate_id: IvaRateId;
};

const SEGURO_DESCRIPTION = "Seguro";

function defaultItems(): ItemDraft[] {
  return [
    { description: "", quantity: "1", unit_price: "", iva_rate_id: IVA_RATE.TWENTY_ONE },
    {
      description: SEGURO_DESCRIPTION,
      quantity: "0.01",
      unit_price: "",
      iva_rate_id: IVA_RATE.TWENTY_ONE,
    },
  ];
}
// Quick percentages for the Seguro line. "Otro" lets the user type a custom
// number that gets stored as quantity (= pct/100) on submit.
const SEGURO_PERCENTAGES = [1, 2, 3, 5] as const;
const SEGURO_CUSTOM_VALUE = "__custom__";

const RATE_OPTIONS: Array<{ value: IvaRateId; label: string }> = [
  { value: IVA_RATE.ZERO, label: "0%" },
  { value: IVA_RATE.TWO_FIVE, label: "2.5%" },
  { value: IVA_RATE.FIVE, label: "5%" },
  { value: IVA_RATE.TEN_FIVE, label: "10.5%" },
  { value: IVA_RATE.TWENTY_ONE, label: "21%" },
  { value: IVA_RATE.TWENTY_SEVEN, label: "27%" },
];

export function NewComprobanteDialog({
  channels,
}: {
  channels: ChannelOption[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus />
          Nuevo
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Nuevo comprobante</DialogTitle>
          <DialogDescription>
            Se emite con CAE de AFIP. Una vez emitido no se puede modificar.
          </DialogDescription>
        </DialogHeader>
        {open && (
          <NewComprobanteForm
            channels={channels}
            onSuccess={() => setOpen(false)}
            onCancel={() => setOpen(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function NewComprobanteForm({
  channels,
  onSuccess,
  onCancel,
}: {
  channels: ChannelOption[];
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const router = useRouter();
  const issueMut = useIssueFiscalInvoice();
  const isSubmitting = issueMut.isPending;

  // Header — default to Jouve Fiscal when present in the channel list.
  const initialChannel =
    channels.find((c) => c.id === DEFAULT_CHANNEL_ID)?.id ??
    channels[0]?.id ??
    "";
  const [channelId, setChannelId] = useState<string>(initialChannel);
  const [puntoVenta, setPuntoVenta] = useState<string>("");
  const [fecha, setFecha] = useState(() => new Date().toISOString().slice(0, 10));

  const posQuery = useEnabledPos(channelId);
  const posOptions: PosOption[] = useMemo(
    () => posQuery.data ?? [],
    [posQuery.data],
  );

  // Auto-pick the first POS when the list resolves (channel changed).
  useEffect(() => {
    if (posOptions.length === 1) {
      setPuntoVenta(String(posOptions[0]!.numero));
    } else if (posOptions.length === 0) {
      setPuntoVenta("");
    }
  }, [posOptions]);

  const currentChannel = channels.find((c) => c.id === channelId) ?? null;
  const concepto = currentChannel
    ? conceptoForDivision(currentChannel.division)
    : CONCEPTO.SERVICIOS;
  // Cliente
  const [client, setClient] = useState<PickedClient | null>(null);

  // Items — first row is the user's, last row is the Seguro line that's
  // always present and can't be removed. Seguro stores `quantity = pct/100`
  // so `line_neto = unit_price (valor declarado) × quantity (pct)` matches
  // what computeTotals expects without a special case.
  const [items, setItems] = useState<ItemDraft[]>(() => defaultItems());

  // Notes / NC-ND
  const [motivo, setMotivo] = useState("");

  // Bumped after "Emitir y continuar" to force a fresh ClientPicker mount,
  // which auto-focuses its search input.
  const [clientPickerKey, setClientPickerKey] = useState(0);

  function resetForContinue() {
    setClient(null);
    setItems(defaultItems());
    setMotivo("");
    setClientPickerKey((k) => k + 1);
  }

  function updateItem(index: number, patch: Partial<ItemDraft>) {
    setItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    );
  }

  function addItem() {
    // Insert before the Seguro row so it always stays at the bottom.
    setItems((prev) => {
      const next = [...prev];
      next.splice(next.length - 1, 0, {
        description: "",
        quantity: "1",
        unit_price: "",
        iva_rate_id: IVA_RATE.TWENTY_ONE,
      });
      return next;
    });
  }

  function removeItem(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  function isSeguroRow(item: ItemDraft): boolean {
    return item.description === SEGURO_DESCRIPTION;
  }

  const totals = useMemo(
    () =>
      computeTotals(
        items.map((it) => ({
          quantity: Number(it.quantity) || 0,
          unit_price: Number(it.unit_price) || 0,
          iva_rate_id: it.iva_rate_id,
        })),
        true,
      ),
    [items],
  );

  const isServiciosConcepto =
    concepto === CONCEPTO.SERVICIOS || concepto === CONCEPTO.PRODUCTOS_Y_SERVICIOS;

  const isFiscal = currentChannel?.is_fiscal ?? true;
  const letter =
    isFiscal && client ? letterFor(client.iva_condition) : null;

  function issue(continueMode: boolean) {
    if (!client) {
      toast.error("Verificá un cliente antes de emitir.");
      return;
    }
    if (!puntoVenta) {
      toast.error("Elegí un punto de venta.");
      return;
    }
    // Drop the Seguro row if its valor declarado quedó vacío/0 — la idea
    // es que la fila esté siempre disponible en el form pero no infle la
    // factura cuando no aplica.
    const itemsForSubmit = items.filter((it) => {
      if (!isSeguroRow(it)) return true;
      const declared = Number(it.unit_price);
      return Number.isFinite(declared) && declared > 0;
    });

    if (
      itemsForSubmit.some((it) => it.description.trim().length === 0)
    ) {
      toast.error("Cada ítem necesita una descripción.");
      return;
    }
    if (totals.imp_total <= 0) {
      toast.error("El total tiene que ser mayor a cero.");
      return;
    }

    // AFIP requires fch_serv_* + fch_vto_pago when concepto is Servicios (2)
    // or Productos+Servicios (3). For Jouve's typical flow — flete del día —
    // los tres se setean al mismo día de emisión.
    const fchServ = isServiciosConcepto ? fecha : null;

    issueMut.mutate(
      {
        channel_id: channelId,
        client_id: client.id,
        kind: "factura",
        // Internal channels: letter and condicionIvaReceptor are ignored by
        // the action and the workflow takes the no-AFIP branch.
        letter: isFiscal ? (letter ?? "B") : null,
        punto_venta: Number(puntoVenta),
        fecha,
        fch_serv_desde: fchServ,
        fch_serv_hasta: fchServ,
        fch_vto_pago: fchServ,
        concepto: concepto as 1 | 2 | 3,
        doc_tipo: 80,
        doc_nro: client.cuit,
        iva_condition_receptor: isFiscal
          ? condicionIvaReceptorFor(client.iva_condition)
          : null,
        moneda: "PES",
        cotizacion: 1,
        motivo_nc_nd: motivo.trim().length === 0 ? null : motivo.trim(),
        items: itemsForSubmit.map((it) => ({
          description: it.description.trim(),
          quantity: Number(it.quantity) || 0,
          unit_price: Number(it.unit_price) || 0,
          iva_rate_id: it.iva_rate_id,
        })),
      },
      {
        onSuccess: (data) => {
          toast.success("Comprobante en cola — esperando CAE.");
          if (continueMode) {
            resetForContinue();
            return;
          }
          onSuccess();
          router.push(`/comprobantes/${data.id}`);
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    issue(false);
  }

  function onFormKeyDown(e: React.KeyboardEvent<HTMLFormElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !isSubmitting) {
      e.preventDefault();
      issue(true);
    }
  }

  return (
    <form onSubmit={onSubmit} onKeyDown={onFormKeyDown} className="space-y-5">
      {/* Canal + Fecha. POS is resolved from the channel (1:1 mapping)
          and Concepto from the division (Jouve→Servicios, DZ→Productos+
          Servicios) so neither needs to live in the UI. */}
      <div className="grid gap-4 sm:grid-cols-[1fr_180px]">
        <div className="space-y-2">
          <Label>Canal</Label>
          <Select value={channelId} onValueChange={setChannelId}>
            <SelectTrigger>
              <SelectValue placeholder="Elegí un canal" />
            </SelectTrigger>
            <SelectContent position="popper">
              {channels.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {channelId && posOptions.length === 0 && (
            <p className="text-xs text-destructive">
              Sin POS habilitados — configurá uno en
              {" "}
              <code className="font-mono">/admin/afip/puntos-de-venta</code>.
            </p>
          )}
        </div>
        <div className="space-y-2">
          <Label>Fecha de emisión</Label>
          <Input
            type="date"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
          />
        </div>
      </div>

      {/* Cliente */}
      <div className="space-y-2">
        <Label>Cliente</Label>
        <ClientPicker
          key={clientPickerKey}
          value={client}
          onChange={setClient}
          autoFocus={clientPickerKey > 0}
        />
      </div>

      {/* Items */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Ítems</Label>
          <Button type="button" variant="outline" size="sm" onClick={addItem}>
            <Plus />
            Agregar ítem
          </Button>
        </div>
        <div className="space-y-2 rounded-md border p-2">
          <div className="grid grid-cols-12 gap-2 px-1 text-xs text-muted-foreground">
            <div className="col-span-5">Descripción</div>
            <div className="col-span-2">Cantidad</div>
            <div className="col-span-2">Precio unitario</div>
            <div className="col-span-2">IVA</div>
            <div className="col-span-1" />
          </div>
          {items.map((item, idx) => {
            const qty = Number(item.quantity) || 0;
            const price = Number(item.unit_price) || 0;
            const lineTotal =
              qty * price * (1 + ivaRatePercent(item.iva_rate_id) / 100);
            const seguro = isSeguroRow(item);
            return (
              <div
                key={idx}
                className="grid grid-cols-12 gap-2 rounded-md p-1"
              >
                <div className="col-span-5">
                  {seguro && <CellLabel />}
                  <Input
                    placeholder="Descripción"
                    value={item.description}
                    onChange={(e) =>
                      updateItem(idx, { description: e.target.value })
                    }
                    disabled={seguro}
                  />
                </div>
                <div className="col-span-2">
                  {seguro && <CellLabel>Porcentaje</CellLabel>}
                  {seguro ? (
                    <SeguroPercentInput
                      value={item.quantity}
                      onChange={(q) => updateItem(idx, { quantity: q })}
                    />
                  ) : (
                    <Input
                      type="text"
                      inputMode="decimal"
                      placeholder="Cantidad"
                      value={item.quantity}
                      onChange={(e) =>
                        updateItem(idx, { quantity: e.target.value })
                      }
                    />
                  )}
                </div>
                <div className="col-span-2">
                  {seguro && <CellLabel>Valor declarado</CellLabel>}
                  <Input
                    type="text"
                    inputMode="decimal"
                    placeholder="$ 0,00"
                    value={item.unit_price}
                    onChange={(e) =>
                      updateItem(idx, { unit_price: e.target.value })
                    }
                  />
                </div>
                <div className="col-span-2">
                  {seguro && <CellLabel />}
                  <Select
                    value={String(item.iva_rate_id)}
                    onValueChange={(v) =>
                      updateItem(idx, {
                        iva_rate_id: Number(v) as IvaRateId,
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent position="popper">
                      {RATE_OPTIONS.map((r) => (
                        <SelectItem key={r.value} value={String(r.value)}>
                          {r.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-1 text-right">
                  {!seguro && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeItem(idx)}
                      disabled={items.length <= 2}
                      aria-label="Quitar ítem"
                    >
                      ×
                    </Button>
                  )}
                </div>
                <div className="col-span-12 text-right text-xs text-muted-foreground font-mono">
                  Subtotal: $
                  {lineTotal.toLocaleString("es-AR", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Totals */}
      <div className="flex items-center justify-end gap-6 rounded-md border bg-muted/30 p-3">
        <div className="text-sm">
          Neto:{" "}
          <span className="font-mono">
            ${totals.imp_neto.toLocaleString("es-AR", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </span>
        </div>
        <div className="text-sm">
          IVA:{" "}
          <span className="font-mono">
            ${totals.imp_iva.toLocaleString("es-AR", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </span>
        </div>
        <div className="text-base font-semibold">
          Total:{" "}
          <span className="font-mono">
            ${totals.imp_total.toLocaleString("es-AR", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </span>
        </div>
      </div>

      {/* Notes */}
      <div className="space-y-2">
        <Label>Notas internas (no van a AFIP)</Label>
        <Textarea
          rows={2}
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
        />
      </div>

      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          onClick={onCancel}
          disabled={isSubmitting}
        >
          Cancelar
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => issue(true)}
          disabled={isSubmitting}
          title="⌘+Enter"
        >
          Emitir y continuar
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Emitiendo…" : "Emitir y solicitar CAE"}
        </Button>
      </div>
    </form>
  );
}

// Cell label used in the Seguro row. Visible labels render the prop;
// unlabeled cells render an invisible spacer so every cell reserves the
// same vertical space and the inputs/selects align across the row.
function CellLabel({ children }: { children?: React.ReactNode }) {
  const isSpacer = children == null;
  return (
    <div
      aria-hidden={isSpacer || undefined}
      className={
        isSpacer
          ? "mb-1 block text-[11px] text-transparent select-none"
          : "mb-1 block text-[11px] text-muted-foreground"
      }
    >
      {isSpacer ? " " : children}
    </div>
  );
}

// Percentage picker for the Seguro row. Quick options + "Otro…" that
// switches to a free-form numeric input. The bound `value` is the AFIP
// quantity (pct/100); we render and accept percentages but persist the
// decimal so computeTotals stays uniform across rows.
function SeguroPercentInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const numeric = Number(value);
  const pct = Number.isFinite(numeric) ? numeric * 100 : 0;
  const matchesPreset = SEGURO_PERCENTAGES.some(
    (preset) => Math.abs(preset - pct) < 1e-6,
  );
  const [isCustom, setIsCustom] = useState(!matchesPreset && pct > 0);

  if (isCustom) {
    return (
      <div className="relative">
        <Input
          type="text"
          inputMode="decimal"
          autoFocus
          value={pct === 0 ? "" : String(pct)}
          onChange={(e) => {
            const next = Number(e.target.value);
            if (!Number.isFinite(next) || next <= 0) {
              onChange("0");
              return;
            }
            onChange(String(next / 100));
          }}
          onBlur={() => {
            // If user blurs with empty/zero, fall back to the select view.
            if (Number(value) === 0) setIsCustom(false);
          }}
          placeholder="%"
        />
      </div>
    );
  }

  return (
    <Select
      value={
        matchesPreset
          ? String(SEGURO_PERCENTAGES.find((p) => Math.abs(p - pct) < 1e-6)!)
          : SEGURO_CUSTOM_VALUE
      }
      onValueChange={(v) => {
        if (v === SEGURO_CUSTOM_VALUE) {
          setIsCustom(true);
          return;
        }
        const preset = Number(v);
        onChange(String(preset / 100));
      }}
    >
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper">
        {SEGURO_PERCENTAGES.map((p) => (
          <SelectItem key={p} value={String(p)}>
            {p}%
          </SelectItem>
        ))}
        <SelectItem value={SEGURO_CUSTOM_VALUE}>Otro…</SelectItem>
      </SelectContent>
    </Select>
  );
}
