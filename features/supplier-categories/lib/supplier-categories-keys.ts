export const supplierCategoriesKeys = {
  all: ["supplier_categories"] as const,
  list: (onlyActive: boolean) =>
    [...supplierCategoriesKeys.all, "list", { onlyActive }] as const,
};
