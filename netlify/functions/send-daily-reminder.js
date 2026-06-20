import { connectLambda, getStore } from "@netlify/blobs";
import webpush from "web-push";

function todayStr() {
return new Date().toISOString().slice(0, 10);
}

function buildMessage(name, record) {
const today = todayStr();
const entries = (record && record.entries) || [];
const loggedToday = entries.some((e) =&gt; e.date === today && Number(e.hours) &gt; 0);

if (loggedToday) {
return { title: "Pace", body: Nice work, ${name} — today's hours are already logged.}; } if (!record || !record.goal) { return { title: "Pace", body: "Set a study target in Pace to start tracking your daily progress." }; } return { title: "Pace", body:Don't forget to log today's study hours, ${name}. };
}

export const handler = async (event) =&gt; {
if (typeof connectLambda === "function") connectLambda(event);
const store = getStore("pace");

const publicKey = process.env.VAPID_PUBLIC_KEY;
const privateKey = process.env.VAPID_PRIVATE_KEY;
const contact = process.env.VAPID_CONTACT_EMAIL || "mailto:admin@example.com";

if (!publicKey || !privateKey) {
console.error("VAPID keys are not configur
