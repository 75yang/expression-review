import type { Metadata } from "next";

import "./globals.css";
import "./design-system.css";
import "./library.css";
import "./workspaces.css";
import { AppShell } from "@/components/AppShell";

export const metadata: Metadata = {
  title: "Expression Review · 表达复盘",
  description: "录制表达、语音转写、音画文联动回看，并从表述与叙事两个层面持续改进。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body><AppShell>{children}</AppShell></body>
    </html>
  );
}
