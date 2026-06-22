/**
 * Extracts `id` (if present and a string) from the variables payload that
 * the `onSuccess` of a TanStack Query mutation receives. The variables
 * signature is loose per feature (each mutation has its own input shape), so
 * instead of typing it generically we use a defensive structural cast.
 *
 * Consolidates the `(variables as { id?: string }).id` pattern that lived in 7
 * hooks (use-clients, use-suppliers, use-receipts, use-payment-orders,
 * use-purchase-invoices, use-transactions, use-employees).
 *
 * Usage:
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
