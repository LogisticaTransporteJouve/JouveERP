import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/db/database.types";

/** The division line every PDF prints under the issuer (the only division
 *  left after DZ was retired). */
export const DIVISION_LABEL = "Logística Jouve";

/** The issuer block of the invoice, receipt and payment-order PDFs. */
export type Emisor = {
  legal_name: string;
  cuit: string;
  iva_condition: string;
  address: string | null;
  division_label: string;
  iibb_number: string | null;
  inicio_actividades: string | null;
};

export type EmisorChannel = {
  business_unit_id: string | null;
};

const DEFAULT_LEGAL_NAME = "DZ & Sons S.A.";

/** One read of the channel's business unit for the three renderers. A missing
 *  unit keeps the defaults the renderers printed before; a read error throws
 *  (a PDF with a wrong issuer is worse than none). */
export async function loadEmisor(
  supabase: SupabaseClient<Database>,
  channel: EmisorChannel,
): Promise<Emisor> {
  const emisor: Emisor = {
    legal_name: DEFAULT_LEGAL_NAME,
    cuit: "",
    iva_condition: "",
    address: null,
    division_label: DIVISION_LABEL,
    iibb_number: null,
    inicio_actividades: null,
  };
  if (!channel.business_unit_id) return emisor;
  const { data: bu, error } = await supabase
    .from("business_units")
    .select(
      "name, cuit, tax_condition, tax_address, iibb_number, inicio_actividades",
    )
    .eq("id", channel.business_unit_id)
    .maybeSingle();
  if (error) throw new Error(`load-business-unit: ${error.message}`);
  if (!bu) return emisor;
  return {
    ...emisor,
    legal_name: bu.name ?? DEFAULT_LEGAL_NAME,
    cuit: bu.cuit ?? "",
    iva_condition: bu.tax_condition ?? "",
    address: bu.tax_address ?? null,
    iibb_number: bu.iibb_number ?? null,
    inicio_actividades: bu.inicio_actividades ?? null,
  };
}

/** D5: an internal document carries no fiscal data of the issuer — only the
 *  division, as its name. A fiscal one is returned untouched. */
export function redactEmisor({
  isFiscal,
  emisor,
}: {
  isFiscal: boolean;
  emisor: Emisor;
}): Emisor {
  if (isFiscal) return emisor;
  return {
    legal_name: emisor.division_label,
    cuit: "",
    iva_condition: "",
    address: null,
    division_label: "",
    iibb_number: null,
    inicio_actividades: null,
  };
}
