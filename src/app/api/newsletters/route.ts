import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]/route";
import { fetchNewsletters } from "@/lib/gmail";
import { generateDigest } from "@/lib/gemini";
import { saveDigest } from "@/lib/store";

export const maxDuration = 60; // Allow up to 60s for AI processing

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

  try {
    console.log("Fetching newsletters from Gmail...");
    const emails = await fetchNewsletters(accessToken);
    console.log(`Found ${emails.length} newsletters. Generating digest...`);

    const digest = await generateDigest(emails);
    saveDigest(digest);

    console.log("Digest saved successfully.");
    return NextResponse.json({ success: true, count: emails.length, digest });
  } catch (err: any) {
    console.error("Digest generation failed:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
