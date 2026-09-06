import type { Metadata } from 'next';

import './globals.css';

export const metadata: Metadata = {
  title: '林奇基本面研究',
  description: '基于官方财报、可追溯计算和 AI 证据校验的公司基本面研究工具。',
  openGraph: {
    title: '林奇基本面研究',
    description:
      '从估值、增长、负债和现金流理解一家公司，每个关键数字都能回到报告与计算依据。',
    images: ['/og.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
