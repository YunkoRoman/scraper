import { lookup } from 'node:dns/promises'

const BLOCKED = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^::1$/,
  /^fc00:/i,
  /^fe80:/i,
]

function isBlockedAddress(addr: string): boolean {
  return BLOCKED.some((r) => r.test(addr))
}

export async function validatePublicUrl(url: string): Promise<string | null> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return 'Invalid URL format'
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return 'URL must use http or https scheme'
  }
  if (isBlockedAddress(parsed.hostname)) {
    return 'URL hostname resolves to a private address'
  }
  try {
    const addresses = await lookup(parsed.hostname, { all: true })
    if (addresses.some(({ address }) => isBlockedAddress(address))) {
      return 'URL hostname resolves to a private address'
    }
  } catch {
    // DNS failure — allow through; let the browser handle it
  }
  return null
}
