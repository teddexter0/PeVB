import { NextRequest, NextResponse } from "next/server";
import { fetchNewsletters } from "@/lib/gmail";
import { generateDigest } from "@/lib/gemini";
import { saveDigest } from "@/lib/store";

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  // Vercel cron jobs call GET, protected by Authorization header
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const accessToken = process.env.GMAIL_ACCESS_TOKEN;
  if (!accessToken) {
    return NextResponse.json(
      {
        error:
          "GMAIL_ACCESS_TOKEN not set. Log in to your app manually, open DevTools > Application > Cookies, copy the session token, and run the /api/get-token endpoint while logged in.",
      },
      { status: 500 }
    );
  }

  try {
    const emails = await fetchNewsletters(accessToken);
    const digest = await generateDigest(emails);
    saveDigest(digest);
    return NextResponse.json({ success: true, count: emails.length });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
