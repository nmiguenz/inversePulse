/**
 * Análisis de noticias con Claude.
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
import Anthropic from 'npm:@anthropic-ai/sdk@0.115.0'

/** Sonnet para clasificar (alto volumen, tarea simple). */
export const NEWS_MODEL = 'claude-sonnet-5'
/** Opus para las oportunidades: son sugerencias sobre plata real, no clasificación. */
export const OPPORTUNITY_MODEL = 'claude-opus-5'

export type NewsInput = {
  index: number
  title: string
  source: string
  snippet: string
}

export type NewsAnalysis = {
  index: number
  summary: string
  sentiment: 'positive' | 'negative' | 'neutral'
  impact_level: 'high' | 'medium' | 'low'
  related_symbols: string[]
  tags: string[]
}

const client = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') })

function buildSchema(topicSlugs: string[]) {
  return {
    type: 'object',
    properties: {
      analyses: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            index: { type: 'integer', description: 'El índice de la noticia analizada' },
            summary: { type: 'string', description: 'Resumen en español, 2-3 oraciones' },
            sentiment: { type: 'string', enum: ['positive', 'negative', 'neutral'] },
            impact_level: { type: 'string', enum: ['high', 'medium', 'low'] },
            related_symbols: {
              type: 'array',
              items: { type: 'string' },
              description: 'Tickers afectados. Vacío si ninguno en particular.',
            },
            tags: {
              type: 'array',
              items: { type: 'string', enum: topicSlugs },
            },
          },
          required: ['index', 'summary', 'sentiment', 'impact_level', 'related_symbols', 'tags'],
          additionalProperties: false,
        },
      },
    },
    required: ['analyses'],
    additionalProperties: false,
  }
}

function buildSystemPrompt(topics: Array<{ slug: string; label: string }>, holdings: string[]) {
  return [
    'Sos analista financiero especializado en cómo los mercados globales impactan a los CEDEARs argentinos.',
    'Analizás noticias para un inversor con esta cartera: ' + (holdings.join(', ') || '(sin posiciones)') + '.',
    '',
    'Temáticas disponibles para clasificar (usá el slug):',
    ...topics.map((t) => `- ${t.slug}: ${t.label}`),
    '',
    'El resumen va en español, claro y directo, sin jerga innecesaria.',
    'El sentimiento es respecto del impacto en los mercados, no del tono del artículo.',
    'Marcá impact_level "high" solo cuando la noticia puede mover precios de forma significativa.',
    'En related_symbols poné únicamente tickers que la noticia afecte de forma directa y concreta;',
    'si no hay ninguno claro, dejá el array vacío en lugar de completar con activos relacionados de forma vaga.',
  ].join('\n')
}

export async function analyzeNews(
  articles: NewsInput[],
  topics: Array<{ slug: string; label: string }>,
  holdings: string[],
): Promise<NewsAnalysis[]> {
  if (!articles.length) return []

  const userContent = articles
    .map((a) => `[${a.index}] (${a.source}) ${a.title}\n${a.snippet}`.trim())
    .join('\n\n')

  const response = await client.messages.create({
    model: NEWS_MODEL,
    max_tokens: 4096,
    // Clasificación: no necesita razonamiento extendido.
    thinking: { type: 'disabled' },
    output_config: {
      effort: 'low',
      format: {
        type: 'json_schema',
        schema: buildSchema(topics.map((t) => t.slug)),
      },
    },
    system: buildSystemPrompt(topics, holdings),
    messages: [{ role: 'user', content: `Analizá estas noticias:\n\n${userContent}` }],
  })

  if (response.stop_reason === 'refusal') {
    console.warn('[claude] request rechazado por los clasificadores de seguridad')
    return []
  }
  if (response.stop_reason === 'max_tokens') {
    console.warn('[claude] respuesta truncada: lote demasiado grande para max_tokens')
    return []
  }

  const text = response.content.find((b) => b.type === 'text')
  if (!text || text.type !== 'text') return []

  // Structured outputs garantiza que esto valida contra el schema.
  const parsed = JSON.parse(text.text) as { analyses: NewsAnalysis[] }

  console.log(
    `[claude] ${articles.length} noticias · in ${response.usage.input_tokens} / out ${response.usage.output_tokens} tokens`,
  )

  return parsed.analyses ?? []
}

// ============================================================
// Oportunidades de inversión
// ============================================================

// ============================================================
// Asesor: acciones concretas sobre la cartera
// ============================================================

export type Recommendation = {
  action: 'buy' | 'add' | 'trim' | 'sell' | 'rebalance' | 'hold'
  symbol: string
  counterpart_symbol: string | null
  title: string
  reasoning: string
  confidence: 'high' | 'medium' | 'low'
  time_horizon: 'short' | 'medium' | 'long'
  suggested_amount_ars: number | null
  realizes_loss: boolean
}

export type AdvisorContext = {
  positions: Array<{
    symbol: string
    sector: string
    value: number
    gainPct: number
    dayPct: number
    weight: number
    trend30d: string
  }>
  totalValue: number
  availableCash: number
  news: Array<{ title: string; summary: string; sentiment: string; symbols: string[] }>
  universe: Array<{ symbol: string; name: string; sector: string; price: number | null }>
  settings: { rebalance_pct: number; sector_concentration_pct: number; take_profit_pct: number }
  sectorWeights: Array<{ sector: string; pct: number }>
  /**
   * Composición por tipo de instrumento. Sin esto el asesor no podía ver que
   * hay 34% de la cartera en fondos comunes mientras el objetivo declarado es
   * maximizar el crecimiento.
   */
  typeWeights?: Array<{ type: string; pct: number; value: number }>
  /**
   * Reserva líquida mínima a MANTENER, en pesos.
   *
   * No es el saldo actual congelado: es el piso por debajo del cual no puede
   * quedar la suma de efectivo y money market. La diferencia importa — cuando
   * el piso se calculaba como "todo lo líquido de hoy", nunca sobraba nada y
   * la rotación a crecimiento no podía ejecutarse nunca.
   */
  liquidityFloor?: number
  /** Cuánto hay líquido hoy, para que se vea cuánto sobra por encima del piso */
  liquidNow?: number
}

function advisorSchema(symbols: string[]) {
  return {
    type: 'object',
    properties: {
      recommendations: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: ['buy', 'add', 'trim', 'sell', 'rebalance', 'hold'] },
            // enum cerrado: la API impide que sugiera un ticker que no se puede operar
            symbol: { type: 'string', enum: symbols },
            counterpart_symbol: {
              anyOf: [{ type: 'string', enum: symbols }, { type: 'null' }],
              description: 'Solo en rebalance: de qué activo sale la plata',
            },
            title: { type: 'string', description: 'Una línea, accionable' },
            reasoning: {
              type: 'string',
              description: 'En español, 3-5 oraciones: por qué ahora y qué lo dispararía en contra',
            },
            confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
            time_horizon: { type: 'string', enum: ['short', 'medium', 'long'] },
            suggested_amount_ars: {
              anyOf: [{ type: 'number' }, { type: 'null' }],
              description: 'Monto en pesos. Nunca mayor al efectivo disponible en una compra.',
            },
            realizes_loss: {
              type: 'boolean',
              description: 'true si la venta sugerida cristaliza una pérdida',
            },
          },
          required: [
            'action',
            'symbol',
            'counterpart_symbol',
            'title',
            'reasoning',
            'confidence',
            'time_horizon',
            'suggested_amount_ars',
            'realizes_loss',
          ],
          additionalProperties: false,
        },
      },
    },
    required: ['recommendations'],
    additionalProperties: false,
  }
}

export async function advise(ctx: AdvisorContext): Promise<{
  recommendations: Recommendation[]
  usage: { input: number; output: number }
}> {
  const system = [
    'Sos asesor financiero con perfil moderado-agresivo, especializado en CEDEARs argentinos.',
    'Tu trabajo es recomendar ACCIONES concretas sobre esta cartera, no describirla.',
    '',
    'Reglas:',
    '- Máximo 3 recomendaciones. Si hoy no hay nada que amerite mover plata, devolvé',
    '  una sola con action "hold" y explicá por qué conviene no hacer nada.',
    '- No sugieras operar por operar. Cada movimiento tiene costo y riesgo de timing.',
    '- En una compra, suggested_amount_ars NUNCA puede superar el efectivo disponible.',
    '- Podés sugerir vender en pérdida si la TESIS se rompió (el negocio está peor,',
    '  no solo el precio). En ese caso marcá realizes_loss y decilo explícitamente en',
    '  el reasoning. Si solo cayó el precio pero la empresa sigue bien, no es motivo.',
    '- En un rebalance indicá el counterpart_symbol: de dónde sale la plata.',
    '- Mirá la concentración: sugerir más de un sector que ya pesa de más empeora el riesgo.',
    '',
    'ROTACIÓN DE RENTA FIJA A CRECIMIENTO:',
    'El objetivo declarado del usuario es que la cartera crezca lo más posible, y reinvertir.',
    'Mirá la composición por tipo de instrumento: si hay una porción grande en fondos comunes',
    'o bonos rindiendo tasa, evaluá explícitamente rotar parte a CEDEARs y decilo con el',
    'counterpart_symbol correspondiente. No lo propongas por reflejo — solo si el activo de',
    'destino tiene una tesis concreta.',
    '',
    'PERO la liquidez no puede quedar por debajo del piso que te paso. Ese piso es una',
    'RESERVA A MANTENER, no el saldo de hoy: lo que exceda el piso sí se puede rotar, y de',
    'hecho es la plata con la que se hace crecer la cartera. Quedarse por debajo obliga a',
    'vender en el peor momento, que es cómo se pierde plata incluso teniendo razón sobre',
    'las empresas.',
    '',
    'En el reasoning incluí siempre qué te haría cambiar de opinión. Una tesis sin',
    'condición de salida no es una tesis.',
  ].join('\n')

  const positionLines = ctx.positions
    .map(
      (p) =>
        `${p.symbol} (${p.sector}): ${fmtArs(p.value)} · ${p.weight.toFixed(1)}% de la cartera · P/L ${p.gainPct.toFixed(1)}% · hoy ${p.dayPct.toFixed(1)}% · 30d ${p.trend30d}`,
    )
    .join('\n')

  const user = [
    `CARTERA — total ${fmtArs(ctx.totalValue)}, efectivo disponible ${fmtArs(ctx.availableCash)}`,
    positionLines || '(sin posiciones)',
    '',
    `CONCENTRACIÓN POR SECTOR: ${ctx.sectorWeights.map((s) => `${s.sector} ${s.pct.toFixed(0)}%`).join(' · ')}`,
    ctx.typeWeights?.length
      ? `COMPOSICIÓN POR TIPO: ${ctx.typeWeights.map((t) => `${t.type} ${t.pct.toFixed(0)}% (${fmtArs(t.value)})`).join(' · ')}`
      : '',
    ctx.liquidityFloor
      ? `LIQUIDEZ — tenés ${fmtArs(ctx.liquidNow ?? 0)} entre efectivo y money market. ` +
        `El piso a mantener es ${fmtArs(ctx.liquidityFloor)}, así que hay ` +
        `${fmtArs(Math.max(0, (ctx.liquidNow ?? 0) - ctx.liquidityFloor))} disponibles para rotar ` +
        `a crecimiento sin bajar del piso.`
      : '',
    `UMBRALES DEL USUARIO: máx ${ctx.settings.rebalance_pct}% por activo, máx ${ctx.settings.sector_concentration_pct}% por sector`,
    '',
    'NOTICIAS RECIENTES:',
    ctx.news
      .map((n) => `- [${n.sentiment}] ${n.title}${n.symbols.length ? ` (${n.symbols.join(', ')})` : ''}\n  ${n.summary}`)
      .join('\n') || '(sin noticias relevantes)',
    '',
    'ACTIVOS QUE PODÉS SUGERIR:',
    ctx.universe
      .map((u) => `${u.symbol} — ${u.name} (${u.sector})${u.price ? ` · ${fmtArs(u.price)}` : ''}`)
      .join('\n'),
  ]
    // Las líneas de composición y piso de liquidez son opcionales: sin filtrar
    // quedarían renglones vacíos en el medio del prompt
    .filter(Boolean)
    .join('\n')

  const response = await client.messages.create({
    model: OPPORTUNITY_MODEL,
    max_tokens: 8000,
    output_config: {
      effort: 'medium',
      format: { type: 'json_schema', schema: advisorSchema(ctx.universe.map((u) => u.symbol)) },
    },
    system,
    messages: [{ role: 'user', content: user }],
  })

  const usage = { input: response.usage.input_tokens, output: response.usage.output_tokens }

  if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') {
    console.warn(`[claude] asesor: stop_reason=${response.stop_reason}`)
    return { recommendations: [], usage }
  }

  const text = response.content.find((b) => b.type === 'text')
  if (!text || text.type !== 'text') return { recommendations: [], usage }

  const parsed = JSON.parse(text.text) as { recommendations: Recommendation[] }
  console.log(`[claude] asesor · in ${usage.input} / out ${usage.output} tokens`)

  return { recommendations: (parsed.recommendations ?? []).slice(0, 3), usage }
}

// ============================================================
// Asesor de una meta puntual
// ============================================================

export type GoalContext = {
  name: string
  targetAmount: number | null
  targetDate: string | null
  daysLeft: number | null
  currentValue: number
  cashInGoal: number
  /** Rendimiento anual que pide la meta. null si no hay objetivo o fecha. */
  requiredAnnualPct: number | null
  /** comodo | exigente | dificil | improbable | inalcanzable */
  band: string | null
  /** A cuánto se llega en la fecha al ritmo de referencia */
  achievableAmount: number | null
  earmarked: Array<{ symbol: string; quantity: number; value: number }>
}

/**
 * Plan de compra para una meta.
 *
 * Dos diferencias con el asesor general, y las dos son deliberadas:
 *
 * 1. El horizonte se acota por la fecha. Una meta a 51 días no puede recibir
 *    una recomendación "long": la API lo impide por schema, no por prompt.
 *
 * 2. Una meta difícil NO habilita más riesgo. El modelo recibe la dificultad
 *    calculada y la instrucción explícita de que un objetivo fuera de alcance
 *    se responde diciéndolo, no concentrando la cartera. Perseguir un objetivo
 *    imposible subiendo el riesgo es el mecanismo exacto por el que la gente se
 *    descapitaliza, y es lo contrario de lo que la app tiene que hacer.
 */
export async function adviseForGoal(
  ctx: AdvisorContext,
  goal: GoalContext,
): Promise<{ recommendations: Recommendation[]; usage: { input: number; output: number } }> {
  // El plazo define qué horizontes son coherentes. Sugerir "6+ meses" para una
  // meta a 51 días sería una recomendación que no puede cumplirse.
  const horizons =
    goal.daysLeft === null
      ? ['short', 'medium', 'long']
      : goal.daysLeft <= 60
        ? ['short']
        : goal.daysLeft <= 210
          ? ['short', 'medium']
          : ['short', 'medium', 'long']

  const unreachable = goal.band === 'improbable' || goal.band === 'inalcanzable'

  const system = [
    'Sos asesor financiero especializado en CEDEARs argentinos.',
    'Estás armando el plan de una META puntual del usuario, no de toda la cartera.',
    '',
    'Reglas:',
    '- Máximo 3 recomendaciones, solo con fundamento real.',
    `- El horizonte de la meta es acotado: usá únicamente ${horizons.join(' o ')}.`,
    '- En una compra, suggested_amount_ars NUNCA puede superar el efectivo disponible.',
    '- Respetá los límites de concentración del usuario. Son los mismos que para el',
    '  resto de la cartera: una meta no los suspende.',
    '',
    'REGLA INNEGOCIABLE SOBRE EL RIESGO:',
    'Una meta exigente NO justifica recomendaciones más agresivas. Si el objetivo no',
    'entra con una cartera razonable, decilo en el reasoning y recomendá lo que sí es',
    'sensato para el plazo. NUNCA propongas concentrar en un solo activo, ni apostar a',
    'un movimiento puntual, para "llegar" al número. El usuario dijo explícitamente que',
    'no quiere descapitalizarse: perseguir un objetivo inalcanzable tomando más riesgo',
    'es la forma más rápida de que eso pase.',
    '',
    unreachable
      ? 'ESTA META ESTÁ FUERA DE ALCANCE con el capital y el plazo actuales. Tu trabajo NO es ' +
        'encontrar la manera de lograrla: es proponer el mejor uso del dinero para ese plazo y ' +
        'decir con todas las letras que el objetivo necesita más capital, más tiempo o un monto menor.'
      : 'Esta meta es alcanzable con una cartera razonable para el plazo.',
    '',
    'En el reasoning incluí siempre qué te haría cambiar de opinión.',
  ].join('\n')

  const goalLines = [
    `META: "${goal.name}"`,
    goal.targetAmount ? `Objetivo: ${fmtArs(goal.targetAmount)}` : 'Sin objetivo de monto',
    goal.targetDate ? `Fecha: ${goal.targetDate}${goal.daysLeft !== null ? ` (faltan ${goal.daysLeft} días)` : ''}` : 'Sin fecha',
    `Valor actual de la meta: ${fmtArs(goal.currentValue)} (${fmtArs(goal.cashInGoal)} en efectivo sin invertir)`,
    goal.requiredAnnualPct !== null
      ? `Rendimiento anual que exige el objetivo: ${goal.requiredAnnualPct.toFixed(0)}% — dificultad ${goal.band}`
      : 'Sin objetivo y fecha no hay rendimiento exigido',
    goal.achievableAmount !== null
      ? `A ritmo de mercado razonable, en la fecha llegaría a ${fmtArs(goal.achievableAmount)}`
      : '',
    '',
    'YA APARTADO PARA ESTA META:',
    goal.earmarked.map((h) => `${h.symbol}: ${h.quantity} unidades · ${fmtArs(h.value)}`).join('\n') ||
      '(nada todavía)',
  ]
    .filter(Boolean)
    .join('\n')

  const positionLines = ctx.positions
    .map(
      (p) =>
        `${p.symbol} (${p.sector}): ${fmtArs(p.value)} · ${p.weight.toFixed(1)}% · P/L ${p.gainPct.toFixed(1)}%`,
    )
    .join('\n')

  const user = [
    goalLines,
    '',
    `CARTERA COMPLETA — total ${fmtArs(ctx.totalValue)}, efectivo disponible ${fmtArs(ctx.availableCash)}`,
    positionLines || '(sin posiciones)',
    '',
    `CONCENTRACIÓN POR SECTOR: ${ctx.sectorWeights.map((s) => `${s.sector} ${s.pct.toFixed(0)}%`).join(' · ')}`,
    `LÍMITES DEL USUARIO: máx ${ctx.settings.rebalance_pct}% por activo, máx ${ctx.settings.sector_concentration_pct}% por sector`,
    '',
    'ACTIVOS QUE PODÉS SUGERIR:',
    ctx.universe.map((u) => `${u.symbol} — ${u.name} (${u.sector})`).join('\n'),
  ].join('\n')

  // Se reusa el schema del asesor general, acotando el enum de horizonte
  const schema = advisorSchema(ctx.universe.map((u) => u.symbol)) as {
    properties: { recommendations: { items: { properties: Record<string, unknown> } } }
  }
  schema.properties.recommendations.items.properties.time_horizon = {
    type: 'string',
    enum: horizons,
  }

  const response = await client.messages.create({
    model: OPPORTUNITY_MODEL,
    max_tokens: 8000,
    output_config: { effort: 'medium', format: { type: 'json_schema', schema } },
    system,
    messages: [{ role: 'user', content: user }],
  })

  const usage = { input: response.usage.input_tokens, output: response.usage.output_tokens }

  if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') {
    console.warn(`[claude] asesor de meta: stop_reason=${response.stop_reason}`)
    return { recommendations: [], usage }
  }

  const text = response.content.find((b) => b.type === 'text')
  if (!text || text.type !== 'text') return { recommendations: [], usage }

  const parsed = JSON.parse(text.text) as { recommendations: Recommendation[] }
  console.log(`[claude] meta "${goal.name}" · in ${usage.input} / out ${usage.output} tokens`)

  return { recommendations: (parsed.recommendations ?? []).slice(0, 3), usage }
}

export type Opportunity = {
  symbol: string
  opportunity_type: 'pullback' | 'momentum' | 'undervalued' | 'sector_rotation' | 'earnings_play'
  title: string
  reasoning: string
  growth_estimate_pct: number
  confidence: 'high' | 'medium' | 'low'
  time_horizon: 'short' | 'medium' | 'long'
}

export type PortfolioContext = {
  positions: Array<{ symbol: string; value: number; gainPct: number; weight: number; sector: string }>
  totalValue: number
  availableCash: number
  news: Array<{ title: string; summary: string; sentiment: string; symbols: string[] }>
  universe: Array<{ symbol: string; name: string; sector: string }>
}

function opportunitySchema(universeSymbols: string[]) {
  return {
    type: 'object',
    properties: {
      opportunities: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            // enum = el modelo NO PUEDE devolver un ticker fuera del universo.
            // Lo garantiza la API, no una instrucción del prompt.
            symbol: { type: 'string', enum: universeSymbols },
            opportunity_type: {
              type: 'string',
              enum: ['pullback', 'momentum', 'undervalued', 'sector_rotation', 'earnings_play'],
            },
            title: { type: 'string', description: 'Título corto y accionable' },
            reasoning: {
              type: 'string',
              description: 'En español, 3-4 oraciones: por qué ES una oportunidad AHORA',
            },
            growth_estimate_pct: { type: 'number' },
            confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
            time_horizon: { type: 'string', enum: ['short', 'medium', 'long'] },
          },
          required: [
            'symbol',
            'opportunity_type',
            'title',
            'reasoning',
            'growth_estimate_pct',
            'confidence',
            'time_horizon',
          ],
          additionalProperties: false,
        },
      },
    },
    required: ['opportunities'],
    additionalProperties: false,
  }
}

const fmtArs = (n: number) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n)

export async function analyzeOpportunities(ctx: PortfolioContext): Promise<{
  opportunities: Opportunity[]
  usage: { input: number; output: number }
}> {
  const system = [
    'Sos analista financiero con perfil moderado-agresivo, especializado en CEDEARs argentinos.',
    'Detectás oportunidades concretas de inversión para un inversor individual.',
    '',
    'Priorizá, en este orden:',
    '- Pullbacks en empresas sólidas (caída temporal, fundamentos intactos)',
    '- Momentum confirmado por resultados, no por precio solo',
    '- Rotaciones sectoriales por cambios macro',
    '',
    'Devolvé como máximo 3 oportunidades, y solo donde tengas convicción real.',
    'Si no hay ninguna que justifique mover plata hoy, devolvé un array vacío:',
    'no completes el cupo por completarlo.',
    '',
    'Tené en cuenta la concentración actual de la cartera: sugerir más de un sector',
    'que ya pesa demasiado empeora el riesgo en vez de mejorarlo.',
    'growth_estimate_pct es tu estimación de retorno para el horizonte que indiques.',
  ].join('\n')

  const positionLines = ctx.positions
    .map(
      (p) =>
        `${p.symbol} (${p.sector}): ${fmtArs(p.value)}, ${p.weight.toFixed(1)}% de la cartera, P/L ${p.gainPct.toFixed(1)}%`,
    )
    .join('\n')

  const newsLines = ctx.news
    .map((n) => `- [${n.sentiment}] ${n.title}${n.symbols.length ? ` (${n.symbols.join(', ')})` : ''}\n  ${n.summary}`)
    .join('\n')

  const universeLines = ctx.universe.map((u) => `${u.symbol} — ${u.name} (${u.sector})`).join('\n')

  const user = [
    `CARTERA (total ${fmtArs(ctx.totalValue)}, efectivo disponible ${fmtArs(ctx.availableCash)}):`,
    positionLines || '(sin posiciones)',
    '',
    'NOTICIAS RECIENTES:',
    newsLines || '(sin noticias relevantes)',
    '',
    'ACTIVOS QUE PODÉS SUGERIR:',
    universeLines,
  ].join('\n')

  const response = await client.messages.create({
    model: OPPORTUNITY_MODEL,
    max_tokens: 8000,
    // Acá SÍ queremos razonamiento: son decisiones sobre plata real.
    // En Opus 5 el thinking adaptativo está activo por defecto.
    output_config: {
      effort: 'medium',
      format: { type: 'json_schema', schema: opportunitySchema(ctx.universe.map((u) => u.symbol)) },
    },
    system,
    messages: [{ role: 'user', content: user }],
  })

  const usage = { input: response.usage.input_tokens, output: response.usage.output_tokens }

  if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') {
    console.warn(`[claude] oportunidades: stop_reason=${response.stop_reason}`)
    return { opportunities: [], usage }
  }

  const text = response.content.find((b) => b.type === 'text')
  if (!text || text.type !== 'text') return { opportunities: [], usage }

  const parsed = JSON.parse(text.text) as { opportunities: Opportunity[] }
  console.log(`[claude] oportunidades · in ${usage.input} / out ${usage.output} tokens`)

  return { opportunities: (parsed.opportunities ?? []).slice(0, 3), usage }
}
