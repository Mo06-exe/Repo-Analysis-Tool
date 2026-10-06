// Hand-drawn 14px icon set. Stroke-based, muted, no fills — sized for
// 24px controls and 12px text.

import type { SVGProps } from 'react'

function Svg({ size = 14, children, ...rest }: SVGProps<SVGSVGElement> & { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  )
}

type P = { size?: number }

export const IconRepo = ({ size }: P) => (
  <Svg size={size}>
    <path d="M3 3.5h8.5v9H3z" />
    <path d="M11.5 5.5H13v9H4.5v-1.5" />
  </Svg>
)

export const IconUpload = ({ size }: P) => (
  <Svg size={size}>
    <path d="M8 10V2.5" />
    <path d="M5 5.5 8 2.5l3 3" />
    <path d="M2.5 10v3h11v-3" />
  </Svg>
)

export const IconLink = ({ size }: P) => (
  <Svg size={size}>
    <path d="M6.5 9.5 9.5 6.5" />
    <path d="M7 4.5 8.8 2.7a2.6 2.6 0 0 1 3.7 3.7L10.7 8.2" />
    <path d="M9 11.5 7.2 13.3a2.6 2.6 0 0 1-3.7-3.7l1.8-1.8" />
  </Svg>
)

export const IconTrash = ({ size }: P) => (
  <Svg size={size}>
    <path d="M3 4.5h10" />
    <path d="M6.5 4.5V3h3v1.5" />
    <path d="M4.5 4.5 5 13h6l.5-8.5" />
  </Svg>
)

export const IconRefresh = ({ size }: P) => (
  <Svg size={size}>
    <path d="M13 8a5 5 0 1 1-1.6-3.7" />
    <path d="M13 3v2.5h-2.5" />
  </Svg>
)

export const IconCheck = ({ size }: P) => (
  <Svg size={size}>
    <path d="m3.5 8.5 3 3 6-7" />
  </Svg>
)

export const IconX = ({ size }: P) => (
  <Svg size={size}>
    <path d="m4 4 8 8M12 4l-8 8" />
  </Svg>
)

export const IconSearch = ({ size }: P) => (
  <Svg size={size}>
    <circle cx="7" cy="7" r="4.2" />
    <path d="m10.3 10.3 3 3" />
  </Svg>
)

export const IconCalendar = ({ size }: P) => (
  <Svg size={size}>
    <path d="M3 4.5h10V13H3z" />
    <path d="M3 7h10M5.5 2.5v3M10.5 2.5v3" />
  </Svg>
)

export const IconHash = ({ size }: P) => (
  <Svg size={size}>
    <path d="M6.3 2.5 5 13.5M11 2.5 9.7 13.5" />
    <path d="M3.5 6h9.5M3 10h9.5" />
  </Svg>
)

export const IconMerge = ({ size }: P) => (
  <Svg size={size}>
    <circle cx="4.5" cy="3.5" r="1.6" />
    <circle cx="4.5" cy="12.5" r="1.6" />
    <circle cx="11.5" cy="8" r="1.6" />
    <path d="M4.5 5.1v5.8" />
    <path d="M6.1 8.8c2.4-.4 3.8-.5 3.8-.8" />
  </Svg>
)

export const IconPlus = ({ size }: P) => (
  <Svg size={size}>
    <path d="M8 3v10M3 8h10" />
  </Svg>
)

export const IconFilter = ({ size }: P) => (
  <Svg size={size}>
    <path d="M2.5 3.5h11L9.5 8.5V13l-3-1.5V8.5z" />
  </Svg>
)

export const IconBranch = ({ size }: P) => (
  <Svg size={size}>
    <circle cx="5" cy="3.5" r="1.6" />
    <circle cx="5" cy="12.5" r="1.6" />
    <circle cx="11" cy="6" r="1.6" />
    <path d="M5 5.1v5.8" />
    <path d="M11 7.6c0 2-1.8 2.4-6 2.9" />
  </Svg>
)

export const IconPath = ({ size }: P) => (
  <Svg size={size}>
    <path d="M2.5 4h5M2.5 8h11M2.5 12h8" />
    <path d="m10.5 2 2 2-2 2" />
  </Svg>
)

export const IconChevron = ({ open }: { open?: boolean }) => (
  <span className={open ? 'expando open' : 'expando'}>▶</span>
)

export const IconUsers = ({ size }: P) => (
  <Svg size={size}>
    <circle cx="5.5" cy="5.5" r="2.2" />
    <path d="M2.5 13c.3-2.4 1.5-3.5 3-3.5s2.7 1.1 3 3.5" />
    <path d="M10.5 4a2 2 0 0 1 0 3.9" />
    <path d="M11.5 9.7c1.2.3 1.9 1.4 2 3.3" />
  </Svg>
)

/** Brand mark: three strata of rock, offset like a sediment column. */
export function StrataGlyph({ size = 17 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" aria-hidden="true">
      <rect x="1" y="2.5" width="16" height="3" rx="0.8" fill="#e2a83e" />
      <rect x="3.4" y="7.5" width="13.6" height="3" rx="0.8" fill="#8a6d34" />
      <rect x="5.8" y="12.5" width="11.2" height="3" rx="0.8" fill="#4a432f" />
    </svg>
  )
}
