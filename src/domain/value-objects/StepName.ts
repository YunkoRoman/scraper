export type StepName = string & { readonly __brand: 'StepName' }

export function stepName(value: string): StepName {
  if (!value.trim()) throw new Error('StepName cannot be empty')
  return value as StepName
}
