/**
 * Thin fetch wrapper that always includes credentials for cross-origin auth.
 * Use this instead of raw `fetch()` when calling backend API endpoints.
 */
export function authFetch(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, { credentials: "include", ...init });
}
