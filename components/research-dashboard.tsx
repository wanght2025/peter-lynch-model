'use client';

import {
  AlertTriangle,
  ArrowUpRight,
  Bot,
  BookMarked,
  CheckCircle2,
  CircleDashed,
  Download,
  FileSearch,
  Scale,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { bookEdition, demoChecks, lynchRules } from '@/lib/lynch-rules';

function resultStyle(result: string) {
  if (result === '通过') return 'bg-[#dce9df] text-[#28573e]';
  return 'bg-[#efe3c8] text-[#7d5b24]';
}

export function ResearchDashboard({ subject }: { subject: string }) {
  const score = demoChecks.reduce((sum, check) => sum + check.score, 0);
  const maxScore = demoChecks.reduce((sum, check) => sum + check.max, 0);

  return (
    <section
      id="report"
      className="border-b border-border bg-[#e9e4d9] px-5 py-12 lg:px-8 lg:py-16"
    >
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Badge className="bg-[#8e5e28] text-white hover:bg-[#8e5e28]">
                交互演示
              </Badge>
              <Badge
                variant="outline"
                className="border-[#9b825e]/40 bg-white/50"
              >
                数据非实时
              </Badge>
            </div>
            <p className="text-xs font-semibold tracking-[0.16em] text-[#7d6644]">
              RESEARCH FILE · {subject}
            </p>
            <h2 className="mt-2 font-serif text-3xl tracking-[-0.02em] sm:text-4xl">
              林奇规则核查报告
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
              以下数值是用于验证评分流程的演示数据，不是对该股票的实时判断。正式数据接入后，表格结构与出处链保持不变。
            </p>
          </div>
          <Button
            variant="outline"
            className="border-[#9b825e]/45 bg-[#fffdf8]"
            onClick={() => window.print()}
          >
            <Download className="size-4" /> 导出 / 打印报告
          </Button>
        </div>

        <div className="grid gap-5 xl:grid-cols-[300px_minmax(0,1fr)]">
          <div className="space-y-5">
            <Card className="border-0 bg-[#102e2b] text-[#fffaf0] ring-0">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="font-serif text-lg text-white">
                    证据覆盖得分
                  </CardTitle>
                  <Scale className="size-4 text-[#e1c17f]" />
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-end gap-2">
                  <span className="font-serif text-6xl leading-none text-[#f0d69d]">
                    {score}
                  </span>
                  <span className="mb-1 text-sm text-white/55">
                    / {maxScore} 已测分
                  </span>
                </div>
                <div className="mt-5 h-2 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-[#d9b978]"
                    style={{ width: `${(score / maxScore) * 100}%` }}
                  />
                </div>
                <p className="mt-4 text-sm leading-6 text-white/66">
                  结论：值得继续研究。得分只表示已取得证据与规则的匹配度，不代表买入建议。
                </p>
              </CardContent>
            </Card>

            <Card className="border-0 bg-[#fffdf8] ring-1 ring-[#a69270]/20">
              <CardHeader>
                <CardTitle className="font-serif text-lg">
                  双AI复核门槛
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between rounded-lg bg-[#e7f0e9] px-3 py-3">
                  <span className="flex items-center gap-2 text-sm">
                    <CheckCircle2 className="size-4 text-[#34724d]" />
                    规则引擎
                  </span>
                  <Badge className="bg-[#34724d] text-white hover:bg-[#34724d]">
                    已完成
                  </Badge>
                </div>
                {['GPT 证据复核', 'DeepSeek 反方复核'].map((name) => (
                  <div
                    key={name}
                    className="flex items-center justify-between rounded-lg bg-[#f2eee5] px-3 py-3"
                  >
                    <span className="flex items-center gap-2 text-sm">
                      <Bot className="size-4 text-[#796c58]" />
                      {name}
                    </span>
                    <Badge variant="outline" className="text-muted-foreground">
                      待接入
                    </Badge>
                  </div>
                ))}
                <p className="flex gap-2 pt-1 text-xs leading-5 text-muted-foreground">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-[#a7732d]" />
                  AI不产生财务数字，不改变程序得分；两者都通过后才进入候选池。
                </p>
              </CardContent>
            </Card>
          </div>

          <Card className="border-0 bg-[#fffdf8] ring-1 ring-[#a69270]/20">
            <CardHeader className="border-b border-border pb-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <CardTitle className="font-serif text-xl">
                    逐条评分与证据
                  </CardTitle>
                  <p className="mt-1 text-xs text-muted-foreground">
                    阈值来自书中；分值权重属于可修改的MVP政策
                  </p>
                </div>
                <Badge variant="outline">7项已测 · 0项失败</Badge>
              </div>
            </CardHeader>
            <CardContent className="px-0">
              <Table>
                <TableHeader>
                  <TableRow className="bg-[#f1ece2] hover:bg-[#f1ece2]">
                    <TableHead className="pl-4">规则</TableHead>
                    <TableHead>本次数值</TableHead>
                    <TableHead>判断</TableHead>
                    <TableHead>得分</TableHead>
                    <TableHead className="pr-4">证据</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {demoChecks.map((check) => {
                    const rule = lynchRules.find(
                      (item) => item.id === check.id,
                    );
                    return (
                      <TableRow key={check.id}>
                        <TableCell className="min-w-52 pl-4">
                          <div className="font-medium">{rule?.title}</div>
                          <div className="mt-1 font-mono text-[11px] text-muted-foreground">
                            {check.id} · {rule?.chapter}
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {check.value}
                        </TableCell>
                        <TableCell>
                          <Badge className={resultStyle(check.result)}>
                            {check.result}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono">
                          {check.score}/{check.max}
                        </TableCell>
                        <TableCell className="max-w-72 whitespace-normal pr-4 text-xs leading-5 text-muted-foreground">
                          {check.evidence}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>

        <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_340px]">
          <Card className="border-0 bg-[#fffdf8] ring-1 ring-[#a69270]/20">
            <CardHeader className="border-b border-border pb-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <CardTitle className="flex items-center gap-2 font-serif text-xl">
                    <BookMarked className="size-5 text-[#8e5e28]" />{' '}
                    可追溯规则卡
                  </CardTitle>
                  <p className="mt-1 text-xs text-muted-foreground">
                    点击任意规则查看公式、适用范围与产品权重
                  </p>
                </div>
                <Badge variant="outline">ISBN {bookEdition.isbn}</Badge>
              </div>
            </CardHeader>
            <CardContent className="grid gap-3 pt-1 md:grid-cols-2">
              {lynchRules.map((rule) => (
                <details
                  key={rule.id}
                  className="rule-detail rounded-lg border border-border bg-[#fbf8f1] p-4 open:bg-white"
                >
                  <summary
                    className="cursor-pointer list-none"
                    aria-label={`展开规则：${rule.title}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium">{rule.title}</p>
                        <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                          {rule.id}
                        </p>
                      </div>
                      <Badge variant="outline" className="shrink-0">
                        {rule.kind}
                      </Badge>
                    </div>
                  </summary>
                  <div className="mt-4 border-t border-border pt-3 text-xs leading-5 text-muted-foreground">
                    <p className="text-foreground">{rule.test}</p>
                    <p className="mt-2">
                      出处：{rule.chapter}「{rule.section}」
                    </p>
                    <p className="mt-1">{rule.note}</p>
                  </div>
                </details>
              ))}
            </CardContent>
          </Card>

          <Card className="border-0 bg-[#fffdf8] ring-1 ring-[#a69270]/20">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 font-serif text-lg">
                <FileSearch className="size-5 text-[#8e5e28]" /> 数据溯源顺序
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {[
                ['01', '交易所 / 巨潮官方财报', '公司披露原文与报表期'],
                ['02', '程序计算财务指标', '保存公式、原始值与单位'],
                ['03', '授权行情或官方收盘价', '显示来源与时间戳'],
                ['04', 'AI证据核查', '引用页码，不补造缺失数字'],
              ].map(([step, title, body]) => (
                <div key={step} className="flex gap-3">
                  <span className="grid size-7 shrink-0 place-items-center rounded-full bg-[#e8dfce] font-mono text-[10px] text-[#6d5127]">
                    {step}
                  </span>
                  <div>
                    <p className="text-sm font-medium">{title}</p>
                    <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                      {body}
                    </p>
                  </div>
                </div>
              ))}
              <div className="border-t border-border pt-4 text-xs leading-5 text-muted-foreground">
                <p>{bookEdition.title}</p>
                <p>
                  {bookEdition.publisher} · {bookEdition.year}
                </p>
                <a
                  className="mt-3 inline-flex items-center gap-1 text-[#7f5a27] hover:underline"
                  href="https://www.cninfo.com.cn/new/index"
                  target="_blank"
                  rel="noreferrer"
                >
                  打开巨潮资讯 <ArrowUpRight className="size-3" />
                </a>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="mt-5 flex items-start gap-3 rounded-xl border border-[#bda777]/45 bg-[#f6edd8] p-4 text-sm leading-6 text-[#645337]">
          <CircleDashed className="mt-1 size-4 shrink-0" />
          <p>
            仍缺少“核心产品收入占比”和“公司增长阶段”两项定性证据。正式版会把缺失项交给AI定位页码，但只有你确认引用无误后才计入报告。
          </p>
        </div>
      </div>
    </section>
  );
}
