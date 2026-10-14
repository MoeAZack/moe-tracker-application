export async function reportDesktopDiagnostic(action: string, error: unknown): Promise<string | null> {
  if (!window.moeDesktop) return null;
  const message = error instanceof Error ? error.message : String(error || 'Unknown error');
  try { return (await window.moeDesktop.reportDiagnostic({ action, message })).code; } catch { return null; }
}
