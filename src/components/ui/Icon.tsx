import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement>

const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  width: 22,
  height: 22,
}

export function IconDashboard(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M3 17.5 8.5 11l3.5 3.5L21 6" />
      <path d="M15.5 6H21v5.5" />
      <path d="M3 21h18" />
    </svg>
  )
}

export function IconBell(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M18 8a6 6 0 1 0-12 0c0 5-2 6.5-2 6.5h16S18 13 18 8Z" />
      <path d="M10.3 18.5a2 2 0 0 0 3.4 0" />
    </svg>
  )
}

export function IconRocket(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M13.5 3.5C17 3 20.5 4 21 4.5s1.5 4-.5 7.5c-1.5 2.6-4.4 4.6-6.5 5.5l-2.5-2.5-2.5-2.5c.9-2.1 2.9-5 5.5-6.5Z" />
      <path d="M9 15c-1.5 0-3 .5-3.5 2S5 21 5 21s2.5.5 4-.5S11 18 11 16.5" />
      <circle cx="15.5" cy="8.5" r="1.5" />
    </svg>
  )
}

export function IconNews(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 5h12a1 1 0 0 1 1 1v12a2 2 0 0 0 2 2H5a2 2 0 0 1-2-2V6a1 1 0 0 1 1-1Z" />
      <path d="M17 9h2a1 1 0 0 1 1 1v8" />
      <path d="M7 9h6M7 12.5h6M7 16h4" />
    </svg>
  )
}

export function IconSettings(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 14a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V20a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 9 18.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 8a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V2a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V8a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z" />
    </svg>
  )
}

export function IconChevronRight(props: IconProps) {
  return (
    <svg {...base} width={16} height={16} {...props}>
      <path d="m9 6 6 6-6 6" />
    </svg>
  )
}

/** Ojo abierto: los montos se ven */
export function IconEye(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

/** Ojo tachado: los montos están ocultos */
export function IconEyeOff(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M10.6 6.1A9.9 9.9 0 0 1 12 6c6 0 9.5 6 9.5 6a17 17 0 0 1-2.8 3.4" />
      <path d="M6.7 7.7A17 17 0 0 0 2.5 12S6 18 12 18a9.6 9.6 0 0 0 4-.85" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
      <path d="m3 3 18 18" />
    </svg>
  )
}

/** Información: abre las instrucciones */
export function IconInfo(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 16.5v-5" />
      <path d="M12 7.9h.01" />
    </svg>
  )
}
