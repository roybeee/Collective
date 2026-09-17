import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "COLLECTIVE — AI Marketing Company",
  description: "브랜드의 다음 성장을 만드는 AI 마케팅 워크스테이션",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className="antialiased">{children}</body>
    </html>
  );
}
