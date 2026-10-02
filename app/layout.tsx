import type { Metadata } from "next";
import "./globals.css";
import { BOOT_SCRIPT } from "@/lib/ui/boot-fetch";

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
      {/* 홈 첫 화면 요청을 화면 코드보다 먼저 시작한다(lib/ui/boot-fetch.ts, UX-PLAN-3 ⑩ 4G LCP). 고정 문자열이며 사용자 값이 없다. */}
      <head>
        <script dangerouslySetInnerHTML={{ __html: BOOT_SCRIPT }} />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
