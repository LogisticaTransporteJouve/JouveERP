/**
 * Extrae `id` (si existe y es string) del payload de variables que recibe
 * el `onSuccess` de una mutation de TanStack Query. La firma de variables
 * es loose por feature (cada mutation tiene su input shape), así que en
 * vez de tipar genérico repetimos un cast estructural defensivo.
 *
 * Consolida el patrón `(variables as { id?: string }).id` que vivía en 7
 * hooks (use-clients, use-suppliers, use-receipts, use-payment-orders,
 * use-purchase-invoices, use-transactions, use-employees).
 *
 * Uso:
 *   onSuccess: (_data, variables) => {
 *     const id = getMutationId(variables);
 *     if (id) qc.invalidateQueries({ queryKey: detail(id) });
 *   }
 */
export function getMutationId(variables: unknown): string | undefined {
  if (
    variables &&
    typeof variables === "object" &&
    "id" in variables &&
    typeof (variables as { id?: unknown }).id === "string"
  ) {
    return (variables as { id: string }).id;
  }
  return undefined;
}
