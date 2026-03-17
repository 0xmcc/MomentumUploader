import { render } from "@testing-library/react";
import { THEMES } from "@/lib/themes";
import ThemeToggle from "./ThemeToggle";

jest.mock("framer-motion", () => ({
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    motion: {
        div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
            <div {...props}>{children}</div>
        ),
    },
}));

jest.mock("./ThemeProvider", () => {
    const orangeTheme = THEMES.find((theme) => theme.id === "orange") ?? THEMES[0];

    return {
        THEMES,
        useTheme: () => ({
            theme: orangeTheme,
            setTheme: jest.fn(),
            playbackTheme: "accent",
            setPlaybackTheme: jest.fn(),
        }),
    };
});

describe("ThemeToggle", () => {
    beforeEach(() => {
        document.documentElement.style.setProperty("--accent", "#10b981");
        document.documentElement.style.setProperty("--surface", "#0a1610");
        document.documentElement.style.setProperty("--border", "#14432a");
        document.documentElement.style.setProperty("--foreground", "#f0fdf4");
        document.documentElement.style.setProperty("--theme-glow", "rgba(16,185,129,0.15)");
    });

    afterEach(() => {
        document.documentElement.removeAttribute("style");
    });

    it("renders the trigger swatch from the applied accent so it matches the current page theme", () => {
        const { container } = render(<ThemeToggle />);
        const swatch = container.querySelector("#theme-palette-btn span");

        expect(swatch).not.toBeNull();
        expect(swatch?.getAttribute("style")).toContain("background: var(--accent)");
        expect(swatch?.getAttribute("style")).toContain("0 0 8px var(--accent)");
    });
});
