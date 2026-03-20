"use client";

import { useSession, signIn, signOut } from "next-auth/react";
import { useEffect, useState, useRef, forwardRef, useImperativeHandle } from "react";
import { createPortal } from "react-dom";
import { Digest, SarcasmLevel } from "@/lib/gemini";
import { VOICE_POOL, VOICE_KEYS, VoiceKey, getDefaultVoice, buildRotationQueue } from "@/lib/voices";

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

function buildSegments(d: Digest, voiceKey: VoiceKey): Segment[] {
  const style = VOICE_POOL[voiceKey]?.style ?? "other";
  const intro =
    style === "american"
      ? `Alright. The Brief. ${d.dateRange}. ${d.overallHighlights}`
      : style === "british"
      ? `Right, let's go. The Brief. ${d.dateRange}. ${d.overallHighlights}`
      : `Here's The Brief. ${d.dateRange}. ${d.overallHighlights}`;
  return [
    { text: intro, entryIndex: null, label: "Introduction" },
    ...d.entries.map((e, i) => {
      const hook = e.tagline || e.sender;
      const text =
        style === "american"
          ? `${hook}. ${e.summary}`
          : style === "british"
          ? `${hook}. Right, so — ${e.summary}`
          : `${hook}. ${e.summary}`;
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
  const [selectedVoice, setSelectedVoice] = useState<VoiceKey>(getDefaultVoice());
  const [readingState, setReadingState] = useState<"idle" | "loading" | "playing" | "paused">("idle");
  const [currentLabel, setCurrentLabel] = useState("");
  const [speed, setSpeed] = useState(1);
  const [autoRotate, setAutoRotate] = useState(true);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const segmentsRef = useRef<Segment[]>([]);
  const playIdRef = useRef(0);
  const segmentIndexRef = useRef(0);
  const voiceRef = useRef<VoiceKey>(getDefaultVoice());
  const speedRef = useRef(1);
  const onReadingEntryRef = useRef(onReadingEntry);
  const emailsPlayedRef = useRef(0);
  const rotationQueueRef = useRef<VoiceKey[]>([]);
  const autoRotateRef = useRef(true);

  useEffect(() => { speedRef.current = speed; if (audioRef.current) audioRef.current.playbackRate = speed; }, [speed]);
  useEffect(() => { onReadingEntryRef.current = onReadingEntry; }, [onReadingEntry]);
  useEffect(() => { autoRotateRef.current = autoRotate; }, [autoRotate]);

  function applyVoice(key: VoiceKey) {
    voiceRef.current = key;
    setSelectedVoice(key);
  }

  function cancelCurrent(): number {
    const newPlayId = ++playIdRef.current;
    if (audioRef.current) {
      audioRef.current.onended = null;
      audioRef.current.pause();
      audioRef.current = null;
    }
    return newPlayId;
  }

  function getNextRotationVoice(): VoiceKey {
    if (!rotationQueueRef.current.length) {
      rotationQueueRef.current = buildRotationQueue(voiceRef.current);
    }
    return rotationQueueRef.current.shift()!;
  }

  async function playSegmentAt(index: number, playId: number) {
    if (playIdRef.current !== playId) return;
    const segments = segmentsRef.current;

    if (index >= segments.length) {
      setReadingState("idle");
      setCurrentLabel("");
      onReadingEntryRef.current(null);
      segmentIndexRef.current = 0;
      // Speak completion phrase via TTS (same voice, reliable after screen-off)
      const endings = [
        "That's your briefing done. Go conquer.",
        "And that's a wrap. You're now the most informed person in the room.",
        "All caught up. Go do something with it.",
        "That's everything. You're welcome.",
        "Briefing complete. The world makes slightly more sense now.",
      ];
      const endText = endings[Math.floor(Math.random() * endings.length)];
      fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: endText, voice: voiceRef.current }),
      })
        .then((r) => r.json())
        .then((d) => {
          if (!d.audioContent) return;
          const a = new Audio(`data:audio/mp3;base64,${d.audioContent}`);
          a.playbackRate = speedRef.current;
          a.play().catch(() => {});
        })
        .catch(() => {
          // fallback: Web Speech
          if (typeof window !== "undefined" && window.speechSynthesis) {
            window.speechSynthesis.cancel();
            const u = new SpeechSynthesisUtterance(endText);
            u.rate = speedRef.current;
            window.speechSynthesis.speak(u);
          }
        });
      return;
    }

    const seg = segments[index];
    segmentIndexRef.current = index;
    setReadingState("loading");
    setCurrentLabel(seg.label);
    onReadingEntryRef.current(seg.entryIndex);

    // Speak a bridge phrase (instant, browser voice) while TTS audio fetches
    const isEmailTransition = index > 0 && segments[index - 1]?.entryIndex !== seg.entryIndex;
    if (isEmailTransition && typeof window !== "undefined" && window.speechSynthesis) {
      const bridges = [
        "Hold tight, getting the next one…",
        "One moment, loading your next story…",
        "Next up, just a second…",
        "Coming right up…",
        "Loading the next story, bear with me…",
      ];
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(bridges[Math.floor(Math.random() * bridges.length)]);
      utter.rate = speedRef.current;
      window.speechSynthesis.speak(utter);
    }

    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: seg.text, voice: voiceRef.current }),
      });
      const data = await res.json();
      if (!data.audioContent) throw new Error("No audio returned");
      if (playIdRef.current !== playId) return;

      // Stop bridge phrase the moment real audio is ready
      if (typeof window !== "undefined" && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }

      const audio = new Audio(`data:audio/mp3;base64,${data.audioContent}`);
      audioRef.current = audio;
      audio.playbackRate = speedRef.current;

      // Register with OS Media Session so audio keeps playing on lock screen
      // and lock-screen transport controls work
      if (typeof navigator !== "undefined" && "mediaSession" in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: seg.label || "The Brief",
          artist: VOICE_POOL[voiceRef.current]?.label ?? "The Brief",
          album: "The Brief",
        });
        navigator.mediaSession.setActionHandler("play", () => { audio.play(); setReadingState("playing"); });
        navigator.mediaSession.setActionHandler("pause", () => { audio.pause(); setReadingState("paused"); });
        navigator.mediaSession.setActionHandler("previoustrack", () => skipTo(segmentIndexRef.current - 1));
        navigator.mediaSession.setActionHandler("nexttrack", () => skipTo(segmentIndexRef.current + 1));
        navigator.mediaSession.setActionHandler("stop", () => stopAll());
      }
      audio.onended = () => {
        if (playIdRef.current !== playId) return;
        // Auto-rotate: every 3 emails played, switch accent
        if (seg.entryIndex !== null) {
          emailsPlayedRef.current++;
          if (autoRotateRef.current && emailsPlayedRef.current % 3 === 0) {
            const nextVoice = getNextRotationVoice();
            applyVoice(nextVoice);
            // Rebuild segments with new voice framing for remaining entries
            const newSegs = buildSegments(digest, nextVoice);
            segmentsRef.current = newSegs;
            playSegmentAt(index + 1, playId);
            return;
          }
        }
        playSegmentAt(index + 1, playId);
      };
      audio.play();
      setReadingState("playing");
    } catch (err) {
      if (playIdRef.current !== playId) return;
      if (typeof window !== "undefined" && window.speechSynthesis) window.speechSynthesis.cancel();
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

  function switchVoice(newVoice: VoiceKey) {
    const currentIndex = segmentIndexRef.current;
    const wasActive = readingState !== "idle";
    const newPlayId = cancelCurrent();
    applyVoice(newVoice);
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

  function handlePlayPause() {
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
    emailsPlayedRef.current = 0;
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
      emailsPlayedRef.current = 0;
      const playId = cancelCurrent();
      playSegmentAt(0, playId);
    },
  }), [digest]);

  function cycleSpeed() {
    setSpeed((s) => (s === 0.75 ? 1 : s === 1 ? 1.25 : 0.75));
  }

  function stopAll() {
    cancelCurrent();
    setReadingState("idle");
    setCurrentLabel("");
    onReadingEntryRef.current(null);
    segmentIndexRef.current = 0;
  }

  const activeVoice = VOICE_POOL[selectedVoice];
  const isActive = readingState !== "idle";
  const totalSegs = segmentsRef.current.length;
  const canPrev = isActive && segmentIndexRef.current > 0;
  const canNext = isActive && segmentIndexRef.current < totalSegs - 1;

  return (
    <>
      {/* ── Top player bar ─────────────────────────────────────────── */}
      <div
        style={{
          background: "var(--ink)",
          marginBottom: "1.5rem",
          padding: "0.75rem 1rem",
        }}
      >
        {/* Row 1: transport + label + auto-rotate */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <button
            onClick={handlePlayPause}
            disabled={readingState === "loading"}
            style={{
              background: "var(--accent)",
              border: "none",
              color: "white",
              width: "2.25rem",
              height: "2.25rem",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: readingState === "loading" ? "not-allowed" : "pointer",
              fontSize: "0.9rem",
              flexShrink: 0,
            }}
          >
            {readingState === "loading" ? "…" : readingState === "playing" ? "⏸" : "▶"}
          </button>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              className="font-mono"
              style={{ fontSize: "0.6rem", color: "rgba(245,240,232,0.45)", letterSpacing: "0.1em", marginBottom: "0.1rem" }}
            >
              {isActive ? "NOW READING" : "READ ALOUD WITH"}
            </div>
            <div
              className="font-serif"
              style={{ color: "var(--paper)", fontSize: "0.9rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
            >
              {isActive && currentLabel
                ? currentLabel
                : `${activeVoice?.flag ?? ""} ${activeVoice?.label ?? ""}`}
            </div>
          </div>

          {/* Auto-rotate toggle */}
          <button
            onClick={() => setAutoRotate((v) => !v)}
            title="Auto-rotate accent every 5 emails"
            style={{
              background: autoRotate ? "var(--accent)" : "rgba(245,240,232,0.08)",
              border: "1px solid",
              borderColor: autoRotate ? "var(--accent)" : "rgba(245,240,232,0.15)",
              color: autoRotate ? "white" : "rgba(245,240,232,0.45)",
              padding: "0.25rem 0.5rem",
              fontFamily: "DM Mono",
              fontSize: "0.55rem",
              letterSpacing: "0.08em",
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            {autoRotate ? "AUTO ✓" : "AUTO"}
          </button>
        </div>

        {/* Row 2: voice chips — horizontally scrollable */}
        <div
          style={{
            display: "flex",
            gap: "0.4rem",
            marginTop: "0.65rem",
            overflowX: "auto",
            paddingBottom: "2px",
            // hide scrollbar visually
            scrollbarWidth: "none",
          }}
        >
          {VOICE_KEYS.map((key) => {
            const v = VOICE_POOL[key];
            const isSelected = key === selectedVoice;
            return (
              <button
                key={key}
                onClick={() => switchVoice(key)}
                style={{
                  background: isSelected ? "var(--accent)" : "transparent",
                  border: "1px solid",
                  borderColor: isSelected ? "var(--accent)" : "rgba(245,240,232,0.18)",
                  color: isSelected ? "white" : "rgba(245,240,232,0.5)",
                  padding: "0.2rem 0.55rem",
                  fontFamily: "DM Mono",
                  fontSize: "0.6rem",
                  letterSpacing: "0.04em",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  flexShrink: 0,
                }}
              >
                {v.flag} {v.label} {v.gender === "F" ? "♀" : "♂"}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Floating mini-player — portalled to body to escape any CSS transform ── */}
      {mounted && createPortal(
        <div
          style={{
            position: "fixed",
            bottom: 0,
            left: 0,
            right: 0,
            paddingBottom: "env(safe-area-inset-bottom, 0px)",
            background: "var(--ink)",
            borderTop: "1px solid rgba(245,240,232,0.15)",
            zIndex: 9999,
          }}
        >
          <div style={{ maxWidth: "720px", margin: "0 auto", padding: "0.75rem 1rem 0.4rem" }}>

            {/* Row 1: transport + label + speed + scroll-up */}
            <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
              {/* Transport buttons */}
              <div style={{ display: "flex", alignItems: "center", gap: "0.2rem", flexShrink: 0 }}>
                <button
                  onClick={() => skipTo(segmentIndexRef.current - 1)}
                  disabled={!canPrev}
                  style={{
                    background: "none", border: "none",
                    color: canPrev ? "var(--paper)" : "rgba(245,240,232,0.2)",
                    cursor: canPrev ? "pointer" : "default",
                    fontSize: "1.6rem", padding: "0.15rem 0.3rem", lineHeight: 1,
                  }}
                >⏮</button>
                <button
                  onClick={handlePlayPause}
                  style={{
                    background: "var(--accent)", border: "none", color: "white",
                    width: "2.8rem", height: "2.8rem", borderRadius: "50%",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    cursor: "pointer", fontSize: "1.1rem", flexShrink: 0,
                  }}
                >
                  {readingState === "loading" ? "…" : readingState === "playing" ? "⏸" : "▶"}
                </button>
                <button
                  onClick={() => skipTo(segmentIndexRef.current + 1)}
                  disabled={!canNext}
                  style={{
                    background: "none", border: "none",
                    color: canNext ? "var(--paper)" : "rgba(245,240,232,0.2)",
                    cursor: canNext ? "pointer" : "default",
                    fontSize: "1.6rem", padding: "0.15rem 0.3rem", lineHeight: 1,
                  }}
                >⏭</button>
                <button
                  onClick={stopAll}
                  disabled={!isActive}
                  style={{
                    background: "none", border: "none",
                    color: isActive ? "rgba(245,240,232,0.6)" : "rgba(245,240,232,0.15)",
                    cursor: isActive ? "pointer" : "default",
                    fontSize: "1.2rem", padding: "0.15rem 0.2rem", lineHeight: 1,
                  }}
                  title="Stop"
                >⏹</button>
              </div>

              {/* Label */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  className="font-serif"
                  style={{
                    color: isActive ? "var(--paper)" : "rgba(245,240,232,0.3)",
                    fontSize: "0.92rem",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}
                >
                  {readingState === "loading"
                    ? "Hold tight, getting the next part…"
                    : currentLabel || "The Brief"}
                </div>
                <div
                  className="font-mono"
                  style={{ fontSize: "0.62rem", color: "rgba(245,240,232,0.4)", marginTop: "0.15rem" }}
                >
                  {activeVoice?.flag} {activeVoice?.label} {activeVoice?.gender === "F" ? "♀" : "♂"}
                  {autoRotate && " · AUTO"}
                </div>
              </div>

              {/* Speed + scroll-up */}
              <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", flexShrink: 0 }}>
                <button
                  onClick={cycleSpeed}
                  style={{
                    background: "rgba(245,240,232,0.12)", border: "1px solid rgba(245,240,232,0.15)",
                    color: "var(--paper)", padding: "0.3rem 0.55rem", fontFamily: "DM Mono",
                    borderRadius: "4px", fontSize: "0.72rem", cursor: "pointer", letterSpacing: "0.03em",
                  }}
                >
                  {speed}×
                </button>
                <button
                  onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
                  style={{
                    background: "rgba(245,240,232,0.08)", border: "1px solid rgba(245,240,232,0.15)",
                    color: "rgba(245,240,232,0.55)", cursor: "pointer", borderRadius: "4px",
                    fontSize: "1.1rem", padding: "0.25rem 0.4rem", lineHeight: 1,
                  }}
                  title="Back to top"
                >↑</button>
              </div>
            </div>

            {/* Row 2: voice chips — pill shaped, easier to tap */}
            <div
              style={{
                display: "flex",
                gap: "0.4rem",
                marginTop: "0.55rem",
                marginBottom: "0.15rem",
                overflowX: "auto",
                scrollbarWidth: "none",
              }}
            >
              {VOICE_KEYS.map((key) => {
                const v = VOICE_POOL[key];
                const isSel = key === selectedVoice;
                return (
                  <button
                    key={key}
                    onClick={() => switchVoice(key)}
                    style={{
                      background: isSel ? "var(--accent)" : "rgba(245,240,232,0.07)",
                      border: "1px solid",
                      borderColor: isSel ? "var(--accent)" : "rgba(245,240,232,0.2)",
                      color: isSel ? "white" : "rgba(245,240,232,0.65)",
                      padding: "0.3rem 0.7rem",
                      borderRadius: "999px",
                      fontFamily: "DM Mono",
                      fontSize: "0.7rem",
                      letterSpacing: "0.03em",
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                      flexShrink: 0,
                    }}
                  >
                    {v.flag} {v.label} {v.gender === "F" ? "♀" : "♂"}
                  </button>
                );
              })}
            </div>

          </div>
        </div>,
        document.body
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
  cacheAge,
  sarcasmLevel,
  onSarcasmChange,
}: {
  digest: Digest | null;
  onRefresh: () => void;
  refreshing: boolean;
  autoPlay: boolean;
  onAutoPlayConsumed: () => void;
  cacheAge: string | null;
  sarcasmLevel: SarcasmLevel;
  onSarcasmChange: (l: SarcasmLevel) => void;
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
    <div style={{ maxWidth: "720px", margin: "0 auto", padding: "0 1.5rem 9rem" }}>
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
        <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
          {/* Sarcasm / tone toggle */}
          <div style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
            {(["subtle", "balanced", "sharp"] as SarcasmLevel[]).map((lvl) => {
              const labels = { subtle: "Dry", balanced: "Balanced", sharp: "Sharp" };
              const active = sarcasmLevel === lvl;
              return (
                <button
                  key={lvl}
                  onClick={() => onSarcasmChange(lvl)}
                  title={`Tone: ${lvl}`}
                  style={{
                    background: active ? "var(--ink)" : "transparent",
                    border: "1px solid",
                    borderColor: active ? "var(--ink)" : "var(--border)",
                    color: active ? "var(--paper)" : "var(--muted)",
                    padding: "0.2rem 0.5rem",
                    fontFamily: "DM Mono",
                    fontSize: "0.6rem",
                    letterSpacing: "0.06em",
                    cursor: "pointer",
                    borderRadius: "3px",
                  }}
                >
                  {labels[lvl]}
                </button>
              );
            })}
          </div>
          {cacheAge && (
            <span
              className="font-mono"
              style={{
                fontSize: "0.6rem", color: "var(--muted)", letterSpacing: "0.05em",
                background: "rgba(180,60,40,0.08)", border: "1px solid var(--border)",
                padding: "0.2rem 0.5rem", borderRadius: "3px",
              }}
              title="Loaded from local cache — hit Generate Now for fresh content"
            >
              ⚡ cached · {cacheAge}
            </span>
          )}
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

// ─── localStorage digest cache ───────────────────────────────────────────────

const DIGEST_CACHE_KEY = "thebrief_digest_v1";
const DIGEST_CACHE_TTL = 3 * 60 * 60 * 1000; // 3 hours

function readDigestCache(): { digest: Digest; savedAt: number } | null {
  try {
    const raw = localStorage.getItem(DIGEST_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Date.now() - parsed.savedAt > DIGEST_CACHE_TTL) return null;
    return parsed;
  } catch { return null; }
}

function writeDigestCache(digest: Digest) {
  try {
    localStorage.setItem(DIGEST_CACHE_KEY, JSON.stringify({ digest, savedAt: Date.now() }));
  } catch { /* storage quota — ignore */ }
}

function formatCacheAge(savedAt: number): string {
  const mins = Math.floor((Date.now() - savedAt) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem > 0 ? `${hrs}h ${rem}m ago` : `${hrs}h ago`;
}

// ─── Home ─────────────────────────────────────────────────────────────────────

export default function Home() {
  const { data: session, status } = useSession();
  const [digest, setDigest] = useState<Digest | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [autoPlay, setAutoPlay] = useState(false);
  const [cacheAge, setCacheAge] = useState<string | null>(null);
  const [sarcasmLevel, setSarcasmLevel] = useState<SarcasmLevel>(() => {
    if (typeof window === "undefined") return "balanced";
    return (localStorage.getItem("thebrief_sarcasm") as SarcasmLevel) ?? "balanced";
  });

  function updateSarcasmLevel(level: SarcasmLevel) {
    setSarcasmLevel(level);
    localStorage.setItem("thebrief_sarcasm", level);
  }

  useEffect(() => {
    if (session && !loaded) {
      // Instantly show cached digest if fresh enough
      const cached = readDigestCache();
      if (cached) {
        setDigest(cached.digest);
        setCacheAge(formatCacheAge(cached.savedAt));
      }
      // Still fetch from server in background (gets fresher data if available)
      fetchDigest();
      setLoaded(true);
    }
  }, [session]);

  async function fetchDigest() {
    try {
      const res = await fetch("/api/digest");
      const data = await res.json();
      if (data.digest) {
        setDigest(data.digest);
        writeDigestCache(data.digest);
        setCacheAge(null); // clear "from cache" banner — this is fresh
      }
    } catch (err) {
      console.error("Failed to fetch digest:", err);
    }
  }

  async function generateDigest() {
    setRefreshing(true);
    try {
      const res = await fetch("/api/newsletters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sarcasmLevel }),
      });
      const contentType = res.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        throw new Error(`Server error (${res.status}) — the AI is taking too long. Try again in a moment.`);
      }
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      if (data.digest) {
        setDigest(data.digest);
        writeDigestCache(data.digest);
        setCacheAge(null);
        setAutoPlay(true);
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
      cacheAge={cacheAge}
      sarcasmLevel={sarcasmLevel}
      onSarcasmChange={updateSarcasmLevel}
    />
  );
}
