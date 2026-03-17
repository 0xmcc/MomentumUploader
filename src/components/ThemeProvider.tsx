"use client";

import { createContext, useContext, useEffect, useState } from "react";
import {
    DEFAULT_THEME,
    THEMES,
    type Theme,
    type ThemeId,
} from "@/lib/themes";

export { DEFAULT_THEME, THEMES };
export type { Theme, ThemeId };

export type PlaybackTheme = "neutral" | "accent";

interface ThemeContextValue {
    theme: Theme;
    setTheme: (id: ThemeId) => void;
    playbackTheme: PlaybackTheme;
    setPlaybackTheme: (theme: PlaybackTheme) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
    theme: DEFAULT_THEME,
    setTheme: () => { },
    playbackTheme: "accent",
    setPlaybackTheme: () => { },
});

export function useTheme() {
    return useContext(ThemeContext);
}

function applyTheme(theme: Theme) {
    const r = document.documentElement;
    const v = theme.vars;
    r.style.setProperty("--background", v.background);
    r.style.setProperty("--foreground", v.foreground);
    r.style.setProperty("--accent", v.accent);
    r.style.setProperty("--accent-hover", v.accentHover);
    r.style.setProperty("--surface", v.surface);
    r.style.setProperty("--border", v.border);
    r.style.setProperty("--theme-glow", v.glow);
    r.style.setProperty("--theme-glass-bg", v.glassBg);
    r.style.setProperty("--theme-neo-blur", v.neoBlur);
}

export default function ThemeProvider({
    children,
}: {
    children: React.ReactNode;
}) {
    const [theme, setThemeState] = useState<Theme>(() => {
        if (typeof window === "undefined") return DEFAULT_THEME;
        const saved = window.localStorage.getItem("sonic-theme") as ThemeId | null;
        const found = saved ? THEMES.find((t) => t.id === saved) : null;
        return found ?? DEFAULT_THEME;
    });

    const [playbackTheme, setPlaybackThemeState] = useState<PlaybackTheme>(() => {
        if (typeof window === "undefined") return "accent";
        const saved = window.localStorage.getItem("sonic-playback-theme") as PlaybackTheme | null;
        return saved === "neutral" ? "neutral" : "accent";
    });

    useEffect(() => {
        applyTheme(theme);
    }, [theme]);

    const setTheme = (id: ThemeId) => {
        const found = THEMES.find((t) => t.id === id);
        if (!found) return;
        setThemeState(found);
        localStorage.setItem("sonic-theme", id);
    };

    const setPlaybackTheme = (pTheme: PlaybackTheme) => {
        setPlaybackThemeState(pTheme);
        localStorage.setItem("sonic-playback-theme", pTheme);
    };

    return (
        <ThemeContext.Provider value={{ theme, setTheme, playbackTheme, setPlaybackTheme }}>
            {children}
        </ThemeContext.Provider>
    );
}
