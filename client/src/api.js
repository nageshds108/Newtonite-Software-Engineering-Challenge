const TOKEN_KEY = "opsdesk_token";
const API_BASE_URL = (import.meta.env.VITE_API_URL || "").replace(/\/+$/, "");

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (token) => localStorage.setItem(TOKEN_KEY, token);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

export async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body !== undefined) headers.set("Content-Type", "application/json");
  if (getToken()) headers.set("Authorization", `Bearer ${getToken()}`);
  const response = await fetch(`${API_BASE_URL}/api${path}`, { ...options, headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error || `Request failed (${response.status})`);
    error.status = response.status;
    error.currentVersion = body.currentVersion;
    throw error;
  }
  return body;
}

export const json = (value) => JSON.stringify(value);
