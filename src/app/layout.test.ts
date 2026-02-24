jest.mock("next/font/google", () => ({
  Geist: () => ({ variable: "--font-geist-sans" }),
  Geist_Mono: () => ({ variable: "--font-geist-mono" }),
}));

jest.mock("@clerk/nextjs", () => ({
  ClerkProvider: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock("@/components/ThemeProvider", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock("./globals.css", () => ({}));

describe("app metadata", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("does not throw when NEXT_PUBLIC_SITE_URL is an empty string", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "";
    process.env.VERCEL_URL = "";

    expect(() => {
      jest.isolateModules(() => {
        require("./layout");
      });
    }).not.toThrow();
  });

  it("uses a valid metadataBase fallback URL", () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    delete process.env.VERCEL_URL;

    let metadata: { metadataBase?: URL } | undefined;
    jest.isolateModules(() => {
      metadata = require("./layout").metadata;
    });

    expect(metadata?.metadataBase?.toString()).toBe("http://localhost:3000/");
  });
});
