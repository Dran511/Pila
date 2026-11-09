import { useState } from 'react'

// Hand-drawn SVG bar chart with an optional comparison line, hover tooltips and an accessible table fallback.

export interface BarDatum {
  label: string
  value: number
  /** Optional comparison value drawn as a line (e.g. "average day"). */
  line?: number
  tip: string
  highlight?: boolean
}

export function BarChart({
  data,
  height = 220,
  title,
  showEvery = 1,
}: {
  data: BarDatum[]
  height?: number
  title: string
  showEvery?: number
}) {
  const [hover, setHover] = useState<number | null>(null)
  const width = 640
  const pad = { top: 12, right: 8, bottom: 26, left: 32 }
  const innerW = width - pad.left - pad.right
  const innerH = height - pad.top - pad.bottom
  const max = Math.max(1, ...data.map((d) => Math.max(d.value, d.line ?? 0)))
  const step = niceStep(max)
  const top = Math.ceil(max / step) * step
  const slot = innerW / data.length
  const barW = Math.max(3, Math.min(32, slot * 0.62))
  const y = (v: number) => pad.top + innerH - (v / top) * innerH
  const ticks = Array.from({ length: Math.floor(top / step) + 1 }, (_, i) => i * step)
  const hasLine = data.some((d) => d.line != null)
  const linePath = hasLine
    ? data.map((d, i) => `${i ? 'L' : 'M'}${pad.left + slot * i + slot / 2},${y(d.line ?? 0)}`).join(' ')
    : ''

  return (
    <div style={{ position: 'relative' }}>
      <svg className="chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title} onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line className="grid-line" x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)} />
            <text x={pad.left - 8} y={y(t) + 4} textAnchor="end">
              {t}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = pad.left + slot * i + (slot - barW) / 2
          return (
            <g key={i} onMouseEnter={() => setHover(i)}>
              <rect x={pad.left + slot * i} y={pad.top} width={slot} height={innerH} fill="transparent" />
              <rect
                className={`bar ${d.highlight === false ? 'alt' : ''}`}
                x={x}
                y={y(d.value)}
                width={barW}
                height={Math.max(0, pad.top + innerH - y(d.value))}
                rx={Math.min(4, barW / 3)}
                opacity={hover == null || hover === i ? 1 : 0.55}
              />
              {i % showEvery === 0 && (
                <text x={pad.left + slot * i + slot / 2} y={height - 8} textAnchor="middle">
                  {d.label}
                </text>
              )}
            </g>
          )
        })}
        {hasLine && <path className="avg-line" d={linePath} />}
      </svg>
      {hover != null && (
        <div
          className="chart-tip"
          style={{
            left: `${((pad.left + slot * hover + slot / 2) / width) * 100}%`,
            top: `${(y(Math.max(data[hover].value, data[hover].line ?? 0)) / height) * 100}%`,
          }}
        >
          {data[hover].tip}
        </div>
      )}
      <table className="sr-only">
        <caption>{title}</caption>
        <tbody>
          {data.map((d, i) => (
            <tr key={i}>
              <th>{d.label}</th>
              <td>{d.tip}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function niceStep(max: number) {
  const raw = max / 4
  const mag = 10 ** Math.floor(Math.log10(raw))
  const n = raw / mag
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag
}
