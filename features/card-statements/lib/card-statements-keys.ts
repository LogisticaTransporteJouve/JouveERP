export const cardStatementsKeys = {
  all: ["card-statements"] as const,
  list: () => [...cardStatementsKeys.all, "list"] as const,
  detail: (id: string) => [...cardStatementsKeys.all, "detail", id] as const,
};
