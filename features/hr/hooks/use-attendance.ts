"use client";

import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";

import { runAction } from "@/lib/query/run-action";

import {
  deleteAttendanceRecordAction,
  getAttendanceMonthAction,
  listAttendanceEmployeesAction,
  upsertAttendanceRecordAction,
} from "../actions/attendance-actions";
import type { AttendanceKind } from "../attendance-schema";

const attendanceKeys = {
  all: ["attendance"] as const,
  month: (year: number, month: number) =>
    [...attendanceKeys.all, "month", year, month] as const,
  employees: () => [...attendanceKeys.all, "employees"] as const,
};

export function useAttendanceMonth(year: number, month: number) {
  return useSuspenseQuery({
    queryKey: attendanceKeys.month(year, month),
    queryFn: () => runAction(() => getAttendanceMonthAction(year, month)),
  });
}

export function useAttendanceEmployees() {
  return useSuspenseQuery({
    queryKey: attendanceKeys.employees(),
    queryFn: () => runAction(() => listAttendanceEmployeesAction()),
  });
}

type UpsertVars = {
  employee_id: string;
  date: string;
  kind: AttendanceKind;
  hours_lost?: number | null;
  notes?: string | null;
  year: number;
  month: number;
};

export function useUpsertAttendance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ year: _y, month: _m, ...rest }: UpsertVars) =>
      runAction(() => upsertAttendanceRecordAction(rest)),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({
        queryKey: attendanceKeys.month(vars.year, vars.month),
      });
    },
  });
}

type DeleteVars = { id: string; year: number; month: number };

export function useDeleteAttendance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: DeleteVars) =>
      runAction(() => deleteAttendanceRecordAction({ id })),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({
        queryKey: attendanceKeys.month(vars.year, vars.month),
      });
    },
  });
}
