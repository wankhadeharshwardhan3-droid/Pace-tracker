 # Pace — shared study tracker

Everyone sign s in with a name and a 4-digit PIN. Each person's hours are
private to them — only the person who created the account can view or edit
it. The "Everyone" tab shows summary stats (progress, balance) for all
signed-up people, visible to anyone who is logged in, so progress is still
visible across the group without exposing anyone's PIN or letting people edit
each other's data. A "Log out" button in the header lets anyone end their
session on the current device.

An optional **admin passcode** (set by you, see Deploy below) lets whoever
has it log in via "Log in as admin" on the sign-in screen and see everyone's
real numbers in the Everyone tab — including people who've turned on "Hide
my progress." Admin entries are shown with a "Hidden from others" badge so
the admin can tell who has chosen to be private. Admin login has no
personal data of its own, so it only ever shows the Everyone view.

Anyone can also set up **Face ID / Touch ID / fingerprint login** on their
own dashboard ("Use Face ID / fingerprint on this device"). Once set up,
that device shows a one-tap biometric login on the sign-in screen instead of
the PIN form. This uses WebAuthn (the same standard behind passkeys) — the
actual fingerprint or face scan never leaves the device or reaches the
server; the server only ever sees a cryptographic signature proving it's the
same device that registered. The PIN still works as a fallback (new
devices, browsers without biometric support, or if biometrics are removed),
since there's no email/SMS recovery if a device-only credential were ever
the *only* way in.

Anyone can also turn on **daily reminders** ("Daily reminders" toggle on
their dashboard). Once enabled, a notification arrives once a day if that
person hasn't logged any hours yet — or a quick "nice work" if they have.
This works even with the app closed, as long as it's been opened and
enabled at least once. On iPhone, this only works if the app was added to
the Home Screen first (Safari does not support push notifications for a
site open only in a browser tab).

## Deploy (free, ~2 minutes)

**Option A — drag and drop**
1. Go to https://app.netlify.com/drop
2. Drag this whole folder onto the page
3. Done — Netlify gives you a live URL immediately

**Option B — connect to GitHub (recommended if you'll keep editing it)**
1. Push this folder to a new GitHub repo
2. In Netlify: *Add new site → Import an existing project → GitHub*
3. Pick the repo. Netlify auto-detects `netlify.toml` — no config needed
4. Deploy

Either way, Netlify Blobs works automatically once the site is deployed —
no database setup, no extra accounts, no API keys.

### Set the admin passcode (optional)

If you want the admin feature, set an environment variable on your Netlify
site — without it, "Log in as admin" will show an error instead of logging
anyone in:

1. In Netlify: *Site configuration → Environment variables → Add a variable*
2. Key: `PACE_ADMIN_PASSCODE`, Value: any passcode you choose
3. Redeploy the site (env var changes need a new deploy to take effect)

Anyone with this passcode can see everyone's hours, including hidden ones —
treat it like a master key and only share it with people you trust with
everyone's data.

### Set up daily reminders (optional)

Push notifications need a "VAPID" key pair — the app's ID badge that lets
push services trust messages are really coming from your site. A pair has
already been generated for you below. **Keep the private key secret.**

In Netlify: *Site configuration → Environment variables → Add a variable*,
add these three:

| Key | Value |
|---|---|
| `VAPID_PUBLIC_KEY` | `BB0zNdP697k6kEbY4honDZY2z8QpOvt8JZMiCSfUlSnoBXciRDQlRSBnIVzyifXqqg_AGkGKI4C5AuCMvxdMKls` |
| `VAPID_PRIVATE_KEY` | `LukIDr78E1eBPJqiX6bNdysSjhNUZHq8s-hLjT-57Jc` |
| `VAPID_CONTACT_EMAIL` | `mailto:your-email@example.com` (use a real address you check) |

Redeploy after adding these (any small change, or *Deploys → Trigger deploy
→ Deploy site*) so the functions pick up the new environment variables.
Without these three variables, the app works fine — the "Daily reminders"
toggle just won't have any effect until they're set.

> Want your own key pair instead of the one above? Generate one at
> https://web-push-codelab.glitch.me and use those values instead.

By default, reminders go out at **14:30 UTC** every day. To change it, edit
the `export const config = { schedule: ... }` line at the bottom of
`netlify/functions/send-daily-reminder.js` — that's the only place it's
defined. Use https://crontab.guru to convert a local time to UTC.

## How it works

- `public/index.html` — the app itself, including the login/signup gate
- `netlify/functions/auth.js` — handles account creation, login, and admin
  login; PINs are hashed with scrypt (a salted, slow hash) before being
  stored — the raw PIN is never saved. Admin login checks the passcode
  against the `PACE_ADMIN_PASSCODE` environment variable using a
  timing-safe comparison, and isn't tied to any one person's account
- `netlify/functions/_session.js` — shared helper that checks a request's
  session token before `profile.js` / `profiles.js` will do anything;
  returns whether the session belongs to a person or to admin
- `netlify/functions/profile.js` — reads/writes one person's goal + entries;
  requires a valid session, and only lets you read/write your *own* data.
  Admin sessions can't use this endpoint, since admin has no personal data
- `netlify/functions/profiles.js` — returns a summary of everyone (for the
  "Everyone" tab); requires a valid session, but never returns PIN data.
  For admin sessions, the "hide my progress" privacy flag is bypassed so
  real numbers come through, marked with `private: true` so the UI can
  show they're hidden from everyone else
- `netlify/functions/webauthn.js` — handles registering and verifying Face
  ID / Touch ID / fingerprint credentials, using `@simplewebauthn/server`
  (the standard library for the WebAuthn protocol). Registering a new
  credential requires an existing PIN-authenticated session, so it can't be
  used to attach a passkey to someone else's account. Only the public key
  and a usage counter are stored — never anything biometric
- `netlify/functions/push.js` — saves or removes a browser's push
  subscription on the signed-in person's own account; requires a valid
  session, same ownership rule as `profile.js`
- `netlify/functions/vapid-public-key.js` — hands the browser the public
  half of the VAPID key pair so it can subscribe to push; the private key
  never leaves environment variables
- `netlify/functions/send-daily-reminder.js` — a *scheduled* function (runs
  automatically once a day, no request needed) that checks who hasn't
  logged hours yet and sends them a push notification
- `public/sw.js` — the service worker; receives push events and shows the
  notification, even if the app isn't open
- Data is stored in a Netlify Blobs store called `pace`, scoped to your site

## Security notes

- PINs are hashed (scrypt + per-account random salt), never stored or logged
  in plain text.
- A 4-digit PIN has only 10,000 possible combinations, so this is meaningfully
  weaker than a real password — fine for a small trusted group who just want
  a quick way to keep their own entries separate, not for anything sensitive.
- Sessions are random 32-byte tokens stored server-side, valid for 30 days,
  sent as a Bearer token on every request.
- This is appropriate for a small trusted group, but it's a lightweight,
  self-hosted auth system, not an enterprise-grade one — there's no email
  verification, PIN reset flow, or rate limiting on login attempts. If
  someone forgets their PIN, the only fix today is manually clearing
  their account in Netlify Blobs and having them sign up again.
- The admin passcode is shared by whoever you give it to — it isn't tied to
  one person's identity, so there's no record of *which* admin viewed what.
  If you need to revoke admin access, change `PACE_ADMIN_PASSCODE` and
  redeploy; this invalidates the passcode for everyone who had it (existing
  admin sessions already logged in stay valid until they expire, 30 days
  after login).
- Biometric login is tied to one specific device and browser — setting it
  up on a phone doesn't affect login on a laptop, and clearing browser data
  removes it. Anyone who unlocks the device itself (Face ID, Touch ID, or
  device PIN, depending on what protects the device) can use the biometric
  login, the same as any other passkey-protected site.

## Local testing (optional)

If you have Node and the Netlify CLI installed:

```
npm install
npx netlify dev
```

This runs the app with working functions and a local Blobs store at
http://localhost:8888.

