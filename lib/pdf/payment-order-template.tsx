import {
  VoucherDocument,
  type VoucherAllocation,
  type VoucherEmisor,
  type VoucherParty,
  type VoucherPaymentLine,
} from "./voucher-template";

// Payment Order PDF: the shared voucher layout, out-flow. payment_lines =
// which account the money comes out of, allocations = which purchase invoices
// it is applied to, no withholdings (K.4 dropped), and signature slots.

export interface PaymentOrderTemplateData {
  /** Set only on an internal-channel payment order (D5). */
  title?: string;
  emisor: VoucherEmisor;
  beneficiario: VoucherParty;
  punto_venta: number;
  numero: number;
  fecha: string;
  moneda: string;

  payment_lines: VoucherPaymentLine[];
  /** "Factura A 0003-00000123" / "Gasto interno 0001-00000005" */
  allocations: VoucherAllocation[];

  total_amount: number;
  payment_sum: number;
  allocated_sum: number;
  a_cuenta: number;

  notes: string | null;
  status: "issued" | "canceled";
}

function formatOPNumber(pos: number, numero: number): string {
  return `OP${String(pos).padStart(4, "0")}-${String(numero).padStart(8, "0")}`;
}

export function PaymentOrderDocument({
  data,
}: {
  data: PaymentOrderTemplateData;
}) {
  return (
    <VoucherDocument
      title={data.title ?? "ORDEN DE PAGO"}
      number={formatOPNumber(data.punto_venta, data.numero)}
      canceledLabel="ANULADA"
      partyTitle="Pagamos a"
      canceled={data.status === "canceled"}
      emisor={data.emisor}
      party={data.beneficiario}
      fecha={data.fecha}
      moneda={data.moneda}
      paymentLines={data.payment_lines}
      allocations={data.allocations}
      totalsBeforeFinal={[{ label: "Pago real", amount: data.payment_sum }]}
      totalLabel="Total OP"
      totalAmount={data.total_amount}
      allocatedSum={data.allocated_sum}
      aCuenta={data.a_cuenta}
      notes={data.notes}
      signatures
    />
  );
}
