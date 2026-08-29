import type { Metadata } from 'next';

import './globals.css';

export const metadata: Metadata = {
  title: '彼得林奇投资模型｜有出处的财报研究',
  description: '依据《彼得·林奇的成功投资》构建的可追溯财报分析工具。',
  openGraph: {
    title: '彼得林奇投资模型｜有出处的财报研究',
    description: '输入股票代码或上传财报，逐条核查彼得·林奇投资规则。',
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
