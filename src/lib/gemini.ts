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

// ─── AI providers ────────────────────────────────────────────────────────────

async function callAnthropic(prompt: string): Promise<string> {
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  const msg = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 4096,
    messages: [{ role: "user", content: prompt }],
  });
  const block = msg.content[0];
  if (block.type !== "text") throw new Error("Unexpected response type from Anthropic");
  return block.text;
}

async function callGemini(prompt: string): Promise<string> {
  const { GoogleGenerativeAI } = await import("@google/generative-ai");
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
  const result = await model.generateContent(prompt);
  return result.response.text().trim();
}

async function generateText(prompt: string): Promise<string> {
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      console.log("Using Anthropic (Claude) for digest generation...");
      return await callAnthropic(prompt);
    } catch (err: any) {
      console.warn("Anthropic failed, falling back to Gemini:", err.message || err);
    }
  }
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("No AI provider available — set ANTHROPIC_API_KEY or GEMINI_API_KEY in your env.");
  }
  console.log("Using Gemini as fallback...");
  return await callGemini(prompt);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

// ─── Main export ─────────────────────────────────────────────────────────────

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

  const toProcess = uniqueEmails.slice(0, 40);

  const newsletterBlocks = toProcess
    .map(
      (email, i) =>
        `--- NEWSLETTER ${i + 1} ---
From: ${email.sender}
Subject: ${email.subject}
Content: ${email.body.slice(0, 3000)}`
    )
    .join("\n\n");

  const batchPrompt = `You are creating a comprehensive digest of newsletters received over the past 4 days.

Here are ${toProcess.length} newsletters:

${newsletterBlocks}

For EACH newsletter, write a thorough summary paragraph (4-6 sentences). Don't be brief or buzzwordy — give the actual substance: what was argued, what data was shared, what events happened, what advice was given, specific names and numbers where relevant.

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

  let parsed: { highlights: string; summaries: Array<{ index: number; summary: string }> };

  try {
    const text = await generateText(batchPrompt);
    const clean = text.replace(/^```json\s*/i, "").replace(/\s*```$/i, "").trim();
    parsed = JSON.parse(clean);
  } catch (err: any) {
    console.error("Digest generation failed:", err.message || err);
    return {
      generatedAt: new Date().toISOString(),
      dateRange: formatDateRange(),
      entries: toProcess.map((email) => ({
        sender: email.sender,
        senderEmail: email.senderEmail,
        subject: email.subject,
        date: email.date,
        summary: "Summary unavailable — AI service unreachable. Try again shortly.",
      })),
      overallHighlights: "Digest could not be fully generated. Please try again.",
    };
  }

  const entries: DigestEntry[] = toProcess.map((email, i) => ({
    sender: email.sender,
    senderEmail: email.senderEmail,
    subject: email.subject,
    date: email.date,
    summary:
      parsed.summaries.find((s) => s.index === i + 1)?.summary ?? "Summary not generated.",
  }));

  return {
    generatedAt: new Date().toISOString(),
    dateRange: formatDateRange(),
    entries,
    overallHighlights: parsed.highlights,
  };
}
