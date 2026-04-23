// client/src/components/JsonEditor.tsx
import { useState } from 'react'

interface Props {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
}

export function JsonEditor({ value, onChange, placeholder, disabled }: Props) {
  const [error, setError] = useState<string | null>(null)

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const v = e.target.value
    onChange(v)
    if (!v.trim()) {
      setError(null)
      return
    }
    try {
      JSON.parse(v)
      setError(null)
    } catch {
      setError('Invalid JSON')
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <textarea
        value={value}
        onChange={handleChange}
        disabled={disabled}
        placeholder={placeholder}
        rows={5}
        spellCheck={false}
        className={[
          'w-full rounded-lg border px-3 py-2 font-mono text-xs resize-y',
          'bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100',
          'placeholder-gray-400 dark:placeholder-gray-600',
          error
            ? 'border-red-400 dark:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-400'
            : 'border-gray-200 dark:border-gray-700 focus:outline-none focus:ring-1 focus:ring-emerald-400',
          disabled ? 'opacity-50 cursor-not-allowed' : '',
        ].join(' ')}
      />
      {error && (
        <p className="text-xs text-red-500 dark:text-red-400">{error}</p>
      )}
    </div>
  )
}
