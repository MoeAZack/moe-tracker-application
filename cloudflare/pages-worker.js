// The one website address (owner decision, 2026-10-22). The older Pages and
// workers.dev addresses send page visits here but keep answering /api, because
// installed desktop apps sync to the address saved in their config.
export const CANONICAL_ORIGIN = "https://moezack.pages.dev";

const isApi = (pathname) => pathname === "/api" || pathname.startsWith("/api/");

/** A 301 to the canonical address for a page visit on a legacy address, else null. */
export function canonicalRedirect(request) {
  const url = new URL(request.url);
  const canonical = new URL(CANONICAL_ORIGIN);
  const host = url.hostname;
  // Only the Cloudflare-provided hosts move; local dev, custom domains and
  // the canonical project's own preview deployments are left alone.
  if (host === canonical.hostname || host.endsWith(`.${canonical.hostname}`)) return null;
  if (!host.endsWith(".pages.dev") && !host.endsWith(".workers.dev")) return null;
  if (isApi(url.pathname) || (request.method !== "GET" && request.method !== "HEAD")) return null;
  return Response.redirect(`${canonical.origin}${url.pathname}${url.search}`, 301);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (isApi(url.pathname)) {
      return env.API.fetch(request);
    }
    return canonicalRedirect(request) || env.ASSETS.fetch(request);
  },
};
