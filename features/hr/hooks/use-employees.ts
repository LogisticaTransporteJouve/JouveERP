"use client";

import {
  useMutation,
  useQueryClient,
  useSuspenseInfiniteQuery,
} from "@tanstack/react-query";
import { useMemo } from "react";

import { getMutationId } from "@/lib/query/get-mutation-id";
import { runAction } from "@/lib/query/run-action";

import {
  createEmployeeAction,
  reactivateEmployeeAction,
  searchEmployeesAction,
  terminateEmployeeAction,
  updateEmployeeAction,
  type SearchEmployeesPage,
} from "../actions/employees-actions";
import { EMPLOYEES_PAGE_SIZE, employeesKeys } from "../lib/employees-keys";
import type { Employee } from "../schema";

export { EMPLOYEES_PAGE_SIZE };

export function useEmployeesSearchInfinite(filters: {
  query: string;
  onlyActive: boolean;
}) {
  const query = useSuspenseInfiniteQuery({
    queryKey: employeesKeys.searchInfinite(filters),
    queryFn: ({ pageParam }) =>
      runAction(() =>
        searchEmployeesAction({
          query: filters.query,
          onlyActive: filters.onlyActive,
          offset: pageParam,
          limit: EMPLOYEES_PAGE_SIZE,
        }),
      ),
    initialPageParam: 0,
    getNextPageParam: (lastPage: SearchEmployeesPage) =>
      lastPage.nextOffset ?? undefined,
  });

  const items = useMemo<Employee[]>(
    () => query.data.pages.flatMap((page) => page.employees),
    [query.data],
  );

  return { ...query, items };
}

export function useCreateEmployee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: unknown) =>
      runAction(() => createEmployeeAction(input)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: employeesKeys.all });
    },
  });
}

export function useUpdateEmployee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: unknown) =>
      runAction(() => updateEmployeeAction(input)),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: employeesKeys.all });
      const id = getMutationId(variables);
      if (id) qc.invalidateQueries({ queryKey: employeesKeys.byId(id) });
    },
  });
}

export function useTerminateEmployee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      id: string;
      termination_date: string;
      notes?: string | null;
    }) => runAction(() => terminateEmployeeAction(input)),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: employeesKeys.all });
      qc.invalidateQueries({ queryKey: employeesKeys.byId(variables.id) });
    },
  });
}

export function useReactivateEmployee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      runAction(() => reactivateEmployeeAction({ id })),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: employeesKeys.all });
      qc.invalidateQueries({ queryKey: employeesKeys.byId(id) });
    },
  });
}
