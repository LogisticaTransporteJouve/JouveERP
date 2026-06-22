"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
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
import {
  IVA_CONDITION_LABEL,
  type IvaCondition,
} from "@/features/clients/schema";
import { computeTotals } from "@/features/invoices/schema";
import { formatNumber2 } from "@/lib/format";
import { DEFAULT_CHANNEL_ID } from "@/lib/scope";

import type {
  InvoiceListItem,
  PosOption,
} from "../actions/invoices-actions";
import {
  useEnabledPos,
  useInvoiceDetailOnDemand,
  useIssueFiscalInvoice,
} from "../hooks/use-invoices";
import { ClientPicker, type PickedClient } from "./client-picker";
import { OriginPicker } from "./origin-picker";

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

type Kind = "factura" | "nc" | "nd";

const KIND_OPTIONS: Array<{ value: Kind; label: string }> = [
  { value: "factura", label: "Factura" },
  { value: "nc", label: "Nota de Crédito" },
  { value: "nd", label: "Nota de Débito" },
];

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

export function NewInvoiceDialog({
  channels,
  initialClient,
  trigger,
}: {
  channels: ChannelOption[];
  initialClient?: PickedClient | null;
  trigger?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <Plus />
            Nuevo
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Nuevo comprobante</DialogTitle>
          <DialogDescription>
            Se emite con CAE de AFIP. Una vez emitido no se puede modificar.
          </DialogDescription>
        </DialogHeader>
        {open && (
          <NewInvoiceForm
            channels={channels}
            initialClient={initialClient ?? null}
            onSuccess={() => setOpen(false)}
            onCancel={() => setOpen(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

const FormSchema = z.object({
  kind: z.enum(["factura", "nc", "nd"]),
  channelId: z.string(),
  puntoVenta: z.string(),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida."),
  origin: z.custom<InvoiceListItem>().nullable(),
  client: z.custom<PickedClient>().nullable(),
  items: z.custom<ItemDraft[]>(),
  motivo: z.string(),
});

type FormValues = z.infer<typeof FormSchema>;

function NewInvoiceForm({
  channels,
  initialClient,
  onSuccess,
  onCancel,
}: {
  channels: ChannelOption[];
  initialClient: PickedClient | null;
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

  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      kind: "factura",
      channelId: initialChannel,
      puntoVenta: "",
      fecha: new Date().toISOString().slice(0, 10),
      origin: null,
      client: initialClient,
      items: defaultItems(),
      motivo: "",
    },
  });

  const kind = form.watch("kind");
  const channelId = form.watch("channelId");
  const puntoVenta = form.watch("puntoVenta");
  const fecha = form.watch("fecha");
  const origin = form.watch("origin");
  const client = form.watch("client");
  const items = form.watch("items");
  const motivo = form.watch("motivo");

  const isNote = kind !== "factura";
  const { data: originDetail } = useInvoiceDetailOnDemand(
    isNote && origin ? origin.id : null,
  );

  const posQuery = useEnabledPos(channelId, { enabled: !isNote });
  const posOptions: PosOption[] = useMemo(
    () => posQuery.data ?? [],
    [posQuery.data],
  );

  // Auto-pick the first POS when the list resolves (channel changed). Only
  // applies to facturas — NC/ND inherit the origen's POS.
  useEffect(() => {
    if (isNote) return;
    if (posOptions.length === 1) {
      form.setValue("puntoVenta", String(posOptions[0]!.numero));
    } else if (posOptions.length === 0) {
      form.setValue("puntoVenta", "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posOptions, isNote]);

  const currentChannel = channels.find((c) => c.id === channelId) ?? null;

  // Bumped after "Emitir y continuar" to force a fresh ClientPicker mount,
  // which auto-focuses its search input.
  const [clientPickerKey, setClientPickerKey] = useState(0);

  // When origen detail lands, prefill channel + POS + client + items.
  useEffect(() => {
    if (!isNote || !originDetail) return;
    form.setValue("channelId", originDetail.channel.id);
    form.setValue("puntoVenta", String(originDetail.punto_venta));
    form.setValue("client", {
      id: originDetail.client.id,
      legal_name: originDetail.client.legal_name,
      display_name: null,
      cuit: originDetail.doc_nro,
      iva_condition: originDetail.client.iva_condition as IvaCondition,
    });
    form.setValue(
      "items",
      originDetail.items.length === 0
        ? [
            {
              description: "",
              quantity: "1",
              unit_price: "",
              iva_rate_id: IVA_RATE.TWENTY_ONE,
            },
          ]
        : originDetail.items.map((it) => ({
            description: it.description,
            quantity: String(it.quantity),
            unit_price: String(it.unit_price),
            iva_rate_id: (it.iva_rate_id ?? IVA_RATE.TWENTY_ONE) as IvaRateId,
          })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNote, originDetail]);

  function handleKindChange(next: Kind) {
    if (next === kind) return;
    form.setValue("kind", next);
    // Reset the parts of the form that mean different things across kinds.
    // Items get repopulated from origin on NC/ND, or reset to defaults on
    // factura. Origin is meaningless for factura — clear it. Motivo resets
    // because the label and meaning change.
    form.setValue("origin", null);
    form.setValue("motivo", "");
    if (next === "factura") {
      form.setValue("channelId", initialChannel);
      form.setValue("items", defaultItems());
      form.setValue("client", initialClient);
    } else {
      // Until an origin is picked, the form sits in an inert state.
      form.setValue("items", []);
      form.setValue("client", null);
      form.setValue("channelId", "");
      form.setValue("puntoVenta", "");
    }
  }

  function resetForContinue() {
    form.setValue("client", null);
    form.setValue("items", defaultItems());
    form.setValue("motivo", "");
    setClientPickerKey((k) => k + 1);
  }

  function updateItem(index: number, patch: Partial<ItemDraft>) {
    form.setValue(
      "items",
      items.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    );
  }

  function addItem() {
    if (isNote) {
      form.setValue("items", [
        ...items,
        {
          description: "",
          quantity: "1",
          unit_price: "",
          iva_rate_id: IVA_RATE.TWENTY_ONE,
        },
      ]);
      return;
    }
    // Factura: insert before the Seguro row so it always stays at the bottom.
    const next = [...items];
    next.splice(next.length - 1, 0, {
      description: "",
      quantity: "1",
      unit_price: "",
      iva_rate_id: IVA_RATE.TWENTY_ONE,
    });
    form.setValue("items", next);
  }

  function removeItem(index: number) {
    form.setValue(
      "items",
      items.filter((_, i) => i !== index),
    );
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

  const concepto = isNote
    ? (originDetail?.concepto ?? CONCEPTO.SERVICIOS)
    : currentChannel
      ? conceptoForDivision(currentChannel.division)
      : CONCEPTO.SERVICIOS;
  const isServiciosConcepto =
    concepto === CONCEPTO.SERVICIOS || concepto === CONCEPTO.PRODUCTOS_Y_SERVICIOS;

  const isFiscal = isNote ? true : (currentChannel?.is_fiscal ?? true);
  // For factura: derive letter from receiver iva_condition.
  // For NC/ND: letter inherits from origen (RG 1415).
  const letter = isNote
    ? (originDetail?.letter ?? null)
    : isFiscal && client
      ? letterFor(client.iva_condition)
      : null;

  function issue(continueMode: boolean) {
    if (isNote && !origin) {
      toast.error("Elegí la factura origen.");
      return;
    }
    if (isNote && !originDetail) {
      toast.error("Esperá a que termine de cargar la factura origen.");
      return;
    }
    if (!client) {
      toast.error("Verificá un cliente antes de emitir.");
      return;
    }
    if (!puntoVenta) {
      toast.error("Elegí un punto de venta.");
      return;
    }
    if (isNote && motivo.trim().length === 0) {
      toast.error("El motivo es obligatorio para NC/ND.");
      return;
    }

    // Drop empty Seguro row so it doesn't inflate the invoice. NC/ND don't
    // carry Seguro at all so the filter is a no-op there.
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
    // or Productos+Servicios (3). For Jouve's typical flow — same-day
    // freight — all three are set to the issue date.
    const fchServ = isServiciosConcepto ? fecha : null;

    issueMut.mutate(
      {
        channel_id: channelId,
        client_id: client.id,
        kind,
        // Internal channels (only possible when kind === "factura"): letter
        // and condicionIvaReceptor are ignored by the action and the
        // workflow takes the no-AFIP branch.
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
        invoice_origin_id: isNote ? (origin?.id ?? null) : null,
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
          router.push(`/invoices/${data.id}`);
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  function onSubmit() {
    issue(false);
  }

  function onFormKeyDown(e: React.KeyboardEvent<HTMLFormElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !isSubmitting) {
      e.preventDefault();
      issue(true);
    }
  }

  const channelLocked = isNote; // NC/ND inherits the channel from the origin.
  const showSeguro = !isNote;

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        onKeyDown={onFormKeyDown}
        className="space-y-5"
      >
        {/* Tipo + Canal + Fecha. POS is resolved from the channel (1:1 mapping)
            and Concepto from the division (Jouve→Servicios, DZ→Productos+
            Servicios) so neither needs to live in the UI for facturas. NC/ND
            inherit canal + POS + concepto from the origen invoice. */}
        <div className="grid gap-4 sm:grid-cols-[180px_1fr_180px]">
          <FormField
            control={form.control}
            name="kind"
            render={({ field }) => (
              <FormItem className="space-y-2">
                <FormLabel>Tipo</FormLabel>
                <Select
                  value={field.value}
                  onValueChange={(v) => handleKindChange(v as Kind)}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent position="popper">
                    {KIND_OPTIONS.map((k) => (
                      <SelectItem key={k.value} value={k.value}>
                        {k.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="channelId"
            render={({ field }) => (
              <FormItem className="space-y-2">
                <FormLabel>Canal</FormLabel>
                <Select
                  value={field.value}
                  onValueChange={field.onChange}
                  disabled={channelLocked}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue
                        placeholder={
                          channelLocked
                            ? "Lo define la factura origen"
                            : "Elegí un canal"
                        }
                      />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent position="popper">
                    {channels.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {channelId && !isNote && posOptions.length === 0 && (
                  <p className="text-xs text-destructive">
                    Sin POS habilitados — configurá uno en
                    {" "}
                    <code className="font-mono">/admin/afip/puntos-de-venta</code>.
                  </p>
                )}
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="fecha"
            render={({ field }) => (
              <FormItem className="space-y-2">
                <FormLabel>Fecha de emisión</FormLabel>
                <FormControl>
                  <DatePicker value={field.value} onChange={field.onChange} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {/* NC/ND-specific: factura origen + motivo */}
        {isNote && (
          <>
            <FormField
              control={form.control}
              name="origin"
              render={({ field }) => (
                <FormItem className="space-y-2">
                  <FormLabel>Factura origen</FormLabel>
                  <FormControl>
                    <OriginPicker
                      value={field.value}
                      onChange={field.onChange}
                    />
                  </FormControl>
                  <p className="text-xs text-muted-foreground">
                    La letra, el cliente y el punto de venta se heredan de la
                    factura origen (RG 1415).
                  </p>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="motivo"
              render={({ field }) => (
                <FormItem className="space-y-2">
                  <FormLabel>
                    Motivo <span className="text-destructive">*</span>
                  </FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder={
                        kind === "nc"
                          ? "Ej. devolución de servicios prestados"
                          : "Ej. diferencia de tarifa"
                      }
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </>
        )}

        {/* Client. For a factura we use the ClientPicker. For NC/ND the client
            is inherited from the origin: we show a read-only summary so the
            user can see it and there's no way to change it (AFIP requires the
            same receiver). */}
        {!isNote && (
          <FormField
            control={form.control}
            name="client"
            render={({ field }) => (
              <FormItem className="space-y-2">
                <FormLabel>Cliente</FormLabel>
                <FormControl>
                  <ClientPicker
                    key={clientPickerKey}
                    value={field.value}
                    onChange={field.onChange}
                    autoFocus={clientPickerKey > 0}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        )}
        {isNote && client && (
          <div className="space-y-2">
            <Label>Cliente (heredado de la factura origen)</Label>
            <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
              <p className="font-medium">{client.legal_name}</p>
              <p className="font-mono text-xs text-muted-foreground">
                CUIT {client.cuit} · {IVA_CONDITION_LABEL[client.iva_condition]}
              </p>
            </div>
          </div>
        )}

        {/* Items — enabled only once a channel/origin is picked. For a
            factura, the Seguro row stays pinned at the bottom. */}
        {(!isNote || originDetail) && (
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
                const seguro = showSeguro && isSeguroRow(item);
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
                          disabled={items.length <= (showSeguro ? 2 : 1)}
                          aria-label="Quitar ítem"
                        >
                          ×
                        </Button>
                      )}
                    </div>
                    <div className="col-span-12 text-right text-xs text-muted-foreground font-mono">
                      Subtotal: ${formatNumber2(lineTotal)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Totals */}
        {(!isNote || originDetail) && (
          <div className="flex items-center justify-end gap-6 rounded-md border bg-muted/30 p-3">
            <div className="text-sm">
              Neto:{" "}
              <span className="font-mono">${formatNumber2(totals.imp_neto)}</span>
            </div>
            <div className="text-sm">
              IVA:{" "}
              <span className="font-mono">${formatNumber2(totals.imp_iva)}</span>
            </div>
            <div className="text-base font-semibold">
              Total:{" "}
              <span className="font-mono">${formatNumber2(totals.imp_total)}</span>
            </div>
          </div>
        )}

        {/* Internal notes — for factura. For NC/ND the reason is already above. */}
        {!isNote && (
          <FormField
            control={form.control}
            name="motivo"
            render={({ field }) => (
              <FormItem className="space-y-2">
                <FormLabel>Notas internas (no van a AFIP)</FormLabel>
                <FormControl>
                  <Textarea rows={2} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        <div className="flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={onCancel}
            disabled={isSubmitting}
          >
            Cancelar
          </Button>
          {/* "Emitir y continuar" only applies to facturas — for NC/ND the flow
              is one-shot per origin. */}
          {!isNote && (
            <Button
              type="button"
              variant="outline"
              onClick={() => issue(true)}
              disabled={isSubmitting}
              title="⌘+Enter"
            >
              Emitir y continuar
            </Button>
          )}
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Emitiendo…" : "Emitir y solicitar CAE"}
          </Button>
        </div>
      </form>
    </Form>
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
      {isSpacer ? " " : children}
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
