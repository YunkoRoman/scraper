// client/src/hooks/useParserEditor.ts
import { useState, useEffect, useCallback, useRef } from 'react'
import {
  getParser, updateParser, createStep, updateStep, deleteStep,
  type ParserRow, type StepRow,
} from '../api'

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

export function useParserEditor(parserName: string) {
  const [parser, setParser] = useState<ParserRow | null>(null)
  const [steps, setSteps] = useState<StepRow[]>([])
  const [selectedStepName, setSelectedStepName] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const selectedStep = steps.find((s) => s.name === selectedStepName) ?? null

  useEffect(() => {
    if (!parserName) return
    setLoading(true)
    setError(null)
    getParser(parserName)
      .then(({ parser: p, steps: ss }) => {
        setParser(p)
        setSteps(ss)
        if (ss.length > 0) {
          setSelectedStepName(ss[0].name)
          setCode(ss[0].code)
        }
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [parserName])

  const selectStep = useCallback((name: string) => {
    const s = steps.find((st) => st.name === name)
    if (!s) return
    setSelectedStepName(name)
    setCode(s.code)
    setSaveStatus('idle')
  }, [steps])

  const handleCodeChange = useCallback((newCode: string) => {
    setCode(newCode)
    setSaveStatus('idle')
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      if (!parserName || !selectedStepName) return
      setSaveStatus('saving')
      try {
        const updated = await updateStep(parserName, selectedStepName, { code: newCode })
        setSteps((prev) => prev.map((s) => s.name === selectedStepName ? updated : s))
        setSaveStatus('saved')
      } catch {
        setSaveStatus('error')
      }
    }, 1000)
  }, [parserName, selectedStepName])

  const saveNow = useCallback(async () => {
    if (!parserName || !selectedStepName) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    setSaveStatus('saving')
    try {
      const updated = await updateStep(parserName, selectedStepName, { code })
      setSteps((prev) => prev.map((s) => s.name === selectedStepName ? updated : s))
      setSaveStatus('saved')
    } catch {
      setSaveStatus('error')
    }
  }, [parserName, selectedStepName, code])

  const addStep = useCallback(async (name: string, type: 'traverser' | 'extractor') => {
    if (!parserName) return
    const created = await createStep(parserName, { name, type })
    setSteps((prev) => [...prev, created])
    setSelectedStepName(created.name)
    setCode(created.code)
    setSaveStatus('idle')
  }, [parserName])

  const removeStep = useCallback(async (name: string) => {
    if (!parserName) return
    await deleteStep(parserName, name)
    setSteps((prev) => {
      const next = prev.filter((s) => s.name !== name)
      if (selectedStepName === name) {
        setSelectedStepName(next[0]?.name ?? null)
        setCode(next[0]?.code ?? '')
      }
      return next
    })
  }, [parserName, selectedStepName])

  const saveParserSettings = useCallback(async (input: Partial<ParserRow>) => {
    if (!parserName) return
    const updated = await updateParser(parserName, input)
    setParser(updated)
  }, [parserName])

  return {
    parser, steps, selectedStep, selectedStepName, code,
    saveStatus, loading, error,
    selectStep, handleCodeChange, saveNow, addStep, removeStep, saveParserSettings,
  }
}
