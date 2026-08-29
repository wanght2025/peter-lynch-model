'use client';

import { useRef, useState } from 'react';
import {
  ArrowRight,
  BookOpenText,
  Check,
  FileText,
  Search,
  ShieldCheck,
  Sparkles,
  UploadCloud,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ResearchDashboard } from '@/components/research-dashboard';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const sourceBadges = ['巨潮资讯', '上交所', '北交所'];

export default function Home() {
  const [code, setCode] = useState('');
  const [fileName, setFileName] = useState('');
  const [analysisSubject, setAnalysisSubject] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const validCode = /^\d{6}$/.test(code);

  function openDemo(subject: string) {
    setAnalysisSubject(subject);
    window.setTimeout(
      () =>
        document
          .querySelector('#report')
          ?.scrollIntoView({ behavior: 'smooth' }),
      50,
    );
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b border-white/10 bg-[#0c1c1b] text-white">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 lg:px-8">
          <a
            className="flex items-center gap-3"
            href="#top"
            aria-label="彼得林奇投资模型首页"
          >
            <span className="grid size-9 place-items-center rounded-full border border-[#d9b978]/45 bg-[#d9b978]/10 text-[#e8c982]">
              <Search className="size-4" />
            </span>
            <span className="font-serif text-lg tracking-[0.06em]">
              彼得林奇投资模型
            </span>
            <Badge className="bg-[#d9b978] text-[#132422] hover:bg-[#d9b978]">
              本地版
            </Badge>
          </a>
          <nav
            className="hidden items-center gap-7 text-sm text-white/58 sm:flex"
            aria-label="主导航"
          >
            <a className="text-white" href="#workspace">
              分析工作台
            </a>
            <a className="transition-colors hover:text-white" href="#method">
              方法护栏
            </a>
            <a className="transition-colors hover:text-white" href="#privacy">
              本地隐私
            </a>
          </nav>
        </div>
      </header>

      <section id="top" className="paper-grid border-b border-border">
        <div className="mx-auto grid max-w-7xl gap-10 px-5 py-12 lg:grid-cols-[1fr_420px] lg:px-8 lg:py-16">
          <div className="max-w-3xl self-center">
            <div className="mb-5 flex items-center gap-2 text-xs font-semibold tracking-[0.16em] text-[#8b622b]">
              <span className="h-px w-8 bg-[#b88743]" />
              PETER LYNCH · EVIDENCE FIRST
            </div>
            <h1 className="font-serif text-4xl leading-[1.15] tracking-[-0.03em] sm:text-5xl lg:text-[58px]">
              把财报，变成一份
              <span className="text-[#9a6a2c]">有出处</span>的投资研究
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
              输入股票代码，或直接上传公司财报。系统按《彼得·林奇的成功投资》逐条核查，计算规则透明，AI只负责解释证据。
            </p>
            <div
              id="sources"
              className="mt-7 flex flex-wrap items-center gap-2"
            >
              <span className="mr-1 text-xs text-muted-foreground">
                优先核验官方披露
              </span>
              {sourceBadges.map((source) => (
                <Badge
                  key={source}
                  variant="outline"
                  className="border-[#ad8c5d]/35 bg-white/55 text-[#675335]"
                >
                  <Check className="size-3" /> {source}
                </Badge>
              ))}
            </div>
          </div>

          <Card
            id="workspace"
            className="border-0 bg-[#fffdf8] shadow-[0_22px_70px_rgba(33,43,38,0.13)] ring-1 ring-[#ad8c5d]/24"
          >
            <CardHeader className="border-b border-[#ad8c5d]/16 pb-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <CardTitle className="font-serif text-xl">
                    开始一次分析
                  </CardTitle>
                  <CardDescription className="mt-1">
                    选择一种方式提供公司信息
                  </CardDescription>
                </div>
                <span className="grid size-9 place-items-center rounded-full bg-[#163b37] text-[#f0d69d]">
                  <Sparkles className="size-4" />
                </span>
              </div>
            </CardHeader>
            <CardContent className="pt-1">
              <Tabs defaultValue="code" className="gap-5">
                <TabsList className="grid h-10 w-full grid-cols-2 bg-[#efe9dd] p-1">
                  <TabsTrigger value="code" className="h-8">
                    输入股票代码
                  </TabsTrigger>
                  <TabsTrigger value="report" className="h-8">
                    上传财报
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="code" className="space-y-4">
                  <label
                    className="block text-xs font-medium tracking-wide text-muted-foreground"
                    htmlFor="stock-code"
                  >
                    A股股票代码
                  </label>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        id="stock-code"
                        inputMode="numeric"
                        maxLength={6}
                        value={code}
                        onChange={(event) =>
                          setCode(event.target.value.replace(/\D/g, ''))
                        }
                        className="h-11 border-[#b9aa8f] bg-white pl-9 text-base tracking-[0.18em] focus-visible:border-[#8c672e] focus-visible:ring-[#b88743]/18"
                        placeholder="例如：600519"
                      />
                    </div>
                    <Button
                      size="lg"
                      disabled={!validCode}
                      onClick={() => openDemo(`股票代码 ${code}`)}
                      className="h-11 bg-[#163b37] px-4 text-[#fff9eb] hover:bg-[#235149]"
                    >
                      查找财报 <ArrowRight className="size-4" />
                    </Button>
                  </div>
                  <p className="text-xs leading-5 text-muted-foreground">
                    首版覆盖沪深北交易所；找不到官方文档时，会提示你改用上传。
                  </p>
                </TabsContent>

                <TabsContent value="report">
                  <input
                    ref={fileRef}
                    className="sr-only"
                    type="file"
                    accept="application/pdf,.pdf"
                    onChange={(event) =>
                      setFileName(event.target.files?.[0]?.name ?? '')
                    }
                  />
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="group flex min-h-36 w-full flex-col items-center justify-center rounded-xl border border-dashed border-[#a38a64] bg-[#f8f3e8]/70 px-5 text-center transition-colors hover:bg-[#f3ead8]"
                  >
                    {fileName ? (
                      <>
                        <FileText className="mb-3 size-7 text-[#8b622b]" />
                        <span className="max-w-full truncate font-medium">
                          {fileName}
                        </span>
                        <span className="mt-1 text-xs text-muted-foreground">
                          已就绪 · 点击可更换
                        </span>
                      </>
                    ) : (
                      <>
                        <UploadCloud className="mb-3 size-7 text-[#8b622b] transition-transform group-hover:-translate-y-0.5" />
                        <span className="font-medium">选择 PDF 财报</span>
                        <span className="mt-1 text-xs text-muted-foreground">
                          年报优先，单份不超过 30 MB
                        </span>
                      </>
                    )}
                  </button>
                  {fileName && (
                    <Button
                      className="mt-3 h-10 w-full bg-[#163b37] text-[#fff9eb] hover:bg-[#235149]"
                      onClick={() => openDemo(`财报文件 ${fileName}`)}
                    >
                      在本地建立档案 <ArrowRight className="size-4" />
                    </Button>
                  )}
                  <p className="mt-3 text-center text-[11px] text-muted-foreground">
                    当前版本不会把所选文件上传到服务器
                  </p>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>
      </section>

      {analysisSubject && <ResearchDashboard subject={analysisSubject} />}

      <section
        id="privacy"
        className="border-b border-border bg-[#102e2b] px-5 py-7 text-white lg:px-8"
      >
        <div className="mx-auto flex max-w-7xl flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 size-5 shrink-0 text-[#e3c47f]" />
            <div>
              <h2 className="font-serif text-lg">
                主程序留在本机，报告按需分享
              </h2>
              <p className="mt-1 text-sm leading-6 text-white/60">
                原始财报、评分底稿和密钥默认不离开你的电脑；导出时可隐藏源文件名，只保留规则、出处和结论。
              </p>
            </div>
          </div>
          <Badge
            variant="outline"
            className="shrink-0 border-white/20 text-white/75"
          >
            LOCAL FIRST
          </Badge>
        </div>
      </section>

      <section
        id="method"
        className="mx-auto max-w-7xl px-5 py-10 lg:px-8 lg:py-12"
      >
        <div className="grid gap-4 md:grid-cols-3">
          {[
            {
              icon: BookOpenText,
              step: '01',
              title: '规则有原文坐标',
              body: '每条规则标注版本、章节、小节与段落指纹，能回到书中复核。',
            },
            {
              icon: ShieldCheck,
              step: '02',
              title: '计算与AI分开',
              body: '财务指标由程序计算；AI不得改分，只解释依据与缺失证据。',
            },
            {
              icon: FileText,
              step: '03',
              title: '输出可发布报告',
              body: '保留数据源、财报期和风险提示，一键生成适合分享的单页报告。',
            },
          ].map(({ icon: Icon, step, title, body }) => (
            <article
              key={step}
              className="method-card rounded-xl border border-border bg-card p-5"
            >
              <div className="mb-5 flex items-center justify-between">
                <span className="grid size-9 place-items-center rounded-full bg-[#e8dfce] text-[#6d5127]">
                  <Icon className="size-4" />
                </span>
                <span className="font-mono text-xs text-[#9b825e]">{step}</span>
              </div>
              <h2 className="font-serif text-lg">{title}</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {body}
              </p>
            </article>
          ))}
        </div>
        <p className="mt-7 text-center text-xs text-muted-foreground">
          研究工具，不构成投资建议。MVP阶段默认使用日线收盘价，并始终显示来源与时间。
        </p>
      </section>
    </main>
  );
}
