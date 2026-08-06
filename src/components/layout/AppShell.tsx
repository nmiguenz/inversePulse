import { Outlet, useLocation } from "react-router-dom";
import { BottomNav } from "./BottomNav";
import { ScrollToTop } from "./ScrollToTop";
import { TopBar } from "./TopBar";
import { useAlerts } from "@/hooks/useAlerts";
import { useEarningsCheck } from "@/hooks/useEarningsCheck";
import { usePortfolio } from "@/hooks/usePortfolio";
import { CurrencyProvider } from "@/lib/currency";

const titles: Record<string, { title: string; subtitle?: string }> = {
  "/": { title: "Inverse Pulse", subtitle: "Cartera en vivo" },
  "/alertas": { title: "Alertas", subtitle: "Señales de tu cartera" },
  "/oportunidades": { title: "Oportunidades", subtitle: "Detectadas por AI" },
  "/noticias": { title: "Noticias", subtitle: "Mercados y temáticas" },
  "/config": { title: "Configuración", subtitle: "Umbrales y notificaciones" },
  "/historial": { title: "Historial", subtitle: "Movimientos y rendimiento" },
  "/metas": { title: "Metas", subtitle: "Tu cartera por objetivo" },
};

export function AppShell() {
  const { pathname } = useLocation();
  // Las rutas con parámetro no están en el mapa: se arma el título del símbolo
  const asset = pathname.match(/^\/activo\/(.+)$/);
  const meta = asset
    ? {
        title: decodeURIComponent(asset[1]).toUpperCase(),
        subtitle: "Detalle del activo",
      }
    : (titles[pathname] ?? { title: "Inverse Pulse" });

  const { unreadCount: alertCount } = useAlerts();
  const { latestRates } = usePortfolio();

  // Al abrir la app, avisa si falta cargar alguna fecha de resultados
  useEarningsCheck();

  // La cotización MEP viene del mismo sync que el resto. Si todavía no hay,
  // CurrencyProvider deshabilita el toggle en vez de inventar un tipo de cambio.
  const mep = latestRates.get("mep")?.sell_price ?? null;

  return (
    <CurrencyProvider mep={mep}>
      <div className="bg-base min-h-dvh">
        <ScrollToTop />
        <TopBar
          title={meta.title}
          subtitle={meta.subtitle}
          alertCount={alertCount}
        />

        <main
          className="mx-auto max-w-lg px-4"
          style={{
            paddingTop:
              "calc(var(--topbar-h) + env(safe-area-inset-top) + 12px)",
            paddingBottom:
              "calc(var(--bottomnav-h) + env(safe-area-inset-bottom) + 16px)",
          }}
        >
          <Outlet />
        </main>

        <BottomNav alertCount={alertCount} />
      </div>
    </CurrencyProvider>
  );
}
