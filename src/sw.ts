/// <reference lib="webworker" />
import {
  precacheAndRoute,
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
} from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { NetworkFirst, StaleWhileRevalidate } from "workbox-strategies";
import { ExpirationPlugin } from "workbox-expiration";

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

type PushPayload = {
  title?: string;
  body?: string;
  tag?: string;
  url?: string;
  alertId?: string;
  severity?: "critical" | "warning" | "info" | "opportunity";
};

// ---------- Precache del app shell ----------
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);
registerRoute(
  new NavigationRoute(createHandlerBoundToURL("index.html"), {
    denylist: [/^\/api\//],
  }),
);

// ---------- Runtime caching ----------
// Fuentes de Google: cachear agresivamente
registerRoute(
  ({ url }) =>
    url.origin === "https://fonts.googleapis.com" ||
    url.origin === "https://fonts.gstatic.com",
  new StaleWhileRevalidate({ cacheName: "google-fonts" }),
);

// Logos de empresas: cambian casi nunca y son chicos. Cachearlos evita que la
// app instalada dependa de la red para dibujar la lista de posiciones.
registerRoute(
  ({ url }) =>
    url.hostname === "assets.parqet.com" ||
    url.hostname === "financialmodelingprep.com",
  new StaleWhileRevalidate({
    cacheName: "asset-logos",
    plugins: [
      new ExpirationPlugin({
        maxEntries: 120,
        maxAgeSeconds: 60 * 60 * 24 * 30,
      }),
    ],
  }),
);

// Datos de Supabase: network first con fallback al último dato conocido (offline)
registerRoute(
  ({ url }) =>
    url.hostname.endsWith(".supabase.co") && url.pathname.startsWith("/rest/"),
  new NetworkFirst({
    cacheName: "supabase-data",
    networkTimeoutSeconds: 5,
    plugins: [
      new ExpirationPlugin({ maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 }),
    ],
  }),
);

// ---------- Ciclo de vida ----------
self.addEventListener("install", () => {
  void self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") void self.skipWaiting();
});

// ---------- Push notifications ----------
self.addEventListener("push", (event) => {
  let data: PushPayload = {};
  try {
    data = (event.data?.json() as PushPayload) ?? {};
  } catch {
    data = { title: "Inverse Pulse", body: event.data?.text() ?? "" };
  }

  const options: NotificationOptions = {
    body: data.body,
    icon: "/icons/icon-192x192.png",
    badge: "/icons/badge-72x72.png",
    tag: data.tag || "default",
    data: { url: data.url || "/", alertId: data.alertId },
    // Propiedades soportadas en Android/Chrome pero fuera del typing estándar
    ...({
      renotify: true,
      vibrate:
        data.severity === "critical"
          ? [300, 100, 300, 100, 300]
          : [200, 100, 200],
      actions: [
        { action: "open", title: "Ver detalle" },
        { action: "dismiss", title: "Descartar" },
      ],
    } as Partial<NotificationOptions>),
  };

  event.waitUntil(
    self.registration.showNotification(data.title ?? "Inverse Pulse", options),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  if (event.action === "dismiss") return;

  const target = (event.notification.data?.url as string | undefined) ?? "/";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        // Si la app ya está abierta, enfocarla y navegar
        for (const client of clientList) {
          if ("focus" in client) {
            void client.focus();
            if ("navigate" in client) void client.navigate(target);
            return;
          }
        }
        return self.clients.openWindow(target).then(() => undefined);
      }),
  );
});
