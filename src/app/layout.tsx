import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { PWA } from "./_components/PWA";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "FocusGrid",
  description:
    "A single-user, browser-local task field. Your tasks live in this browser profile only.",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f7f9" },
    { media: "(prefers-color-scheme: dark)", color: "#111719" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

// Set once per server process (survives HMR, not restarts); the demo DB is reseeded when it changes.
const g = globalThis as { __fgBoot?: string };
const BOOT_ID = (g.__fgBoot ??= crypto.randomUUID());

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col overflow-x-hidden" data-boot={BOOT_ID}>
        <script dangerouslySetInnerHTML={{ __html: `try{var t=localStorage.getItem('focusgrid-theme');document.documentElement.dataset.theme=t==='light'||t==='dark'?t:matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}catch(e){}` }} />
        {children}
        <PWA />
      </body>
    </html>
  );
}
