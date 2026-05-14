"use client";

import { useMemo } from "react";
import { toast } from "sonner";

import { Switch } from "@/components/ui/switch";

import {
  useNotificationSettings,
  useUpsertNotificationSetting,
} from "../hooks/use-settings";

import { PushToggle } from "./push-toggle";

const LABELS: Record<string, { title: string; description: string }> = {
  chat_message: {
    title: "Mensajes de chat",
    description: "Cuando recibís un mensaje en cualquier canal.",
  },
  chat_reply: {
    title: "Respuestas",
    description: "Cuando alguien responde un mensaje tuyo.",
  },
  chat_mention: {
    title: "Menciones",
    description: "Cuando te mencionan con @ en una conversación.",
  },
};

const TYPE_ORDER = ["chat_mention", "chat_reply", "chat_message"] as const;

export function NotificationSettings() {
  const { data: settings } = useNotificationSettings();
  const upsert = useUpsertNotificationSetting();

  const byType = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const s of settings) map.set(s.notification_type, s.enabled);
    return map;
  }, [settings]);

  const handleToggle = async (type: string, next: boolean) => {
    try {
      await upsert.mutateAsync({ type, enabled: next });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error.");
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-medium">Notificaciones</h2>
        <p className="text-sm text-muted-foreground">
          Elegí qué tipos de evento querés que disparen una notificación
          en la campanita del header.
        </p>
      </div>
      <div className="rounded-md border">
        <ul className="divide-y">
          {TYPE_ORDER.map((type) => {
            const label = LABELS[type] ?? { title: type, description: "" };
            const enabled = byType.get(type) ?? true;
            return (
              <li
                key={type}
                className="flex items-center justify-between gap-3 px-3 py-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">{label.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {label.description}
                  </p>
                </div>
                <Switch
                  checked={enabled}
                  disabled={upsert.isPending}
                  onCheckedChange={(v) => handleToggle(type, v)}
                  aria-label={label.title}
                />
              </li>
            );
          })}
        </ul>
      </div>

      <div className="space-y-2 rounded-md border p-3">
        <p className="text-sm font-medium">Push en este dispositivo</p>
        <p className="text-xs text-muted-foreground">
          Recibí las notificaciones aunque tengas la app cerrada. Funciona
          en Chrome, Firefox y Edge. En iOS Safari requiere agregar la app
          al Home Screen primero.
        </p>
        <PushToggle />
      </div>
    </div>
  );
}
