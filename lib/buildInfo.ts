// Which build answered: the three website deployments and the desktop app all
// serve /api/health, and only these fields tell them apart.
export function buildInfo(env: Record<string, string | undefined> = process.env) {
  return {
    version: env.APP_VERSION || null,
    revision: env.APP_REVISION || 'development',
    surface: env.CLOUDFLARE_WORKER === 'true' ? 'website' as const : env.APP_DESKTOP === 'true' ? 'desktop' as const : 'server' as const,
  };
}
