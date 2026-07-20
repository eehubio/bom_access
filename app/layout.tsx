import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BOM Intake & Normalization Agent | ezPLM",
  description: "将 Excel、CSV、PDF、扫描件和截图转换为可追溯的 Canonical BOM。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
