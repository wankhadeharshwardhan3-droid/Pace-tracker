import { connectLambda, getStore } from "@netlify/blobs";
import webpush from "web-push";

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function buildMessage(name, record) {
  const today = todayStr();
  const entries = (record && record.entries) || [];
  const loggedToday = entries.some((e) => e.date === today && Number(e.hours) > 0);

  if (loggedToday) {
    return { title: "Pace", body: `Nice work, ${name} — today's hours are already logged.` };
  }
  if (!record || !record.goal) {
    return { title: "Pace", body: "Set a study target in Pace to start tracking your daily progress." };
  }
  return { title: "Pace", body: `Don't forget to log today's study hours, ${name}.` };
}

export const handler = async (event) => {
  if (typeof connectLambda === "function") connectLambda(event);
  const store = getStore("pace");

  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const contact = process.env.VAPID_CONTACT_EMAIL || "mailto:admin@example.com";

  if (!publicKey || !privateKey) {
    console.error("VAPID keys are not configured — skipping reminder run.");
    return { statusCode: 200, body: "Skipped: VAPID keys missing." };
  }

  webpush.setVapidDetails(contact, publicKey, privateKey);

  const names = (await store.get("list", { type: "json" })) || [];
  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const name of names) {
    const accountKey = `account:${name.toLowerCase()}`;
    const account = await store.get(accountKey, { type: "json" });
    if (!account || !account.pushSubscription) {
      skipped++;
      continue;
    }

    const record = await store.get(`data:${name}`, { type: "json" });
    const message = buildMessage(name, record);

    try {
      await webpush.sendNotification(
        account.pushSubscription,
        JSON.stringify({ ...message, url: "/" })
      );
      sent++;
    } catch (err) {
      failed++;
      // 404/410 = the browser revoked or expired the subscription
      // (uninstalled, cleared site data, etc.) — stop trying it.
      if (err.statusCode === 404 || err.statusCode === 410) {
        delete account.pushSubscription;
        await store.setJSON(accountKey, account);
      } else {
        console.error(`Push failed for ${name}:`, err.message || err);
      }
    }
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ sent, skipped, failed, total: names.length }),
  };
};

// Runs once a day at 14:30 UTC. To change the time, edit this line —
// it's the only place the schedule is defined. Use https://crontab.guru
// to convert a local time to the UTC cron expression.
export const config = {
  schedule: "30 14 * * *",
};
