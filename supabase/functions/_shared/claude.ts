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

/** Sonnet para clasificar (alto volumen, tarea simple). Opus queda para las oportunidades. */
export const NEWS_MODEL = 'claude-sonnet-5'

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
