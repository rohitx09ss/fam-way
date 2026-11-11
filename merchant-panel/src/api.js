// Network + session helpers with no CSS side effects (used by the login page and by core.js).
export const API = (import.meta.env.VITE_API_URL || "http://localhost:8000").replace(/\/$/, "");
export const BRAND = import.meta.env.VITE_BRAND_NAME || "FAMWAY";
const TK = "pg_token", UK = "pg_user";

// "Keep me signed in" -> localStorage; otherwise the session ends when the browser tab closes.
const read = (k) => sessionStorage.getItem(k) ?? localStorage.getItem(k);
export const getToken = () => read(TK);
export const getUser = () => { try { return JSON.parse(read(UK)) || {}; } catch { return {}; } };
export function setSession(token, user, remember) {
  const useLocal = remember ?? localStorage.getItem(TK) !== null;
  const keep = useLocal ? localStorage : sessionStorage, drop = useLocal ? sessionStorage : localStorage;
  drop.removeItem(TK); drop.removeItem(UK);
  keep.setItem(TK, token); keep.setItem(UK, JSON.stringify(user || {}));
}
export function logout() {
  for (const s of [localStorage, sessionStorage]) { s.removeItem(TK); s.removeItem(UK); }
  location.href = "/login.html";
}

export async function api(path, { method = "GET", body, auth = true } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (auth && getToken()) headers.Authorization = `Bearer ${getToken()}`;
  let res;
  try {
    res = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw new Error("Cannot reach the server. It may be waking up, try again in 30 seconds.");
  }
  if (auth && (res.status === 401 || res.status === 403)) { logout(); throw new Error("Session expired"); }
  let data = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) throw new Error(typeof data?.detail === "string" ? data.detail : data?.detail?.[0]?.msg || res.statusText || "Request failed");
  return data;
}
