import type { Metadata } from "next";
import "./globals.css";

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
    <html lang="en" className="dark">
      <body className="text-slate-100 antialiased">{children}</body>
    </html>
  );
}
