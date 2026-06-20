import { connectLambda, getStore } from "@netlify/blobs";
import { randomBytes } from "node:crypto";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import { requireSession, unauthorized } from "./_session.js";

const MAX_NAME_LEN = 30;
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days, matches auth.js
const CHALLENGE_TTL_MS = 1000 * 60 * 5; // 5 minutes — plenty for a biometric prompt

// "Relying Party" identity. rpID must match the domain the site is served
// from (no scheme, no port, no trailing slash) — Netlify sets URL/DEPLOY_PRIME_URL
// at runtime, so this derives it instead of hardcoding a domain.
function getRpIdAndOrigin(event) {
  const host =
    (event.headers && (event.headers.host || event.headers.Host)) || "localhost";
  const hostname = host.split(":")[0];
  const proto = hostname === "localhost" ? "http" : "https";
  return { rpID: hostname, origin: `${proto}://${host}` };
}

function sanitizeName(name) {
  return String(name || "").trim().slice(0, MAX_NAME_LEN);
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify(body),
  };
}

function newToken() {
  return randomBytes(32).toString("hex");
}

async function createSession(store, name) {
  const token = newToken();
  const expiresAt = Date.now() + SESSION_TTL_MS;
  await store.setJSON(`session:${token}`, { name, isAdmin: false, expiresAt });
  return token;
}

// Credential public keys come back from the library as Uint8Array, but
// Netlify Blobs JSON storage can't hold binary directly — store as base64url.
function bufToB64(buf) {
  return Buffer.from(buf).toString("base64url");
}
function b64ToBuf(str) {
  return new Uint8Array(Buffer.from(str, "base64url"));
}

export const handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  if (typeof connectLambda === 'function') connectLambda(event);
  const store = getStore("pace");
  const { rpID, origin } = getRpIdAndOrigin(event);

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (e) {
    return json(400, { error: "Invalid JSON" });
  }

  const action = payload.action;
  // "reg-options" | "reg-verify" | "auth-options" | "auth-verify" | "remove"

  // ---- Registration: attaching Face ID / Touch ID / fingerprint to an
  // already-logged-in account. Requires a normal PIN-authenticated session,
  // so this can't be used to silently attach a passkey to someone else's account.
  if (action === "reg-options" || action === "reg-verify" || action === "remove") {
    const session = await requireSession(store, event);
    if (!session || session.isAdmin || !session.name) {
      return unauthorized("Log in with your PIN first to set this up");
    }
    const name = session.name;
    const accountKey = `account:${name.toLowerCase()}`;
    const account = await store.get(accountKey, { type: "json" });
    if (!account) return unauthorized();

    if (action === "remove") {
      delete account.webauthnCredential;
      await store.setJSON(accountKey, account);
      return json(200, { ok: true });
    }

    if (action === "reg-options") {
      const options = await generateRegistrationOptions({
        rpName: "Pace",
        rpID,
        userName: name,
        userDisplayName: name,
        attestationType: "none",
        // Don't let someone register the same authenticator twice
        excludeCredentials: account.webauthnCredential
          ? [{ id: account.webauthnCredential.id, transports: account.webauthnCredential.transports }]
          : [],
        authenticatorSelection: {
          // 'platform' = the device's built-in authenticator (Face ID / Touch
          // ID / Windows Hello / Android fingerprint) rather than a separate
          // security key, matching "fingerprint or Face ID" specifically.
          authenticatorAttachment: "platform",
          residentKey: "preferred",
          userVerification: "required",
        },
      });
      await store.setJSON(`webauthn-challenge:${name.toLowerCase()}`, {
        challenge: options.challenge,
        expiresAt: Date.now() + CHALLENGE_TTL_MS,
      });
      return json(200, options);
    }

    // reg-verify
    const challengeRecord = await store.get(`webauthn-challenge:${name.toLowerCase()}`, { type: "json" });
    if (!challengeRecord || Date.now() > challengeRecord.expiresAt) {
      return json(400, { error: "That registration attempt expired. Try again." });
    }
    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: payload.response,
        expectedChallenge: challengeRecord.challenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
      });
    } catch (e) {
      return json(400, { error: "Could not verify that device. Try again." });
    }
    if (!verification.verified || !verification.registrationInfo) {
      return json(400, { error: "Could not verify that device." });
    }
    const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
    account.webauthnCredential = {
      id: credential.id,
      publicKey: bufToB64(credential.publicKey),
      counter: credential.counter,
      transports: credential.transports || [],
      deviceType: credentialDeviceType,
      backedUp: credentialBackedUp,
      createdAt: Date.now(),
    };
    await store.setJSON(accountKey, account);
    await store.delete(`webauthn-challenge:${name.toLowerCase()}`).catch(() => {});
    return json(200, { ok: true });
  }

  // ---- Authentication: logging in with Face ID / Touch ID / fingerprint
  // instead of typing the PIN.
  if (action === "auth-options") {
    const name = sanitizeName(payload.name);
    if (!name) return json(400, { error: "Missing name" });
    const accountKey = `account:${name.toLowerCase()}`;
    const account = await store.get(accountKey, { type: "json" });
    if (!account || !account.webauthnCredential) {
      // Deliberately vague — don't reveal whether the account exists or
      // just lacks a passkey, same caution as a wrong-PIN message.
      return json(404, { error: "No biometric login set up for that name on this device" });
    }
    const options = await generateAuthenticationOptions({
      rpID,
      allowCredentials: [
        { id: account.webauthnCredential.id, transports: account.webauthnCredential.transports },
      ],
      userVerification: "required",
    });
    await store.setJSON(`webauthn-challenge:${name.toLowerCase()}`, {
      challenge: options.challenge,
      expiresAt: Date.now() + CHALLENGE_TTL_MS,
    });
    return json(200, options);
  }

  if (action === "auth-verify") {
    const name = sanitizeName(payload.name);
    if (!name) return json(400, { error: "Missing name" });
    const accountKey = `account:${name.toLowerCase()}`;
    const account = await store.get(accountKey, { type: "json" });
    if (!account || !account.webauthnCredential) {
      return json(404, { error: "No biometric login set up for that name on this device" });
    }
    const challengeRecord = await store.get(`webauthn-challenge:${name.toLowerCase()}`, { type: "json" });
    if (!challengeRecord || Date.now() > challengeRecord.expiresAt) {
      return json(400, { error: "That login attempt expired. Try again." });
    }
    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response: payload.response,
        expectedChallenge: challengeRecord.challenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        credential: {
          id: account.webauthnCredential.id,
          publicKey: b64ToBuf(account.webauthnCredential.publicKey),
          counter: account.webauthnCredential.counter,
          transports: account.webauthnCredential.transports,
        },
      });
    } catch (e) {
      return json(401, { error: "Could not verify — try your PIN instead." });
    }
    if (!verification.verified) {
      return json(401, { error: "Could not verify — try your PIN instead." });
    }
    account.webauthnCredential.counter = verification.authenticationInfo.newCounter;
    await store.setJSON(accountKey, account);
    await store.delete(`webauthn-challenge:${name.toLowerCase()}`).catch(() => {});

    const token = await createSession(store, account.name);
    return json(200, { ok: true, name: account.name, token });
  }

  // ---- Lets the gate quietly check "does this name have biometric login set
  // up at all" before showing the option, without needing a session.
  if (action === "has-credential") {
    const name = sanitizeName(payload.name);
    if (!name) return json(400, { error: "Missing name" });
    const account = await store.get(`account:${name.toLowerCase()}`, { type: "json" });
    return json(200, { hasCredential: Boolean(account && account.webauthnCredential) });
  }

  return json(400, { error: "Unknown action" });
};
