// On Windows a file that another handle has open (a save replacing db.json,
// an antivirus scan, the backup copier) briefly fails reads and renames with
// EPERM, EACCES or EBUSY. Those clear within milliseconds, so retry them a few
// times with a short backoff; every other error is thrown at once.
const TRANSIENT_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);

export function isTransientFileLock(error: unknown) {
  return TRANSIENT_CODES.has((error as { code?: string } | null)?.code || '');
}

export async function retryTransientFileLock<T>(operation: () => Promise<T>, { attempts = 6, delayMs = 25 }: { attempts?: number; delayMs?: number } = {}): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try { return await operation(); }
    catch (error) {
      if (attempt >= attempts || !isTransientFileLock(error)) throw error;
      await new Promise(resolve => setTimeout(resolve, delayMs * 2 ** (attempt - 1)));
    }
  }
}
