import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "API Monitor",
  description: "AI 기반 API 모니터링 & 에러 그룹화 연구 플랫폼",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="min-h-screen bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
        {children}
      </body>
    </html>
  );
}
