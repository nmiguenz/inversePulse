import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import type { SectorSlice } from '@/lib/types'
import { sectorColor } from '@/lib/sectors'
import { formatARS } from '@/lib/format'

/**
 * Composición por sector. El donut da la forma; la leyenda de abajo hace de
 * vista tabular (sector + % + monto), así la identidad nunca depende del color.
 */
export function SectorDonut({ slices }: { slices: SectorSlice[] }) {
  if (!slices.length) return null

  return (
    <div>
      <div className="h-[168px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={slices}
              dataKey="value"
              nameKey="sector"
              innerRadius={52}
              outerRadius={80}
              // 2px de superficie entre segmentos
              paddingAngle={2}
              stroke="#0E0E14"
              strokeWidth={2}
              isAnimationActive={false}
            >
              {slices.map((s) => (
                <Cell key={s.sector} fill={sectorColor(s.sector)} />
              ))}
            </Pie>
            <Tooltip
              cursor={false}
              contentStyle={{
                background: '#161620',
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: 12,
                fontSize: 12,
                padding: '8px 10px',
              }}
              itemStyle={{ color: '#EEEEF4' }}
              labelStyle={{ display: 'none' }}
              formatter={(value: number, name: string) => [
                `${formatARS(value)} · ${((value / slices.reduce((s, x) => s + x.value, 0)) * 100).toFixed(1)}%`,
                name,
              ]}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>

      <ul className="mt-3 space-y-2">
        {slices.map((s) => (
          <li key={s.sector} className="flex items-center gap-2.5">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ background: sectorColor(s.sector) }}
              aria-hidden
            />
            <span className="text-primary flex-1 truncate text-[13px]">{s.sector}</span>
            <span className="tnum text-secondary font-mono text-[12px]">
              {s.pct.toFixed(1)}%
            </span>
            <span className="tnum text-muted w-24 text-right font-mono text-[12px]">
              {formatARS(s.value)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
