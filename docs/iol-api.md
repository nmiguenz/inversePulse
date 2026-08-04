# API REST de IOL — endpoints usados

Base: `https://api.invertironline.com` (sandbox: `https://api.homo.invertironline.com`)

Documentación oficial: [Autenticación](https://api.invertironline.com/Help/Autenticacion) ·
[Portal de developers](https://developers.invertironline.com/)

## Autenticación

```http
POST /token
Content-Type: application/x-www-form-urlencoded

username=<usuario>&password=<clave>&grant_type=password
```

Respuesta: `access_token`, `refresh_token`, `expires_in` (900s = **15 minutos**).

Renovación:

```http
POST /token
refresh_token=<token>&grant_type=refresh_token
```

> **El refresh token rota en cada renovación.** Por eso no puede vivir en una env
> var (son inmutables en runtime): se persiste en la tabla `iol_credentials`, que
> tiene RLS habilitado y ninguna policy, así que solo la alcanza la service role key.

Todas las llamadas siguientes van con `Authorization: Bearer <access_token>`.

## Portafolio

```http
GET /api/v2/portafolio/argentina
```

```jsonc
{
  "pais": "argentina",
  "activos": [
    {
      "cantidad": 24,
      "comprometido": 0,
      "puntosVariacion": 318.0,
      "variacionDiaria": 1.24,      // % del día
      "ultimoPrecio": 25980.0,
      "ppc": 20813.0,               // precio promedio de compra
      "gananciaPorcentaje": 24.8,
      "gananciaDinero": 124008.0,
      "valorizado": 623520.0,
      "titulo": {
        "simbolo": "MSFT",
        "descripcion": "Microsoft Corp.",
        "pais": "estados_Unidos",
        "mercado": "bCBA",
        "tipo": "CEDEARS",          // CEDEARS | FondoComundeInversion | TitulosPublicos | ACCIONES
        "plazo": "t1",              // t0 | t1 | t2  → rescue_time
        "moneda": "peso_Argentino"
      },
      "parking": { "disponibleInmediato": 0 }
    }
  ]
}
```

Mapeo a `positions` en [`supabase/functions/_shared/mapping.ts`](../supabase/functions/_shared/mapping.ts).

`previous_close` no viene en la respuesta: se deriva de `ultimoPrecio` y
`variacionDiaria` (`ultimoPrecio / (1 + variacionDiaria/100)`).

## Estado de cuenta

```http
GET /api/v2/estadocuenta
```

```jsonc
{
  "cuentas": [
    {
      "numero": "...", "tipo": "inversion_Argentina_Pesos",
      "moneda": "peso_Argentino",
      "disponible": 1510.0, "comprometido": 0.0, "saldo": 1510.0,
      "titulosValorizados": 7294560.0, "total": 7296070.0,
      "margenDescubierto": 0.0, "estado": "operable"
    }
  ],
  "estadisticas": [{ "descripcion": "...", "cantidad": 0, "volumen": 0 }],
  "totalEnPesos": 7296070.0
}
```

## Otros endpoints (fases siguientes)

| Uso | Endpoint |
|---|---|
| Cotización puntual | `GET /api/v2/{mercado}/Titulos/{simbolo}/Cotizacion` |
| Cotización detallada | `GET /api/v2/titulos/cotizacion/detalle` |
| Serie histórica | `GET /api/v2/titulos/cotizacion/serie-historica` |
| Operar | `POST /api/v2/operar/Comprar` · `/Vender` |

## Rate limits

El CRON corre cada 5 minutos y hace **2 requests por ciclo** (portafolio +
estado de cuenta), más como mucho 1 request de token cada 15 minutos. No hay
polling desde el frontend: el browser solo lee de Supabase.
