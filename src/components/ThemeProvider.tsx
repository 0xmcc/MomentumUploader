"use client";

import { createContext, useContext, useEffect, useState } from "react";

export type ThemeId =
    | "violet"
    | "blue"
    | "emerald"
    | "crimson"
    | "amber"
    | "ocean"
    | "orange";

export interface Theme {
    id: ThemeId;
    name: string;
    swatch: string; // CSS color for the button swatch
    vars: {
        background: string;
        foreground: string;
        accent: string;
        accentHover: string;
        surface: string;
        border: string;
        glow: string; // rgba for radial gradient glow
        glassBg: string;
        neoBlur: string;
    };
}

export const THEMES: Theme[] = [
    {
        id: "violet",
        name: "Void Violet",
        swatch: "#8b5cf6",
        vars: {
            background: "#09090b",
            foreground: "#fafafa",
            accent: "#8b5cf6",
            accentHover: "#7c3aed",
            surface: "#121214",
            border: "#27272a",
            glow: "rgba(139,92,246,0.15)",
            glassBg: "rgba(18,18,20,0.65)",
            neoBlur: "rgba(139,92,246,0.15)",
        },
    },
    {
        id: "blue",
        name: "Midnight Blue",
        swatch: "#3b82f6",
        vars: {
            background: "#080c14",
            foreground: "#f0f4ff",
            accent: "#3b82f6",
            accentHover: "#2563eb",
            surface: "#0d1220",
            border: "#1e2d4a",
            glow: "rgba(59,130,246,0.15)",
            glassBg: "rgba(13,18,32,0.65)",
            neoBlur: "rgba(59,130,246,0.15)",
        },
    },
    {
        id: "emerald",
        name: "Neon Forest",
        swatch: "#10b981",
        vars: {
            background: "#060e0a",
            foreground: "#f0fdf4",
            accent: "#10b981",
            accentHover: "#059669",
            surface: "#0a1610",
            border: "#14432a",
            glow: "rgba(16,185,129,0.15)",
            glassBg: "rgba(10,22,16,0.65)",
            neoBlur: "rgba(16,185,129,0.15)",
        },
    },
    {
        id: "crimson",
        name: "Crimson Noir",
        swatch: "#ef4444",
        vars: {
            background: "#0e0607",
            foreground: "#fff1f2",
            accent: "#ef4444",
            accentHover: "#dc2626",
            surface: "#160a0b",
            border: "#3f1414",
            glow: "rgba(239,68,68,0.15)",
            glassBg: "rgba(22,10,11,0.65)",
            neoBlur: "rgba(239,68,68,0.15)",
        },
    },
    {
        id: "amber",
        name: "Solar Amber",
        swatch: "#f59e0b",
        vars: {
            background: "#0d0a04",
            foreground: "#fffbeb",
            accent: "#f59e0b",
            accentHover: "#d97706",
            surface: "#161007",
            border: "#3d2a07",
            glow: "rgba(245,158,11,0.15)",
            glassBg: "rgba(22,16,7,0.65)",
            neoBlur: "rgba(245,158,11,0.15)",
        },
    },
    {
        id: "ocean",
        name: "Deep Ocean",
        swatch: "#06b6d4",
        vars: {
            background: "#040d12",
            foreground: "#ecfeff",
            accent: "#06b6d4",
            accentHover: "#0891b2",
            surface: "#071520",
            border: "#0c2d3f",
            glow: "rgba(6,182,212,0.15)",
            glassBg: "rgba(7,21,32,0.65)",
            neoBlur: "rgba(6,182,212,0.15)",
        },
    },
    {
        id: "orange",
        name: "Burning Orange",
        swatch: "#f97316",
        vars: {
            background: "#0d0800",
            foreground: "#fff7ed",
            accent: "#f97316",
            accentHover: "#ea6c0a",
            surface: "#180f03",
            border: "#43230a",
            glow: "rgba(249,115,22,0.18)",
            glassBg: "rgba(24,15,3,0.65)",
            neoBlur: "rgba(249,115,22,0.18)",
        },
    },
];

const DEFAULT_THEME = THEMES.find((theme) => theme.id === "orange") ?? THEMES[0];

interface ThemeContextValue {
    theme: Theme;
    setTheme: (id: ThemeId) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
    theme: DEFAULT_THEME,
    setTheme: () => { },
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

    useEffect(() => {
        applyTheme(theme);
    }, [theme]);

    const setTheme = (id: ThemeId) => {
        const found = THEMES.find((t) => t.id === id);
        if (!found) return;
        setThemeState(found);
        localStorage.setItem("sonic-theme", id);
    };

    return (
        <ThemeContext.Provider value={{ theme, setTheme }}>
            {children}
        </ThemeContext.Provider>
    );
}
