// Shared session helper used by profile.js and profiles.js.
// Netlify bundles relative imports automatically, so this file ships
// alongside the functions that import it.

export function getBearerToken(event) {
  const header =
    (event.headers && (event.headers.authorization || event.headers.Authorization)) || "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1] : null;
}

// Returns the full session record { name, isAdmin } for a valid,
// non-expired token, or null. `name` is null for admin sessions (admin
// isn't tied to any one person's account).
export async function requireSession(store, event) {
  const token = getBearerToken(event);
  if (!token) return null;
  const session = await store.get(`session:${token}`, { type: "json" });
  if (!session) return null;
  if (!session.expiresAt || Date.now() > session.expiresAt) {
    // expired — best-effort cleanup, don't block on it
    store.delete(`session:${token}`).catch(() => {});
    return null;
  }
  return session;
}

export function unauthorized(message) {
  return {
    statusCode: 401,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify({ error: message || "Not signed in" }),
  };
}
