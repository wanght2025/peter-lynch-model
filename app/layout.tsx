import type { Metadata } from 'next';

import './globals.css';

export const metadata: Metadata = {
  title: '彼得林奇投资模型',
  description: '基于锁定原著规则、可追溯财报数据和人工确认的本地投资研究工具。',
  openGraph: {
    title: '彼得林奇投资模型',
    description:
      '没有出处的不收，没有数字的不硬编；每个结论都能回到原文和财报。',
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
