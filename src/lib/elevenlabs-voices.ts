export interface CuratedVoice {
  id: string;
  name: string;
  accent: string;
  style: string;
  stability: number;
  similarityBoost: number;
}

export const ELEVENLABS_STS_MODEL = "eleven_multilingual_sts_v2";

export const CURATED_VOICES: CuratedVoice[] = [
  { id: "nPczCjzI2devNBz1zQrb", name: "Brian",    accent: "American",        style: "Deep Narrator",           stability: 0.71, similarityBoost: 0.5  },
  { id: "EXAVITQu4vr4xnSDxMaL", name: "Sarah",    accent: "American",        style: "Warm & Clear",            stability: 0.75, similarityBoost: 0.75 },
  { id: "TX3LPaxmHKxFdv7VOQHJ", name: "Liam",     accent: "American",        style: "Youthful & Energetic",    stability: 0.5,  similarityBoost: 0.75 },
  { id: "pqHfZKP75CvOlQylNhV4", name: "Bill",     accent: "American",        style: "Documentary Whisper",     stability: 0.85, similarityBoost: 0.35 },
  { id: "ThT5KcBeYPX3keUQqHPh", name: "Dorothy",  accent: "British",         style: "Crisp & Authoritative",   stability: 0.8,  similarityBoost: 0.75 },
  { id: "jsCqWAovK2LkecY7zXl4", name: "Freya",    accent: "American",        style: "Intimate & Poetic",       stability: 0.6,  similarityBoost: 0.8  },
  { id: "IKne3meq5aSn9XLyUdCD", name: "Charlie",  accent: "Australian",      style: "Laid-back & Trustworthy", stability: 0.82, similarityBoost: 0.63 },
  { id: "XB0fDUnXU5powFXDhCwa", name: "Charlotte", accent: "Swedish-English", style: "Cool & Cinematic",       stability: 0.65, similarityBoost: 0.45 },
  { id: "onwK4e9ZLuTAKqWW03F9", name: "Daniel",   accent: "British",         style: "News Anchor",             stability: 0.9,  similarityBoost: 0.75 },
];
