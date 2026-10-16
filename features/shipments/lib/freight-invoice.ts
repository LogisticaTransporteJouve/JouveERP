/** Dates of a freight invoice issued `today` (Argentina calendar day). The
 *  service period is the delivery (or scheduled) day; payment falls due no
 *  earlier than the voucher itself, which AFIP requires. */
export function freightInvoiceDates(
  shipment: { delivery_date: string | null; scheduled_date: string | null },
  today: string,
): {
  fecha: string;
  fch_serv_desde: string;
  fch_serv_hasta: string;
  fch_vto_pago: string;
} {
  const serviceDate =
    shipment.delivery_date ?? shipment.scheduled_date ?? today;
  return {
    fecha: today,
    fch_serv_desde: serviceDate,
    fch_serv_hasta: serviceDate,
    fch_vto_pago: serviceDate > today ? serviceDate : today,
  };
}
