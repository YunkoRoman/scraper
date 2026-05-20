// client/src/components/JsonEditor.tsx
import { useRef, useEffect } from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import { useSettings } from '../hooks/useSettings'

interface Props {
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
  placeholder?: string
  disabled?: boolean
  rows?: number
}

export function JsonEditor({ value, onChange, onBlur, disabled, rows = 5 }: Props) {
  const { settings } = useSettings()
  const monacoTheme = settings.theme === 'dark' || (settings.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'vs-dark' : 'light'
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null)
  const onBlurRef = useRef(onBlur)
  useEffect(() => { onBlurRef.current = onBlur }, [onBlur])
  const height = rows * 19 + 12

  function handleMount(editor: Parameters<OnMount>[0]) {
    editorRef.current = editor
    editor.onDidBlurEditorText(() => onBlurRef.current?.())
  }

  function handleFormat() {
    editorRef.current?.getAction('editor.action.formatDocument')?.run()
  }

  return (
    <div className="relative rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
      <Editor
        height={height}
        language="json"
        theme={monacoTheme}
        value={value}
        onChange={(v) => onChange(v ?? '')}
        onMount={handleMount}
        options={{
          minimap: { enabled: false },
          fontSize: 12,
          lineNumbers: 'off',
          glyphMargin: false,
          folding: false,
          lineDecorationsWidth: 4,
          scrollBeyondLastLine: false,
          wordWrap: 'on',
          tabSize: 2,
          readOnly: disabled,
          overviewRulerLanes: 0,
          renderLineHighlight: 'none',
          scrollbar: { vertical: 'auto', horizontal: 'hidden' },
        }}
      />
      {value.trim() && (
        <button
          type="button"
          onClick={handleFormat}
          disabled={disabled}
          className="absolute top-1.5 right-3 z-10 text-xs px-1.5 py-0.5 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          Format
        </button>
      )}
    </div>
  )
}
