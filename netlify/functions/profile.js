import { connectLambda, getStore } from "@netlify/blobs";
import { requireSession, unauthorized } from "./_session.js";

const MAX_NAME_LEN = 30;
const MAX_ENTRIES = 5000;

function sanitizeName(name) {
  return String(name || "").trim().slice(0, MAX_NAME_LEN);
}

export const handler = async (event) => {
  connectLambda(event);
  const store = getStore("pace");

  const session = await requireSession(store, event);
  if (!session) return unauthorized();
  if (session.isAdmin) {
    // Admin sessions aren't tied to a person and have no personal data of
    // their own — they use /profiles to see everyone, not this endpoint.
    return unauthorized("Admin sessions can't read or write personal profile data");
  }
  const sessionName = session.name;

  if (event.httpMethod === "GET") {
    const name = sanitizeName(event.queryStringParameters && event.queryStringParameters.name);
    if (!name) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing name" }) };
    }
    if (name.toLowerCase() !== sessionName.toLowerCase()) {
      return unauthorized("You can only view your own profile data");
    }
    const record = (await store.get(`data:${name}`, { type: "json" })) || { goal: null, entries: [], private: false };
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      body: JSON.stringify(record),
    };
  }

  if (event.httpMethod === "POST") {
    let payload;
    try {
      payload = JSON.parse(event.body || "{}");
    } catch (e) {
      return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON" }) };
    }

    const name = sanitizeName(payload.name);
    if (!name) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing name" }) };
    }
    if (name.toLowerCase() !== sessionName.toLowerCase()) {
      return unauthorized("You can only edit your own profile data");
    }

    const incoming = payload.data || {};
    const g = incoming.goal;
    const goal =
      g && typeof g === "object" && g.start && g.end && g.dailyTarget
        ? {
            totalHours: Number(g.totalHours) || 0,
            dailyTarget: Number(g.dailyTarget) || 0,
            start: String(g.start),
            end: String(g.end),
          }
        : null;

    const entries = Array.isArray(incoming.entries)
      ? incoming.entries
          .slice(0, MAX_ENTRIES)
          .map((e) => ({ date: String(e.date || ""), hours: Number(e.hours) || 0 }))
          .filter((e) => e.date)
      : [];

    const isPrivate = Boolean(incoming.private);

    await store.setJSON(`data:${name}`, { goal, entries, private: isPrivate });

    const list = (await store.get("list", { type: "json" })) || [];
    if (!list.includes(name)) {
      list.push(name);
      await store.setJSON("list", list);
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      body: JSON.stringify({ ok: true }),
    };
  }

  return { statusCode: 405, body: "Method not allowed" };
};
