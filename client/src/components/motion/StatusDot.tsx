// client/src/components/motion/StatusDot.tsx

interface Props {
  /** Tailwind class for the dot color, e.g. 'bg-amber-400' */
  dotClass: string
  /** Show a ping ring animation (for running state) */
  pulse?: boolean
}

export function StatusDot({ dotClass, pulse = false }: Props) {
  return (
    <span className="relative flex shrink-0 w-2 h-2" aria-hidden="true">
      {pulse && (
        <span
          className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${dotClass}`}
        />
      )}
      <span className={`relative inline-flex rounded-full w-2 h-2 ${dotClass}`} />
    </span>
  )
}
