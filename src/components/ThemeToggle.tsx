"use client";

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Palette, Check, Zap } from "lucide-react";
import { useTheme, THEMES, ThemeId } from "./ThemeProvider";

export default function ThemeToggle() {
    const { theme, setTheme, playbackTheme, setPlaybackTheme } = useTheme();
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    // Close on outside click
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, []);

    return (
        <div ref={ref} className="relative" id="theme-toggle">
            {/* Trigger Button */}
            <button
                id="theme-palette-btn"
                onClick={() => setOpen((o) => !o)}
                title="Change theme"
                className="group relative flex items-center gap-2 px-3 py-2 rounded-xl border transition-all duration-200 text-sm font-medium"
                style={{
                    background: "var(--surface)",
                    borderColor: open ? "var(--accent)" : "var(--border)",
                    color: "var(--foreground)",
                    boxShadow: open
                        ? `0 0 16px var(--theme-glow), 0 0 0 1px var(--accent)`
                        : "none",
                }}
            >
                {/* Mini swatch row */}
                <span className="flex gap-1 items-center">
                    {THEMES.slice(0, 6).map((t) => (
                        <span
                            key={t.id}
                            className="w-2.5 h-2.5 rounded-full transition-transform duration-150"
                            style={{
                                background: t.swatch,
                                transform: t.id === theme.id ? "scale(1.3)" : "scale(1)",
                                boxShadow:
                                    t.id === theme.id ? `0 0 6px ${t.swatch}` : "none",
                            }}
                        />
                    ))}
                </span>
                <Palette
                    size={14}
                    style={{ color: "var(--accent)" }}
                    className="transition-transform duration-200 group-hover:rotate-12"
                />
            </button>

            {/* Panel */}
            <AnimatePresence>
                {open && (
                    <motion.div
                        id="theme-panel"
                        initial={{ opacity: 0, y: -8, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -8, scale: 0.95 }}
                        transition={{ duration: 0.15, ease: "easeOut" }}
                        className="absolute right-0 top-full mt-2 z-50 rounded-2xl p-3 min-w-[240px]"
                        style={{
                            background: "var(--theme-glass-bg)",
                            backdropFilter: "blur(20px)",
                            WebkitBackdropFilter: "blur(20px)",
                            border: "1px solid rgba(255,255,255,0.08)",
                            boxShadow: `0 24px 48px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04)`,
                        }}
                    >
                        <p
                            className="text-xs font-semibold uppercase tracking-widest mb-3 px-1"
                            style={{ color: "rgba(255,255,255,0.35)" }}
                        >
                            Color Theme
                        </p>

                        <div className="space-y-1">
                            {THEMES.map((t) => {
                                const active = t.id === theme.id;
                                return (
                                    <button
                                        key={t.id}
                                        id={`theme-${t.id}`}
                                        onClick={() => {
                                            setTheme(t.id as ThemeId);
                                            setOpen(false);
                                        }}
                                        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-150 group/item"
                                        style={{
                                            background: active
                                                ? `color-mix(in srgb, ${t.swatch} 12%, transparent)`
                                                : "transparent",
                                            border: `1px solid ${active ? t.swatch + "40" : "transparent"}`,
                                        }}
                                        onMouseEnter={(e) => {
                                            if (!active)
                                                (e.currentTarget as HTMLButtonElement).style.background =
                                                    "rgba(255,255,255,0.05)";
                                        }}
                                        onMouseLeave={(e) => {
                                            if (!active)
                                                (e.currentTarget as HTMLButtonElement).style.background =
                                                    "transparent";
                                        }}
                                    >
                                        {/* Big swatch circle */}
                                        <span
                                            className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center"
                                            style={{
                                                background: `radial-gradient(circle at 35% 35%, ${t.swatch}cc, ${t.swatch}66)`,
                                                boxShadow: active
                                                    ? `0 0 12px ${t.swatch}80`
                                                    : `0 0 0 1px ${t.swatch}40`,
                                            }}
                                        >
                                            {active && (
                                                <Check
                                                    size={12}
                                                    className="text-white drop-shadow"
                                                />
                                            )}
                                        </span>

                                        {/* Name */}
                                        <span
                                            className="text-sm font-medium"
                                            style={{
                                                color: active
                                                    ? t.swatch
                                                    : "rgba(255,255,255,0.7)",
                                            }}
                                        >
                                            {t.name}
                                        </span>

                                        {/* "Active" badge */}
                                        {active && (
                                            <span
                                                className="ml-auto text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full"
                                                style={{
                                                    background: t.swatch + "25",
                                                    color: t.swatch,
                                                }}
                                            >
                                                Active
                                            </span>
                                        )}
                                    </button>
                                );
                            })}
                        </div>

                        {/* Bottom decorative bar */}
                        <div
                            className="mt-4 h-px rounded-full"
                            style={{
                                background: `linear-gradient(to right, transparent, var(--accent), transparent)`,
                                opacity: 0.3,
                            }}
                        />

                        {/* Playback Theme Section */}
                        <div className="mt-4 px-1">
                            <p
                                className="text-[10px] font-semibold uppercase tracking-widest mb-3 opacity-40"
                                style={{ color: "var(--foreground)" }}
                            >
                                Playback Style
                            </p>
                            <div className="flex bg-black/40 border border-white/5 rounded-xl p-1 gap-1">
                                <button
                                    onClick={() => setPlaybackTheme("neutral")}
                                    className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-[10px] font-mono uppercase tracking-tight transition-all ${playbackTheme === "neutral"
                                        ? "bg-white text-black shadow-lg"
                                        : "text-white/40 hover:text-white/60 hover:bg-white/5"
                                        }`}
                                >
                                    <Palette size={10} />
                                    Neutral
                                </button>
                                <button
                                    onClick={() => setPlaybackTheme("accent")}
                                    className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-[10px] font-mono uppercase tracking-tight transition-all ${playbackTheme === "accent"
                                        ? "bg-accent text-white shadow-lg shadow-accent/20"
                                        : "text-white/40 hover:text-white/60 hover:bg-white/5"
                                        }`}
                                >
                                    <Zap size={10} />
                                    Accent
                                </button>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
