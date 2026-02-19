import React from 'react'

interface CircleTimerProps {
  elapsed: number
  total: number
  size?: number
  reverse?: boolean
  thickness?: number
  progressClassName?: string
  trackClassName?: string | null
}

export function CircleTimer({ elapsed, total, size = 32, reverse = false, thickness = 2, progressClassName = 'text-codemirror-200', trackClassName = null }: CircleTimerProps) {
  const progress = Math.min(elapsed / total, 1)
  const radius = 14 - thickness / 2
  const circumference = 2 * Math.PI * radius
  const dashOffset = reverse ? (1 - progress) * circumference : progress * circumference

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      className="transform -rotate-90"
    >
      {/* Track circle (full background) */}
      {trackClassName && (
        <circle
          cx="16"
          cy="16"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={thickness}
          strokeDasharray={circumference}
          strokeDashoffset={0}
          className={trackClassName}
          strokeLinecap="round"
        />
      )}
      {/* Progress circle */}
      <circle
        cx="16"
        cy="16"
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={thickness}
        strokeDasharray={circumference}
        strokeDashoffset={dashOffset}
        className={`${progressClassName} transition-all duration-50`}
        strokeLinecap="round"
      />
    </svg>
  )
}
