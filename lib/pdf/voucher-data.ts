import "server-only";

import {
  ACCOUNT_TYPE_LABEL,
  type AccountNameJoin,
  type AccountType,
} from "@/features/accounts/schema";
import { ivaConditionLabel } from "@/features/clients/schema";
import type { Emisor } from "@/lib/pdf/emisor";

import type {
  VoucherEmisor,
  VoucherParty,
  VoucherPaymentLine,
} from "./voucher-template";

/** The receipt / payment-order payment lines as the voucher PDF prints them. */
export function voucherPaymentLines(
  rows: readonly { amount: number | string; reference: string | null }[],
): VoucherPaymentLine[] {
  return rows.map((l) => {
    const acc = (l as unknown as AccountNameJoin).account;
    return {
      account_name: acc?.name ?? "—",
      account_type_label:
        ACCOUNT_TYPE_LABEL[acc?.type as AccountType] ?? acc?.type ?? "",
      amount: Number(l.amount),
      reference: l.reference ?? null,
    };
  });
}

export function voucherEmisor(emisor: Emisor): VoucherEmisor {
  return {
    legal_name: emisor.legal_name,
    cuit: emisor.cuit,
    address: emisor.address,
    division_label: emisor.division_label,
  };
}

/** The client or supplier box; an unknown IVA condition prints as stored.
 *  An internal counterparty has neither CUIT nor IVA condition. */
export function voucherParty(party: {
  legal_name: string;
  cuit: string | null;
  iva_condition: string | null;
}): VoucherParty {
  return {
    legal_name: party.legal_name,
    cuit: party.cuit,
    iva_condition_label:
      ivaConditionLabel(party.iva_condition) ?? party.iva_condition,
  };
}
