"use client";

import { useEffect, useState } from "react";

const SPINNER_VERBS = [
  "Cerebrating",
  "Beboppin'",
  "Discombobulating",
  "Percolating",
  "Cogitating",
  "Schmoozing",
  "Razzle-dazzling",
  "Orchestrating",
  "Synthesizing",
  "Ruminating",
  "Pontificating",
  "Concocting",
  "Brewing",
  "Ideating",
  "Assembling",
  "Harmonizing",
  "Calibrating",
  "Channeling",
  "Constructing",
  "Channeling vibes",
];

export default function WhimsicalLoadingSpinner() {
  const [verbIndex, setVerbIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setVerbIndex((prev) => (prev + 1) % SPINNER_VERBS.length);
    }, 1200);
    return () => clearInterval(interval);
  }, []);

  return (
    <div data-testid="sales-docs-generating-indicator" className="flex items-center gap-2">
      <div className="flex items-center gap-1">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--sd-purple)] animate-pulse"></span>
      </div>
      <span className="text-[12.5px] leading-relaxed text-[var(--sd-text-secondary)]">
        {SPINNER_VERBS[verbIndex]}…
      </span>
    </div>
  );
}
