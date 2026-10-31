export const issuedChecksKeys = {
  all: ["issued_checks"] as const,
  list: (isFiscal: boolean | null) =>
    [...issuedChecksKeys.all, "list", { isFiscal }] as const,
  byId: (id: string) => [...issuedChecksKeys.all, "byId", id] as const,
};
