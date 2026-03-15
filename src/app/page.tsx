"use client";

import { useSession, signIn, signOut } from "next-auth/react";
import { useEffect, useState, useRef, forwardRef, useImperativeHandle } from "react";
import { Digest } from "@/lib/gemini";
import { VOICES, VoiceDay, getTodayVoice } from "@/lib/voices";

function SignInPage() {
  return (
    <div className="signin-container">
      <div style={{ maxWidth: "420px", width: "100%", textAlign: "center" }}>
        <div className="fade-up" style={{ marginBottom: "3rem" }}>
          <p
            className="font-mono"
            style={{
              fontSize: "0.7rem",
              letterSpacing: "0.25em",
              color: "var(--muted)",
              textTransform: "uppercase",
              marginBottom: "0.5rem",
            }}
          >
            Est. 2025
          </p>
          <h1
            className="font-serif"
            style={{ fontSize: "3.5rem", lineHeight: 1, margin: 0, color: "var(--ink)" }}
          >
            The Brief
          </h1>
          <p
            className="font-serif"
            style={{ fontSize: "1rem", color: "var(--muted)", fontStyle: "italic", marginTop: "0.5rem" }}
          >
            Your newsletters, distilled.
          </p>
        </div>

        <hr className="rule" />

        <div className="fade-up fade-up-delay-1" style={{ marginBottom: "2.5rem" }}>
          <p style={{ fontSize: "0.9rem", color: "var(--muted)", lineHeight: 1.7, marginBottom: "2rem" }}>
            Twice a week, every newsletter you subscribe to becomes one clean page.
            No inbox. No tabs. No overwhelm.
          </p>
          <button
            className="btn-primary"
            onClick={() => signIn("google")}
            style={{ width: "100%", padding: "0.9rem", fontSize: "0.85rem" }}
          >
            Connect Gmail → Read The Brief
          </button>
          <p
            className="font-mono"
            style={{ fontSize: "0.65rem", color: "var(--muted)", marginTop: "1rem", letterSpacing: "0.03em" }}
          >
            Read-only access. Your emails never leave Google's servers.
          </p>
        </div>

        <hr className="rule" />

        <div className="fade-up fade-up-delay-2" style={{ display: "flex", justifyContent: "center", gap: "2rem" }}>
          {["Sunday 7PM", "Wednesday 7PM"].map((day) => (
            <div key={day} style={{ textAlign: "center" }}>
              <div className="font-serif" style={{ fontSize: "0.95rem", color: "var(--accent)" }}>{day}</div>
              <div className="font-mono" style={{ fontSize: "0.65rem", color: "var(--muted)", letterSpacing: "0.05em" }}>AUTO-DIGEST</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── VoicePlayer ──────────────────────────────────────────────────────────────

type Segment = { text: string; entryIndex: number | null; label: string };

function buildSegments(d: Digest, voice: VoiceDay): Segment[] {
  const isSunday = voice === "sunday";
  const intro = isSunday
    ? `Alright. The Brief. ${d.dateRange}. ${d.overallHighlights}`
    : `Right, let's go. The Brief. ${d.dateRange}. ${d.overallHighlights}`;
  return [
    { text: intro, entryIndex: null, label: "Introduction" },
    ...d.entries.map((e, i) => {
      const hook = e.tagline || e.sender;
      const text = isSunday
        ? `${hook}. ${e.summary}`
        : `${hook}. Right, so — ${e.summary}`;
      return { text, entryIndex: i, label: e.sender };
    }),
  ];
}

interface VoicePlayerHandle {
  jumpToEntry: (entryIndex: number) => void;
  startPlaying: () => void;
}

const VoicePlayer = forwardRef<VoicePlayerHandle, {
  digest: Digest;
  onReadingEntry: (i: number | null) => void;
}>(function VoicePlayer({ digest, onReadingEntry }, ref) {
  const [selectedVoice, setSelectedVoice] = useState<VoiceDay>(getTodayVoice());
  const [readingState, setReadingState] = useState<"idle" | "loading" | "playing" | "paused">("idle");
  const [currentLabel, setCurrentLabel] = useState("");
  const [speed, setSpeed] = useState(1);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const segmentsRef = useRef<Segment[]>([]);
  const playIdRef = useRef(0);
  const segmentIndexRef = useRef(0);
  const voiceRef = useRef(selectedVoice);
  const speedRef = useRef(1);
  const onReadingEntryRef = useRef(onReadingEntry);

  useEffect(() => { voiceRef.current = selectedVoice; }, [selectedVoice]);
  useEffect(() => {
    speedRef.current = speed;
    if (audioRef.current) audioRef.current.playbackRate = speed;
  }, [speed]);
  useEffect(() => { onReadingEntryRef.current = onReadingEntry; }, [onReadingEntry]);

  function cancelCurrent(): number {
    const newPlayId = ++playIdRef.current;
    if (audioRef.current) {
      audioRef.current.onended = null;
      audioRef.current.pause();
      audioRef.current = null;
    }
    return newPlayId;
  }

  async function playSegmentAt(index: number, playId: number) {
    if (playIdRef.current !== playId) return;
    const segments = segmentsRef.current;

    if (index >= segments.length) {
      setReadingState("idle");
      setCurrentLabel("");
      onReadingEntryRef.current(null);
      segmentIndexRef.current = 0;
      return;
    }

    const seg = segments[index];
    segmentIndexRef.current = index;
    setReadingState("loading");
    setCurrentLabel(seg.label);
    onReadingEntryRef.current(seg.entryIndex);

    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: seg.text, voice: voiceRef.current }),
      });
      const data = await res.json();
      if (!data.audioContent) throw new Error("No audio returned");
      if (playIdRef.current !== playId) return;

      const audio = new Audio(`data:audio/mp3;base64,${data.audioContent}`);
      audioRef.current = audio;
      audio.playbackRate = speedRef.current;
      audio.onended = () => {
        if (playIdRef.current !== playId) return;
        playSegmentAt(index + 1, playId);
      };
      audio.play();
      setReadingState("playing");
    } catch (err) {
      if (playIdRef.current !== playId) return;
      console.error("TTS failed:", err);
      alert("Voice failed — check GOOGLE_TTS_API_KEY in your env.");
      setReadingState("idle");
      onReadingEntryRef.current(null);
    }
  }

  function skipTo(index: number) {
    const segs = segmentsRef.current;
    if (!segs.length) return;
    const clamped = Math.max(0, Math.min(index, segs.length - 1));
    const playId = cancelCurrent();
    playSegmentAt(clamped, playId);
  }

  // Switch voice mid-read: continues from same segment with new voice framing
  function switchVoice(newVoice: VoiceDay) {
    const currentIndex = segmentIndexRef.current;
    const wasActive = readingState !== "idle";
    const newPlayId = cancelCurrent();
    voiceRef.current = newVoice;
    setSelectedVoice(newVoice);
    if (wasActive) {
      const segs = buildSegments(digest, newVoice);
      segmentsRef.current = segs;
      playSegmentAt(currentIndex, newPlayId);
    } else {
      setReadingState("idle");
      setCurrentLabel("");
      onReadingEntryRef.current(null);
    }
  }

  async function handlePlayPause() {
    if (readingState === "playing" && audioRef.current) {
      audioRef.current.pause();
      setReadingState("paused");
      return;
    }
    if (readingState === "paused" && audioRef.current) {
      audioRef.current.play();
      setReadingState("playing");
      return;
    }
    const segs = buildSegments(digest, voiceRef.current);
    segmentsRef.current = segs;
    segmentIndexRef.current = 0;
    const playId = ++playIdRef.current;
    playSegmentAt(0, playId);
  }

  useImperativeHandle(ref, () => ({
    jumpToEntry(entryIndex: number) {
      const segs = buildSegments(digest, voiceRef.current);
      segmentsRef.current = segs;
      const idx = segs.findIndex((s) => s.entryIndex === entryIndex);
      if (idx === -1) return;
      const playId = cancelCurrent();
      playSegmentAt(idx, playId);
    },
    startPlaying() {
      const segs = buildSegments(digest, voiceRef.current);
      segmentsRef.current = segs;
      segmentIndexRef.current = 0;
      const playId = cancelCurrent();
      playSegmentAt(0, playId);
    },
  }), [digest]);

  function cycleSpeed() {
    setSpeed((s) => (s === 0.75 ? 1 : s === 1 ? 1.25 : 0.75));
  }

  const activeVoice = VOICES[selectedVoice];
  const isActive = readingState !== "idle";
  const totalSegs = segmentsRef.current.length;
  const canPrev = isActive && segmentIndexRef.current > 0;
  const canNext = isActive && segmentIndexRef.current < totalSegs - 1;

  return (
    <>
      {/* Top player bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "1rem",
          padding: "1rem 1.25rem",
          background: "var(--ink)",
          marginBottom: "1.5rem",
          flexWrap: "wrap",
        }}
      >
        <button
          onClick={handlePlayPause}
          disabled={readingState === "loading"}
          style={{
            background: "var(--accent)",
            border: "none",
            color: "white",
            width: "2.5rem",
            height: "2.5rem",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: readingState === "loading" ? "not-allowed" : "pointer",
            fontSize: "1rem",
            flexShrink: 0,
          }}
        >
          {readingState === "loading" ? "…" : readingState === "playing" ? "⏸" : "▶"}
        </button>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            className="font-mono"
            style={{ fontSize: "0.65rem", color: "rgba(245,240,232,0.5)", letterSpacing: "0.1em", marginBottom: "0.1rem" }}
          >
            {isActive ? "NOW READING" : "READ ALOUD WITH"}
          </div>
          <div className="font-serif" style={{ color: "var(--paper)", fontSize: "1rem", lineHeight: 1.3 }}>
            {isActive && currentLabel ? (
              currentLabel
            ) : (
              <>
                <span>{activeVoice.label}</span>
                <span style={{ color: "rgba(245,240,232,0.45)", fontSize: "0.8rem" }}>
                  {" · "}{activeVoice.description}
                </span>
              </>
            )}
          </div>
        </div>

        <div style={{ display: "flex", gap: "0.5rem", flexShrink: 0 }}>
          {(["sunday", "wednesday"] as VoiceDay[]).map((v) => (
            <button
              key={v}
              onClick={() => switchVoice(v)}
              style={{
                background: selectedVoice === v ? "var(--accent)" : "transparent",
                border: "1px solid",
                borderColor: selectedVoice === v ? "var(--accent)" : "rgba(245,240,232,0.2)",
                color: selectedVoice === v ? "white" : "rgba(245,240,232,0.5)",
                padding: "0.35rem 0.75rem",
                fontFamily: "DM Mono",
                fontSize: "0.65rem",
                letterSpacing: "0.05em",
                cursor: "pointer",
                textTransform: "uppercase",
              }}
            >
              {VOICES[v].label}
            </button>
          ))}
        </div>
      </div>

      {/* Floating mini-player — only when active */}
      {isActive && (
        <div
          style={{
            position: "fixed",
            bottom: 0,
            left: 0,
            right: 0,
            background: "var(--ink)",
            borderTop: "1px solid rgba(245,240,232,0.12)",
            padding: "0.6rem 1rem",
            display: "flex",
            alignItems: "center",
            gap: "0.75rem",
            zIndex: 100,
          }}
        >
          {/* Transport */}
          <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", flexShrink: 0 }}>
            <button
              onClick={() => skipTo(segmentIndexRef.current - 1)}
              disabled={!canPrev}
              title="Previous"
              style={{
                background: "none",
                border: "none",
                color: canPrev ? "var(--paper)" : "rgba(245,240,232,0.2)",
                cursor: canPrev ? "pointer" : "default",
                fontSize: "1.1rem",
                padding: "0.2rem",
                lineHeight: 1,
              }}
            >⏮</button>
            <button
              onClick={handlePlayPause}
              disabled={readingState === "loading"}
              style={{
                background: "var(--accent)",
                border: "none",
                color: "white",
                width: "2rem",
                height: "2rem",
                borderRadius: "50%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                fontSize: "0.8rem",
                flexShrink: 0,
              }}
            >
              {readingState === "loading" ? "…" : readingState === "playing" ? "⏸" : "▶"}
            </button>
            <button
              onClick={() => skipTo(segmentIndexRef.current + 1)}
              disabled={!canNext}
              title="Next"
              style={{
                background: "none",
                border: "none",
                color: canNext ? "var(--paper)" : "rgba(245,240,232,0.2)",
                cursor: canNext ? "pointer" : "default",
                fontSize: "1.1rem",
                padding: "0.2rem",
                lineHeight: 1,
              }}
            >⏭</button>
          </div>

          {/* Label */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              className="font-serif"
              style={{
                color: "var(--paper)",
                fontSize: "0.85rem",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {currentLabel || "The Brief"}
            </div>
          </div>

          {/* Speed + scroll to top */}
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexShrink: 0 }}>
            <button
              onClick={cycleSpeed}
              title="Playback speed"
              style={{
                background: "rgba(245,240,232,0.1)",
                border: "none",
                color: "var(--paper)",
                padding: "0.2rem 0.45rem",
                fontFamily: "DM Mono",
                fontSize: "0.65rem",
                cursor: "pointer",
                letterSpacing: "0.03em",
              }}
            >
              {speed}×
            </button>
            <button
              onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
              title="Back to top"
              style={{
                background: "none",
                border: "none",
                color: "rgba(245,240,232,0.5)",
                cursor: "pointer",
                fontSize: "1rem",
                padding: "0.2rem",
                lineHeight: 1,
              }}
            >↑</button>
          </div>
        </div>
      )}
    </>
  );
});

// ─── DigestPage ───────────────────────────────────────────────────────────────

function DigestPage({
  digest,
  onRefresh,
  refreshing,
  autoPlay,
  onAutoPlayConsumed,
}: {
  digest: Digest | null;
  onRefresh: () => void;
  refreshing: boolean;
  autoPlay: boolean;
  onAutoPlayConsumed: () => void;
}) {
  const { data: session } = useSession();
  const name = session?.user?.name?.split(" ")[0] || "you";
  const [currentEntry, setCurrentEntryState] = useState<number>(0);
  const [readingEntry, setReadingEntry] = useState<number | null>(null);
  const entryRefs = useRef<(HTMLDivElement | null)[]>([]);
  const voicePlayerRef = useRef<VoicePlayerHandle>(null);

  // Restore saved position
  useEffect(() => {
    const saved = localStorage.getItem("thebrief_entry");
    if (saved) setCurrentEntryState(parseInt(saved, 10));
  }, []);

  // Scroll to saved position once digest loads
  useEffect(() => {
    if (!digest) return;
    const saved = localStorage.getItem("thebrief_entry");
    const idx = saved ? parseInt(saved, 10) : 0;
    const clamped = Math.min(idx, digest.entries.length - 1);
    setCurrentEntryState(clamped);
    setTimeout(() => {
      entryRefs.current[clamped]?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 350);
  }, [digest?.generatedAt]);

  // Auto-scroll when voice advances
  useEffect(() => {
    if (readingEntry === null) return;
    setCurrentEntryState(readingEntry);
    entryRefs.current[readingEntry]?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [readingEntry]);

  // Auto-play when digest just generated
  useEffect(() => {
    if (!autoPlay || !digest) return;
    // Short delay so React finishes rendering VoicePlayer
    const t = setTimeout(() => {
      try {
        voicePlayerRef.current?.startPlaying();
      } catch {
        // Autoplay blocked by browser — user will see the ▶ button
      }
      onAutoPlayConsumed();
    }, 600);
    return () => clearTimeout(t);
  }, [autoPlay, digest?.generatedAt]);

  function navigateTo(idx: number) {
    if (!digest) return;
    const clamped = Math.max(0, Math.min(idx, digest.entries.length - 1));
    setCurrentEntryState(clamped);
    localStorage.setItem("thebrief_entry", String(clamped));
    setTimeout(() => {
      entryRefs.current[clamped]?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  }

  return (
    <div style={{ maxWidth: "720px", margin: "0 auto", padding: "0 1.5rem 6rem" }}>
      {/* Masthead */}
      <div className="masthead fade-up">
        <p
          className="font-mono"
          style={{
            fontSize: "0.65rem",
            letterSpacing: "0.3em",
            color: "var(--muted)",
            textTransform: "uppercase",
            marginBottom: "0.4rem",
          }}
        >
          Personal Edition · {digest ? digest.dateRange : "Loading..."}
        </p>
        <h1 className="font-serif" style={{ fontSize: "4rem", margin: "0", lineHeight: 1 }}>
          The Brief
        </h1>
        <p className="font-serif" style={{ color: "var(--muted)", fontStyle: "italic", marginTop: "0.4rem" }}>
          Good evening, {name}.
        </p>
      </div>

      {/* Controls */}
      <div
        className="fade-up fade-up-delay-1"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "1rem 0",
          borderBottom: "1px solid var(--border)",
          marginBottom: "1.5rem",
        }}
      >
        {digest && digest.entries.length > 0 ? (
          <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
            <button
              onClick={() => navigateTo(currentEntry - 1)}
              disabled={currentEntry === 0}
              style={{
                background: "none", border: "none", fontFamily: "DM Mono", fontSize: "0.8rem",
                color: currentEntry === 0 ? "var(--border)" : "var(--muted)",
                cursor: currentEntry === 0 ? "default" : "pointer",
                padding: "0 0.15rem", lineHeight: 1,
              }}
            >←</button>
            <span className="font-mono" style={{ fontSize: "0.7rem", color: "var(--muted)", letterSpacing: "0.05em" }}>
              {currentEntry + 1} / {digest.entries.length} NEWSLETTERS
            </span>
            <button
              onClick={() => navigateTo(currentEntry + 1)}
              disabled={currentEntry === digest.entries.length - 1}
              style={{
                background: "none", border: "none", fontFamily: "DM Mono", fontSize: "0.8rem",
                color: currentEntry === digest.entries.length - 1 ? "var(--border)" : "var(--muted)",
                cursor: currentEntry === digest.entries.length - 1 ? "default" : "pointer",
                padding: "0 0.15rem", lineHeight: 1,
              }}
            >→</button>
          </div>
        ) : (
          <span className="font-mono" style={{ fontSize: "0.7rem", color: "var(--muted)", letterSpacing: "0.05em" }}>
            {digest ? "NO NEWSLETTERS THIS PERIOD" : "NO DIGEST YET"}
          </span>
        )}
        <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
          <button className="btn-primary" onClick={onRefresh} disabled={refreshing}>
            {refreshing ? "Generating..." : "↻ Generate Now"}
          </button>
          <button
            onClick={() => signOut()}
            style={{
              background: "none", border: "1px solid var(--border)", padding: "0.5rem 1rem",
              fontFamily: "DM Mono", fontSize: "0.75rem", cursor: "pointer", color: "var(--muted)",
            }}
          >
            Sign out
          </button>
        </div>
      </div>

      {/* Loading state */}
      {refreshing && (
        <div style={{ textAlign: "center", padding: "4rem 0", color: "var(--muted)" }}>
          <p className="font-serif loading-pulse" style={{ fontSize: "1.5rem" }}>
            Reading your inbox...
          </p>
          <p className="font-mono" style={{ fontSize: "0.75rem", marginTop: "0.75rem", letterSpacing: "0.05em" }}>
            This takes 1–2 minutes. Sit tight.
          </p>
        </div>
      )}

      {/* No digest yet */}
      {!digest && !refreshing && (
        <div style={{ textAlign: "center", padding: "4rem 0" }}>
          <p className="font-serif" style={{ fontSize: "1.5rem", color: "var(--muted)" }}>No digest yet.</p>
          <p style={{ color: "var(--muted)", marginTop: "0.5rem" }}>
            Hit "Generate Now" to read your first briefing.
          </p>
        </div>
      )}

      {/* Digest content */}
      {digest && !refreshing && (
        <div className="fade-up fade-up-delay-2">
          {digest.entries.length > 0 && (
            <VoicePlayer ref={voicePlayerRef} digest={digest} onReadingEntry={setReadingEntry} />
          )}

          {digest.overallHighlights && digest.entries.length > 0 && (
            <div style={{ marginBottom: "2.5rem" }}>
              <p
                className="font-mono"
                style={{
                  fontSize: "0.65rem", letterSpacing: "0.2em", textTransform: "uppercase",
                  color: "var(--muted)", marginBottom: "0.75rem",
                }}
              >
                ★ This Period's Highlights
              </p>
              <div className="highlights-box">
                <p className="font-serif" style={{ fontSize: "1.1rem", lineHeight: 1.7, margin: 0 }}>
                  {digest.overallHighlights}
                </p>
              </div>
            </div>
          )}

          <hr className="rule" />

          {digest.entries.length === 0 && (
            <div style={{ textAlign: "center", padding: "3rem 0", color: "var(--muted)" }}>
              <p className="font-serif" style={{ fontSize: "1.25rem" }}>No newsletters found this period.</p>
              <p style={{ fontSize: "0.85rem", marginTop: "0.5rem" }}>
                Check that Gmail can see your inbox, or add senders to CUSTOM_SENDERS in your env.
              </p>
            </div>
          )}

          {digest.entries.map((entry, i) => {
            const isReading = readingEntry === i;
            const isFocused = i === currentEntry;
            return (
              <div key={i} ref={(el) => { entryRefs.current[i] = el; }}>
                <div
                  className="digest-card"
                  onClick={() => {
                    navigateTo(i);
                    voicePlayerRef.current?.jumpToEntry(i);
                  }}
                  style={{
                    position: "relative",
                    opacity: isReading ? 1 : (readingEntry !== null ? 0.3 : isFocused ? 1 : 0.45),
                    cursor: "pointer",
                    transition: "opacity 0.3s, outline 0.2s",
                    outline: isReading ? "2px solid var(--accent)" : isFocused ? "1px solid var(--border)" : "none",
                    outlineOffset: "2px",
                    background: isReading ? "rgba(180,60,40,0.05)" : undefined,
                  }}
                >
                  {/* NOW READING badge */}
                  {isReading && (
                    <div
                      className="font-mono"
                      style={{
                        position: "absolute", top: "0.75rem", right: "0.75rem",
                        fontSize: "0.55rem", letterSpacing: "0.15em", color: "var(--accent)",
                        display: "flex", alignItems: "center", gap: "0.3rem",
                      }}
                    >
                      ▶ NOW READING
                    </div>
                  )}

                  {/* Sender + date */}
                  <div
                    style={{
                      display: "flex", justifyContent: "space-between", alignItems: "flex-start",
                      marginBottom: "0.5rem", flexWrap: "wrap", gap: "0.5rem",
                    }}
                  >
                    <div>
                      <span className="font-serif" style={{ fontSize: "1.15rem", color: "var(--ink)" }}>
                        {entry.sender}
                      </span>
                      <span
                        className="font-mono"
                        style={{ fontSize: "0.65rem", color: "var(--muted)", marginLeft: "0.75rem", letterSpacing: "0.05em" }}
                      >
                        {entry.senderEmail}
                      </span>
                    </div>
                    <span className="font-mono" style={{ fontSize: "0.65rem", color: "var(--muted)", letterSpacing: "0.03em" }}>
                      {entry.date ? new Date(entry.date).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : ""}
                    </span>
                  </div>

                  {/* Subject */}
                  <p
                    style={{
                      fontSize: "0.8rem", color: "var(--accent)", fontWeight: 500,
                      marginBottom: entry.tagline ? "0.35rem" : "0.75rem", letterSpacing: "0.01em",
                    }}
                  >
                    {entry.subject}
                  </p>

                  {/* Tagline — AI-generated witty genre hook */}
                  {entry.tagline && (
                    <p
                      className="font-mono"
                      style={{
                        fontSize: "0.72rem", color: "var(--muted)", fontStyle: "italic",
                        marginBottom: "0.75rem", letterSpacing: "0.02em",
                      }}
                    >
                      {entry.tagline}
                    </p>
                  )}

                  {/* Summary */}
                  <p style={{ lineHeight: 1.75, color: "var(--ink)", fontSize: "0.95rem" }}>
                    {entry.summary}
                  </p>
                </div>

                {i < digest.entries.length - 1 && <hr className="rule-thin" />}
              </div>
            );
          })}

          <hr className="rule" />
          <p
            className="font-mono"
            style={{ textAlign: "center", fontSize: "0.65rem", color: "var(--muted)", letterSpacing: "0.1em" }}
          >
            THE BRIEF · AUTO-GENERATES SUNDAY & WEDNESDAY 7PM · YOUR EYES ONLY
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Home ─────────────────────────────────────────────────────────────────────

export default function Home() {
  const { data: session, status } = useSession();
  const [digest, setDigest] = useState<Digest | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [autoPlay, setAutoPlay] = useState(false);

  useEffect(() => {
    if (session && !loaded) {
      fetchDigest();
      setLoaded(true);
    }
  }, [session]);

  async function fetchDigest() {
    try {
      const res = await fetch("/api/digest");
      const data = await res.json();
      if (data.digest) setDigest(data.digest);
    } catch (err) {
      console.error("Failed to fetch digest:", err);
    }
  }

  async function generateDigest() {
    setRefreshing(true);
    try {
      const res = await fetch("/api/newsletters", { method: "POST" });
      const contentType = res.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        throw new Error(`Server error (${res.status}) — the AI is taking too long. Try again in a moment.`);
      }
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      if (data.digest) {
        setDigest(data.digest);
        setAutoPlay(true); // trigger auto-play; browser may block it — that's fine
      }
    } catch (err: any) {
      console.error("Failed to generate:", err);
      alert(err.message || "Failed to generate digest. Please try again.");
    } finally {
      setRefreshing(false);
    }
  }

  if (status === "loading") {
    return (
      <div className="signin-container">
        <p className="font-serif loading-pulse" style={{ fontSize: "1.5rem", color: "var(--muted)" }}>
          Loading...
        </p>
      </div>
    );
  }

  if (!session) return <SignInPage />;

  return (
    <DigestPage
      digest={digest}
      onRefresh={generateDigest}
      refreshing={refreshing}
      autoPlay={autoPlay}
      onAutoPlayConsumed={() => setAutoPlay(false)}
    />
  );
}
