import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "健康数据", description: "个人可穿戴设备数据，供 AI 助手查询" };
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
