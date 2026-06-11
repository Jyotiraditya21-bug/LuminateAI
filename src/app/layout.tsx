import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ARXIVEER — Self-Updating AI Research Assistant",
  description: "An advanced research assistant using RAPTOR hierarchical indexing and CRAG corrective fallback over arXiv.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
