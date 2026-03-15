// Voice pool for The Brief — all English, multiple accents & genders
// Journey voices = highest quality (US/GB only)
// Neural2 = excellent quality
// Standard = functional (NG fallback)

export interface VoiceConfig {
  name: string;           // Google TTS voice name
  languageCode: string;   // BCP-47 code
  label: string;          // City / region display name
  gender: "F" | "M";
  flag: string;           // Emoji flag
  style: "american" | "british" | "other"; // determines reading framing
}

export const VOICE_POOL: Record<string, VoiceConfig> = {
  // ── American ─────────────────────────────────────────────────
  "californian-f": {
    name: "en-US-Journey-F",
    languageCode: "en-US",
    label: "Californian",
    gender: "F",
    flag: "🇺🇸",
    style: "american",
  },
  "bronx-m": {
    name: "en-US-Journey-D",
    languageCode: "en-US",
    label: "Bronx",
    gender: "M",
    flag: "🗽",
    style: "american",
  },

  // ── British ───────────────────────────────────────────────────
  "manchester-f": {
    name: "en-GB-Journey-F",
    languageCode: "en-GB",
    label: "Manchester",
    gender: "F",
    flag: "🇬🇧",
    style: "british",
  },
  "liverpool-m": {
    name: "en-GB-Neural2-B",
    languageCode: "en-GB",
    label: "Liverpool",
    gender: "M",
    flag: "🇬🇧",
    style: "british",
  },

  // ── Australian ────────────────────────────────────────────────
  "sydney-f": {
    name: "en-AU-Neural2-A",
    languageCode: "en-AU",
    label: "Sydney",
    gender: "F",
    flag: "🇦🇺",
    style: "other",
  },
  "melbourne-m": {
    name: "en-AU-Neural2-B",
    languageCode: "en-AU",
    label: "Melbourne",
    gender: "M",
    flag: "🇦🇺",
    style: "other",
  },

  // ── Indian ────────────────────────────────────────────────────
  // (en-NG not supported by Google TTS; en-IN Neural2 is the best non-Western option)
  "delhi-m": {
    name: "en-IN-Neural2-B",
    languageCode: "en-IN",
    label: "Delhi",
    gender: "M",
    flag: "🇮🇳",
    style: "other",
  },
};

export type VoiceKey = string;
export const VOICE_KEYS = Object.keys(VOICE_POOL);

export function getDefaultVoice(): VoiceKey {
  const day = new Date().getDay();
  return day === 3 ? "manchester-f" : "californian-f";
}

/** Shuffled rotation queue, excluding the current voice */
export function buildRotationQueue(currentKey: VoiceKey): VoiceKey[] {
  return VOICE_KEYS.filter((k) => k !== currentKey).sort(() => Math.random() - 0.5);
}

// ── Legacy shims (keep old imports working) ───────────────────
export type VoiceDay = VoiceKey;
export const VOICES = VOICE_POOL;
export function getTodayVoice(): VoiceKey { return getDefaultVoice(); }
