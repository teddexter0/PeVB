import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { RawEmail } from "./gmail";

export interface DigestEntry {
  sender: string;
  senderEmail: string;
  subject: string;
  date: string;
  summary: string;
  tagline?: string; // punchy one-liner genre hook, e.g. "Your wallet just flinched"
}

export interface Digest {
  generatedAt: string;
  dateRange: string;
  entries: DigestEntry[];
  overallHighlights: string;
}

// ─── AI providers ────────────────────────────────────────────────────────────

async function callAnthropic(prompt: string): Promise<string> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  const msg = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 8192,
    messages: [{ role: "user", content: prompt }],
  });
  const block = msg.content[0];
  if (block.type !== "text") throw new Error("Unexpected response type from Anthropic");
  return block.text;
}

async function callGemini(prompt: string): Promise<string> {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
  const result = await model.generateContent(prompt);
  return result.response.text().trim();
}

async function generateText(prompt: string): Promise<string> {
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      console.log("Using Anthropic (Claude Haiku) for digest generation...");
      const result = await callAnthropic(prompt);
      console.log("Anthropic succeeded.");
      return result;
    } catch (err: any) {
      console.error("Anthropic call failed — full error:", err);
      console.error("Anthropic error message:", err.message);
      console.error("Anthropic status:", err.status);
      if (process.env.GEMINI_API_KEY) {
        console.log("Falling back to Gemini...");
      }
    }
  } else {
    console.warn("ANTHROPIC_API_KEY not set — skipping Claude.");
  }

  if (process.env.GEMINI_API_KEY) {
    console.log("Using Gemini as fallback...");
    return await callGemini(prompt);
  }

  throw new Error(
    "No AI provider available. Set ANTHROPIC_API_KEY or GEMINI_API_KEY in Vercel → Settings → Environment Variables."
  );
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

  const toProcess = uniqueEmails.slice(0, 35);

  const newsletterBlocks = toProcess
    .map(
      (email, i) =>
        `--- NEWSLETTER ${i + 1} ---
From: ${email.sender}
Subject: ${email.subject}
Content: ${email.body.slice(0, 1500)}`
    )
    .join("\n\n");

  const batchPrompt = `You are a sharp, witty briefing host — imagine the dry intelligence of John Oliver, the casual directness of Ryan Reynolds, and the analytical edge of Malcolm Gladwell. You make information feel alive and worth knowing. You speak like a clever friend who did all the reading so the listener didn't have to. Keep it clean and workplace-safe — no profanity, no crude language — but absolutely keep the wit, the specific observations, and the light sarcasm. Dry humour and cultural references are encouraged.

Here are ${toProcess.length} newsletters from the past 4 days:

${newsletterBlocks}

For EACH newsletter, produce:
1. A "tagline": One punchy, specific sentence that captures the vibe and category. Witty and sharp — like a great podcast episode title or a magazine subheader. Examples: "Your portfolio just had a panic attack", "AI took another job, this time it's awkward", "Streaming wars: the body count rises", "Someone in Washington blinked first". Be specific to the actual content, never generic.
2. A "summary": 3-4 sentences in conversational, no-nonsense style. Real substance — actual numbers, names, events, arguments. Write it so someone listening while commuting gets the full picture. Where it makes sense, naturally connect dots to other newsletters in this batch (e.g. "which tracks with what [Other Sender] said about...").

For "highlights": Write 3-4 sentences like a host's sharp opening monologue. What's the story of this period? What themes keep coming up? Be specific and opinionated — no vague corporate summaries.

Respond ONLY with valid JSON in this exact structure, nothing else:
{
  "highlights": "Opening monologue: the big picture story of this period in 3-4 punchy sentences...",
  "summaries": [
    {
      "index": 1,
      "tagline": "Your wallet just flinched",
      "summary": "Conversational, substantive 3-4 sentence summary here..."
    }
  ]
}`;

  let parsed: { highlights: string; summaries: Array<{ index: number; tagline?: string; summary: string }> };

  try {
    const text = await generateText(batchPrompt);
    // Strip markdown fences, then extract the outermost {...} in case the model
    // added commentary before or after the JSON blob
    const stripped = text.replace(/^```json\s*/i, "").replace(/\s*```$/i, "").trim();
    const start = stripped.indexOf("{");
    const end = stripped.lastIndexOf("}");
    if (start === -1 || end === -1) throw new Error("No JSON object found in AI response");
    const clean = stripped.slice(start, end + 1);
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
        tagline: undefined,
      })),
      overallHighlights: "Digest could not be fully generated. Please try again.",
    };
  }

  const entries: DigestEntry[] = toProcess.map((email, i) => {
    const match = parsed.summaries.find((s) => s.index === i + 1);
    return {
      sender: email.sender,
      senderEmail: email.senderEmail,
      subject: email.subject,
      date: email.date,
      summary: match?.summary ?? "Summary not generated.",
      tagline: match?.tagline,
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    dateRange: formatDateRange(),
    entries,
    overallHighlights: parsed.highlights,
  };
}
