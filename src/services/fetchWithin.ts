/**
 * A fetch that cannot wait for ever (2026-10-19).
 *
 * React Native's fetch sets no time limit: the request reaches iOS with a
 * timeout of 0 (XMLHttpRequest's default), which means NO idle timeout
 * once the connection is open, measured at more than two and a half
 * minutes still waiting on a server that accepted and never answered. A
 * reply lost on a weak or switching connection then left the rescue's
 * spinner up for good, with the coins already sent.
 *
 * `fetchWithin` aborts the request after `ms` and rejects, whether or not
 * the abort reaches the network layer, so the caller always gets an answer
 * or an error in time.
 */
export async function fetchWithin(url: string, init: RequestInit, ms: number): Promise<Response> {
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      ctrl?.abort();
      reject(new Error(`No answer from the server in ${Math.round(ms / 1000)}s`));
    }, ms);
  });
  // Two declarations of AbortSignal are in the program (React Native's
  // globals and Node's, through Jest's types) and TypeScript keeps whichever
  // it reads first, which depends on the order it meets the files (it
  // changed when the old engine's bridge left the repo, decided 2026-11-04):
  // the signal is React Native's own at run time, so it is typed as fetch's.
  const signal = ctrl?.signal as RequestInit['signal'];
  try {
    return await Promise.race([fetch(url, ctrl ? { ...init, signal } : init), late]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * How long a LIST from 21st Capital may take (decided 2026-10-19). The
 * limit covers the whole answer, its download included: React Native's
 * fetch (whatwg-fetch) resolves only on the request's load. A list can be
 * large: the co-sign list holds up to 200 requests, each with its signed
 * PSBT. Fifteen seconds would cut a slow mobile link short every time, so
 * a list that used to load in the end would never load. A minute still
 * ends a request that will never answer. The small reports sent after a
 * broadcast keep their 15 seconds.
 */
export const LIST_FETCH_MS = 60_000;
