export class ProxyPoolService {
  private readonly pool: string[]
  private idx = 0

  constructor(input: string[]) {
    this.pool = (input ?? []).map((s) => s.trim()).filter(Boolean)
  }

  size(): number { return this.pool.length }

  next(): string | undefined {
    if (this.pool.length === 0) return undefined
    const v = this.pool[this.idx % this.pool.length]
    this.idx++
    return v
  }
}
