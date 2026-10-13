import { AfipTransportError } from "@/lib/afip/errors";
import type {
  InvoiceCAEResult,
  InvoiceRequestInput,
  VoucherInfo,
} from "@/lib/afip/wsfev1";
import { round2 } from "@/lib/format";
import { logger } from "@/lib/logger";

import { NonRetriableError } from "inngest";

// Fiscal numbering + CAE request for issue-invoice, as ONE unit of work.
//
// AFIP only accepts FECAESolicitar for exactly FECompUltimoAutorizado + 1 on
// a (punto de venta, cbte tipo). Reading that number and requesting the CAE
// must therefore happen with no other emission on the same punto de venta in
// between. issue-invoice runs this inside a single Inngest step, and Inngest's
// concurrency limit (limit 1, keyed by punto de venta) applies per STEP, so
// the whole read-then-authorize window is serialized. When it was split in two
// steps, two runs could interleave between them and pick the same number.
//
// Retries: a step that fails is re-executed from scratch (no memoized value),
// so the number this invoice sent to AFIP is recorded durably BEFORE the call
// (`AttemptStore.record`). A retry first asks AFIP about that number and adopts
// the CAE only if the registered voucher is this invoice's (same total, date
// and receptor, and no other live invoice attempted or holds that number);
// otherwise it starts over from the last authorized number.

export type AfipCaePort = {
  getLastAuthorizedNumber: (
    ptoVta: number,
    cbteTipo: number,
  ) => Promise<number>;
  requestCAE: (input: InvoiceRequestInput) => Promise<InvoiceCAEResult>;
  getVoucherInfo: (
    ptoVta: number,
    cbteTipo: number,
    cbteNro: number,
  ) => Promise<VoucherInfo | null>;
};

export type AttemptStore = {
  /** Number this invoice last sent to AFIP, or null if none. */
  read: () => Promise<number | null>;
  /** Durably records `cbteNro` as sent by this invoice, before the AFIP call. */
  record: (cbteNro: number) => Promise<void>;
  /** Whether another non-failed invoice on the same (pv, tipo) attempted or
   *  holds `cbteNro` — then a voucher at that number is not this invoice's. */
  takenByOther: (cbteNro: number) => Promise<boolean>;
};

/** The fields of the draft a registered voucher must match to be adopted. */
export type VoucherIdentity = {
  impTotal: number;
  /** yyyy-mm-dd */
  fecha: string;
  docTipo: number;
  docNro: string;
};

function normalizeDocNro(value: string): string {
  return value.trim().replace(/^0+(?=\d)/, "");
}

export function voucherMatches(
  info: VoucherInfo,
  expected: VoucherIdentity,
): boolean {
  if (round2(info.impTotal) !== round2(expected.impTotal)) return false;
  if (info.cbteFch !== expected.fecha.replace(/-/g, "")) return false;
  if (info.docTipo !== null && info.docTipo !== expected.docTipo) return false;
  if (
    info.docNro !== null &&
    normalizeDocNro(info.docNro) !== normalizeDocNro(expected.docNro)
  ) {
    return false;
  }
  return true;
}

function adopt(info: VoucherInfo): InvoiceCAEResult | null {
  if (!info.cae || !info.caeFchVto) return null;
  return {
    ptoVta: info.ptoVta,
    cbteTipo: info.cbteTipo,
    cbteNro: info.cbteNro,
    cae: info.cae,
    caeFchVto: info.caeFchVto,
    observaciones: [],
    fchProceso: null,
  };
}

export async function reserveNumberAndRequestCae(params: {
  invoiceId: string;
  ptoVta: number;
  cbteTipo: number;
  expected: VoucherIdentity;
  buildInput: (cbteNro: number) => InvoiceRequestInput;
  afip: AfipCaePort;
  attempts: AttemptStore;
}): Promise<InvoiceCAEResult> {
  const { invoiceId, ptoVta, cbteTipo, expected, buildInput, afip, attempts } =
    params;

  // A previous attempt of this step may have reached AFIP and lost the
  // response (or crashed before the step finished). Recover that CAE instead
  // of authorizing the same invoice a second time under a new number.
  const previous = await attempts.read();
  if (previous !== null && !(await attempts.takenByOther(previous))) {
    const info = await afip.getVoucherInfo(ptoVta, cbteTipo, previous);
    const recovered =
      info && voucherMatches(info, expected) ? adopt(info) : null;
    if (recovered) {
      logger.info("issue_invoice.recovered_previous_attempt", {
        invoice_id: invoiceId,
        ptoVta,
        cbteTipo,
        cbteNro: previous,
      });
      return recovered;
    }
  }

  const cbteNro = (await afip.getLastAuthorizedNumber(ptoVta, cbteTipo)) + 1;
  await attempts.record(cbteNro);

  try {
    return await afip.requestCAE(buildInput(cbteNro));
  } catch (err) {
    if (err instanceof AfipTransportError) {
      // The request might have reached AFIP and the response was lost
      // mid-flight. Ask AFIP whether it registered THIS voucher.
      logger.info("issue_invoice.recovery_attempt", {
        invoice_id: invoiceId,
        ptoVta,
        cbteTipo,
        cbteNro,
      });
      const info = await afip.getVoucherInfo(ptoVta, cbteTipo, cbteNro);
      if (info && voucherMatches(info, expected)) {
        const recovered = adopt(info);
        if (recovered) return recovered;
      }
      if (info?.cae) {
        logger.warn("issue_invoice.recovery_mismatch", {
          invoice_id: invoiceId,
          ptoVta,
          cbteTipo,
          cbteNro,
          afipImpTotal: info.impTotal,
          afipCbteFch: info.cbteFch,
        });
      }
      throw err; // genuine transport failure — let Inngest retry
    }
    // service / soap-fault / config / input errors are deterministic:
    // retrying re-sends the same rejected payload and holds the invoice in
    // "emitting" for the whole retry schedule. Fail fast.
    throw new NonRetriableError(
      err instanceof Error ? err.message : String(err),
      { cause: err },
    );
  }
}
