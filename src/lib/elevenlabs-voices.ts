export interface CuratedVoice {
  id: string;
  name: string;
  accent: string;
  style: string;
  description: string;
  tags: string[];
  stability: number;
  similarityBoost: number;
}

export const ELEVENLABS_STS_MODEL = "eleven_multilingual_sts_v2";

export const CURATED_VOICES: CuratedVoice[] = [
  {
    id: "nPczCjzI2devNBz1zQrb",
    name: "Brian",
    accent: "American",
    style: "Deep Narrator",
    description:
      "Authoritative, cinematic. Perfect for trailers and documentary openers.",
    tags: ["deep", "cinematic", "trailer"],
    stability: 0.71,
    similarityBoost: 0.5,
  },
  {
    id: "EXAVITQu4vr4xnSDxMaL",
    name: "Sarah",
    accent: "American",
    style: "Warm & Clear",
    description:
      "Conversational warmth for explainers, vlogs, and brand storytelling.",
    tags: ["warm", "friendly", "explainer"],
    stability: 0.75,
    similarityBoost: 0.75,
  },
  {
    id: "TX3LPaxmHKxFdv7VOQHJ",
    name: "Liam",
    accent: "American",
    style: "Youthful & Energetic",
    description:
      "High energy for social media, YouTube, and product demos.",
    tags: ["energetic", "young", "youtube"],
    stability: 0.5,
    similarityBoost: 0.75,
  },
  {
    id: "pqHfZKP75CvOlQylNhV4",
    name: "Bill",
    accent: "American",
    style: "Documentary Whisper",
    description:
      "Low, measured delivery. David Attenborough energy for nature and human interest.",
    tags: ["documentary", "calm", "measured"],
    stability: 0.85,
    similarityBoost: 0.35,
  },
  {
    id: "ThT5KcBeYPX3keUQqHPh",
    name: "Dorothy",
    accent: "British",
    style: "Crisp & Authoritative",
    description:
      "British precision. Works brilliantly for news-style narration and corporate.",
    tags: ["british", "authoritative", "news"],
    stability: 0.8,
    similarityBoost: 0.75,
  },
  {
    id: "jsCqWAovK2LkecY7zXl4",
    name: "Freya",
    accent: "American",
    style: "Intimate & Poetic",
    description:
      "Hushed, breathy storytelling for short films, poetry, and emotional content.",
    tags: ["intimate", "film", "poetic"],
    stability: 0.6,
    similarityBoost: 0.8,
  },
  {
    id: "IKne3meq5aSn9XLyUdCD",
    name: "Charlie",
    accent: "Australian",
    style: "Laid-back & Trustworthy",
    description:
      "Casual Australian warmth. Great for tech content and modern brand voice.",
    tags: ["australian", "casual", "tech"],
    stability: 0.82,
    similarityBoost: 0.63,
  },
  {
    id: "XB0fDUnXU5powFXDhCwa",
    name: "Charlotte",
    accent: "Swedish-English",
    style: "Cool & Cinematic",
    description:
      "European accent with a film-score quality. Ideal for luxury and art-house.",
    tags: ["cinematic", "luxury", "european"],
    stability: 0.65,
    similarityBoost: 0.45,
  },
  {
    id: "onwK4e9ZLuTAKqWW03F9",
    name: "Daniel",
    accent: "British",
    style: "News Anchor",
    description:
      "Confident, polished broadcaster delivery for corporate and journalistic content.",
    tags: ["news", "polished", "corporate"],
    stability: 0.9,
    similarityBoost: 0.75,
  },
];
