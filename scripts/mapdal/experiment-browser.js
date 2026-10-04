/** Server-acknowledged arms only. Import on an explicitly consented storefront page. */
export function createExperiment({csrfToken, render, fetchImpl = globalThis.fetch, wait = ms => new Promise(resolve => setTimeout(resolve, ms))}) {
  if (typeof csrfToken !== 'string' || csrfToken.length < 24 || typeof render !== 'function') throw new Error('Session CSRF and renderer required');
  let withdrawn = false, running = null, generation = 0, renderController = null;
  async function request(action) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetchImpl('/collective/experiment/', {method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: controller.signal,
        headers: {'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken}, body: JSON.stringify({action})});
      const value = await response.json();
      if (![200, 202].includes(response.status) || !value || Object.keys(value).some(k => !['status', 'arm'].includes(k))) throw new Error('Measurement unavailable');
      return value;
    } finally { clearTimeout(timer); }
  }
  async function measure() {
    const current = generation;
    try {
      for (let attempt = 0; attempt < 6; attempt++) {
        if (withdrawn || current !== generation) return {status: 'withdrawn'};
        const result = await request('assign');
        if (withdrawn || current !== generation) return {status: 'withdrawn'};
        if (result.status === 'pending' && result.arm === null) {
          if (attempt < 5) await wait(500);
          continue;
        }
        if (result.status !== 'assigned' || !['control', 'treatment'].includes(result.arm)) throw new Error('Invalid assignment');
        renderController = new AbortController();
        await render(result.arm, {signal: renderController.signal});
        if (withdrawn || current !== generation) return {status: 'withdrawn'};
        const exposure = await request('exposure');
        if (exposure.status !== 'queued' || exposure.arm !== null) throw new Error('Exposure unavailable');
        return withdrawn ? {status: 'withdrawn'} : {status: 'exposed', arm: result.arm};
      }
      return {status: 'pending'};
    } catch { return {status: withdrawn ? 'withdrawn' : 'unavailable'}; }
  }
  return {
    start() {
      if (withdrawn) return Promise.resolve({status: 'withdrawn'});
      if (!running) running = measure().finally(() => { running = null; });
      return running;
    },
    async withdraw() {
      withdrawn = true; generation++; renderController?.abort();
      try {
        const result = await request('withdraw');
        return {status: result.status === 'withdrawn' && result.arm === null ? 'withdrawn' : 'withdrawal_pending'};
      } catch { return {status: 'withdrawal_pending'}; }
    }
  };
}
