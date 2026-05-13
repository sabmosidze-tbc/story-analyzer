import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "StoryAnalyzer – QA Breakdown Tool",
  description: "Paste a Jira story to get instant QA analysis: explanation, desk-check scenarios, and test suggestions.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="h-full flex flex-col">{children}</body>
    </html>
  );
}
