// Loading the tracker state retries once on a server error or a dropped
// request: a save replacing db.json on Windows can make one read fail for a
// moment, and that should not put an error banner over a healthy workspace.
export async function fetchTrackerState(request: () => Promise<Response>, { retryDelayMs = 400 }: { retryDelayMs?: number } = {}): Promise<Response> {
  let response: Response;
  try { response = await request(); }
  catch {
    await new Promise(resolve => setTimeout(resolve, retryDelayMs));
    return request();
  }
  if (response.status < 500 || response.status === 503) return response;
  await new Promise(resolve => setTimeout(resolve, retryDelayMs));
  return request();
}

/** What the failed load said, for the local diagnostic log. */
export async function trackerStateFailure(response: Response) {
  const body = await response.clone().json().catch(() => null) as { error?: unknown; code?: unknown } | null;
  const detail = [typeof body?.code === 'string' ? body.code : null, typeof body?.error === 'string' ? body.error.slice(0, 300) : null].filter(Boolean).join(' · ');
  return `GET tracker state failed: HTTP ${response.status}${detail ? ` · ${detail}` : ''}`;
}
