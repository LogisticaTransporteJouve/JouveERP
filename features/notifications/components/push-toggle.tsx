"use client";

import { Bell, BellOff } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

import {
  disablePushNotifications,
  enablePushNotifications,
  isPushSupported,
} from "../lib/push-client";

type State = "unsupported" | "missing-vapid" | "denied" | "off" | "on";

export function PushToggle() {
  const [state, setState] = useState<State>("off");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isPushSupported()) {
      setState("unsupported");
      return;
    }
    if (!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) {
      setState("missing-vapid");
      return;
    }
    if (Notification.permission === "denied") {
      setState("denied");
      return;
    }
    (async () => {
      const reg = await navigator.serviceWorker.getRegistration("/sw.js");
      const sub = await reg?.pushManager.getSubscription();
      setState(sub ? "on" : "off");
    })();
  }, []);

  const handleEnable = async () => {
    setBusy(true);
    try {
      const res = await enablePushNotifications();
      if (res.ok) {
        setState("on");
        toast.success("Push activado en este dispositivo.");
      } else {
        toast.error(
          res.reason === "permission_denied"
            ? "Permiso denegado. Activalo desde la configuración del browser."
            : `No se pudo activar: ${res.reason}`,
        );
      }
    } finally {
      setBusy(false);
    }
  };

  const handleDisable = async () => {
    setBusy(true);
    try {
      await disablePushNotifications();
      setState("off");
      toast.success("Push desactivado.");
    } finally {
      setBusy(false);
    }
  };

  if (state === "unsupported") {
    return (
      <p className="text-xs text-muted-foreground">
        Este browser no soporta push notifications.
      </p>
    );
  }

  if (state === "missing-vapid") {
    return (
      <p className="text-xs text-muted-foreground">
        Push real no está configurado en este deploy. Las notifs in-app
        siguen funcionando.
      </p>
    );
  }

  if (state === "denied") {
    return (
      <p className="text-xs text-muted-foreground">
        Bloqueaste las notifs en este browser. Habilitalas desde la
        configuración del sitio para activar el push.
      </p>
    );
  }

  return state === "on" ? (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={busy}
      onClick={handleDisable}
    >
      <BellOff className="size-4" />
      Desactivar push en este dispositivo
    </Button>
  ) : (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={busy}
      onClick={handleEnable}
    >
      <Bell className="size-4" />
      Activar push en este dispositivo
    </Button>
  );
}
