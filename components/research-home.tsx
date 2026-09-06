'use client';

import { useEffect, useState, type SyntheticEvent } from 'react';
import Link from 'next/link';
import { ArrowRight, Database, FileCheck2, Search, Sparkles } from 'lucide-react';

import { normalizeSecurityCode } from '@/lib/official-filings';
import type { AnalysisDataset } from '@/lib/analysis-types';

const DATASET_STORAGE_KEY = 'lynch-official-analysis-dataset-v11';

export function ResearchHome() {
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [recent, setRecent] = useState<AnalysisDataset | null>(null);

  useEffect(() => {
    const saved = window.localStorage.getItem(DATASET_STORAGE_KEY);
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved) as AnalysisDataset;
      if (parsed.companyCode && parsed.companyName)
        queueMicrotask(() => setRecent(parsed));
    } catch {
      // The research workspace owns invalid-cache cleanup.
    }
  }, []);

  function openResearch(value: string) {
    const normalized = normalizeSecurityCode(value);
    if (!normalized) {
      setError('请输入 6 位 A 股代码或 4–5 位港股代码。');
      return;
    }
    window.location.assign(`/fundamentals?code=${normalized.code}`);
  }

  function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    openResearch(query);
  }

  return (
    <main
      id="main-content"
      className="finance-shell min-h-dvh bg-[var(--ds-surface)] text-[var(--ds-text-primary)]"
    >
      <a href="#home-stock-code" className="skip-link">
        跳到公司搜索
      </a>
      <header className="border-b border-[var(--ds-border-subtle)]">
        <div className="mx-auto flex h-16 max-w-[1280px] items-center justify-between px-5 lg:px-8">
          <Link
            href="/"
            prefetch={false}
            className="text-sm font-semibold tracking-tight"
          >
            林奇基本面研究
          </Link>
          <Link
            href="/rules"
            prefetch={false}
            className="text-sm text-[var(--ds-text-tertiary)] transition-colors hover:text-[var(--ds-accent)]"
          >
            方法与规则
          </Link>
        </div>
      </header>

      <section className="mx-auto max-w-[920px] px-5 pb-20 pt-24 sm:pt-32 lg:px-8">
        <p className="text-sm font-medium text-[var(--ds-accent)]">公司研究</p>
        <h1 className="mt-3 max-w-3xl text-4xl font-semibold tracking-[-0.035em] sm:text-5xl">
          从一家公司开始，形成可追溯的投资判断
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-7 text-[var(--ds-text-secondary)]">
          输入股票代码，查看投资结论、关键财务事实、Peter Lynch 分析与原始依据。
        </p>

        <form onSubmit={submit} className="mt-10" aria-label="搜索公司">
          <label
            htmlFor="home-stock-code"
            className="block text-sm font-medium"
          >
            股票代码
          </label>
          <div className="mt-2 flex flex-col gap-3 sm:flex-row">
            <div className="relative flex-1">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-[var(--ds-text-disabled)]"
              />
              <input
                id="home-stock-code"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setError('');
                }}
                placeholder="例如：600519 或 00700"
                inputMode="numeric"
                autoComplete="off"
                className="h-14 w-full border border-[var(--ds-border-strong)] bg-white pl-12 pr-4 text-base outline-none transition-colors placeholder:text-[var(--ds-text-disabled)] focus:border-[var(--ds-accent)] focus:ring-2 focus:ring-[var(--ds-focus)]/20"
              />
            </div>
            <button
              type="submit"
              className="inline-flex h-14 min-w-36 items-center justify-center gap-2 bg-[var(--ds-accent)] px-6 font-medium text-white transition-colors hover:bg-[var(--ds-accent-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ds-focus)] focus-visible:ring-offset-2"
            >
              开始研究 <ArrowRight aria-hidden="true" className="size-4" />
            </button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
            <span className="text-[var(--ds-text-tertiary)]">快速查看</span>
            <button
              type="button"
              onClick={() => openResearch('600519')}
              className="text-[var(--ds-accent)] hover:underline"
            >
              贵州茅台 600519
            </button>
            <button
              type="button"
              onClick={() => openResearch('00700')}
              className="text-[var(--ds-accent)] hover:underline"
            >
              腾讯控股 00700
            </button>
          </div>
          {error && (
            <p role="alert" className="mt-3 text-sm text-[var(--ds-danger)]">
              {error}
            </p>
          )}
        </form>

        <section
          aria-label="软件如何得出判断"
          className="mt-16 grid gap-px overflow-hidden border border-[var(--ds-border-subtle)] bg-[var(--ds-border-subtle)] sm:grid-cols-3"
        >
          {[
            {
              icon: Database,
              step: '01',
              title: '只读真实披露',
              text: '从交易所和法定财报提取数字、页码与原文，缺数据不猜。',
            },
            {
              icon: Sparkles,
              step: '02',
              title: 'AI 自动分类补证',
              text: '自动判断公司可能属于哪些林奇类型，并补齐定性规则证据。',
            },
            {
              icon: FileCheck2,
              step: '03',
              title: '先结论，后证据',
              text: '直接告诉你优势、风险和未知项；证据覆盖不足时拒绝给高分。',
            },
          ].map(({ icon: Icon, step, title, text }) => (
            <div key={step} className="bg-[var(--ds-surface)] p-5">
              <div className="flex items-center justify-between">
                <Icon className="size-5 text-[var(--ds-accent)]" aria-hidden />
                <span className="font-mono text-xs text-[var(--ds-text-disabled)]">
                  {step}
                </span>
              </div>
              <h2 className="mt-4 text-sm font-semibold">{title}</h2>
              <p className="mt-2 text-sm leading-6 text-[var(--ds-text-secondary)]">
                {text}
              </p>
            </div>
          ))}
        </section>

        {recent && (
          <section className="mt-20 border-t border-[var(--ds-border-subtle)] pt-6">
            <div className="flex items-baseline justify-between gap-4">
              <h2 className="text-lg font-semibold">最近研究</h2>
              <span className="text-xs text-[var(--ds-text-tertiary)]">
                保存在当前设备
              </span>
            </div>
            <Link
              href={`/fundamentals?code=${recent.companyCode}`}
              prefetch={false}
              className="group mt-4 grid min-h-20 grid-cols-[1fr_auto] items-center gap-4 border-y border-[var(--ds-border-subtle)] py-4"
            >
              <span>
                <span className="block text-base font-semibold">
                  {recent.companyName}
                </span>
                <span className="mt-1 block font-mono text-xs text-[var(--ds-text-tertiary)]">
                  {recent.companyCode} ·{' '}
                  {recent.security?.market === 'HK' ? '港股' : 'A股'} ·
                  最新报告期 {recent.latestReportPeriod ?? '未取得'}
                </span>
              </span>
              <ArrowRight
                aria-hidden="true"
                className="size-4 text-[var(--ds-text-disabled)] transition-transform group-hover:translate-x-1 group-hover:text-[var(--ds-accent)]"
              />
            </Link>
          </section>
        )}
      </section>
    </main>
  );
}
