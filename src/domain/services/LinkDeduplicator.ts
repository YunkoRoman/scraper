export class LinkDeduplicator {
  private seen = new Set<string>()

  constructor(private readonly enabled: boolean = true) {}

  filter(urls: string[]): string[] {
    if (!this.enabled) return urls
    const result: string[] = []
    for (const url of urls) {
      const normalized = this.normalize(url)
      if (!this.seen.has(normalized)) {
        this.seen.add(normalized)
        result.push(url)
      }
    }
    return result
  }

  private normalize(url: string): string {
    try {
      const parsed = new URL(url)
      parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/'
      parsed.searchParams.sort()
      return parsed.toString()
    } catch {
      return url
    }
  }
}
