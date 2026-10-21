import { useEffect, useState } from 'react';
import { apiFetch } from './api';

// Cloud AI (Gemini) runs only when the server holds a key. On the website the
// routes answer 410 and the key is never present, so the same check covers both.
export const CLOUD_AI_OFF_MESSAGE = 'Cloud AI is off. Add a Gemini API key in Settings on the desktop app to use this feature.';

export function cloudAiConfigured(status: unknown): boolean {
  return (status as any)?.gemini?.configured === true;
}

// A cloud AI action is blocked while availability is unknown (null) or off,
// and whenever the caller is busy or missing input.
export function cloudAiActionBlocked(available: boolean | null, busyOrMissingInput: boolean): boolean {
  return busyOrMissingInput || available !== true;
}

// null while the status loads; false when the status cannot be read.
export function useCloudAiAvailable(): boolean | null {
  const [available, setAvailable] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    apiFetch('/api/integrations-status')
      .then(async response => (response.ok ? response.json() : null))
      .then(status => { if (alive) setAvailable(cloudAiConfigured(status)); })
      .catch(() => { if (alive) setAvailable(false); });
    return () => { alive = false; };
  }, []);
  return available;
}

export async function cloudAiErrorMessage(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => ({}));
  if (response.status === 410 || response.status === 503) return CLOUD_AI_OFF_MESSAGE;
  return typeof body?.error === 'string' && body.error ? body.error : fallback;
}
