export type StepName = string & { readonly __brand: 'StepName' }

export function stepName(value: string): StepName {
  const trimmed = value.trim()
  if (!trimmed) throw new Error('StepName cannot be empty')
  return trimmed as StepName
}
