"use client";

import { useQuery } from "@tanstack/react-query";

import { cashFlowQuery, treasurySummaryQuery } from "../lib/treasury-queries";

export function useTreasurySummary() {
  return useQuery(treasurySummaryQuery());
}

export function useCashFlow(monthsBack: number, monthsFwd: number) {
  return useQuery(cashFlowQuery(monthsBack, monthsFwd));
}
