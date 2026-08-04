import { EmptyState } from '@/components/ui/Card'

export function Opportunities() {
  return (
    <div className="animate-fade-up">
      <EmptyState
        icon="🚀"
        title="Todavía no hay oportunidades"
        description="En la Fase 5 la Edge Function analyze-opportunities usa Claude para detectar pullbacks, momentum y rotaciones sectoriales."
      />
    </div>
  )
}
