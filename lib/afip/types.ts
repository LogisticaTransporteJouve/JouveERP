// AFIP padrón A4 normalized output.
//
// `tax_condition` matches the IVA enum used by the clients table (C.1) so the
// padrón response can be plugged straight into a client form without an extra
// mapping layer. The mapping from the AFIP raw shape lives in padron.ts.

export type TaxCondition =
  | "responsable_inscripto"
  | "monotributo"
  | "exento"
  | "consumidor_final"
  | "no_categorizado";

export interface FiscalAddress {
  street: string;
  city: string;
  province: string;
  postal_code: string;
}

export interface TaxEntry {
  id: number;
  description: string;
  status: string; // 'ACTIVO' | 'BAJA DEFINITIVA' | ...
  registration_date: string | null;
}

export interface ContributorInfo {
  cuit: string;
  person_type: "FISICA" | "JURIDICA";
  id_type: "CUIT" | "CUIL" | "CDI";
  status: "ACTIVO" | "INACTIVO" | "BLOQUEADO" | "UNKNOWN";
  legal_name: string;
  first_name: string | null;
  last_name: string | null;
  tax_condition: TaxCondition;
  fiscal_address: FiscalAddress | null;
  main_activity: string | null;
  closing_month: number | null;
  registration_date: string | null;
  taxes: TaxEntry[];
}

export interface AccessTicket {
  token: string;
  sign: string;
  expiration_time: Date;
}
