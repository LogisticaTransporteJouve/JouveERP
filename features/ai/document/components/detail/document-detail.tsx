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
  ChequeBatchExtractionSchema,
  ChequeExtractionSchema,
  type ChequeExtraction,
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
    case "purchase_invoice":
    case "sales_invoice":
    case "credit_debit_note":
      return <InvoiceDetail payload={payload} />;
    case "receipt":
      return <ReceiptDetail payload={payload} />;
    case "payment_order":
      return <PaymentOrderDetail payload={payload} />;
    case "delivery_note":
      return <RemitoDetail payload={payload} />;
    case "check":
      return <ChequeDetail payload={payload} />;
    case "bank_statement":
      return <ExtractoDetail payload={payload} />;
    default:
      return <GenericDetail payload={payload} />;
  }
}

function PartyFields({ party }: { party: Party }) {
  return (
    <>
      <Field label="Nombre" value={fmtText(party.name)} />
      <Field label="CUIT" value={fmtText(party.cuit)} />
      <Field label="Cond. IVA" value={fmtText(party.iva_condition)} />
      <Field label="Domicilio" value={fmtText(party.address)} />
      <Field label="Localidad" value={fmtText(party.city)} />
      <Field label="Provincia" value={fmtText(party.province)} />
    </>
  );
}

function InvoiceDetail({ payload }: { payload: unknown }) {
  const parsed = InvoiceExtractionSchema.safeParse(payload);
  if (!parsed.success) return <GenericDetail payload={payload} />;
  const inv = parsed.data;
  const cur = inv.currency;

  return (
    <div className="space-y-3">
      <Section icon={Users} title="Partes">
        <Field label="Contraparte" value={fmtText(inv.counterparty_name)} />
        <Field label="CUIT" value={fmtText(inv.counterparty_cuit)} />
        {inv.issuer && (
          <div className="mt-1 border-t pt-1">
            <p className="text-muted-foreground py-0.5 text-[11px] font-medium">
              Emisor
            </p>
            <PartyFields party={inv.issuer} />
          </div>
        )}
        {inv.recipient && (
          <div className="mt-1 border-t pt-1">
            <p className="text-muted-foreground py-0.5 text-[11px] font-medium">
              Receptor
            </p>
            <PartyFields party={inv.recipient} />
          </div>
        )}
      </Section>

      <Section icon={Receipt} title="Comprobante">
        <Field label="Letra" value={fmtText(inv.letter)} />
        <Field label="Punto de venta" value={fmtText(inv.sales_point)} />
        <Field label="Número" value={fmtText(inv.number)} />
        <Field label="Fecha" value={fmtText(inv.date)} />
        <Field label="Vencimiento" value={fmtText(inv.due_date)} />
        <Field label="Condición de pago" value={fmtText(inv.payment_terms)} />
        <Field label="Moneda" value={fmtText(inv.currency)} />
      </Section>

      <Section icon={Banknote} title="Importes">
        <Field label="Neto" value={fmtMoney(inv.net_amount, cur)} />
        <Field label="IVA" value={fmtMoney(inv.iva_amount, cur)} />
        <Field label="Otros trib." value={fmtMoney(inv.other_taxes_amount, cur)} />
        <Field label="Total" value={fmtMoney(inv.total_amount, cur)} />
      </Section>

      {inv.payment && (
        <Section icon={Building2} title="Pago">
          <Field label="Método" value={fmtText(inv.payment.method)} />
          <Field label="CBU" value={fmtText(inv.payment.cbu)} />
          <Field label="Alias" value={fmtText(inv.payment.alias)} />
          <Field label="Banco" value={fmtText(inv.payment.bank)} />
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
              it.description,
              fmtText(it.quantity),
              fmtText(it.unit),
              fmtMoney(it.unit_price, cur),
              it.discount_pct != null ? `${it.discount_pct}%` : "—",
              fmtMoney(it.net_amount, cur),
              fmtText(it.iva_rate),
              fmtMoney(it.iva_amount, cur),
              fmtMoney(it.total_amount, cur),
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
      <Field label="Contraparte" value={fmtText(r.counterparty_name)} />
      <Field label="CUIT" value={fmtText(r.counterparty_cuit)} />
      <Field label="Número" value={fmtText(r.number)} />
      <Field label="Fecha" value={fmtText(r.date)} />
      <Field label="Moneda" value={fmtText(r.currency)} />
      <Field label="Total" value={fmtMoney(r.total_amount, r.currency)} />
    </Section>
  );
}

function PaymentOrderDetail({ payload }: { payload: unknown }) {
  const parsed = PaymentOrderExtractionSchema.safeParse(payload);
  if (!parsed.success) return <GenericDetail payload={payload} />;
  const o = parsed.data;
  return (
    <Section icon={Banknote} title="Orden de pago">
      <Field label="Contraparte" value={fmtText(o.counterparty_name)} />
      <Field label="CUIT" value={fmtText(o.counterparty_cuit)} />
      <Field label="Número" value={fmtText(o.number)} />
      <Field label="Fecha" value={fmtText(o.date)} />
      <Field label="Moneda" value={fmtText(o.currency)} />
      <Field label="Total" value={fmtMoney(o.total_amount, o.currency)} />
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
        <Field label="Contraparte" value={fmtText(r.counterparty_name)} />
        <Field label="CUIT" value={fmtText(r.counterparty_cuit)} />
        <Field label="Punto de venta" value={fmtText(r.sales_point)} />
        <Field label="Número" value={fmtText(r.number)} />
        <Field label="Fecha" value={fmtText(r.date)} />
        <Field label="Fecha de entrega" value={fmtText(r.delivery_date)} />
        <Field label="Destino" value={fmtText(r.destination)} multiline />
        <Field label="Transportista" value={fmtText(r.carrier)} />
        <Field label="Conductor" value={fmtText(r.driver)} />
        <Field label="Dominio" value={fmtText(r.vehicle_plate)} />
        <Field label="Total kilos" value={fmtNumber(r.total_kilos)} />
        <Field label="CRE" value={fmtText(r.cre)} />
        <Field label="Observaciones" value={fmtText(r.observations)} multiline />
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
              it.description,
              fmtText(it.code),
              fmtText(it.afip_code),
              fmtText(it.quantity),
              fmtText(it.unit),
              fmtText(it.units),
              fmtText(it.packaging_type),
            ])}
          />
        </Section>
      )}
    </div>
  );
}

function ChequeCard({
  c,
  index,
  total,
}: {
  c: ChequeExtraction;
  index: number;
  total: number;
}) {
  return (
    <Section
      icon={Banknote}
      title={total > 1 ? `Cheque ${index + 1} de ${total}` : "Cheque"}
    >
      <Field label="Banco" value={fmtText(c.bank)} />
      <Field label="Serie" value={fmtText(c.series)} />
      <Field label="Número" value={fmtText(c.number)} />
      <Field label="Tipo" value={fmtText(c.type)} />
      <Field label="Importe" value={fmtMoney(c.amount, c.currency)} />
      <Field label="Beneficiario" value={fmtText(c.beneficiary)} />
      <Field label="Librador" value={fmtText(c.drawer)} />
      <Field label="CUIT librador" value={fmtText(c.drawer_cuit)} />
      <Field label="Cuenta" value={fmtText(c.account)} />
      <Field label="Emisión" value={fmtText(c.date)} />
      <Field label="Pago / vto" value={fmtText(c.payment_date)} />
      <Field label="Moneda" value={fmtText(c.currency)} />
    </Section>
  );
}

function ChequeDetail({ payload }: { payload: unknown }) {
  // Batch (1..N checks); fall back to a legacy single payload, then generic.
  const batch = ChequeBatchExtractionSchema.safeParse(payload);
  let cheques: ChequeExtraction[] = [];
  if (batch.success && batch.data.cheques.length > 0) {
    cheques = batch.data.cheques;
  } else {
    const single = ChequeExtractionSchema.safeParse(payload);
    if (
      single.success &&
      (single.data.bank || single.data.number || single.data.amount != null)
    ) {
      cheques = [single.data];
    }
  }
  if (cheques.length === 0) return <GenericDetail payload={payload} />;
  return (
    <div className="space-y-3">
      {cheques.map((c, i) => (
        <ChequeCard key={i} c={c} index={i} total={cheques.length} />
      ))}
    </div>
  );
}

function ExtractoDetail({ payload }: { payload: unknown }) {
  const parsed = ExtractoBancarioExtractionSchema.safeParse(payload);
  if (!parsed.success) return <GenericDetail payload={payload} />;
  const e = parsed.data;
  return (
    <div className="space-y-3">
      <Section icon={Landmark} title="Extracto bancario">
        <Field label="Banco" value={fmtText(e.bank)} />
        <Field label="Cuenta" value={fmtText(e.account)} />
        <Field label="Período" value={fmtText(e.period)} />
        <Field label="Moneda" value={fmtText(e.currency)} />
        <Field label="Saldo inicial" value={fmtMoney(e.opening_balance, e.currency)} />
        <Field label="Saldo final" value={fmtMoney(e.closing_balance, e.currency)} />
      </Section>
      {e.movements.length > 0 && (
        <Section icon={List} title={`Movimientos (${e.movements.length})`}>
          <DetailTable
            headers={["Fecha", "Concepto", "Débito", "Crédito", "Saldo"]}
            aligns={["left", "left", "right", "right", "right"]}
            rows={e.movements.map((m) => [
              fmtText(m.date),
              m.concept,
              fmtMoney(m.debit, e.currency),
              fmtMoney(m.credit, e.currency),
              fmtMoney(m.balance, e.currency),
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
