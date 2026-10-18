// Custom fetch wrapper to safely handle authentication headers and intercept errors
export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === 'string' ? input : (input instanceof URL ? input.toString() : input.url);
  
  // Clone or initialize options
  const options: RequestInit = { ...init };
  
  // Inject authorization header if calling local API
  if (url.includes('/api/')) {
    const key = localStorage.getItem('team_tracker_key');
    if (key) {
      const headers = new Headers(options.headers || {});
      headers.set('Authorization', `Bearer ${key}`);
      options.headers = headers;
    }
  }

  let response = await fetch(input, options);

  // The installed desktop owns a local credential and can renew its short-lived
  // session without interrupting capture or asking the coach to sign in again.
  if (response.status === 401 && !url.includes('/api/login-key') && window.moeDesktop) {
    try {
      const session = await window.moeDesktop.bootstrapSession(true);
      localStorage.setItem('team_tracker_key', session.key);
      localStorage.setItem('team_tracker_role', session.role);
      localStorage.setItem('team_tracker_username', session.username);
      const retryOptions: RequestInit = { ...options, headers: new Headers(options.headers || {}) };
      (retryOptions.headers as Headers).set('Authorization', `Bearer ${session.key}`);
      response = await fetch(input, retryOptions);
    } catch {
      // The normal 401 handling below will return the desktop to a recoverable state.
    }
  }

  // If unauthorized (excluding login endpoint itself), clear session and force reload to login
  if (response.status === 401 && !url.includes('/api/login-key')) {
    localStorage.removeItem('team_tracker_key');
    localStorage.removeItem('team_tracker_role');
    localStorage.removeItem('team_tracker_username');
    // Reload the page so the App transitions cleanly to the Login state
    window.location.reload();
  }

  return response;
}
