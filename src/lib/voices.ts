// Voice configuration for PVB
// Sunday = Californian (Journey - warm, American female)
// Wednesday = Manc British (en-GB-Neural2-C - British female)

export type VoiceDay = "sunday" | "wednesday";

export interface VoiceConfig {
  name: string;
  languageCode: string;
  label: string;
  description: string;
}

export const VOICES: Record<VoiceDay, VoiceConfig> = {
  sunday: {
    name: "en-US-Journey-F",
    languageCode: "en-US",
    label: "Californian",
    description: "Warm · American · Sunday",
  },
  wednesday: {
    name: "en-GB-Neural2-C",
    languageCode: "en-GB",
    label: "Manchester",
    description: "Dry · British · Wednesday",
  },
};

export function getTodayVoice(): VoiceDay {
  const day = new Date().getDay(); // 0 = Sunday, 3 = Wednesday
  return day === 3 ? "wednesday" : "sunday";
}
