export const issuedChecksKeys = {
  all: ["issued_checks"] as const,
  list: () => [...issuedChecksKeys.all, "list"] as const,
  byId: (id: string) => [...issuedChecksKeys.all, "byId", id] as const,
};
