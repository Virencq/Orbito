import type { CSSProperties } from 'react'

interface OrbitoLogoProps {
  isWorking?: boolean
  size?: number
  className?: string
}

/** Orbito Orbit Dot mark. The ring animates during work; the satellite remains visually distinct. */
export function OrbitoLogo({ isWorking = false, size = 22, className = '' }: OrbitoLogoProps) {
  const style: CSSProperties = { width: size, height: size }
  return (
    <span
      className={`orbito-logo ${isWorking ? 'orbito-logo--working' : ''} ${className}`.trim()}
      style={style}
      role="img"
      aria-label={isWorking ? 'Orbito agent is working' : 'Orbito agent is idle'}
      title={isWorking ? 'Agent is working' : 'Agent is idle'}
    >
      <svg viewBox="0 0 40 40" width={size} height={size} aria-hidden="true">
        <defs>
          <linearGradient id="orbito-mark-gradient" x1="5" y1="3" x2="35" y2="37" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#ffbe4b" />
            <stop offset=".55" stopColor="#ff7a00" />
            <stop offset="1" stopColor="#f33d1e" />
          </linearGradient>
          <radialGradient id="orbito-node-gradient" cx="30%" cy="25%" r="75%">
            <stop offset="0" stopColor="#ffd36b" />
            <stop offset=".62" stopColor="#ff7a00" />
            <stop offset="1" stopColor="#f34b20" />
          </radialGradient>
        </defs>
        <circle cx="20" cy="20" r="17" fill="none" stroke="#ff7a00" strokeWidth="1.2" strokeOpacity=".12" />
        <path className="orbito-logo-ring" d="M28.2 8.4A15.4 15.4 0 1 0 33.5 22.7" fill="none" stroke="url(#orbito-mark-gradient)" strokeWidth="4.5" strokeLinecap="round" />
        <circle cx="28.3" cy="10.7" r="5.3" fill="url(#orbito-node-gradient)" />
        <circle cx="26.7" cy="9.1" r="1.2" fill="#fff0bd" fillOpacity=".72" />
      </svg>
    </span>
  )
}
