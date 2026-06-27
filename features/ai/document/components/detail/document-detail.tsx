"use client";

import {
  Banknote,
  Building2,
  FileText,
  Landmark,
  List,
  Receipt,
  Truck,
  Users,
} from "lucide-react";

import {
  ChequeExtractionSchema,
  ExtractoBancarioExtractionSchema,
  InvoiceExtractionSchema,
  PaymentOrderExtractionSchema,
  type Party,
  ReceiptExtractionSchema,
  RemitoExtractionSchema,
} from "../../schemas";

import {
  DetailTable,
  Field,
  Section,
  fmtMoney,
  fmtNumber,
  fmtText,
} from "./primitives";

/**
 * Renders the full extracted detail for a document, dispatching to a per-kind
 * renderer (the JouveERP analogue of Sumary's AnomalyTypeContent). Each renderer
 * parses the payload with its Zod schema and shows every field it captured.
 */
export function DocumentDetail({
  payload,
  kind,
}: {
  payload: unknown;
  kind: string | null;
}) {
  switch (kind) {
    case "factura_compra":
    case "factura_venta":
    case "nc_nd":
      return <InvoiceDetail payload={payload} />;
    case "recibo":
      return <ReceiptDetail payload={payload} />;
    case "orden_pago":
      return <PaymentOrderDetail payload={payload} />;
    case "remito":
      return <RemitoDetail payload={payload} />;
    case "cheque":
      return <ChequeDetail payload={payload} />;
    case "extracto":
      return <ExtractoDetail payload={payload} />;
    default:
      return <GenericDetail payload={payload} />;
  }
}

function PartyFields({ party }: { party: Party }) {
  return (
    <>
      <Field label="Nombre" value={fmtText(party.nombre)} />
      <Field label="CUIT" value={fmtText(party.cuit)} />
      <Field label="Cond. IVA" value={fmtText(party.condicion_iva)} />
      <Field label="Domicilio" value={fmtText(party.domicilio)} />
      <Field label="Localidad" value={fmtText(party.localidad)} />
      <Field label="Provincia" value={fmtText(party.provincia)} />
    </>
  );
}

function InvoiceDetail({ payload }: { payload: unknown }) {
  const parsed = InvoiceExtractionSchema.safeParse(payload);
  if (!parsed.success) return <GenericDetail payload={payload} />;
  const inv = parsed.data;
  const cur = inv.moneda;

  return (
    <div className="space-y-3">
      <Section icon={Users} title="Partes">
        <Field label="Contraparte" value={fmtText(inv.contraparte_nombre)} />
        <Field label="CUIT" value={fmtText(inv.contraparte_cuit)} />
        {inv.emisor && (
          <div className="mt-1 border-t pt-1">
            <p className="text-muted-foreground py-0.5 text-[11px] font-medium">
              Emisor
            </p>
            <PartyFields party={inv.emisor} />
          </div>
        )}
        {inv.receptor && (
          <div className="mt-1 border-t pt-1">
            <p className="text-muted-foreground py-0.5 text-[11px] font-medium">
              Receptor
            </p>
            <PartyFields party={inv.receptor} />
          </div>
        )}
      </Section>

      <Section icon={Receipt} title="Comprobante">
        <Field label="Letra" value={fmtText(inv.letra)} />
        <Field label="Punto de venta" value={fmtText(inv.punto_venta)} />
        <Field label="Número" value={fmtText(inv.numero)} />
        <Field label="Fecha" value={fmtText(inv.fecha)} />
        <Field label="Vencimiento" value={fmtText(inv.fch_vto_pago)} />
        <Field label="Condición de pago" value={fmtText(inv.condicion_pago)} />
        <Field label="Moneda" value={fmtText(inv.moneda)} />
      </Section>

      <Section icon={Banknote} title="Importes">
        <Field label="Neto" value={fmtMoney(inv.importe_neto, cur)} />
        <Field label="IVA" value={fmtMoney(inv.importe_iva, cur)} />
        <Field label="Otros trib." value={fmtMoney(inv.importe_trib, cur)} />
        <Field label="Total" value={fmtMoney(inv.importe_total, cur)} />
      </Section>

      {inv.pago && (
        <Section icon={Building2} title="Pago">
          <Field label="Método" value={fmtText(inv.pago.metodo)} />
          <Field label="CBU" value={fmtText(inv.pago.cbu)} />
          <Field label="Alias" value={fmtText(inv.pago.alias)} />
          <Field label="Banco" value={fmtText(inv.pago.banco)} />
        </Section>
      )}

      {inv.items.length > 0 && (
        <Section icon={List} title={`Ítems (${inv.items.length})`}>
          <DetailTable
            headers={[
              "Descripción",
              "Cant.",
              "U.",
              "P. unit.",
              "Bonif.",
              "Neto",
              "Alíc.",
              "IVA",
              "Total",
            ]}
            aligns={[
              "left",
              "right",
              "left",
              "right",
              "right",
              "right",
              "right",
              "right",
              "right",
            ]}
            rows={inv.items.map((it) => [
              it.descripcion,
              fmtText(it.cantidad),
              fmtText(it.unidad),
              fmtMoney(it.precio_unitario, cur),
              it.bonif_pct != null ? `${it.bonif_pct}%` : "—",
              fmtMoney(it.importe_neto, cur),
              fmtText(it.alicuota_iva),
              fmtMoney(it.importe_iva, cur),
              fmtMoney(it.importe_total, cur),
            ])}
          />
        </Section>
      )}
    </div>
  );
}

function ReceiptDetail({ payload }: { payload: unknown }) {
  const parsed = ReceiptExtractionSchema.safeParse(payload);
  if (!parsed.success) return <GenericDetail payload={payload} />;
  const r = parsed.data;
  return (
    <Section icon={Receipt} title="Recibo">
      <Field label="Contraparte" value={fmtText(r.contraparte_nombre)} />
      <Field label="CUIT" value={fmtText(r.contraparte_cuit)} />
      <Field label="Número" value={fmtText(r.numero)} />
      <Field label="Fecha" value={fmtText(r.fecha)} />
      <Field label="Moneda" value={fmtText(r.moneda)} />
      <Field label="Total" value={fmtMoney(r.importe_total, r.moneda)} />
    </Section>
  );
}

function PaymentOrderDetail({ payload }: { payload: unknown }) {
  const parsed = PaymentOrderExtractionSchema.safeParse(payload);
  if (!parsed.success) return <GenericDetail payload={payload} />;
  const o = parsed.data;
  return (
    <Section icon={Banknote} title="Orden de pago">
      <Field label="Contraparte" value={fmtText(o.contraparte_nombre)} />
      <Field label="CUIT" value={fmtText(o.contraparte_cuit)} />
      <Field label="Número" value={fmtText(o.numero)} />
      <Field label="Fecha" value={fmtText(o.fecha)} />
      <Field label="Moneda" value={fmtText(o.moneda)} />
      <Field label="Total" value={fmtMoney(o.importe_total, o.moneda)} />
    </Section>
  );
}

function RemitoDetail({ payload }: { payload: unknown }) {
  const parsed = RemitoExtractionSchema.safeParse(payload);
  if (!parsed.success) return <GenericDetail payload={payload} />;
  const r = parsed.data;
  return (
    <div className="space-y-3">
      <Section icon={Truck} title="Remito">
        <Field label="Contraparte" value={fmtText(r.contraparte_nombre)} />
        <Field label="CUIT" value={fmtText(r.contraparte_cuit)} />
        <Field label="Punto de venta" value={fmtText(r.punto_venta)} />
        <Field label="Número" value={fmtText(r.numero)} />
        <Field label="Fecha" value={fmtText(r.fecha)} />
        <Field label="Fecha de entrega" value={fmtText(r.fecha_entrega)} />
        <Field label="Destino" value={fmtText(r.destino)} />
        <Field label="Transportista" value={fmtText(r.transportista)} />
        <Field label="Conductor" value={fmtText(r.conductor)} />
        <Field label="Dominio" value={fmtText(r.dominio_vehiculo)} />
        <Field label="Total kilos" value={fmtNumber(r.total_kilos)} />
        <Field label="CRE" value={fmtText(r.cre)} />
        <Field label="Observaciones" value={fmtText(r.observaciones)} />
      </Section>
      {r.items.length > 0 && (
        <Section icon={List} title={`Ítems (${r.items.length})`}>
          <DetailTable
            headers={[
              "Descripción",
              "Código",
              "Cod AFIP",
              "Cant.",
              "U.",
              "Unid.",
              "Embalaje",
            ]}
            aligns={[
              "left",
              "left",
              "left",
              "right",
              "left",
              "right",
              "left",
            ]}
            rows={r.items.map((it) => [
              it.descripcion,
              fmtText(it.codigo),
              fmtText(it.cod_afip),
              fmtText(it.cantidad),
              fmtText(it.unidad),
              fmtText(it.unidades),
              fmtText(it.tipo_embalaje),
            ])}
          />
        </Section>
      )}
    </div>
  );
}

function ChequeDetail({ payload }: { payload: unknown }) {
  const parsed = ChequeExtractionSchema.safeParse(payload);
  if (!parsed.success) return <GenericDetail payload={payload} />;
  const c = parsed.data;
  return (
    <Section icon={Banknote} title="Cheque">
      <Field label="Banco" value={fmtText(c.banco)} />
      <Field label="Número" value={fmtText(c.numero)} />
      <Field label="Tipo" value={fmtText(c.tipo)} />
      <Field label="Beneficiario" value={fmtText(c.beneficiario)} />
      <Field label="Fecha" value={fmtText(c.fecha)} />
      <Field label="Fecha de pago" value={fmtText(c.fecha_pago)} />
      <Field label="Moneda" value={fmtText(c.moneda)} />
      <Field label="Importe" value={fmtMoney(c.importe, c.moneda)} />
    </Section>
  );
}

function ExtractoDetail({ payload }: { payload: unknown }) {
  const parsed = ExtractoBancarioExtractionSchema.safeParse(payload);
  if (!parsed.success) return <GenericDetail payload={payload} />;
  const e = parsed.data;
  return (
    <div className="space-y-3">
      <Section icon={Landmark} title="Extracto bancario">
        <Field label="Banco" value={fmtText(e.banco)} />
        <Field label="Cuenta" value={fmtText(e.cuenta)} />
        <Field label="Período" value={fmtText(e.periodo)} />
        <Field label="Moneda" value={fmtText(e.moneda)} />
        <Field label="Saldo inicial" value={fmtMoney(e.saldo_inicial, e.moneda)} />
        <Field label="Saldo final" value={fmtMoney(e.saldo_final, e.moneda)} />
      </Section>
      {e.movimientos.length > 0 && (
        <Section icon={List} title={`Movimientos (${e.movimientos.length})`}>
          <DetailTable
            headers={["Fecha", "Concepto", "Débito", "Crédito", "Saldo"]}
            aligns={["left", "left", "right", "right", "right"]}
            rows={e.movimientos.map((m) => [
              fmtText(m.fecha),
              m.concepto,
              fmtMoney(m.debito, e.moneda),
              fmtMoney(m.credito, e.moneda),
              fmtMoney(m.saldo, e.moneda),
            ])}
          />
        </Section>
      )}
    </div>
  );
}

function GenericDetail({ payload }: { payload: unknown }) {
  if (typeof payload !== "object" || payload === null) {
    return (
      <p className="text-muted-foreground text-sm">Sin datos extraídos.</p>
    );
  }
  const entries = Object.entries(payload as Record<string, unknown>).filter(
    ([, v]) => v !== null && v !== undefined && typeof v !== "object",
  );
  if (entries.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        Documento sin datos estructurados.
      </p>
    );
  }
  return (
    <Section icon={FileText} title="Datos">
      {entries.map(([k, v]) => (
        <Field key={k} label={k} value={fmtText(v)} />
      ))}
    </Section>
  );
}
