export const EMPLOYEES_PAGE_SIZE = 50;

export const employeesKeys = {
  all: ["employees"] as const,
  searchInfinite: (filters: { query: string; onlyActive: boolean }) =>
    [...employeesKeys.all, "searchInfinite", filters] as const,
  search: (filters: { query: string; onlyActive: boolean; limit: number }) =>
    [...employeesKeys.all, "search", filters] as const,
  byId: (id: string) => [...employeesKeys.all, "byId", id] as const,
  list: () => [...employeesKeys.all, "list"] as const,
};
