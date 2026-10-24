// Production uses the website's authenticated, same-origin backend gateway.
const endpoint = () => (isLocalPage() ? 'http://127.0.0.1:8765' : '/api/tryon');
export function isLocalPage() {
  return ['localhost', '127.0.0.1'].includes(window.location.hostname);
}
async function request(path: string, init?: RequestInit) {
  let response: Response;
  try {
    response = await fetch(endpoint() + path, {
      ...init,
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new Error(
      isLocalPage()
        ? 'Local service is unavailable. Run npm run local in the tryon folder and reconnect.'
        : 'The try-on service is unavailable. Please retry shortly.',
    );
  }
  if (!response.ok) {
    const error = (await response.json().catch(() => ({}))) as {
      detail?: string;
    };
    throw new Error(
      error.detail || `Try-on service error (${response.status}).`,
    );
  }
  return response;
}
export async function localStatus() {
  return (await request('/status')).json() as Promise<{
    model_ready: boolean;
    model: string;
  }>;
}
export async function createLocalJob(data: FormData) {
  return (
    await request('/jobs', { method: 'POST', body: data })
  ).json() as Promise<{ id: string }>;
}
export async function cancelLocalJob(id: string) {
  await request(`/jobs/${id}/cancel`, { method: 'POST' });
}
export async function pollLocalJob(id: string, update: (text: string) => void) {
  const started = Date.now();
  while (Date.now() - started < 21 * 60 * 1000) {
    const job = (await (await request(`/jobs/${id}`)).json()) as {
      state: string;
      error?: string;
      progress?: { stage: string; step?: number; total?: number };
    };
    if (job.state === 'succeeded')
      return (await request(`/jobs/${id}/result`)).blob();
    if (job.state === 'failed')
      throw new Error(job.error || 'Generation failed.');
    if (job.state === 'cancelled') throw new Error('Generation cancelled.');
    const seconds = Math.floor((Date.now() - started) / 1000);
    const progress = job.progress;
    update(
      `${progress?.stage || 'Preparing try-on'}${progress?.step ? ` · ${progress.step}/${progress.total}` : ''} · ${seconds}s`,
    );
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error('Generation timed out. Please retry.');
}
