"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Lightbulb, Pin, SquarePen, Sparkles } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { IconButton } from "@/components/ui/icon-button";
import { Skeleton } from "@/components/ui/skeleton";

import { InsightsPanel } from "@/features/ai/insights/components/insights-panel";
import { useInsights } from "@/features/ai/insights/hooks/use-insights";

import { AiChat } from "./ai-chat";
import { AiHistoryMenu } from "./ai-history";
import { AiUsageMeter } from "./ai-usage-meter";
import {
  useAiSessions,
  useAiSessionMessages,
  useDeleteAiSession,
} from "../hooks/use-ai-sessions";
import { useAiUsageToday } from "../hooks/use-ai-usage";
import { aiKeys } from "../lib/ai-keys";

export function AiWorkspace({
  canManageInsights = false,
  initialAsk,
  initialSessionId,
}: {
  canManageInsights?: boolean;
  initialAsk?: string;
  /** Open this conversation from history (e.g. a link from /files). */
  initialSessionId?: string;
}) {
  const qc = useQueryClient();
  // Live (not-yet-loaded-from-history) chat id. Generated after mount to avoid
  // an SSR/client hydration mismatch.
  const [liveNewId, setLiveNewId] = useState("");
  const [activeSessionId, setActiveSessionId] = useState("");
  const [insightsOpen, setInsightsOpen] = useState(false);
  const [seed, setSeed] = useState<{
    sessionId: string;
    prompt: string;
  } | null>(null);

  useEffect(() => {
    const id = crypto.randomUUID();
    setLiveNewId(id);
    setActiveSessionId(initialSessionId ?? id);
    if (initialAsk && !initialSessionId) {
      setSeed({ sessionId: id, prompt: initialAsk });
    }
  }, [initialAsk, initialSessionId]);

  const sessions = useAiSessions();
  const usage = useAiUsageToday();
  const insights = useInsights();
  const atCap = usage.data ? usage.data.totalTokens >= usage.data.cap : false;
  const isLive = activeSessionId === liveNewId;
  const messages = useAiSessionMessages(
    activeSessionId,
    Boolean(activeSessionId) && !isLive,
  );
  const deleteSession = useDeleteAiSession();
  const insightCount = insights.data?.total ?? 0;
  // Same rule as the panel: hidden while loading, and when there is nothing
  // to show and nothing to recalculate.
  const showInsights =
    !insights.isLoading &&
    (insights.isError || insightCount > 0 || canManageInsights);

  function startNewChat() {
    const id = crypto.randomUUID();
    setLiveNewId(id);
    setActiveSessionId(id);
  }

  // "Resolver con IA": start a fresh chat seeded with the insight question.
  function askAboutInsight(question: string) {
    const id = crypto.randomUUID();
    setLiveNewId(id);
    setActiveSessionId(id);
    setSeed({ sessionId: id, prompt: question });
    setInsightsOpen(false);
  }

  function handleDelete(id: string) {
    deleteSession.mutate(id, {
      onSuccess: () => {
        if (id === activeSessionId) startNewChat();
      },
    });
  }

  function handlePersisted(sessionId: string) {
    qc.invalidateQueries({ queryKey: aiKeys.sessions() });
    qc.invalidateQueries({ queryKey: aiKeys.sessionMessages(sessionId) });
    qc.invalidateQueries({ queryKey: aiKeys.usageToday() });
  }

  return (
    <div className="flex h-[calc(100dvh-7rem)] flex-col gap-4 md:h-[calc(100dvh-8rem)]">
      <header className="flex items-center gap-1 sm:gap-2">
        <AiHistoryMenu
          sessions={sessions.data ?? []}
          isLoading={sessions.isLoading}
          activeId={activeSessionId}
          onSelect={setActiveSessionId}
          onNew={startNewChat}
          onDelete={handleDelete}
        />
        <IconButton label="Nuevo chat" variant="ghost" onClick={startNewChat}>
          <SquarePen className="size-4" />
        </IconButton>
        <Sparkles className="ml-1 hidden size-5 sm:block" />
        <h1 className="truncate text-xl font-semibold sm:text-2xl">
          Asistente IA
        </h1>
        <div className="ml-auto flex items-center gap-1 sm:gap-2">
          {showInsights && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setInsightsOpen(true)}
              aria-label={`Insights${insightCount > 0 ? ` (${insightCount})` : ""}`}
            >
              <Lightbulb className="size-4" />
              <span className="hidden sm:inline">Insights</span>
              {insightCount > 0 && (
                <span className="text-muted-foreground tabular-nums">
                  {insightCount}
                </span>
              )}
            </Button>
          )}
          <Button variant="ghost" size="sm" asChild>
            <Link href="/ai/pinned" aria-label="Fijados">
              <Pin className="size-4" />
              <span className="hidden sm:inline">Fijados</span>
            </Link>
          </Button>
          {/* On a phone the title needs the room; at the cap the composer
              says so anyway. */}
          {usage.data && (
            <div className="hidden sm:block">
              <AiUsageMeter
                totalTokens={usage.data.totalTokens}
                cap={usage.data.cap}
              />
            </div>
          )}
        </div>
      </header>

      <main className="min-h-0 flex-1">
        {!activeSessionId || (!isLive && messages.isLoading) ? (
          <Skeleton className="h-full w-full" />
        ) : (
          <AiChat
            key={activeSessionId}
            sessionId={activeSessionId}
            initialMessages={isLive ? [] : (messages.data ?? [])}
            onPersisted={handlePersisted}
            atCap={atCap}
            seedPrompt={
              seed && seed.sessionId === activeSessionId
                ? seed.prompt
                : undefined
            }
          />
        )}
      </main>

      <Dialog open={insightsOpen} onOpenChange={setInsightsOpen}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Insights</DialogTitle>
            <DialogDescription>
              Lo que el analista encontró en los datos, primero lo más grave.
              «Resolver con IA» abre un chat nuevo sobre la alerta.
            </DialogDescription>
          </DialogHeader>
          <InsightsPanel
            canManage={canManageInsights}
            onAsk={askAboutInsight}
            collapsible={false}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
