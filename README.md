# IOL Portfolio Monitor

PWA de monitoreo de cartera con alertas automáticas. Spec completa en [docs/CLAUDE.md](docs/CLAUDE.md).

## Comandos

```bash
npm install
npm run dev      # http://localhost:5173 (expuesto en la LAN para probar en el celular)
npm run build    # type-check + build de producción (genera dist/sw.js)
npm run preview  # sirve dist/ — necesario para probar el service worker real
npm run icons    # regenera public/icons/*.png
```

## Estado — Fase 1 ✅

- Vite 6 + React 18 + TypeScript (strict, alias `@/*` → `src/`)
- Tailwind v4 con el design system del spec en `@theme` ([src/index.css](src/index.css))
- PWA con `vite-plugin-pwa` en modo `injectManifest`: manifest, precache del app shell,
  runtime caching (fuentes + REST de Supabase con `NetworkFirst` para el modo offline)
  y service worker propio con handlers de `push` / `notificationclick` ([src/sw.ts](src/sw.ts))
- Layout mobile first (375px): top bar fija con badge de alertas, bottom nav de 5 tabs
  con safe-area insets ([src/components/layout/](src/components/layout/))
- Pantallas ruteadas: Dashboard, Alertas, Oportunidades, Noticias, Config
- Supabase: schema en [supabase/migrations/0001_init.sql](supabase/migrations/0001_init.sql),
  cliente en [src/lib/supabase.ts](src/lib/supabase.ts), auth por magic link (PKCE) con guard de
  rutas y logout ([src/lib/auth.tsx](src/lib/auth.tsx), [src/pages/Login.tsx](src/pages/Login.tsx))

## Estado — Fase 2 ✅

- Edge Functions `fetch-portfolio` y `fetch-dollar-rates` + jobs de `pg_cron`
- Endpoints de IOL documentados en [docs/iol-api.md](docs/iol-api.md)
- Dashboard con datos reales de Supabase y realtime: MetricCards, donut por sector,
  posiciones con sparklines de 30 días, top 5 de liquidez y cotizaciones de dólar

## Estructura

```
src/
  components/
    layout/     AppShell · TopBar · BottomNav
    ui/         Card · MetricCard · Badge (AlertBadge, TagPill) · Icon
    dashboard/  SectorDonut · Sparkline · PositionRow · DollarStrip
  hooks/        usePortfolio (fetch + realtime)
  lib/          format · portfolio (cálculos) · sectors (paleta) · types · supabase · auth
  pages/        Dashboard · Alerts · Opportunities · News · Settings · Login
  sw.ts         service worker (precache + push)
supabase/
  migrations/   0001_init · 0002_iol_integration · 0003_cron
  functions/    fetch-portfolio · fetch-dollar-rates · _shared (iol, mapping)
scripts/
  generate-icons.mjs   iconos PNG sin dependencias
```

## Setup de Supabase

1. **SQL Editor** → pegar y correr `supabase/migrations/0001_init.sql`.
2. **Project Settings → API** → copiar `Project URL` y la `anon public` key a un `.env.local`:
   ```
   VITE_SUPABASE_URL=https://xxx.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJ...
   ```
3. **Authentication → URL Configuration** → Site URL `http://localhost:5173` y agregar
   `http://localhost:5173/**` (y después el dominio de Vercel) a Redirect URLs.

Reiniciar `npm run dev`: la app arranca en el login, el magic link crea la fila en `public.users`
con sus `alert_rules` por defecto vía trigger.

## Deploy de las Edge Functions (Fase 2)

```bash
npx supabase login                         # abre el browser, guarda el access token
npx supabase link --project-ref <PROJECT_REF>
npx supabase secrets set IOL_USERNAME=... IOL_PASSWORD=...
npx supabase functions deploy fetch-portfolio fetch-dollar-rates
npx supabase functions list                # confirmar que quedaron ACTIVE
```

Primer sync manual (el CLI 2.x no tiene `functions invoke`, se llama por HTTP con la
service role key, que es la que las functions esperan en el header):

```bash
curl -i -X POST "https://<PROJECT_REF>.supabase.co/functions/v1/fetch-portfolio" \
  -H "Authorization: Bearer <SERVICE_ROLE_KEY>"
```

> **Si aplicaste las migraciones a mano desde el SQL Editor, no corras `supabase db push`**:
> el CLI no tiene registro de ellas e intentaría re-ejecutarlas ("relation already exists").
> Para que el CLI las dé por aplicadas:
> `npx supabase migration repair --status applied 0001 0002`.
> De ahí en adelante, `db push` para las nuevas.

Después, editar `supabase/migrations/0003_cron.sql` con el project ref y la service role
key, y correrlo en el SQL Editor para programar los CRON (los horarios están en UTC:
13-21 UTC = 10-18 ART).

`SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` ya vienen inyectadas en el runtime de las
functions; no hace falta setearlas como secrets.

## CRON

Los jobs están en [supabase/migrations/0003_cron.sql](supabase/migrations/0003_cron.sql).
La service role key **no está en el archivo**: se guarda cifrada en Vault y el job la lee
en cada corrida. Antes de correr esa migración, una sola vez:

```sql
select vault.create_secret('<SERVICE_ROLE_KEY>', 'service_role_key');
```

## Deploy a Vercel

1. Subir el repo a GitHub (**privado** — el proyecto expone la estructura de la cartera).
2. Vercel → Add New → Project → importar el repo. Detecta Vite solo; no hay que tocar
   build command ni output directory.
3. Cargar las env vars (Settings → Environment Variables), las mismas del `.env.local`:
   `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_VAPID_PUBLIC_KEY`.
   Las de IOL y la VAPID privada **no** van acá: viven en los secrets de Supabase.
4. Supabase → Authentication → URL Configuration: cambiar Site URL al dominio de Vercel
   y agregar `https://<dominio>/**` a Redirect URLs (dejar también el de localhost).

[vercel.json](vercel.json) resuelve el rewrite de SPA para React Router y evita que el
service worker quede cacheado.

Recién con HTTPS se pueden probar las push notifications en el celular.

## Estado — Fase 4 ✅

- Edge Function `fetch-news`: RSS → pre-filtro por keywords → análisis con Claude → alertas
- Feed de noticias filtrable por temática; los tags del Dashboard abren el feed ya filtrado
- Alertas + push por noticias negativas de alto impacto sobre activos en cartera

### Costo

El spec proponía una llamada a Claude por noticia. Medido sobre los feeds reales, eso serían
~290 llamadas por corrida. Con el pre-filtro por las keywords de `world_topics` **antes** de
tocar la API, sobrevive ~26% y se agrupan de a 10 por request: **~8 llamadas en la primera
corrida**, y bastante menos en las siguientes porque `news.url` es `UNIQUE` y nada se analiza
dos veces.

Otras medidas: `thinking: disabled` + `effort: low` (en Sonnet 5 el thinking adaptativo está
activo por defecto si no se configura) y un tope de 40 noticias analizadas por corrida.

Para medir el ratio con datos frescos, la respuesta de la function trae `stats.fetched` vs
`stats.analyzed`: si se parecen, el pre-filtro dejó de filtrar.

## Próximo — Fase 5

- `analyze-opportunities` con Claude Opus 5 (razonamiento sobre decisiones de inversión)
- Cards de oportunidades con growth estimate y horizonte temporal
- Earnings calendar y recordatorios

## Notas

- Las credenciales de IOL y la `ANTHROPIC_API_KEY` van **solo** en Edge Functions, nunca en el frontend.
- El service worker solo corre en `dev` (`devOptions.enabled`) y en `npm run preview`; para probar
  push notifications hace falta HTTPS o `localhost`.
