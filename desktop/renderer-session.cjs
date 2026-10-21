// The local coach JWT stays in the main process. The renderer only learns who
// is signed in; the main process adds the bearer token to the renderer's own
// API requests on the way out, so script running in the page never sees it.

function publicSession(session) {
  return { success: session?.success !== false, role: String(session?.role || ''), username: String(session?.username || ''), expiresAt: session?.expiresAt || null };
}

function apiRequestFilter(port) {
  return { urls: [`http://127.0.0.1:${port}/api/*`] };
}

function headerName(headers, name) {
  return Object.keys(headers || {}).find(key => key.toLowerCase() === name);
}

/**
 * Returns an onBeforeSendHeaders listener. A request from the trusted window to
 * the local API gets `Authorization: Bearer <main-process session>` unless the
 * page already supplied its own credential (a coach who signed in by hand).
 * Login requests and every other page or origin are passed through untouched.
 */
function createSessionHeaderInjector({ port, getSession, isTrustedWebContents = () => true }) {
  const origin = `http://127.0.0.1:${port}`;
  return (details, callback) => {
    const requestHeaders = { ...(details.requestHeaders || {}) };
    let target;
    try { target = new URL(details.url); } catch { return callback({ requestHeaders }); }
    const local = target.origin === origin && (target.pathname === '/api' || target.pathname.startsWith('/api/'));
    if (!local || target.pathname === '/api/login-key' || !isTrustedWebContents(details.webContentsId) || headerName(requestHeaders, 'authorization')) return callback({ requestHeaders });
    Promise.resolve().then(getSession).then(session => {
      if (session?.key) requestHeaders.Authorization = `Bearer ${session.key}`;
      callback({ requestHeaders });
    }, () => callback({ requestHeaders }));
  };
}

module.exports = { publicSession, apiRequestFilter, createSessionHeaderInjector };
