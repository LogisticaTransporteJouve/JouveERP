// A receipt with an eCheq: the receipt, the check into the cartera and the
// treasury movement of the cartera.
export const ECHEQ_LISTADO_PERMISSIONS = [
  "receipts:write",
  "cheques:write",
  "transactions:write",
] as const;
