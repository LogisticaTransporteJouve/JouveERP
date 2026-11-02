import { z } from "zod";

import { getDashboardTodayAction } from "@/features/dashboard/actions/dashboard-actions";

import { defineAiAction } from "../define";
import { type AiRunResult, errResult, okResult } from "../result";

// Read tool over the dashboard's "Hoy y esta semana": wraps
// getDashboardTodayAction, so each part keeps its own gate (trips:read for
// today's trips; fleet_documents:read and hr:read for the papers). What is
// due this week comes from getTasks.

export async function runTodayOverview(): Promise<AiRunResult> {
  const res = await getDashboardTodayAction();
  if (!res.ok) return errResult(res.error);
  const { trips, papers } = res.data;
  const parts: string[] = [];
  if (trips) {
    parts.push(
      trips.ok ? `${trips.data.length} trips today` : "trips unreadable",
    );
  }
  if (papers) {
    parts.push(
      papers.ok
        ? `${papers.data.filter((p) => p.expired).length} papers expired, ` +
            `${papers.data.filter((p) => !p.expired).length} expiring in 30 days`
        : "papers unreadable",
    );
  }
  return okResult(`${parts.join("; ")}.`, res.data, {
    partial: trips?.ok === false || papers?.ok === false,
  });
}

export const getTodayOverview = defineAiAction({
  name: "getTodayOverview",
  domain: "flota",
  permission: { anyOf: ["trips:read", "fleet_documents:read", "hr:read"] },
  sideEffect: "read",
  sources: ["trips", "shipments", "fleet_documents", "employee_documents"],
  description:
    "Today at a glance (dashboard 'Hoy y esta semana'): today's trips with " +
    "truck, driver, clients and status, and the papers of trucks, drivers " +
    "and employees that are expired or expire within 30 days (a renewed " +
    "one is not listed). For what is due this week use getTasks.",
  input: z.object({}),
  run: () => runTodayOverview(),
});
