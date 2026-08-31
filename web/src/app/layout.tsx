import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import AuthStatus from "./auth-status";
import Providers from "./providers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "LeetVibeCode",
  description: "A benchmark for AI-native software engineers.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased mx-auto max-w-6xl p-6`}
      >
        <Providers>
          <nav className="mb-8 flex items-center gap-6 border-b pb-4">
            <Link href="/" className="text-xl font-bold">
              LeetVibeCode
            </Link>
            <Link href="/history" className="text-sm">
              My attempts
            </Link>
            <span className="grow" />
            <AuthStatus />
          </nav>
          <main>{children}</main>
        </Providers>
      </body>
    </html>
  );
}
