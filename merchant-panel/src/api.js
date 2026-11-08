const BASE = (import.meta.env.VITE_API_URL || "http://localhost:8000").replace(/\/$/, "");

export async function api(path, { method = "GET", body, token } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = res.statusText || "Request failed";
    try {
      const j = await res.json();
      msg = typeof j.detail === "string" ? j.detail : j.detail?.[0]?.msg || msg;
    } catch {}
    const e = new Error(msg);
    e.status = res.status;
    throw e;
  }
  return res.json();
}
