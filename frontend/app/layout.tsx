import type { Metadata } from "next";
import { Inter, Newsreader } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

const newsreader = Newsreader({
  subsets: ["latin"],
  style: ["normal", "italic"],
  variable: "--font-newsreader",
});

export const metadata: Metadata = {
  title: "Debate Arena",
  description:
    "Watch Gandhi, Mandela, and Marx debate — grounded in their real writings via hybrid RAG.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`dark ${inter.variable} ${newsreader.variable}`}>
      <body className="font-sans text-zinc-100 antialiased">{children}</body>
    </html>
  );
}
