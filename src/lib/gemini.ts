import { GoogleGenerativeAI } from "@google/generative-ai";
import { RawEmail } from "./gmail";

export interface DigestEntry {
  sender: string;
  senderEmail: string;
  subject: string;
  date: string;
  summary: string;
}

export interface Digest {
  generatedAt: string;
  dateRange: string;
  entries: DigestEntry[];
  overallHighlights: string;
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
const MODEL = "gemini-2.0-flash";

// Deduplicate by sender — keep most recent per sender
function deduplicateBySender(emails: RawEmail[]): RawEmail[] {
  const seen = new Map<string, RawEmail>();
  for (const email of emails) {
    const key = email.senderEmail.toLowerCase();
    if (!seen.has(key)) seen.set(key, email);
  }
  return Array.from(seen.values());
}

function formatDateRange(): string {
  const now = new Date();
  const past = new Date();
  past.setDate(past.getDate() - 4);
  const fmt = (d: Date) =>
    d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  return `${fmt(past)} – ${fmt(now)}`;
}

export function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export async function generateDigest(emails: RawEmail[]): Promise<Digest> {
  if (emails.length === 0) {
    return {
      generatedAt: new Date().toISOString(),
      dateRange: formatDateRange(),
      entries: [],
      overallHighlights: "No newsletters found for this period.",
    };
  }

  const uniqueEmails = deduplicateBySender(emails);
  console.log(`Processing ${uniqueEmails.length} unique senders (from ${emails.length} total emails)`);

  // Cap at 40 senders to stay within token limits comfortably
  const toProcess = uniqueEmails.slice(0, 40);

  // Build one big batch prompt — all newsletters in a single API call
  const newsletterBlocks = toProcess.map((email, i) => 
    `--- NEWSLETTER ${i + 1} ---
From: ${email.sender}
Subject: ${email.subject}
Content: ${email.body.slice(0, 3000)}`
  ).join("\n\n");

  const batchPrompt = `You are creating a comprehensive 2-page digest of newsletters received over the past 4 days.

Here are ${toProcess.length} newsletters:

${newsletterBlocks}

For EACH newsletter, write a thorough summary paragraph (4-6 sentences). Don't be brief or buzzwordy — give the actual substance: what was argued, what data was shared, what events happened, what advice was given, specific names and numbers where relevant. This should read like a well-informed friend telling you exactly what you missed.

Respond ONLY with valid JSON in this exact structure, nothing else:
{
  "highlights": "3-4 sentence overview of the most important/interesting things across ALL newsletters this period. Specific, not vague.",
  "summaries": [
    {
      "index": 1,
      "summary": "Full substantive paragraph here..."
    }
  ]
}`;

  const model = genAI.getGenerativeModel({ model: MODEL });
  
  let parsed: { highlights: string; summaries: Array<{ index: number; summary: string }> };
  
  try {
    const result = await model.generateContent(batchPrompt);
    const text = result.response.text().trim();
    // Strip any markdown code fences if present
    const clean = text.replace(/^```json\s*/i, "").replace(/\s*```$/i, "").trim();
    parsed = JSON.parse(clean);
  } catch (err: any) {
    console.error("Batch summarisation failed:", err.message || err);
    // Fallback: return entries with no summaries rather than crashing
    return {
      generatedAt: new Date().toISOString(),
      dateRange: formatDateRange(),
      entries: toProcess.map(email => ({
        sender: email.sender,
        senderEmail: email.senderEmail,
        subject: email.subject,
        date: email.date,
        summary: "Summary unavailable — API quota exceeded. Try again tomorrow.",
      })),
      overallHighlights: "Digest partially generated. Some summaries unavailable due to API limits.",
    };
  }

  const entries: DigestEntry[] = toProcess.map((email, i) => ({
    sender: email.sender,
    senderEmail: email.senderEmail,
    subject: email.subject,
    date: email.date,
    summary: parsed.summaries.find(s => s.index === i + 1)?.summary 
      ?? "Summary not generated.",
  }));

  return {
    generatedAt: new Date().toISOString(),
    dateRange: formatDateRange(),
    entries,
    overallHighlights: parsed.highlights,
  };
}