"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { getMutationId } from "@/lib/query/get-mutation-id";
import { runAction } from "@/lib/query/run-action";

import {
  createEmployeeDocumentAction,
  deleteEmployeeDocumentAction,
  listEmployeeDocumentsAction,
  listExpiringDocumentsAction,
  updateEmployeeDocumentAction,
} from "../actions/employee-documents-actions";
import { employeeDocumentsKeys } from "../keys";

export function useEmployeeDocuments(employeeId: string) {
  return useQuery({
    queryKey: employeeDocumentsKeys.byEmployee(employeeId),
    queryFn: () => runAction(() => listEmployeeDocumentsAction(employeeId)),
    enabled: Boolean(employeeId),
  });
}

export function useExpiringDocuments() {
  return useQuery({
    queryKey: employeeDocumentsKeys.expiring(),
    queryFn: () => runAction(() => listExpiringDocumentsAction()),
    staleTime: 60_000,
  });
}

export function useCreateEmployeeDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof createEmployeeDocumentAction>[0]) =>
      runAction(() => createEmployeeDocumentAction(input)),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: employeeDocumentsKeys.all });
      const employeeId = (variables as { employee_id?: string }).employee_id;
      if (employeeId) {
        qc.invalidateQueries({
          queryKey: employeeDocumentsKeys.byEmployee(employeeId),
        });
      }
    },
  });
}

export function useUpdateEmployeeDocument(employeeId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof updateEmployeeDocumentAction>[0]) =>
      runAction(() => updateEmployeeDocumentAction(input)),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: employeeDocumentsKeys.all });
      const id = getMutationId(variables);
      if (id && employeeId) {
        qc.invalidateQueries({
          queryKey: employeeDocumentsKeys.byEmployee(employeeId),
        });
      }
    },
  });
}

export function useDeleteEmployeeDocument(employeeId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      runAction(() => deleteEmployeeDocumentAction(id)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: employeeDocumentsKeys.all });
      if (employeeId) {
        qc.invalidateQueries({
          queryKey: employeeDocumentsKeys.byEmployee(employeeId),
        });
      }
    },
  });
}
