"use client";

import { useRouter } from "next/navigation";

import { WeeklySummaryCard } from "../../weekly/components/weekly-summary-card";
import { InsightsPanel } from "./insights-panel";

// Dashboard wrapper: the Monday CFO summary, then the insight cards. "Resolver
// con IA" deep-links into the AI chat with the alert pre-seeded via ?ask=.
export function DashboardInsights({ canManage }: { canManage: boolean }) {
  const router = useRouter();
  return (
    <div className="space-y-3">
      <WeeklySummaryCard />
      <InsightsPanel
        canManage={canManage}
        onAsk={(question) =>
          router.push(`/ai?ask=${encodeURIComponent(question)}`)
        }
      />
    </div>
  );
}
