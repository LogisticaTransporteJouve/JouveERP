import { Text, View } from "@react-pdf/renderer";

import { formatReceiptNumber } from "@/features/receipts/schema";

import {
  formatVoucherAmount,
  VoucherDocument,
  voucherStyles as styles,
  type VoucherAllocation,
  type VoucherEmisor,
  type VoucherParty,
  type VoucherPaymentLine,
} from "./voucher-template";

// Receipt PDF: the shared voucher layout plus the withholdings the client
// applied.

export interface ReceiptTemplateRetention {
  kind_label: string; // "Retención" / "Percepción"
  tax_type_label: string; // "Ganancias" / "IVA" / "IIBB" / "SUSS" / "Otros"
  jurisdiction: string | null;
  certificate_number: string;
  certificate_date: string;
  amount: number;
}

export interface ReceiptTemplateData {
  /** Set only on an internal-channel receipt (D5); a fiscal one has no key. */
  title?: string;
  emisor: VoucherEmisor;
  receptor: VoucherParty;
  punto_venta: number;
  numero: number;
  fecha: string; // YYYY-MM-DD
  moneda: string;

  payment_lines: VoucherPaymentLine[];
  retentions: ReceiptTemplateRetention[];
  allocations: VoucherAllocation[];

  total_amount: number;
  payment_sum: number;
  retention_sum: number;
  allocated_sum: number;
  a_cuenta: number;

  notes: string | null;
  status: "issued" | "canceled";
}

export function ReceiptDocument({ data }: { data: ReceiptTemplateData }) {
  const retentions = data.retentions.length > 0 && (
    <View style={styles.block}>
      <Text style={styles.sectionTitle}>Retenciones / Percepciones</Text>
      <View style={styles.tableHeader}>
        <Text style={styles.colSmall}>Tipo</Text>
        <Text style={styles.colSmall}>Impuesto</Text>
        <Text style={styles.colSmall}>Certificado</Text>
        <Text style={styles.colSmall}>Fecha</Text>
        <Text style={styles.colNumber}>Importe</Text>
      </View>
      {data.retentions.map((r, i) => (
        <View key={i} style={styles.tableRow}>
          <Text style={styles.colSmall}>{r.kind_label}</Text>
          <Text style={styles.colSmall}>
            {r.tax_type_label}
            {r.jurisdiction ? ` · ${r.jurisdiction}` : ""}
          </Text>
          <Text style={styles.colSmall}>{r.certificate_number}</Text>
          <Text style={styles.colSmall}>{r.certificate_date}</Text>
          <Text style={styles.colNumber}>
            {formatVoucherAmount(r.amount, data.moneda)}
          </Text>
        </View>
      ))}
    </View>
  );

  return (
    <VoucherDocument
      title={data.title ?? "RECIBO"}
      number={formatReceiptNumber(data.punto_venta, data.numero)}
      canceledLabel="ANULADO"
      partyTitle="Recibimos de"
      canceled={data.status === "canceled"}
      emisor={data.emisor}
      party={data.receptor}
      fecha={data.fecha}
      moneda={data.moneda}
      paymentLines={data.payment_lines}
      allocations={data.allocations}
      afterPaymentLines={retentions}
      totalsBeforeFinal={[
        { label: "Pago real", amount: data.payment_sum },
        { label: "Retenciones", amount: data.retention_sum },
      ]}
      totalLabel="Total recibo"
      totalAmount={data.total_amount}
      allocatedSum={data.allocated_sum}
      aCuenta={data.a_cuenta}
      notes={data.notes}
    />
  );
}
