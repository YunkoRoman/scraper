// client/src/hooks/useParserEditor.ts
import { useState, useEffect, useCallback, useRef } from 'react'
import {
  getParser,
  updateParser,
  createStep,
  updateStep,
  deleteStep,
  listModules,
  createModule,
  getModule,
  updateModule,
  deleteModule,
  createStepVersion,
  listStepVersions,
  type ParserRow,
  type StepRow,
  type UpdateStepInput,
  type UpdateParserInput,
  type ParserFileRow,
} from '../api'

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error' | 'versioned' | 'unchanged'

export function useParserEditor(parserId: string) {
  const [parser, setParser] = useState<ParserRow | null>(null)
  const [steps, setSteps] = useState<StepRow[]>([])
  const [selectedStepName, setSelectedStepName] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [modules, setModules] = useState<Array<Omit<ParserFileRow, 'content'>>>([])
  const [selectedModuleId, setSelectedModuleId] = useState<string | null>(null)
  const [activeItemType, setActiveItemType] = useState<'step' | 'module'>('step')
  const [latestVersionNumber, setLatestVersionNumber] = useState<number>(0)

  const selectedStep = steps.find((s) => s.name === selectedStepName) ?? null

  useEffect(() => {
    if (!parserId) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    setError(null)
    Promise.all([getParser(parserId), listModules(parserId)])
      .then(async ([{ parser: p, steps: ss }, ms]) => {
        setParser(p)
        setSteps(ss)
        setModules(ms)
        if (ss.length > 0) {
          setSelectedStepName(ss[0].name)
          setCode(ss[0].code)
          setActiveItemType('step')
          const versions = await listStepVersions(parserId, ss[0].name).catch(() => [])
          const maxNum = versions.reduce((m, v) => Math.max(m, v.versionNumber ?? 0), 0)
          setLatestVersionNumber(maxNum)
        }
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [parserId])

  // Clear debounce timer on unmount to prevent setState-after-unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  const selectStep = useCallback(
    (name: string) => {
      const s = steps.find((st) => st.name === name)
      if (!s) return
      if (debounceRef.current) clearTimeout(debounceRef.current)
      setActiveItemType('step')
      setSelectedModuleId(null)
      setSelectedStepName(name)
      setCode(s.code)
      setSaveStatus('idle')
      listStepVersions(parserId, name)
        .then((versions) => {
          const maxNum = versions.reduce((m, v) => Math.max(m, v.versionNumber ?? 0), 0)
          setLatestVersionNumber(maxNum)
        })
        .catch(() => {})
    },
    [steps, parserId],
  )

  const selectModule = useCallback(
    async (id: string) => {
      if (!parserId) return
      if (debounceRef.current) clearTimeout(debounceRef.current)
      setActiveItemType('module')
      setSelectedModuleId(id)
      setSaveStatus('idle')
      try {
        const m = await getModule(parserId, id)
        setCode(m.content)
      } catch (e) {
        setError((e as Error).message)
      }
    },
    [parserId],
  )

  const handleCodeChange = useCallback(
    (newCode: string) => {
      setCode(newCode)
      setSaveStatus('idle')
      if (debounceRef.current) clearTimeout(debounceRef.current)
      const capturedType = activeItemType
      const capturedStepName = selectedStepName
      const capturedModuleId = selectedModuleId
      debounceRef.current = setTimeout(async () => {
        if (!parserId) return
        setSaveStatus('saving')
        try {
          if (capturedType === 'module') {
            if (!capturedModuleId) return
            await updateModule(parserId, capturedModuleId, { content: newCode })
          } else {
            if (!capturedStepName) return
            const updated = await updateStep(parserId, capturedStepName, { code: newCode })
            setSteps((prev) => prev.map((s) => (s.name === capturedStepName ? updated : s)))
          }
          setSaveStatus('saved')
        } catch {
          setSaveStatus('error')
        }
      }, 1000)
    },
    [parserId, activeItemType, selectedStepName, selectedModuleId],
  )

  const saveNow = useCallback(async () => {
    if (!parserId || !selectedStepName) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    setSaveStatus('saving')
    try {
      const updated = await updateStep(parserId, selectedStepName, { code })
      setSteps((prev) => prev.map((s) => (s.name === selectedStepName ? updated : s)))
      setSaveStatus('saved')
    } catch {
      setSaveStatus('error')
    }
  }, [parserId, selectedStepName, code])

  const saveVersion = useCallback(async () => {
    if (!parserId || !selectedStepName) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    setSaveStatus('saving')
    try {
      const updated = await updateStep(parserId, selectedStepName, { code })
      setSteps((prev) => prev.map((s) => (s.name === selectedStepName ? updated : s)))
      const { version, unchanged } = await createStepVersion(parserId, selectedStepName)
      if (unchanged) {
        setSaveStatus('unchanged')
      } else {
        setLatestVersionNumber(version?.versionNumber ?? 0)
        setSaveStatus('versioned')
      }
    } catch {
      setSaveStatus('error')
    }
  }, [parserId, selectedStepName, code])

  // templateCode is saved immediately to DB so state stays consistent regardless of
  // when React batches the selectedStepName update
  const addStep = useCallback(
    async (name: string, type: 'traverser' | 'extractor', templateCode?: string) => {
      if (!parserId) return
      try {
        const created = await createStep(parserId, { name, type })
        let stepWithCode = created
        if (templateCode) {
          const saved = await updateStep(parserId, name, { code: templateCode })
          stepWithCode = saved
        }
        setSteps((prev) => [...prev, stepWithCode])
        setActiveItemType('step')
        setSelectedStepName(stepWithCode.name)
        setCode(stepWithCode.code)
        setSaveStatus(templateCode ? 'saved' : 'idle')
      } catch (e) {
        setError((e as Error).message)
      }
    },
    [parserId],
  )

  const removeStep = useCallback(
    async (name: string) => {
      if (!parserId) return
      try {
        await deleteStep(parserId, name)
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
    },
    [parserId, selectedStepName, steps],
  )

  const addModule = useCallback(
    async (path: string) => {
      if (!parserId) return
      try {
        const created = await createModule(parserId, { path, content: '' })
        const { content: _c, ...summary } = created
        setModules((prev) => [...prev, summary])
        setActiveItemType('module')
        setSelectedModuleId(created.id)
        setCode(created.content)
        setSaveStatus('idle')
      } catch (e) {
        setError((e as Error).message)
      }
    },
    [parserId],
  )

  const removeModule = useCallback(
    async (id: string) => {
      if (!parserId) return
      try {
        await deleteModule(parserId, id)
        const next = modules.filter((m) => m.id !== id)
        setModules(next)
        if (selectedModuleId === id) {
          setSelectedModuleId(null)
          setActiveItemType('step')
          setCode(selectedStep?.code ?? steps[0]?.code ?? '')
          setSelectedStepName(selectedStepName ?? steps[0]?.name ?? null)
        }
      } catch (e) {
        setError((e as Error).message)
      }
    },
    [parserId, modules, selectedModuleId, selectedStep, selectedStepName, steps],
  )

  const saveStepMeta = useCallback(
    async (stepName: string, input: UpdateStepInput) => {
      if (!parserId) return
      try {
        const updated = await updateStep(parserId, stepName, input)
        setSteps((prev) => prev.map((s) => (s.name === stepName ? updated : s)))
      } catch (e) {
        setError((e as Error).message)
      }
    },
    [parserId],
  )

  const saveParserSettings = useCallback(
    async (input: UpdateParserInput) => {
      if (!parserId) return
      try {
        const updated = await updateParser(parserId, input)
        setParser(updated)
      } catch (e) {
        setError((e as Error).message)
      }
    },
    [parserId],
  )

  return {
    parser,
    steps,
    selectedStep,
    selectedStepName,
    code,
    modules,
    selectedModuleId,
    activeItemType,
    saveStatus,
    latestVersionNumber,
    loading,
    error,
    selectStep,
    handleCodeChange,
    saveNow,
    saveVersion,
    addStep,
    removeStep,
    saveParserSettings,
    saveStepMeta,
    selectModule,
    addModule,
    removeModule,
  }
}
