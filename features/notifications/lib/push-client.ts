// Cliente del subsystem de Web Push. Registra el service worker,
// suscribe al user al endpoint del browser, y manda la subscription
// al server para que la guarde. Si las VAPID keys públicas no están
// disponibles, todo el flujo es un no-op.

import {
  subscribePushAction,
  unsubscribePushAction,
} from "../actions/push-actions";

const SW_PATH = "/sw.js";

export function isPushSupported(): boolean {
  if (typeof window === "undefined") return false;
  return (
    "serviceWorker" in navigator
    && "PushManager" in window
    && "Notification" in window
  );
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const arr = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) arr[i] = rawData.charCodeAt(i);
  return arr;
}

async function getRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!isPushSupported()) return null;
  const existing = await navigator.serviceWorker.getRegistration(SW_PATH);
  if (existing) return existing;
  return navigator.serviceWorker.register(SW_PATH);
}

export async function enablePushNotifications(): Promise<
  { ok: true } | { ok: false; reason: string }
> {
  if (!isPushSupported()) return { ok: false, reason: "unsupported" };
  const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!vapidKey) return { ok: false, reason: "missing_vapid_key" };

  if (Notification.permission === "default") {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") return { ok: false, reason: "permission_denied" };
  } else if (Notification.permission !== "granted") {
    return { ok: false, reason: "permission_denied" };
  }

  const registration = await getRegistration();
  if (!registration) return { ok: false, reason: "no_registration" };

  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    // applicationServerKey acepta BufferSource; el cast es por TS strict
    // sobre el Uint8Array<ArrayBufferLike> que devuelve atob().
    const keyBytes = urlBase64ToUint8Array(vapidKey);
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyBytes.buffer as ArrayBuffer,
    });
  }

  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    return { ok: false, reason: "invalid_subscription" };
  }
  const res = await subscribePushAction({
    endpoint: json.endpoint,
    p256dh: json.keys.p256dh,
    auth: json.keys.auth,
    userAgent: navigator.userAgent,
  });
  if (!res.ok) return { ok: false, reason: res.error };

  return { ok: true };
}

export async function disablePushNotifications(): Promise<void> {
  if (!isPushSupported()) return;
  const registration = await navigator.serviceWorker.getRegistration(SW_PATH);
  const subscription = await registration?.pushManager.getSubscription();
  if (subscription) {
    await unsubscribePushAction(subscription.endpoint);
    await subscription.unsubscribe();
  }
}
