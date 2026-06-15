import { eq } from 'drizzle-orm'
import { parserFiles } from './schema.js'
import { BasePersistenceService } from './BasePersistenceService.js'

export type ParserFileRow = typeof parserFiles.$inferSelect

export interface CreateModuleInput {
  parserId: string
  path: string
  content?: string
}

export interface UpdateModuleInput {
  path?: string
  content?: string
}

export class ModulePersistenceService extends BasePersistenceService<
  ParserFileRow,
  CreateModuleInput,
  UpdateModuleInput
> {
  async create(input: CreateModuleInput): Promise<ParserFileRow> {
    const [row] = await this.db
      .insert(parserFiles)
      .values({ parserId: input.parserId, path: input.path, content: input.content ?? '' })
      .returning()
    return row
  }

  async findById(id: string): Promise<ParserFileRow | null> {
    const [row] = await this.db.select().from(parserFiles).where(eq(parserFiles.id, id))
    return row ?? null
  }

  async findByParserId(parserId: string): Promise<ParserFileRow[]> {
    return this.db.select().from(parserFiles).where(eq(parserFiles.parserId, parserId))
  }

  async update(id: string, input: UpdateModuleInput): Promise<ParserFileRow> {
    const patch: Record<string, unknown> = { updatedAt: new Date() }
    if (input.path !== undefined) patch.path = input.path
    if (input.content !== undefined) patch.content = input.content
    const [row] = await this.db
      .update(parserFiles)
      .set(patch)
      .where(eq(parserFiles.id, id))
      .returning()
    return row
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(parserFiles).where(eq(parserFiles.id, id))
  }
}
