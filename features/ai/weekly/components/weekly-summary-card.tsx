"use client";

import { CalendarDays } from "lucide-react";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { formatArgentineDate } from "@/lib/format";

import { AiMarkdown } from "../../lib/markdown";
import { useWeeklySummary } from "../hooks/use-weekly-summary";

/** The latest Monday CFO summary; renders nothing until there is one. */
export function WeeklySummaryCard() {
  const { data } = useWeeklySummary();
  if (!data) return null;
  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2 space-y-0 pb-2">
        <CalendarDays className="size-4 shrink-0" />
        <p className="text-sm font-semibold">
          Resumen semanal · semana del {formatArgentineDate(data.weekStart)}
        </p>
      </CardHeader>
      <CardContent className="text-sm">
        <AiMarkdown body={data.content} />
        <p className="text-muted-foreground mt-2 text-xs">
          Redactado por IA sobre cifras del sistema con tus permisos. No es
          asesoramiento profesional.
        </p>
      </CardContent>
    </Card>
  );
}
