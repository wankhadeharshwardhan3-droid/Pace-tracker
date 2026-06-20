// Serves only the public half of the VAPID key pair — the private key
// (VAPID_PRIVATE_KEY) stays in environment variables and is never sent
// to the browser. Used by the frontend to call pushManager.subscribe().
export const handler = async () => {
  const publicKey = process.env.VAPID_PUBLIC_KEY || "";
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=3600" },
    body: JSON.stringify({ publicKey }),
  };
};
