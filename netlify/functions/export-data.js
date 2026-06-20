// TEMPORARY migration tool. Add this to netlify/functions/, deploy once,
// visit it once to get your data, then DELETE this file and redeploy.
// It dumps every account + data record + the user list as one JSON blob,
// protected by the same admin passcode you already use to log in as admin.
//
// Usage: https://<your-site>.netlify.app/.netlify/functions/export-data?passcode=YOUR_ADMIN_PASSCODE

import { connectLambda, getStore } from "@netlify/blobs";

export const handler = async (event) => {
  if (typeof connectLambda === "function") connectLambda(event);
  const store = getStore("pace");

  const params = event.queryStringParameters || {};
  const passcode = params.passcode || "";
  const expected = process.env.PACE_ADMIN_PASSCODE || "";

  if (!expected || passcode !== expected) {
    return {
      statusCode: 401,
      body: JSON.stringify({ error: "Provide ?passcode=<your admin passcode> in the URL" }),
    };
  }

  const names = (await store.get("list", { type: "json" })) || [];

  const accounts = {};
  const data = {};

  for (const name of names) {
    const accountKey = `account:${name.toLowerCase()}`;
    const account = await store.get(accountKey, { type: "json" });
    if (account) accounts[accountKey] = account;

    const dataKey = `data:${name}`;
    const record = await store.get(dataKey, { type: "json" });
    if (record) data[dataKey] = record;
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json", "Content-Disposition": "attachment; filename=pace-export.json" },
    body: JSON.stringify({ list: names, accounts, data }, null, 2),
  };
};
