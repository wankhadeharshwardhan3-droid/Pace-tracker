import { connectLambda, getStore } from "@netlify/blobs";
import { requireSession, unauthorized } from "./_session.js";

function json(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify(body),
  };
}

// Push subscriptions are tied to one person's account, the same way
// webauthnCredential is — both live on the `account:<name>` record so a
// signup/login flow never has to touch a second key for the common case.
export const handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  if (typeof connectLambda === "function") connectLambda(event);
  const store = getStore("pace");

  const session = await requireSession(store, event);
  if (!session) return unauthorized();
  if (session.isAdmin || !session.name) {
    // Admin isn't tied to a person and has no hours to be reminded about.
    return unauthorized("Admin sessions can't manage push subscriptions");
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (e) {
    return json(400, { error: "Invalid JSON" });
  }

  const action = payload.action; // "save" | "remove"
  const accountKey = `account:${session.name.toLowerCase()}`;
  const account = await store.get(accountKey, { type: "json" });
  if (!account) return unauthorized();

  if (action === "remove") {
    delete account.pushSubscription;
    await store.setJSON(accountKey, account);
    return json(200, { ok: true });
  }

  if (action === "save") {
    const sub = payload.subscription;
    if (!sub || !sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) {
      return json(400, { error: "Invalid push subscription" });
    }
    account.pushSubscription = {
      endpoint: sub.endpoint,
      keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
      savedAt: Date.now(),
    };
    await store.setJSON(accountKey, account);
    return json(200, { ok: true });
  }

  return json(400, { error: "Unknown action" });
};
