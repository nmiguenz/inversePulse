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

## Tipo de cambio implícito

Un CEDEAR cotiza en pesos y también en dólar MEP, con **sufijo `D`** (y en
cable con sufijo `C`):

```jsonc
// GET /api/v2/bCBA/Titulos/NVDA/Cotizacion   → ultimoPrecio 14330  (ARS)
// GET /api/v2/bCBA/Titulos/NVDAD/Cotizacion  → ultimoPrecio 9.46   (USD)
// dólar implícito = 14330 / 9.46 = 1514,8   (MEP de mercado 1523,9)
```

**La convención NO es universal.** Los símbolos de 5 caracteres se abrevian
para que el par entre en 5:

| Símbolo | Par en dólares | |
|---|---|---|
| `NVDA` | `NVDAD` | ✓ convención |
| `BRKB` | `BRKBD` | ✓ convención |
| `GOOGL` | `GOGLD` | ✗ `GOOGLD` no existe |
| `TZXD6` | `TXD6D` | ✗ bono, tira la `Z` |

La abreviatura **no se puede derivar**: `GOOGL` tira la segunda `O` y `TZXD6`
tira la `Z`. Por eso se curan una por una en vez de intentar una regla.

Las excepciones viven en `asset_metadata.dollar_symbol` (NULL = usar la
convención), pero **no hay que cargarlas a mano**: si el ticker por convención
falla, `computeImpliedFx` prueba los candidatos de "borrar un carácter y
agregar D" —que es la única operación que distingue a las excepciones
conocidas— y guarda el que funciona.

La red de seguridad es el MEP: un candidato podría resolver a otro instrumento
real, así que se descarta cualquiera cuyo implícito quede a más de 20% del MEP
de mercado. Probado borrando los overrides de `GOOGL` y `TZXD6`: la corrida
siguiente redescubrió `GOGLD` y `TXD6D` y los volvió a persistir.

> El detalle del título de la API pública **no sirve** para esto: sondeado,
> devuelve solo `descripcion, mercado, moneda, pais, plazo, simbolo, tipo`. No
> hay campo de símbolos relacionados — eso lo arma el conector MCP por su
> cuenta.

Lo que aun así no resuelva queda en un warning con el ticker intentado, y
`POST /functions/v1/fetch-portfolio?probe=fx` lo devuelve por HTTP (el CLI de
Supabase no tiene `functions logs`).

**Esto no es solo de CEDEARs.** Los bonos tienen par (`TZXD6` → `TXD6D`) y las
acciones locales también (`GGAL` → `GGALD`). Los únicos que realmente no tienen
son los **FCI**: el detalle de `CNXPOPA` y `PRMCAPB` devuelve `dollar: null`.

Se calcula en dos cadencias, desde `_shared/impliedFx.ts`:

| Quién | Qué cubre | Cuándo |
|---|---|---|
| `fetch-portfolio` | lo que tenés en cartera | cada 5 min |
| `fetch-market-quotes` | el universo sugerible | 1×/día al cierre |

El segundo existe porque la prima decide sobre todo una COMPRA, y lo que se
compra sale del universo, no de lo que ya tenés.

Se guarda en `market_quotes.implied_fx`. La pata en pesos ya se tiene (viene en
el portafolio o en la cotización del universo), así que es **1 request extra
por símbolo**.

## Otros endpoints (fases siguientes)

| Uso | Endpoint |
|---|---|
| Cotización puntual | `GET /api/v2/{mercado}/Titulos/{simbolo}/Cotizacion` |
| Cotización detallada | `GET /api/v2/titulos/cotizacion/detalle` |
| Serie histórica | `GET /api/v2/titulos/cotizacion/serie-historica` |
| Operar | `POST /api/v2/operar/Comprar` · `/Vender` |

## Lo que NO está en la API pública

El conector MCP de IOL expone endpoints que **no viven en
`api.invertironline.com`** sino en `gateway-api-internal.invertironline.com`,
un host interno sin documentar:

| Herramienta MCP | URL real |
|---|---|
| `get_options_chain` | `GET {gateway}/Asset/Options/Chain/{simbolo}` |
| `get_stop_loss_and_take_profit` | host y ruta sin confirmar |

Dos cosas comprobadas sobre las opciones, antes de que a alguien se le ocurra
usarlas para calcular volatilidad implícita:

- **Los CEDEARs no tienen opciones en BCBA.** `NVDA`, `AAPL` y `MSFT` devuelven
  404. Solo listan opciones las acciones locales (`GGAL` devuelve 174
  contratos con Greeks).
- La IV viene como **fracción**, no como porcentaje: el ATM de GGAL da
  `0.8938`, o sea 89% anualizado. En este mercado ese valor es lo normal, así
  que un umbral tipo "IV > 40% = alta" marca absolutamente todo.

Por eso el asesor usa **volatilidad realizada** de `price_history` en vez de IV.

### El gateway interno no es alcanzable

`gateway-api-internal.invertironline.com` **no existe en DNS público**. No
resuelve ni en `1.1.1.1` ni en `8.8.8.8`: el nombre solo matchea con `.com.ar`
agregado, y devuelve IPs distintas según el resolver, que es la firma de un
catch-all de typosquatting. Desde una Edge Function el request queda colgado
hasta agotar el presupuesto de cómputo (`WORKER_RESOURCE_LIMIT`).

El conector MCP corre adentro de la red de IOL o por una ruta privada. **No
intentar pegarle desde acá.**

### Stop loss / take profit: NO están en la API pública

Sondeado el 2026-08-20 con `POST /functions/v1/fetch-portfolio?probe=sltp`
(solo lectura, todavía en el código por si IOL los publica algún día):

| Ruta | Resultado |
|---|---|
| `/api/v2/Alertas` | 404 `No HTTP resource was found` |
| `/api/v2/alertas` | 404 idem |
| `/api/v2/StopLoss` | 404 idem |
| `/api/v2/TakeProfit` | 404 idem |
| `/api/v2/operar/StopLoss` | 500 `Runtime Error` genérico |
| `/api/v2/MiCuenta/Alertas` | 500 idem |

**No es un problema de credenciales**: un token inválido daría 401, y acá el
request llega hasta la capa de ruteo, que responde que la ruta no existe. Los
500 genéricos son lo mismo que ya se documentó para los movimientos de dinero:
en esta API una ruta inexistente puede devolver 500 en vez de 404.

Conclusión: la venta automática es una función de la plataforma web de IOL, no
de su API pública. La app no puede crear stop loss por el usuario — se queda en
avisar por alerta, que es lo que ya hace.

## Rate limits

El CRON corre cada 5 minutos y hace **2 + N requests por ciclo**: portafolio,
estado de cuenta, y una cotización por cada CEDEAR en cartera para el dólar
implícito (~10 hoy, de a tandas de 10). Más como mucho 1 request de token cada
15 minutos. No hay polling desde el frontend: el browser solo lee de Supabase.
