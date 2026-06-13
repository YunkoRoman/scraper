/**
 * Validates that FLARESOLVERR_URL is a well-formed http/https URL.
 * Throws a clear error if the URL is invalid, uses file://, or is empty (feature disabled).
 */
export function validateFlareSolverrUrl(url: string): void {
  if (!url) return // empty = feature disabled, error thrown at call time
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error(`FLARESOLVERR_URL is not a valid URL: "${url}"`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`FLARESOLVERR_URL must use http or https, got: "${parsed.protocol}"`)
  }
}

/**
 * Generates a JS snippet defining solveCF(url) for injection into step execution context.
 * Prepend to user step code before AsyncFunction construction.
 *
 * NOTE: `url` passed to solveCF() is user-controlled and causes FlareSolverr to make an
 * outbound HTTP request to that URL. Do not run FlareSolverr on hosts with privileged
 * access to internal services (same SSRF risk as page.goto()).
 */
export function makeSolveCFSnippet(flareSolverrUrl: string): string {
  validateFlareSolverrUrl(flareSolverrUrl)
  return `
const solveCF = async (url) => {
  const __fsUrl = ${JSON.stringify(flareSolverrUrl)};
  if (!__fsUrl) throw new Error('solveCF: FLARESOLVERR_URL env var not set — start FlareSolverr and add it to .env');
  let __res;
  try {
    __res = await fetch(__fsUrl + '/v1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cmd: 'request.get', url, maxTimeout: 60000 })
    });
  } catch (__e) {
    throw new Error('solveCF: cannot reach FlareSolverr at ' + __fsUrl + ' — is it running? docker run -d -p 8191:8191 ghcr.io/flaresolverr/flaresolverr');
  }
  if (!__res.ok) throw new Error('solveCF: FlareSolverr HTTP error ' + __res.status);
  const __data = await __res.json();
  if (typeof __data.solution?.response === 'string' && __data.solution.response.length > 10_000_000) {
    throw new Error('solveCF: response too large (> 10 MB)');
  }
  if (__data.solution?.status !== 'ok') throw new Error('solveCF: ' + (__data.message ?? 'FlareSolverr returned non-ok status'));
  return __data.solution.response;
};
`
}
