import { db } from './client.js'

export abstract class BasePersistenceService<TRow, TCreateInput, TUpdateInput> {
  protected readonly db = db

  protected isDuplicateKeyError(err: unknown): boolean {
    return (err as { code?: string }).code === '23505'
  }

  abstract create(input: TCreateInput): Promise<TRow>
  abstract findById(id: string): Promise<TRow | null>
  abstract update(id: string, input: TUpdateInput): Promise<TRow>
  abstract delete(id: string): Promise<void>
}
