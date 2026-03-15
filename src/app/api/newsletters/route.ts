import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { fetchNewsletters } from "@/lib/gmail";
import { generateDigest } from "@/lib/gemini";
import { saveDigest, loadDigest } from "@/lib/store";

const DIGEST_MAX_AGE_HOURS = 4;

export const maxDuration = 120; // Allow up to 120s for AI processing (Vercel Pro)

export async function POST(req: NextRequest) {
  // Two modes: cron job (via secret) or manual trigger (via session)
  const cronSecret = req.headers.get("x-cron-secret");
  const isCron = cronSecret === process.env.CRON_SECRET;

  let accessToken: string | undefined;

  if (isCron) {
    // Cron mode: use a stored token (see README — you need to set this after first login)
    accessToken = process.env.GMAIL_ACCESS_TOKEN;
    if (!accessToken) {
      return NextResponse.json(
        {
          error:
            "No access token for cron. Log in manually first and copy your token to GMAIL_ACCESS_TOKEN in env.",
        },
        { status: 500 }
      );
    }
  } else {
    // Manual mode: user must be logged in
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    accessToken = (session as any).accessToken;
    if (!accessToken) {
      return NextResponse.json(
        { error: "No Gmail access token in session. Please sign out and sign in again." },
        { status: 400 }
      );
    }
  }

  // Warn loudly in logs if no AI key is set — makes Vercel log diagnosis easy
  const hasAnthropic = !!process.env.ANTHROPIC_API_KEY;
  const hasGemini = !!process.env.GEMINI_API_KEY;
  if (!hasAnthropic && !hasGemini) {
    console.error("FATAL: Neither ANTHROPIC_API_KEY nor GEMINI_API_KEY is set. Add at least one in Vercel → Settings → Environment Variables.");
    return NextResponse.json(
      { error: "No AI provider configured. Add ANTHROPIC_API_KEY (or GEMINI_API_KEY) to your environment variables." },
      { status: 500 }
    );
  }
  console.log(`AI provider: ${hasAnthropic ? "Anthropic (primary)" : "Gemini (only)"}${hasAnthropic && hasGemini ? " + Gemini (fallback)" : ""}`);

  let step = "loading cache";
  try {
    // Return cached digest if it's fresh enough — avoids burning AI quota
    const existing = loadDigest();
    if (existing?.generatedAt) {
      const ageHours = (Date.now() - new Date(existing.generatedAt).getTime()) / 3_600_000;
      if (ageHours < DIGEST_MAX_AGE_HOURS) {
        console.log(`Returning cached digest (${ageHours.toFixed(1)}h old)`);
        return NextResponse.json({ success: true, count: existing.entries.length, digest: existing, cached: true });
      }
    }

    step = "fetching Gmail";
    console.log("Fetching newsletters from Gmail...");
    const emails = await fetchNewsletters(accessToken);
    console.log(`Found ${emails.length} newsletters. Generating digest...`);

    step = "generating digest";
    const digest = await generateDigest(emails);

    step = "saving digest";
    saveDigest(digest);

    console.log("Digest saved successfully.");
    return NextResponse.json({ success: true, count: emails.length, digest });
  } catch (err: any) {
    console.error(`Digest generation failed at step "${step}":`, err);
    return NextResponse.json({ error: `Failed at step "${step}": ${err.message}` }, { status: 500 });
  }
}
