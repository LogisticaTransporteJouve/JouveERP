import { agingKeys } from "@/features/aging/lib/aging-keys";
import { clientsKeys } from "@/features/clients/lib/clients-keys";
import { LEDGER_KEYS } from "@/features/journal-entries/lib/ledger-keys";
import { libroIvaKeys } from "@/features/libro-iva/lib/libro-iva-keys";
import { receiptsKeys } from "@/features/receipts/lib/receipts-keys";
import { shipmentsKeys } from "@/features/shipments/lib/shipments-keys";
import { storageBillingKeys } from "@/features/storage-billing/lib/storage-billing-keys";

import { invoicesKeys } from "./invoices-keys";

/** What an emitted or cancelled invoice changes beyond its own list: the
 *  client's cuenta corriente and aging, the receipts picker, the fiscal
 *  books and the shipment / storage period it bills. */
export const INVOICE_EFFECT_KEYS = [
  invoicesKeys.all,
  agingKeys.all,
  clientsKeys.all,
  receiptsKeys.all,
  libroIvaKeys.all,
  ...LEDGER_KEYS,
  shipmentsKeys.all,
  storageBillingKeys.all,
] as const;
