"use client";

import { useRouter } from "next/navigation";

import { InsightsPanel } from "./insights-panel";

// Dashboard wrapper: "Preguntar sobre esto" deep-links into the AI chat with
// the insight question pre-seeded via the ?ask= search param.
export function DashboardInsights({ canManage }: { canManage: boolean }) {
  const router = useRouter();
  return (
    <InsightsPanel
      canManage={canManage}
      onAsk={(question) => router.push(`/ai?ask=${encodeURIComponent(question)}`)}
    />
  );
}
