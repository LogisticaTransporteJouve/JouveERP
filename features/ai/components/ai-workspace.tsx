"use client";

import { useQueryClient } from "@tanstack/react-query";
import { PanelLeft, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

import { InsightsPanel } from "@/features/ai/insights/components/insights-panel";

import { AiChat } from "./ai-chat";
import { AiHistory } from "./ai-history";
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
}: {
  canManageInsights?: boolean;
  initialAsk?: string;
}) {
  const qc = useQueryClient();
  // Live (not-yet-loaded-from-history) chat id. Generated after mount to avoid
  // an SSR/client hydration mismatch.
  const [liveNewId, setLiveNewId] = useState("");
  const [activeSessionId, setActiveSessionId] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [seed, setSeed] = useState<{
    sessionId: string;
    prompt: string;
  } | null>(null);

  useEffect(() => {
    const id = crypto.randomUUID();
    setLiveNewId(id);
    setActiveSessionId(id);
    if (initialAsk) setSeed({ sessionId: id, prompt: initialAsk });
  }, [initialAsk]);

  const sessions = useAiSessions();
  const usage = useAiUsageToday();
  const atCap = usage.data ? usage.data.totalTokens >= usage.data.cap : false;
  const isLive = activeSessionId === liveNewId;
  const messages = useAiSessionMessages(
    activeSessionId,
    Boolean(activeSessionId) && !isLive,
  );
  const deleteSession = useDeleteAiSession();

  function startNewChat() {
    const id = crypto.randomUUID();
    setLiveNewId(id);
    setActiveSessionId(id);
    setHistoryOpen(false);
  }

  function selectSession(id: string) {
    setActiveSessionId(id);
    setHistoryOpen(false);
  }

  // "Preguntar sobre esto": start a fresh chat seeded with the insight question.
  function askAboutInsight(question: string) {
    const id = crypto.randomUUID();
    setLiveNewId(id);
    setActiveSessionId(id);
    setSeed({ sessionId: id, prompt: question });
    setHistoryOpen(false);
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

  const history = (
    <AiHistory
      sessions={sessions.data ?? []}
      isLoading={sessions.isLoading}
      activeId={activeSessionId}
      onSelect={selectSession}
      onNew={startNewChat}
      onDelete={handleDelete}
    />
  );

  return (
    <div className="flex h-[calc(100dvh-7rem)] flex-col gap-4">
      <header className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          onClick={() => setHistoryOpen((v) => !v)}
        >
          <PanelLeft className="size-5" />
          <span className="sr-only">Historial</span>
        </Button>
        <Sparkles className="size-5" />
        <h1 className="text-2xl font-semibold">Asistente IA</h1>
        {usage.data && (
          <div className="ml-auto">
            <AiUsageMeter
              totalTokens={usage.data.totalTokens}
              cap={usage.data.cap}
            />
          </div>
        )}
      </header>

      <div className="flex min-h-0 flex-1 gap-4">
        <aside className="hidden w-64 shrink-0 md:block">{history}</aside>

        {historyOpen && (
          <div className="bg-card absolute inset-x-0 z-10 mx-4 rounded-lg border p-4 shadow-md md:hidden">
            {history}
          </div>
        )}

        <main className="flex min-w-0 flex-1 flex-col gap-3 overflow-hidden">
          <div className="max-h-72 shrink-0 overflow-y-auto">
            <InsightsPanel
              canManage={canManageInsights}
              onAsk={askAboutInsight}
            />
          </div>
          <div className="min-h-0 flex-1">
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
          </div>
        </main>
      </div>
    </div>
  );
}
