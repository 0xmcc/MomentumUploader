import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";
import ThemeProvider from "@/components/ThemeProvider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "Sonic Memos | Cloud & Parakeet",
  description: "Capture, cloud-sync, and transcribe voice memos seamlessly with NVIDIA Parakeet.",
  openGraph: {
    title: "Sonic Memos | Cloud & Parakeet",
    description: "Capture, cloud-sync, and transcribe voice memos seamlessly with NVIDIA Parakeet.",
    images: [
      {
        url: "/assets/memos-link-preview.png",
        width: 1024,
        height: 576,
        alt: "Sonic Memos recording interface",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Sonic Memos | Cloud & Parakeet",
    description: "Capture, cloud-sync, and transcribe voice memos seamlessly with NVIDIA Parakeet.",
    images: ["/assets/memos-link-preview.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider>
      <html lang="en" className="dark">
        <body
          className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground min-h-screen relative overflow-x-hidden`}
        >
          <div className="absolute inset-0 -z-10 h-full w-full bg-background bg-[radial-gradient(ellipse_80%_80%_at_50%_-20%,var(--theme-glow,rgba(249,115,22,0.18)),rgba(255,255,255,0))]" />
          <ThemeProvider>
            {children}
          </ThemeProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
