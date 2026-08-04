import { EmptyState } from '@/components/ui/Card'

export function News() {
  return (
    <div className="animate-fade-up">
      <EmptyState
        icon="📰"
        title="Feed vacío"
        description="En la Fase 4 el RSS fetcher trae Ámbito, Cronista, Reuters y Bloomberg, con resumen y sentimiento generados por Claude."
      />
    </div>
  )
}
