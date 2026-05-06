// client/src/hooks/useParserEditor.ts
import { useState, useEffect, useCallback, useRef } from 'react'
import {
  getParser, updateParser, createStep, updateStep, deleteStep,
  type ParserRow, type StepRow, type UpdateStepInput, type UpdateParserInput,
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
    // eslint-disable-next-line react-hooks/set-state-in-effect
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

  // Clear debounce timer on unmount to prevent setState-after-unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  const selectStep = useCallback((name: string) => {
    const s = steps.find((st) => st.name === name)
    if (!s) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    setSelectedStepName(name)
    setCode(s.code)
    setSaveStatus('idle')
  }, [steps])

  const handleCodeChange = useCallback((newCode: string) => {
    setCode(newCode)
    setSaveStatus('idle')
    if (debounceRef.current) clearTimeout(debounceRef.current)
    // Capture selectedStepName at schedule time so the timeout uses the correct step
    const capturedStepName = selectedStepName
    debounceRef.current = setTimeout(async () => {
      if (!parserName || !capturedStepName) return
      setSaveStatus('saving')
      try {
        const updated = await updateStep(parserName, capturedStepName, { code: newCode })
        setSteps((prev) => prev.map((s) => s.name === capturedStepName ? updated : s))
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

  // templateCode is saved immediately to DB so state stays consistent regardless of
  // when React batches the selectedStepName update
  const addStep = useCallback(async (name: string, type: 'traverser' | 'extractor', templateCode?: string) => {
    if (!parserName) return
    try {
      const created = await createStep(parserName, { name, type })
      let stepWithCode = created
      if (templateCode) {
        const saved = await updateStep(parserName, name, { code: templateCode })
        stepWithCode = saved
      }
      setSteps((prev) => [...prev, stepWithCode])
      setSelectedStepName(stepWithCode.name)
      setCode(stepWithCode.code)
      setSaveStatus(templateCode ? 'saved' : 'idle')
    } catch (e) {
      setError((e as Error).message)
    }
  }, [parserName])

  const removeStep = useCallback(async (name: string) => {
    if (!parserName) return
    try {
      await deleteStep(parserName, name)
      // Compute next selection outside the updater (avoids side-effects in pure updater)
      const next = steps.filter((s) => s.name !== name)
      setSteps(next)
      if (selectedStepName === name) {
        setSelectedStepName(next[0]?.name ?? null)
        setCode(next[0]?.code ?? '')
      }
    } catch (e) {
      setError((e as Error).message)
    }
  }, [parserName, selectedStepName, steps])

  const saveStepMeta = useCallback(async (stepName: string, input: UpdateStepInput) => {
    if (!parserName) return
    try {
      const updated = await updateStep(parserName, stepName, input)
      setSteps((prev) => prev.map((s) => s.name === stepName ? updated : s))
    } catch (e) {
      setError((e as Error).message)
    }
  }, [parserName])

  const saveParserSettings = useCallback(async (input: UpdateParserInput) => {
    if (!parserName) return
    try {
      const updated = await updateParser(parserName, input)
      setParser(updated)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [parserName])

  return {
    parser, steps, selectedStep, selectedStepName, code,
    saveStatus, loading, error,
    selectStep, handleCodeChange, saveNow, addStep, removeStep, saveParserSettings, saveStepMeta,
  }
}
