import { google } from "googleapis";

// How far back to look for newsletters (in days)
const LOOKBACK_DAYS = 4; // covers Sun→Wed and Wed→Sun

export interface RawEmail {
  id: string;
  sender: string;
  senderEmail: string;
  subject: string;
  date: string;
  body: string;
}

function getDaysAgoTimestamp(days: number): number {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return Math.floor(d.getTime() / 1000);
}

function isNewsletter(
  headers: { name: string; value: string }[],
  body: string,
  customSenders: string[]
): boolean {
  const getHeader = (name: string) =>
    headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || "";

  const from = getHeader("from").toLowerCase();
  const listUnsubscribe = getHeader("list-unsubscribe");
  const listId = getHeader("list-id");
  const precedence = getHeader("precedence").toLowerCase();

  // Check custom senders first
  if (customSenders.some((s) => from.includes(s.toLowerCase().trim()))) {
    return true;
  }

  // Standard newsletter detection headers
  if (listUnsubscribe || listId) return true;
  if (precedence === "bulk" || precedence === "list") return true;

  // Body-based fallback: unsubscribe link in text
  if (
    body.toLowerCase().includes("unsubscribe") ||
    body.toLowerCase().includes("opt out") ||
    body.toLowerCase().includes("manage preferences")
  ) {
    return true;
  }

  return false;
}

function decodeBody(payload: any): string {
  // Recursively find text/plain or text/html parts
  if (!payload) return "";

  if (payload.parts) {
    for (const part of payload.parts) {
      const text = decodeBody(part);
      if (text) return text;
    }
  }

  const mimeType = payload.mimeType || "";
  if (
    (mimeType === "text/plain" || mimeType === "text/html") &&
    payload.body?.data
  ) {
    const decoded = Buffer.from(payload.body.data, "base64").toString("utf-8");
    // Strip HTML tags for cleaner AI processing
    return decoded.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }

  return "";
}

export async function fetchNewsletters(accessToken: string): Promise<RawEmail[]> {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });

  const gmail = google.gmail({ version: "v1", auth });

  const customSenders = (process.env.CUSTOM_SENDERS || "")
    .split(",")
    .filter(Boolean);

  const since = getDaysAgoTimestamp(LOOKBACK_DAYS);

  // Search for emails since X days ago, not from me
  const listRes = await gmail.users.messages.list({
    userId: "me",
    q: `after:${since} -from:me`,
    maxResults: 100,
  });

  const messages = listRes.data.messages || [];
  if (messages.length === 0) return [];

  const newsletters: RawEmail[] = [];

  for (const msg of messages) {
    if (!msg.id) continue;

    try {
      const detail = await gmail.users.messages.get({
        userId: "me",
        id: msg.id,
        format: "full",
      });

      const payload = detail.data.payload;
      const headers = payload?.headers || [];

      const getHeader = (name: string) =>
        headers.find((h: any) => h.name?.toLowerCase() === name.toLowerCase())
          ?.value || "";

      const body = decodeBody(payload);

      if (!isNewsletter(headers as any, body, customSenders)) continue;

      const fromRaw = getHeader("from");
      // Parse "Name <email>" format
      const nameMatch = fromRaw.match(/^(.+?)\s*<(.+?)>/);
      const senderName = nameMatch ? nameMatch[1].replace(/"/g, "").trim() : fromRaw;
      const senderEmail = nameMatch ? nameMatch[2] : fromRaw;

      newsletters.push({
        id: msg.id,
        sender: senderName,
        senderEmail: senderEmail,
        subject: getHeader("subject"),
        date: getHeader("date"),
        body: body.slice(0, 8000), // Cap to avoid huge token usage
      });
    } catch (err) {
      console.error(`Failed to fetch message ${msg.id}:`, err);
    }
  }

  return newsletters;
}
