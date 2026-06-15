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
 * Generates a JS snippet defining solveCF(url, options?) for injection into step execution context.
 * Prepend to user step code before AsyncFunction construction.
 *
 * solveCF returns the full solution object: { response, cookies, screenshot, ... }
 * Supports all FlareSolverr/Byparr request.get options as the second argument.
 *
 * NOTE: `url` is user-controlled and causes the solver to make an outbound HTTP request.
 * Do not run FlareSolverr/Byparr on hosts with privileged access to internal services.
 */
export function makeSolveCFSnippet(flareSolverrUrl: string): string {
  validateFlareSolverrUrl(flareSolverrUrl)
  return `
const solveCF = async (url, options = {}) => {
  const __fsUrl = ${JSON.stringify(flareSolverrUrl)};
  if (!__fsUrl) throw new Error('solveCF: FLARESOLVERR_URL not configured — set it in .env or flareSolverrUrl in step settings');
  let __res;
  try {
    __res = await fetch(__fsUrl + '/v1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cmd: 'request.get', url, maxTimeout: 60000, ...options })
    });
  } catch (__e) {
    throw new Error('solveCF: cannot reach solver at ' + __fsUrl + ' — is it running? docker run -d -p 8191:8191 ghcr.io/flaresolverr/flaresolverr');
  }
  if (!__res.ok) throw new Error('solveCF: solver HTTP error ' + __res.status);
  const __data = await __res.json();
  if (typeof __data.solution?.response === 'string' && __data.solution.response.length > 10_000_000) {
    throw new Error('solveCF: response too large (> 10 MB)');
  }
  const __topStatus = String(__data.status ?? '');
  if (__topStatus !== 'ok' && !__topStatus.toLowerCase().includes('solved') && !(__data.message ?? '').toLowerCase().includes('solved')) throw new Error('solveCF: ' + (__data.message ?? 'solver returned non-ok status'));
  if (!__data.solution) throw new Error('solveCF: solver returned ok status but no solution object');
  return __data.solution;
};
`
}
