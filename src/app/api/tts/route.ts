import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]/route";
import { VOICES, VoiceDay } from "@/lib/voices";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { text, voice } = await req.json();

  if (!text || !voice) {
    return NextResponse.json({ error: "Missing text or voice" }, { status: 400 });
  }

  const voiceConfig = VOICES[voice as VoiceDay];
  if (!voiceConfig) {
    return NextResponse.json({ error: "Invalid voice" }, { status: 400 });
  }

  const apiKey = process.env.GOOGLE_TTS_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "GOOGLE_TTS_API_KEY not set" }, { status: 500 });
  }

  // Trim text to stay within free tier (1M chars/month — very generous)
  const trimmedText = text.slice(0, 5000);

  try {
    const response = await fetch(
      `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: { text: trimmedText },
          voice: {
            languageCode: voiceConfig.languageCode,
            name: voiceConfig.name,
          },
          audioConfig: {
            audioEncoding: "MP3",
            speakingRate: 0.95, // Slightly slower = easier to listen to
            pitch: 0,
          },
        }),
      }
    );

    if (!response.ok) {
      const err = await response.json();
      console.error("Google TTS error:", err);
      return NextResponse.json(
        { error: "TTS request failed", details: err },
        { status: 500 }
      );
    }

    const data = await response.json();
    // Returns base64 encoded MP3
    return NextResponse.json({ audioContent: data.audioContent });
  } catch (err: any) {
    console.error("TTS failed:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
