/**
 * Análisis de noticias y asesoramiento con Claude.
 *
 * Dos decisiones de costo, ambas visibles acá:
 *
 * 1. Se analiza un LOTE de noticias por request, no una por llamada. El system
 *    prompt (instrucciones + temáticas + símbolos en cartera) se paga una vez
 *    por lote en vez de una vez por noticia.
 *
 * 2. `thinking: disabled` + `effort: low`. En Sonnet 5 el thinking adaptativo
 *    está ACTIVO por defecto cuando no se configura; clasificar sentimiento no
 *    lo necesita, así que apagarlo explícitamente evita pagar tokens de
 *    razonamiento en cada corrida del CRON.
 *
 * La forma de la respuesta la garantiza la API vía structured outputs
 * (`output_config.format`), así que no hay que pedirle al modelo que "responda
 * solo con JSON" ni limpiar backticks del texto.
 */
import Anthropic from "npm:@anthropic-ai/sdk@0.115.0";

/** Sonnet para clasificar (alto volumen, tarea simple). */
export const NEWS_MODEL = "claude-sonnet-5";
/** Opus para las oportunidades: son sugerencias sobre plata real, no clasificación. */
export const OPPORTUNITY_MODEL = "claude-opus-5";

// ============================================================
// Types
// ============================================================

export type NewsInput = {
  index: number;
  title: string;
  source: string;
  snippet: string;
};

export type NewsAnalysis = {
  index: number;
  summary: string;
  sentiment: "positive" | "negative" | "neutral";
  impact_level: "high" | "medium" | "low";
  related_symbols: string[];
  tags: string[];
};

export type Recommendation = {
  action: "buy" | "add" | "trim" | "sell" | "rebalance" | "hold";
  symbol: string;
  counterpart_symbol: string | null;
  title: string;
  reasoning: string;
  confidence: "high" | "medium" | "low";
  time_horizon: "short" | "medium" | "long";
  suggested_amount_ars: number | null;
  realizes_loss: boolean;
};

export type Opportunity = {
  symbol: string;
  opportunity_type:
    | "pullback"
    | "momentum"
    | "undervalued"
    | "sector_rotation"
    | "earnings_play";
  title: string;
  reasoning: string;
  growth_estimate_pct: number;
  confidence: "high" | "medium" | "low";
  time_horizon: "short" | "medium" | "long";
};

/**
 * Perfil del inversor: lo que el modelo necesita saber para personalizar
 * recomendaciones. Se construye a partir de los settings del usuario + su
 * historial de decisiones.
 */
export type InvestorProfile = {
  /** 'aggressive' | 'moderate' — viene del toggle de la UI */
  riskProfile: "aggressive" | "moderate";
  /** Sectores donde el usuario tiene mayor convicción. Ej: ['semiconductores', 'IA', 'energía'] */
  preferredSectors: string[];
  /** Resumen de decisiones históricas que dan contexto. Generado una vez y actualizado. */
  investmentHistory: string;
  /** Objetivo declarado del usuario. Ej: 'maximizar crecimiento y reinvertir ganancias' */
  objective: string;
};

export type AdvisorContext = {
  positions: Array<{
    symbol: string;
    sector: string;
    assetType: string;
    value: number;
    gainPct: number;
    dayPct: number;
    weight: number;
    trend30d: string;
  }>;
  totalValue: number;
  availableCash: number;
  news: Array<{
    title: string;
    summary: string;
    sentiment: string;
    symbols: string[];
  }>;
  universe: Array<{
    symbol: string;
    name: string;
    sector: string;
    price: number | null;
  }>;
  settings: {
    rebalance_pct: number;
    sector_concentration_pct: number;
    take_profit_pct: number;
    stop_loss_pct: number;
    trailing_stop_pct: number;
    trailing_min_gain_pct: number;
    fixed_ceiling_pct: number;
    daily_extreme_pct: number;
    rebuy_alert_pct: number;
  };
  sectorWeights: Array<{ sector: string; pct: number }>;
  typeWeights?: Array<{ type: string; pct: number; value: number }>;
  liquidityFloor?: number;
  liquidNow?: number;
  /** Perfil del inversor — sin esto el asesor no sabe a quién le habla */
  profile?: InvestorProfile;
  /**
   * Días desde la PRIMERA compra de cada posición.
   *
   * Alimenta la regla de los 14 días: una tesis necesita tiempo antes de
   * liquidarla. Un símbolo sin operación registrada queda afuera del mapa, y
   * entonces la regla no aplica — es el lado seguro del error, porque nunca
   * marca como "nueva" una posición vieja que el backfill no alcanzó.
   */
  positionAges?: Record<string, number>;
  /**
   * Cuánto se espera que se mueva cada activo.
   *
   * Reemplaza a la implied volatility de opciones, que en BCBA no existe para
   * CEDEARs (solo cotizan opciones las acciones locales). `vol30d` es la
   * volatilidad REALIZADA de los últimos 30 días, anualizada, en %.
   */
  expectedMove?: Record<string, { vol30d: number; earningsInDays?: number }>;
  /**
   * Dólar implícito contra el MEP de mercado.
   *
   * Cubre lo que tenés Y el universo sugerible: la prima decide sobre todo una
   * COMPRA, y lo que se compra sale del universo. Los FCI quedan afuera porque
   * no tienen par en dólares.
   */
  dollarPremium?: Record<
    string,
    { implicit: number; mep: number; premiumPct: number }
  >;
};

export type PortfolioContext = {
  positions: Array<{
    symbol: string;
    value: number;
    gainPct: number;
    weight: number;
    sector: string;
  }>;
  totalValue: number;
  availableCash: number;
  news: Array<{
    title: string;
    summary: string;
    sentiment: string;
    symbols: string[];
  }>;
  universe: Array<{
    symbol: string;
    name: string;
    sector: string;
    price: number | null;
  }>;
  /** Perfil del inversor */
  profile?: InvestorProfile;
};

export type GoalContext = {
  name: string;
  targetAmount: number | null;
  targetDate: string | null;
  daysLeft: number | null;
  currentValue: number;
  cashInGoal: number;
  requiredAnnualPct: number | null;
  band: string | null;
  achievableAmount: number | null;
  earmarked: Array<{ symbol: string; quantity: number; value: number }>;
};

// ============================================================
// Client cache
// ============================================================

/**
 * Un cliente por key, no uno de módulo.
 *
 * Cada usuario pone la suya, así que la key llega por parámetro en vez de salir
 * de una env var. El cache evita rearmar el cliente en cada llamada de un mismo
 * lote sin atarlo a una key global.
 */
const clients = new Map<string, Anthropic>();

function clientFor(apiKey: string): Anthropic {
  const existing = clients.get(apiKey);
  if (existing) return existing;
  const created = new Anthropic({ apiKey });
  clients.set(apiKey, created);
  return created;
}

/** Se tira si alguien llama a una función de IA sin key. */
export class MissingApiKeyError extends Error {
  constructor() {
    super("El usuario no tiene una API key de Anthropic configurada");
  }
}

const fmtArs = (n: number) =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(n);

// ============================================================
// Análisis de noticias (Sonnet — alto volumen, tarea simple)
// ============================================================

function buildNewsSchema(topicSlugs: string[]) {
  return {
    type: "object",
    properties: {
      analyses: {
        type: "array",
        items: {
          type: "object",
          properties: {
            index: {
              type: "integer",
              description: "El índice de la noticia analizada",
            },
            summary: {
              type: "string",
              description: "Resumen en español, 2-3 oraciones",
            },
            sentiment: {
              type: "string",
              enum: ["positive", "negative", "neutral"],
            },
            impact_level: { type: "string", enum: ["high", "medium", "low"] },
            related_symbols: {
              type: "array",
              items: { type: "string" },
              description: "Tickers afectados. Vacío si ninguno en particular.",
            },
            tags: {
              type: "array",
              items: { type: "string", enum: topicSlugs },
            },
          },
          required: [
            "index",
            "summary",
            "sentiment",
            "impact_level",
            "related_symbols",
            "tags",
          ],
          additionalProperties: false,
        },
      },
    },
    required: ["analyses"],
    additionalProperties: false,
  };
}

function buildNewsSystemPrompt(
  topics: Array<{ slug: string; label: string }>,
  holdings: string[],
  profile?: InvestorProfile,
) {
  const lines = [
    "Sos analista financiero especializado en cómo los mercados globales impactan a los CEDEARs argentinos.",
    `Analizás noticias para un inversor con perfil ${profile?.riskProfile === "aggressive" ? "AGRESIVO orientado a growth" : "MODERADO"}.`,
    "Cartera actual: " + (holdings.join(", ") || "(sin posiciones)") + ".",
  ];

  if (profile?.preferredSectors.length) {
    lines.push(
      `Sectores de mayor interés para este inversor: ${profile.preferredSectors.join(", ")}.`,
    );
    lines.push(
      "Priorizá el análisis de impacto en estos sectores. Si una noticia afecta semiconductores",
      "o IA y el usuario tiene posiciones ahí, el impact_level debe reflejarlo.",
    );
  }

  lines.push(
    "",
    "Temáticas disponibles para clasificar (usá el slug):",
    ...topics.map((t) => `- ${t.slug}: ${t.label}`),
    "",
    "El resumen va en español, claro y directo, sin jerga innecesaria.",
    "El sentimiento es respecto del impacto en los mercados, no del tono del artículo.",
    'Marcá impact_level "high" solo cuando la noticia puede mover precios de forma significativa.',
    "En related_symbols poné únicamente tickers que la noticia afecte de forma directa y concreta;",
    "si no hay ninguno claro, dejá el array vacío en lugar de completar con activos relacionados de forma vaga.",
  );

  return lines.join("\n");
}

export async function analyzeNews(
  apiKey: string,
  articles: NewsInput[],
  topics: Array<{ slug: string; label: string }>,
  holdings: string[],
  profile?: InvestorProfile,
): Promise<NewsAnalysis[]> {
  if (!apiKey) throw new MissingApiKeyError();
  if (!articles.length) return [];

  const userContent = articles
    .map((a) => `[${a.index}] (${a.source}) ${a.title}\n${a.snippet}`.trim())
    .join("\n\n");

  const response = await clientFor(apiKey).messages.create({
    model: NEWS_MODEL,
    max_tokens: 4096,
    thinking: { type: "disabled" },
    output_config: {
      effort: "low",
      format: {
        type: "json_schema",
        schema: buildNewsSchema(topics.map((t) => t.slug)),
      },
    },
    system: buildNewsSystemPrompt(topics, holdings, profile),
    messages: [
      { role: "user", content: `Analizá estas noticias:\n\n${userContent}` },
    ],
  });

  if (response.stop_reason === "refusal") {
    console.warn(
      "[claude] request rechazado por los clasificadores de seguridad",
    );
    return [];
  }
  if (response.stop_reason === "max_tokens") {
    console.warn(
      "[claude] respuesta truncada: lote demasiado grande para max_tokens",
    );
    return [];
  }

  const text = response.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") return [];

  const parsed = JSON.parse(text.text) as { analyses: NewsAnalysis[] };

  console.log(
    `[claude] ${articles.length} noticias · in ${response.usage.input_tokens} / out ${response.usage.output_tokens} tokens`,
  );

  return parsed.analyses ?? [];
}

// ============================================================
// Oportunidades de inversión (Opus — decisiones sobre plata)
// ============================================================

function opportunitySchema(universeSymbols: string[]) {
  return {
    type: "object",
    properties: {
      opportunities: {
        type: "array",
        items: {
          type: "object",
          properties: {
            symbol: { type: "string", enum: universeSymbols },
            opportunity_type: {
              type: "string",
              enum: [
                "pullback",
                "momentum",
                "undervalued",
                "sector_rotation",
                "earnings_play",
              ],
            },
            title: { type: "string", description: "Título corto y accionable" },
            reasoning: {
              type: "string",
              description:
                "En español, 3-4 oraciones: por qué ES una oportunidad AHORA y qué la invalidaría",
            },
            growth_estimate_pct: { type: "number" },
            confidence: { type: "string", enum: ["high", "medium", "low"] },
            time_horizon: { type: "string", enum: ["short", "medium", "long"] },
          },
          required: [
            "symbol",
            "opportunity_type",
            "title",
            "reasoning",
            "growth_estimate_pct",
            "confidence",
            "time_horizon",
          ],
          additionalProperties: false,
        },
      },
    },
    required: ["opportunities"],
    additionalProperties: false,
  };
}

function buildOpportunitySystemPrompt(profile?: InvestorProfile) {
  const isAggressive = profile?.riskProfile === "aggressive";

  return [
    `Sos analista financiero con perfil ${isAggressive ? "AGRESIVO orientado a crecimiento" : "MODERADO balanceado"},`,
    "especializado en CEDEARs argentinos. Detectás oportunidades concretas de inversión.",
    "",
    // Va arriba de todo, no al final: enterrada abajo se cumplía a medias y
    // el cupo de 3 se llenaba igual.
    [
      "ANTES QUE NADA:",
      "Si no hay ninguna oportunidad que justifique mover plata hoy, devolvé un array",
      "vacío. No completes el cupo de 3 por completarlo. Es MEJOR devolver 0 oportunidades",
      "que devolver 3 mediocres. El usuario ve estas sugerencias y puede actuar — una",
      "sugerencia mediocre que se ejecuta es peor que ninguna sugerencia.",
    ].join("\n"),
    "",
    profile?.objective ? `OBJETIVO DEL INVERSOR: ${profile.objective}` : "",
    "",
    profile?.preferredSectors?.length
      ? `SECTORES PREFERIDOS: ${profile.preferredSectors.join(", ")}. ` +
        "Priorizá oportunidades en estos sectores, pero no fuerces: si no hay nada " +
        "bueno en semis, no inventes una oportunidad ahí."
      : "",
    "",
    profile?.investmentHistory
      ? `HISTORIAL DE DECISIONES (para contexto, no para repetir):\n${profile.investmentHistory}`
      : "",
    "",
    "Priorizá, en este orden:",
    isAggressive
      ? [
          "- Pullbacks en empresas de alto crecimiento (caída temporal, fundamentos intactos)",
          "- Momentum confirmado por resultados — no por precio solo",
          "- Sector rotation cuando hay un catalizador macro claro",
          "- Earnings plays solo si hay asimetría clara (expectativas bajas + negocio sólido)",
        ].join("\n")
      : [
          "- Activos con valuación razonable y fundamentos sólidos",
          "- Pullbacks en blue chips con historial de recuperación",
          "- Diversificación sectorial cuando un sector está subponderado",
        ].join("\n"),
    "",
    "Devolvé como máximo 3 oportunidades, y solo donde tengas convicción real.",
    "",
    "Tené en cuenta la concentración actual de la cartera: sugerir más de un sector",
    "que ya pesa demasiado empeora el riesgo en vez de mejorarlo.",
    "growth_estimate_pct es tu estimación de retorno para el horizonte que indiques.",
    "",
    "En el reasoning incluí SIEMPRE qué te haría cambiar de opinión (condición de salida).",
    "Una oportunidad sin condición de invalidación no es una oportunidad, es una apuesta.",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function analyzeOpportunities(
  apiKey: string,
  ctx: PortfolioContext,
): Promise<{
  opportunities: Opportunity[];
  usage: { input: number; output: number };
}> {
  if (!apiKey) throw new MissingApiKeyError();

  const positionLines = ctx.positions
    .map(
      (p) =>
        `${p.symbol} (${p.sector}): ${fmtArs(p.value)}, ${p.weight.toFixed(1)}% de la cartera, P/L ${p.gainPct.toFixed(1)}%`,
    )
    .join("\n");

  const newsLines = ctx.news
    .map(
      (n) =>
        `- [${n.sentiment}] ${n.title}${n.symbols.length ? ` (${n.symbols.join(", ")})` : ""}\n  ${n.summary}`,
    )
    .join("\n");

  // Incluir precios del universo — sin precio el modelo no puede evaluar "barato" vs "caro"
  const universeLines = ctx.universe
    .map(
      (u) =>
        `${u.symbol} — ${u.name} (${u.sector})${u.price ? ` · ${fmtArs(u.price)}` : ""}`,
    )
    .join("\n");

  const user = [
    `CARTERA (total ${fmtArs(ctx.totalValue)}, efectivo disponible ${fmtArs(ctx.availableCash)}):`,
    positionLines || "(sin posiciones)",
    "",
    "NOTICIAS RECIENTES:",
    newsLines || "(sin noticias relevantes)",
    "",
    "ACTIVOS QUE PODÉS SUGERIR (con precio actual):",
    universeLines,
  ].join("\n");

  const response = await clientFor(apiKey).messages.create({
    model: OPPORTUNITY_MODEL,
    max_tokens: 8000,
    // Acá SÍ queremos razonamiento: son decisiones sobre plata real.
    output_config: {
      effort: "high",
      format: {
        type: "json_schema",
        schema: opportunitySchema(ctx.universe.map((u) => u.symbol)),
      },
    },
    system: buildOpportunitySystemPrompt(ctx.profile),
    messages: [{ role: "user", content: user }],
  });

  const usage = {
    input: response.usage.input_tokens,
    output: response.usage.output_tokens,
  };

  if (
    response.stop_reason === "refusal" ||
    response.stop_reason === "max_tokens"
  ) {
    console.warn(`[claude] oportunidades: stop_reason=${response.stop_reason}`);
    return { opportunities: [], usage };
  }

  const text = response.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") return { opportunities: [], usage };

  const parsed = JSON.parse(text.text) as { opportunities: Opportunity[] };
  console.log(
    `[claude] oportunidades · in ${usage.input} / out ${usage.output} tokens`,
  );

  return { opportunities: (parsed.opportunities ?? []).slice(0, 3), usage };
}

// ============================================================
// Asesor: acciones concretas sobre la cartera (Opus)
// ============================================================

function advisorSchema(symbols: string[], held: string[] = []) {
  return {
    type: "object",
    properties: {
      recommendations: {
        type: "array",
        items: {
          type: "object",
          properties: {
            action: {
              type: "string",
              enum: ["buy", "add", "trim", "sell", "rebalance", "hold"],
            },
            symbol: { type: "string", enum: symbols },
            counterpart_symbol: {
              anyOf: [
                ...(held.length ? [{ type: "string", enum: held }] : []),
                { type: "null" },
              ],
              description:
                "Solo en rebalance: de qué activo EN CARTERA sale la plata. Nunca uno que no se tenga.",
            },
            title: {
              type: "string",
              description:
                "Una línea, accionable, con monto y ambas patas si es rebalanceo",
            },
            reasoning: {
              type: "string",
              description:
                "En español, 3-5 oraciones: por qué ahora, qué lo dispararía en contra, y condición de salida",
            },
            confidence: { type: "string", enum: ["high", "medium", "low"] },
            time_horizon: { type: "string", enum: ["short", "medium", "long"] },
            suggested_amount_ars: {
              anyOf: [{ type: "number" }, { type: "null" }],
              description:
                "Monto en pesos. Nunca mayor al efectivo disponible en una compra.",
            },
            realizes_loss: {
              type: "boolean",
              description: "true si la venta sugerida cristaliza una pérdida",
            },
          },
          required: [
            "action",
            "symbol",
            "counterpart_symbol",
            "title",
            "reasoning",
            "confidence",
            "time_horizon",
            "suggested_amount_ars",
            "realizes_loss",
          ],
          additionalProperties: false,
        },
      },
    },
    required: ["recommendations"],
    additionalProperties: false,
  };
}

function buildAdvisorSystemPrompt(ctx: AdvisorContext) {
  const profile = ctx.profile;
  const isAggressive = profile?.riskProfile === "aggressive";
  const settings = ctx.settings;

  // La volatilidad "alta" es relativa a la cartera, no un número fijo: 40%
  // anualizado es muchísimo para KO y poco para TSLA. Se le pasa la mediana
  // para que el modelo calibre contra lo que el usuario realmente tiene.
  const vols = Object.values(ctx.expectedMove ?? {})
    .map((e) => e.vol30d)
    .sort((a, b) => a - b);
  const hasExpectedMove = vols.length > 0;
  const medianVol = hasExpectedMove ? vols[Math.floor(vols.length / 2)] : 0;
  const hasDollarPremium =
    Object.keys(ctx.dollarPremium ?? {}).length > 0;

  return [
    // ── Identidad del asesor, adaptada al perfil del usuario ──
    `Sos asesor financiero con perfil ${isAggressive ? "AGRESIVO orientado a maximizar crecimiento" : "MODERADO equilibrado"},`,
    "especializado en CEDEARs argentinos.",
    "Tu trabajo es recomendar ACCIONES concretas sobre esta cartera, no describirla.",
    "",

    // ── Regla #0: el silencio es una respuesta válida ──
    // Va primera y sola porque es la que más se incumplía: el asesor llenaba
    // las 3 recomendaciones siempre, y el usuario leía eso como "hay 3 cosas
    // que hacer hoy". El resultado era over-trading.
    [
      "REGLA #0 — LA MÁS IMPORTANTE DE TODAS:",
      "No recomendar es una recomendación válida y PREFERIBLE cuando no hay motivo real.",
      "Si ningún umbral se activó, ninguna noticia cambia una tesis, y no hay un pullback",
      "claro en un activo sólido, la respuesta correcta es UNA SOLA recomendación con",
      'action "hold" que explique por qué no hay nada que hacer hoy.',
      "",
      "NO llenes las 3 recomendaciones por llenarlas. El usuario confía en vos para tomar",
      "decisiones con plata real. Cada recomendación de más es ruido que erosiona esa",
      "confianza. Si tenés 1 buena y 2 mediocres, mandá solo la buena.",
      "",
      'Preguntate antes de cada recomendación: "¿apostaría MI plata a esto hoy?"',
      'Si la respuesta es "probablemente no" o "depende", no la incluyas.',
    ].join("\n"),
    "",

    // ── Perfil del inversor ──
    profile?.objective ? `OBJETIVO DEL INVERSOR: ${profile.objective}` : "",
    profile?.preferredSectors?.length
      ? `SECTORES PREFERIDOS: ${profile.preferredSectors.join(", ")}`
      : "",
    profile?.investmentHistory
      ? `\nHISTORIAL DE DECISIONES (para contexto — NO repetir las mismas operaciones):\n${profile.investmentHistory}`
      : "",
    "",

    // ── Reglas generales ──
    "REGLAS:",
    "- Máximo 3 recomendaciones. Si hoy no hay nada que amerite mover plata, devolvé",
    '  una sola con action "hold" y explicá por qué conviene no hacer nada.',
    "- No sugieras operar por operar. Cada movimiento tiene costo y riesgo de timing.",
    "- En una compra, suggested_amount_ars NUNCA puede superar el efectivo disponible.",
    "- Podés sugerir vender en pérdida si la TESIS se rompió (el negocio está peor,",
    "  no solo el precio). En ese caso marcá realizes_loss y decilo explícitamente.",
    "  Si solo cayó el precio pero la empresa sigue bien, no es motivo de venta.",
    "- Mirá la concentración: sugerir más de un sector que ya pesa de más empeora el riesgo.",
    "",

    // ── Umbrales del usuario (leídos dinámicamente) ──
    "UMBRALES CONFIGURADOS POR EL USUARIO (respetarlos en las recomendaciones):",
    `- Trailing stop: -${Math.abs(settings.trailing_stop_pct)}% desde el máximo`,
    `- Ganancia mínima para trailing: +${settings.trailing_min_gain_pct}% (debajo de esto no aplica trailing, aplica stop loss)`,
    `- Techo fijo de ganancia: +${settings.fixed_ceiling_pct}%${settings.fixed_ceiling_pct === 0 ? " (desactivado, solo trailing)" : ""}`,
    `- Stop loss: -${Math.abs(settings.stop_loss_pct)}%`,
    `- Variación extrema del día: ±${settings.daily_extreme_pct}%`,
    `- Aviso de recompra: ${settings.rebuy_alert_pct}% (si algo vendido baja este %, avisar)`,
    `- Máximo por activo: ${settings.rebalance_pct}% de la cartera`,
    `- Máximo por sector: ${settings.sector_concentration_pct}%`,
    "",
    "Usá estos umbrales para evaluar cada posición:",
    `- Si una posición ganó más de +${settings.trailing_min_gain_pct}% y cedió ${Math.abs(settings.trailing_stop_pct)}% desde su máximo → sugerí trim/sell.`,
    settings.fixed_ceiling_pct > 0
      ? `- Si una posición ganó +${settings.fixed_ceiling_pct}% → sugerí toma de ganancia parcial independientemente del trailing.`
      : "- Techo fijo desactivado: solo aplica trailing stop.",
    `- Si una posición perdió más de ${settings.stop_loss_pct}% desde la compra → evaluá si la tesis se rompió.`,
    "",

    // ── Consolidación de ganancias ──
    "CONSOLIDACIÓN DE GANANCIAS:",
    isAggressive
      ? [
          "El usuario quiere que cuando algo sube mucho, se tome ganancia parcial y se",
          "REINVIERTA en otro activo con potencial. No dejar plata quieta.",
          `Si un activo superó +${settings.trailing_min_gain_pct}% y el trailing activó, sugerí:`,
          "1. Cuánto vender (20-30% de la posición, no todo)",
          "2. En qué reinvertir el producido (otro CEDEAR con tesis concreta)",
          'El título debe decir ambas patas: "Vendé $X de SYMBOL → comprá DESTINO".',
        ].join("\n")
      : [
          "Cuando un activo supera la ganancia mínima para trailing y el trailing activa,",
          "sugerí toma de ganancia parcial. El producido puede ir a renta fija o a otro",
          "CEDEAR menos volátil, según el contexto.",
        ].join("\n"),
    "",

    // ── Posiciones simbólicas ──
    isAggressive
      ? [
          "POSICIONES SIMBÓLICAS:",
          "Si un activo pesa menos del 3% de la cartera, no tiene impacto real.",
          "Evaluá si conviene: (a) reforzarlo hasta 5%+ para que pese, o (b) liquidarlo",
          "y concentrar esa plata en un winner. No dejes posiciones que solo suman ruido.",
        ].join("\n")
      : "",
    "",

    // ── Timing: qué NO se puede vender, y por qué ──
    // Van ANTES de las rotaciones a propósito: el rebalanceo es la regla que
    // más veces empujó a vender en rojo, así que primero tiene que quedar
    // claro qué está vedado y recién después cómo se arma la rotación.
    [
      "REGLAS DE TIMING (INNEGOCIABLES — aplican antes que cualquier rebalanceo):",
      "",
      "1. NUNCA sugieras vender un activo que cayó más de -3% esta semana para",
      "   rebalancear. El rebalanceo se hace VENDIENDO GANADORES, no perdedores.",
      "   Si tech pesa 59% porque todo lo demás cayó más, la solución es comprar",
      "   otros sectores con cash, NO vender tech en baja. Vender en rojo para",
      "   cumplir un % es destruir valor para satisfacer una métrica.",
      "",
      "2. NUNCA sugieras liquidar una posición que se compró hace menos de 14 días.",
      "   Una tesis necesita tiempo para desarrollarse. Si pesa poco, la acción",
      "   correcta es REFORZAR, no liquidar. Indicá que es nueva y que conviene",
      "   esperar.",
      "",
      "3. Antes de cualquier rebalanceo, evaluá POR QUÉ se excede el límite:",
      "   - ¿El sector subió mucho? → Trimear el que más ganó (toma parcial)",
      "   - ¿Todo lo demás bajó? → Comprar otros sectores con cash disponible",
      "   - ¿Se agregaron posiciones nuevas? → Esperar, la cartera se está armando",
      "   Explicá cuál de las tres situaciones aplica en el reasoning.",
      "",
      "4. Los umbrales (trailing, stop loss, techo) son ALERTAS, no órdenes automáticas.",
      "   Que tech pese 59% con límite de 55% no significa \"vendé tech ya\".",
      '   Significa "no COMPRES más tech hasta que baje del 55%". Solo se vende',
      "   activamente si el exceso es >10 puntos por encima del límite O si hay",
      "   un ganador con rendimiento superior al techo fijo de ganancia para trimear.",
    ].join("\n"),
    "",

    // ── Rotaciones y rebalanceos ──
    "ROTACIONES Y REBALANCEOS — SIEMPRE CON LAS DOS PATAS:",
    'Un "rebalance" sin decir de dónde sale la plata es inaccionable. En cada uno:',
    "- `counterpart_symbol` OBLIGATORIO, y tiene que ser un activo que el usuario TENGA HOY,",
    "  de la lista CARTERA. No se puede vender lo que no se tiene.",
    "- El monto no puede superar lo que vale esa posición.",
    "- `suggested_amount_ars` OBLIGATORIO: cuánto se mueve, en pesos.",
    "- El `title` tiene que decir las dos patas en imperativo y con el monto:",
    '  "Vendé $220.000 de PRMCAPB y comprá NVDA". No "rebalancear la cartera".',
    "- El `reasoning` explica por qué SALE de ese activo y por qué ENTRA al otro.",
    "",

    // ── Rotación renta fija → growth ──
    isAggressive
      ? [
          "ROTACIÓN DE RENTA FIJA A CRECIMIENTO:",
          "El objetivo declarado del usuario es maximizar crecimiento y reinvertir.",
          "Mirá la composición por tipo: si hay una porción significativa en fondos comunes",
          "o bonos rindiendo tasa, evaluá rotar parte a CEDEARs growth. No lo propongas",
          "por reflejo — solo si el activo de destino tiene una tesis concreta hoy.",
          "",
          "PERO la liquidez no puede quedar por debajo del piso configurado.",
          "El piso es una RESERVA A MANTENER, no el saldo de hoy.",
          "Lo que exceda el piso SÍ se puede rotar a crecimiento.",
        ].join("\n")
      : [
          "RENTA FIJA:",
          "Mantené el balance entre renta fija y variable según los límites del usuario.",
          "No rotar renta fija a variable salvo que haya una oportunidad excepcional.",
        ].join("\n"),
    "",

    // ── Cómo leer los datos que se agregaron a cada posición ──
    // Condicionales: si el CRON todavía no pobló el dato, explicar cómo
    // interpretarlo solo invita a que el modelo lo invente.
    hasExpectedMove
      ? [
          "MOVIMIENTO ESPERADO (en la línea de cada posición):",
          "Volatilidad REALIZADA de los últimos 30 días, anualizada, más los días que",
          "faltan para el próximo earnings cuando está cerca.",
          `La mediana de esta cartera es ${medianVol.toFixed(0)}%: "alta" es notablemente`,
          "por encima de ese número, no un valor fijo — 40% es mucho para un defensivo",
          "y poco para un semiconductor.",
          "NO es señal de compra ni de venta por sí sola. Es contexto para calibrar el",
          "riesgo de la recomendación:",
          "- Si sugerís comprar algo con volatilidad alta o earnings en menos de 7 días,",
          "  mencionalo: el precio puede moverse fuerte en cualquier dirección.",
          "- Si sugerís hold, una volatilidad baja confirma que no se espera movimiento.",
        ].join("\n")
      : "",
    hasDollarPremium
      ? [
          "TC IMPLÍCITO (tipo de cambio implícito del CEDEAR vs MEP de mercado):",
          '- Prima > +3%: el CEDEAR está "caro" en pesos respecto al dólar. No es buen',
          "  momento para comprar en ARS — mejor esperar a que la prima baje.",
          '- Prima < -3%: el CEDEAR está "barato" en pesos. Puede ser oportunidad.',
          "- Entre -3% y +3%: neutral, no es factor.",
          "Usá esto como filtro: si vas a sugerir una compra y la prima es > +5%, mencioná",
          "que el precio en pesos está inflado y que conviene esperar.",
        ].join("\n")
      : "",
    "",

    // ── Condición de salida obligatoria ──
    "REGLA FINAL:",
    "En el reasoning incluí SIEMPRE qué te haría cambiar de opinión.",
    "Una recomendación sin condición de salida no es una recomendación, es una apuesta.",
    'Ejemplo: "Comprar NVDA porque X. Invalidaría esta tesis si Y o si Z."',
  ]
    .filter(Boolean)
    .join("\n");
}

export async function advise(
  apiKey: string,
  ctx: AdvisorContext,
): Promise<{
  recommendations: Recommendation[];
  usage: { input: number; output: number };
}> {
  if (!apiKey) throw new MissingApiKeyError();

  const positionLines = ctx.positions
    .map((p) => {
      // Cada sufijo se omite cuando falta el dato: una línea que dice
      // "posición desde hace undefined días" es peor que no decir nada.
      const age = ctx.positionAges?.[p.symbol];
      const ageStr =
        age !== undefined ? ` · posición desde hace ${age} días` : "";

      const em = ctx.expectedMove?.[p.symbol];
      const emStr = em
        ? ` · vol 30d ${em.vol30d.toFixed(0)}%` +
          (em.earningsInDays !== undefined && em.earningsInDays <= 7
            ? ` · earnings en ${em.earningsInDays} días`
            : "")
        : "";

      const dp = ctx.dollarPremium?.[p.symbol];
      const dpStr = dp
        ? ` · TC implícito $${dp.implicit.toFixed(0)} (${dp.premiumPct > 0 ? "+" : ""}${dp.premiumPct.toFixed(1)}% vs MEP)`
        : "";

      return (
        `${p.symbol} (${p.sector}, ${p.assetType}): ${fmtArs(p.value)} · ${p.weight.toFixed(1)}% de la cartera · P/L ${p.gainPct.toFixed(1)}% · hoy ${p.dayPct.toFixed(1)}% · 30d ${p.trend30d}` +
        ageStr +
        emStr +
        dpStr
      );
    })
    .join("\n");

  const user = [
    `CARTERA — total ${fmtArs(ctx.totalValue)}, efectivo disponible ${fmtArs(ctx.availableCash)}`,
    "Estos son los ÚNICOS activos de los que podés sacar plata en una rotación:",
    positionLines || "(sin posiciones)",
    "",
    `CONCENTRACIÓN POR SECTOR: ${ctx.sectorWeights.map((s) => `${s.sector} ${s.pct.toFixed(0)}%`).join(" · ")}`,
    ctx.typeWeights?.length
      ? `COMPOSICIÓN POR TIPO: ${ctx.typeWeights.map((t) => `${t.type} ${t.pct.toFixed(0)}% (${fmtArs(t.value)})`).join(" · ")}`
      : "",
    ctx.liquidityFloor != null
      ? `LIQUIDEZ — tenés ${fmtArs(ctx.liquidNow ?? 0)} entre efectivo y money market. ` +
        `El piso a mantener es ${fmtArs(ctx.liquidityFloor)}, así que hay ` +
        `${fmtArs(Math.max(0, (ctx.liquidNow ?? 0) - ctx.liquidityFloor))} disponibles para rotar ` +
        `a crecimiento sin bajar del piso.`
      : "",
    "",
    "NOTICIAS RECIENTES:",
    ctx.news
      .map(
        (n) =>
          `- [${n.sentiment}] ${n.title}${n.symbols.length ? ` (${n.symbols.join(", ")})` : ""}\n  ${n.summary}`,
      )
      .join("\n") || "(sin noticias relevantes)",
    "",
    "ACTIVOS QUE PODÉS SUGERIR (con precio actual):",
    ctx.universe
      .map((u) => {
        // La prima acá pesa más que sobre la cartera: sobre lo que ya tenés es
        // información, sobre lo que podrías comprar es una decisión concreta de
        // ejecución — comprar en pesos o dolarizarse primero.
        const dp = ctx.dollarPremium?.[u.symbol];
        const dpStr = dp
          ? ` · TC implícito ${dp.premiumPct > 0 ? "+" : ""}${dp.premiumPct.toFixed(1)}% vs MEP`
          : "";
        return `${u.symbol} — ${u.name} (${u.sector})${u.price ? ` · ${fmtArs(u.price)}` : ""}${dpStr}`;
      })
      .join("\n"),
  ]
    .filter(Boolean)
    .join("\n");

  const response = await clientFor(apiKey).messages.create({
    model: OPPORTUNITY_MODEL,
    max_tokens: 8000,
    output_config: {
      effort: "high",
      format: {
        type: "json_schema",
        schema: advisorSchema(
          ctx.universe.map((u) => u.symbol),
          ctx.positions.map((p) => p.symbol),
        ),
      },
    },
    system: buildAdvisorSystemPrompt(ctx),
    messages: [{ role: "user", content: user }],
  });

  const usage = {
    input: response.usage.input_tokens,
    output: response.usage.output_tokens,
  };

  if (
    response.stop_reason === "refusal" ||
    response.stop_reason === "max_tokens"
  ) {
    console.warn(`[claude] asesor: stop_reason=${response.stop_reason}`);
    return { recommendations: [], usage };
  }

  const text = response.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") return { recommendations: [], usage };

  const parsed = JSON.parse(text.text) as { recommendations: Recommendation[] };
  console.log(
    `[claude] asesor · in ${usage.input} / out ${usage.output} tokens`,
  );

  // Red de seguridad: una rotación desde un activo que no está en cartera es inejecutable
  const held = new Set(ctx.positions.map((p) => p.symbol));
  const usable = (parsed.recommendations ?? []).filter((r) => {
    if (r.action !== "rebalance") return true;
    if (r.counterpart_symbol && held.has(r.counterpart_symbol)) return true;
    console.warn(
      `[claude] descartada: rebalance ${r.symbol} desde "${r.counterpart_symbol}", que no está en cartera`,
    );
    return false;
  });

  return { recommendations: usable.slice(0, 3), usage };
}

// ============================================================
// Asesor de una meta puntual (Opus)
// ============================================================

export async function adviseForGoal(
  apiKey: string,
  ctx: AdvisorContext,
  goal: GoalContext,
): Promise<{
  recommendations: Recommendation[];
  usage: { input: number; output: number };
}> {
  if (!apiKey) throw new MissingApiKeyError();

  const profile = ctx.profile;
  const horizons =
    goal.daysLeft === null
      ? ["short", "medium", "long"]
      : goal.daysLeft <= 60
        ? ["short"]
        : goal.daysLeft <= 210
          ? ["short", "medium"]
          : ["short", "medium", "long"];

  const unreachable =
    goal.band === "improbable" || goal.band === "inalcanzable";

  const system = [
    `Sos asesor financiero con perfil ${profile?.riskProfile === "aggressive" ? "AGRESIVO" : "MODERADO"},`,
    "especializado en CEDEARs argentinos.",
    "Estás armando el plan de una META puntual del usuario, no de toda la cartera.",
    "",
    profile?.objective
      ? `OBJETIVO GENERAL DEL INVERSOR: ${profile.objective}`
      : "",
    "",
    "Reglas:",
    "- Máximo 3 recomendaciones, solo con fundamento real.",
    `- El horizonte de la meta es acotado: usá únicamente ${horizons.join(" o ")}.`,
    "- En una compra, suggested_amount_ars NUNCA puede superar el efectivo disponible.",
    "- Respetá los límites de concentración del usuario.",
    "",
    "REGLA INNEGOCIABLE SOBRE EL RIESGO:",
    "Una meta exigente NO justifica recomendaciones más agresivas. Si el objetivo no",
    "entra con una cartera razonable, decilo en el reasoning y recomendá lo que sí es",
    "sensato para el plazo. NUNCA propongas concentrar en un solo activo, ni apostar a",
    'un movimiento puntual, para "llegar" al número. Perseguir un objetivo inalcanzable',
    "tomando más riesgo es la forma más rápida de descapitalizarse.",
    "",
    unreachable
      ? "ESTA META ESTÁ FUERA DE ALCANCE con el capital y el plazo actuales. Tu trabajo NO es " +
        "encontrar la manera de lograrla: es proponer el mejor uso del dinero para ese plazo y " +
        "decir con todas las letras que el objetivo necesita más capital, más tiempo o un monto menor."
      : "Esta meta es alcanzable con una cartera razonable para el plazo.",
    "",
    "En el reasoning incluí SIEMPRE qué te haría cambiar de opinión.",
  ]
    .filter(Boolean)
    .join("\n");

  const goalLines = [
    `META: "${goal.name}"`,
    goal.targetAmount
      ? `Objetivo: ${fmtArs(goal.targetAmount)}`
      : "Sin objetivo de monto",
    goal.targetDate
      ? `Fecha: ${goal.targetDate}${goal.daysLeft !== null ? ` (faltan ${goal.daysLeft} días)` : ""}`
      : "Sin fecha",
    `Valor actual de la meta: ${fmtArs(goal.currentValue)} (${fmtArs(goal.cashInGoal)} en efectivo sin invertir)`,
    goal.requiredAnnualPct !== null
      ? `Rendimiento anual que exige el objetivo: ${goal.requiredAnnualPct.toFixed(0)}% — dificultad ${goal.band}`
      : "Sin objetivo y fecha no hay rendimiento exigido",
    goal.achievableAmount !== null
      ? `A ritmo de mercado razonable, en la fecha llegaría a ${fmtArs(goal.achievableAmount)}`
      : "",
    "",
    "YA APARTADO PARA ESTA META:",
    goal.earmarked
      .map((h) => `${h.symbol}: ${h.quantity} unidades · ${fmtArs(h.value)}`)
      .join("\n") || "(nada todavía)",
  ]
    .filter(Boolean)
    .join("\n");

  const positionLines = ctx.positions
    .map(
      (p) =>
        `${p.symbol} (${p.sector}): ${fmtArs(p.value)} · ${p.weight.toFixed(1)}% · P/L ${p.gainPct.toFixed(1)}%`,
    )
    .join("\n");

  const user = [
    goalLines,
    "",
    `CARTERA COMPLETA — total ${fmtArs(ctx.totalValue)}, efectivo disponible ${fmtArs(ctx.availableCash)}`,
    positionLines || "(sin posiciones)",
    "",
    `CONCENTRACIÓN POR SECTOR: ${ctx.sectorWeights.map((s) => `${s.sector} ${s.pct.toFixed(0)}%`).join(" · ")}`,
    `LÍMITES DEL USUARIO: máx ${ctx.settings.rebalance_pct}% por activo, máx ${ctx.settings.sector_concentration_pct}% por sector`,
    "",
    "ACTIVOS QUE PODÉS SUGERIR (con precio):",
    ctx.universe
      .map(
        (u) =>
          `${u.symbol} — ${u.name} (${u.sector})${u.price ? ` · ${fmtArs(u.price)}` : ""}`,
      )
      .join("\n"),
  ].join("\n");

  const schema = advisorSchema(
    ctx.universe.map((u) => u.symbol),
    ctx.positions.map((p) => p.symbol),
  ) as {
    properties: {
      recommendations: { items: { properties: Record<string, unknown> } };
    };
  };
  schema.properties.recommendations.items.properties.time_horizon = {
    type: "string",
    enum: horizons,
  };

  const response = await clientFor(apiKey).messages.create({
    model: OPPORTUNITY_MODEL,
    max_tokens: 8000,
    output_config: { effort: "high", format: { type: "json_schema", schema } },
    system,
    messages: [{ role: "user", content: user }],
  });

  const usage = {
    input: response.usage.input_tokens,
    output: response.usage.output_tokens,
  };

  if (
    response.stop_reason === "refusal" ||
    response.stop_reason === "max_tokens"
  ) {
    console.warn(
      `[claude] asesor de meta: stop_reason=${response.stop_reason}`,
    );
    return { recommendations: [], usage };
  }

  const text = response.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") return { recommendations: [], usage };

  const parsed = JSON.parse(text.text) as { recommendations: Recommendation[] };
  console.log(
    `[claude] meta "${goal.name}" · in ${usage.input} / out ${usage.output} tokens`,
  );

  return { recommendations: (parsed.recommendations ?? []).slice(0, 3), usage };
}
