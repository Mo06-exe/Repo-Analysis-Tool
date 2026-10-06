// Charts, hand-drawn in SVG. No chart library: the strata chart needs a
// very specific look (flat stacked columns, hairline grid) and hover tooltips
// that read like a readout, not a marketing dashboard.

import { useEffect, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { fmtCompact, fmtInt } from '../format'

/** Muted earth palette — distinguishable, never neon. */
export const SERIES_COLORS = [
  '#e2a83e', // amber (the accent)
  '#7d97c9', // slate blue
  '#5aa878', // moss
  '#c96b60', // clay red
  '#9b7fc9', // heather
  '#5fa8a0', // verdigris
  '#c9a25f', // ochre
  '#8a93a6', // pewter
]

export const OTHERS_COLOR = '#3d4552'

export function colorFor(index: number): string {
  return SERIES_COLORS[index % SERIES_COLORS.length]
}

/** Observe an element's width so SVGs can be laid out in real pixels. */
export function useMeasure<T extends HTMLElement>(): [RefObject<T>, number] {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setWidth(e.contentRect.width)
    })
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])
  return [ref, width]
}

export interface StratumSeries {
  key: string
  name: string
  color: string
  values: number[]
}

function niceCeil(v: number): number {
  if (v <= 0) return 1
  const mag = Math.pow(10, Math.floor(Math.log10(v)))
  const norm = v / mag
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 4 ? 4 : norm <= 5 ? 5 : norm <= 8 ? 8 : 10
  return step * mag
}

export function StrataChart({
  labels,
  series,
  height = 210,
  valueName = 'commits',
  onBucketClick,
}: {
  labels: string[]
  series: StratumSeries[]
  height?: number
  valueName?: string
  onBucketClick?: (bucketIndex: number) => void
}) {
  const [wrapRef, width] = useMeasure<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)

  const margin = { l: 46, r: 10, t: 12, b: 24 }
  const innerW = Math.max(0, width - margin.l - margin.r)
  const innerH = height - margin.t - margin.b
  const n = labels.length

  const totals = useMemo(() => {
    return labels.map((_, i) => series.reduce((acc, s) => acc + (s.values[i] ?? 0), 0))
  }, [labels, series])

  const yMax = useMemo(() => niceCeil(Math.max(1, ...totals)), [totals])
  const stepX = n > 0 ? innerW / n : 0
  const barW = Math.max(2, Math.min(26, stepX - 2))

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * yMax)

  // thin x labels so they never collide (~64px each)
  const labelStride = Math.max(1, Math.ceil((n * 64) / Math.max(1, innerW)))

  if (!n) {
    return (
      <div className="empty" style={{ padding: '36px 16px' }}>
        no commits in scope
      </div>
    )
  }

  const xFor = (i: number) => margin.l + i * stepX + stepX / 2
  const tipLeft = hover === null ? 0 : Math.min(Math.max(xFor(hover) - 88, 4), Math.max(4, width - 182))

  return (
    <div className="chart-wrap" ref={wrapRef}>
      {width > 0 && (
        <svg
          width={width}
          height={height}
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect()
            const x = e.clientX - rect.left - margin.l
            const idx = Math.floor(x / Math.max(1, stepX))
            setHover(idx >= 0 && idx < n ? idx : null)
          }}
          onMouseLeave={() => setHover(null)}
          onClick={() => hover !== null && onBucketClick?.(hover)}
          style={onBucketClick ? { cursor: 'pointer' } : undefined}
        >
          {/* grid */}
          {yTicks.map((v, i) => {
            const y = margin.t + innerH - (v / yMax) * innerH
            return (
              <g key={i}>
                <line x1={margin.l} x2={margin.l + innerW} y1={y} y2={y} stroke="#1f242b" strokeWidth={1} />
                <text x={margin.l - 6} y={y + 3} textAnchor="end" fontSize={9.5} fill="#646d79" fontFamily="var(--font-mono)">
                  {fmtCompact(v)}
                </text>
              </g>
            )
          })}

          {/* stacked columns */}
          {labels.map((_, i) => {
            let acc = 0
            const cx = margin.l + i * stepX + (stepX - barW) / 2
            const dimmed = hover !== null && hover !== i
            return (
              <g key={i} opacity={dimmed ? 0.45 : 1}>
                {series.map((s) => {
                  const v = s.values[i] ?? 0
                  if (v <= 0) return null
                  const h = (v / yMax) * innerH
                  const y = margin.t + innerH - (acc / yMax) * innerH - h
                  acc += v
                  return <rect key={s.key} x={cx} y={y} width={barW} height={Math.max(1, h)} fill={s.color} />
                })}
              </g>
            )
          })}

          {/* hover guide */}
          {hover !== null && (
            <line
              x1={xFor(hover)}
              x2={xFor(hover)}
              y1={margin.t}
              y2={margin.t + innerH}
              stroke="#e2a83e"
              strokeWidth={1}
              strokeDasharray="2 3"
              opacity={0.7}
            />
          )}

          {/* x labels */}
          {labels.map((label, i) =>
            i % labelStride === 0 || i === n - 1 ? (
              <text
                key={i}
                x={xFor(i)}
                y={height - 8}
                textAnchor="middle"
                fontSize={9.5}
                fill="#646d79"
                fontFamily="var(--font-mono)"
              >
                {label}
              </text>
            ) : null,
          )}

          {/* invisible per-bucket hit areas — also catch synthetic hovers */}
          {labels.map((_, i) => (
            <rect
              key={`hit-${i}`}
              x={margin.l + i * stepX}
              y={margin.t}
              width={stepX}
              height={innerH}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
            />
          ))}
        </svg>
      )}

      {hover !== null && (
        <div className="chart-tip" style={{ left: tipLeft, top: margin.t }}>
          <div className="tip-head">
            {labels[hover]} · {fmtInt(totals[hover])} {valueName}
          </div>
          {series
            .map((s) => ({ s, v: s.values[hover] ?? 0 }))
            .filter((x) => x.v > 0)
            .sort((a, b) => b.v - a.v)
            .map(({ s, v }) => (
              <div className="tip-row" key={s.key}>
                <span className="sw" style={{ background: s.color }} />
                <span className="tx">{s.name}</span>
                <span className="vv">{fmtInt(v)}</span>
              </div>
            ))}
        </div>
      )}
    </div>
  )
}

export function Legend({
  items,
  onClick,
}: {
  items: { key: string; name: string; color: string; muted?: boolean }[]
  onClick?: (key: string) => void
}) {
  return (
    <div className="legend">
      {items.map((it) => (
        <span
          key={it.key}
          className={it.muted ? 'lg-item dimmed' : 'lg-item'}
          onClick={onClick && !it.muted ? () => onClick(it.key) : undefined}
          title={onClick && !it.muted ? 'filter by this series' : undefined}
        >
          <span className="sw" style={{ width: 7, height: 7, borderRadius: 1, background: it.color, display: 'inline-block' }} />
          {it.name}
        </span>
      ))}
    </div>
  )
}

export function Sparkline({
  values,
  width = 120,
  height = 26,
  color = '#e2a83e',
}: {
  values: number[]
  width?: number
  height?: number
  color?: string
}) {
  if (!values.length) return null
  const max = Math.max(1, ...values)
  const step = values.length > 1 ? width / (values.length - 1) : width
  const pts = values.map((v, i) => [i * step, height - 2 - (v / max) * (height - 5)] as const)
  const line = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const area = `${line} L${width},${height} L0,${height} Z`
  return (
    <svg className="sparkline" width={width} height={height}>
      <path d={area} fill={color} opacity={0.12} />
      <path d={line} fill="none" stroke={color} strokeWidth={1.2} />
    </svg>
  )
}

/** Inline added/deleted ratio bar for table cells. */
export function RatioBar({ added, deleted, width = 90 }: { added: number; deleted: number; width?: number }) {
  const total = added + deleted
  const aw = total > 0 ? (added / total) * 100 : 0
  const dw = total > 0 ? (deleted / total) * 100 : 0
  return (
    <span className="ratio" style={{ width }} title={`+${fmtInt(added)} / −${fmtInt(deleted)}`}>
      <span className="r-add" style={{ width: `${aw}%` }} />
      <span className="r-del" style={{ left: `${aw}%`, width: `${dw}%` }} />
    </span>
  )
}
