/**
 * Generates a JS snippet defining solveCF(url) for injection into step execution context.
 * Prepend to user step code before AsyncFunction construction.
 *
 * NOTE: `url` passed to solveCF() is user-controlled and causes FlareSolverr to make an
 * outbound HTTP request to that URL. Do not run FlareSolverr on hosts with privileged
 * access to internal services (same SSRF risk as page.goto()).
 */
export function makeSolveCFSnippet(flareSolverrUrl: string): string {
  return `
async function solveCF(url) {
  const __fsUrl = ${JSON.stringify(flareSolverrUrl)};
  if (!__fsUrl) throw new Error('solveCF: FLARESOLVERR_URL env var not set — start FlareSolverr and add it to .env');
  const __res = await fetch(__fsUrl + '/v1', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cmd: 'request.get', url, maxTimeout: 60000 })
  });
  if (!__res.ok) throw new Error('solveCF: FlareSolverr HTTP error ' + __res.status);
  const __data = await __res.json();
  if (__data.solution?.status !== 'ok') throw new Error('solveCF: ' + (__data.message ?? 'FlareSolverr returned non-ok status'));
  return __data.solution.response;
}
`
}
