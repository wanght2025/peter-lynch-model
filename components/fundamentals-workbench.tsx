'use client';

import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Database,
  ExternalLink,
  FileSearch,
  LineChart as LineChartIcon,
  ChartNoAxesCombined,
  LoaderCircle,
  Printer,
  ShieldCheck,
  Sparkles,
  Table2,
  CircleHelp,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from 'recharts';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  ChartContainer,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { RuleAnalysisPanel } from '@/components/rule-analysis-panel';
import {
  applyDatasetWindow,
  assertTraceableDataset,
} from '@/lib/dataset-policy';
import {
  calculateScore,
  evaluateProgramRules,
  mergeRuleResults,
} from '@/lib/scoring-engine';
import type { AiAnalysisReport } from '@/lib/ai-analysis';
import type { FundamentalsResponse } from '@/lib/fundamentals';
import { ruleCatalog } from '@/lib/rule-catalog';
import {
  normalizeSecurityCode,
  type OfficialLookup,
} from '@/lib/official-filings';
import type {
  AnalysisDataset,
  MetricEvidence,
  MetricPoint,
  ProgramAnalysis,
  RuleResult,
  ScoreSummary,
  CompanyType,
  ReportReference,
} from '@/lib/analysis-types';

type Notice = { tone: 'good' | 'warn' | 'bad'; text: string } | null;

const DATASET_STORAGE_KEY = 'lynch-official-analysis-dataset-v11';
const ANALYSIS_STORAGE_KEY = 'lynch-program-analysis-v6';
const LOOKUP_CACHE_KEY = 'lynch-official-lookup-cache-v3';
const AI_STORAGE_KEY = 'lynch-deepseek-analysis-v1';

const COMPANY_TYPE_OPTIONS: Array<{
  value: Exclude<CompanyType, 'unclassified'>;
  label: string;
  description: string;
}> = [
  {
    value: 'slow_grower',
    label: '缓慢增长型',
    description: '成熟、低增长，股息通常更重要。',
  },
  {
    value: 'stalwart',
    label: '稳定增长型',
    description: '规模较大、增长较稳定。',
  },
  {
    value: 'fast_grower',
    label: '快速增长型',
    description: '规模较小或中等、盈利增长较快。',
  },
  {
    value: 'cyclical',
    label: '周期型',
    description: '盈利随行业供需或经济周期明显波动。',
  },
  {
    value: 'turnaround',
    label: '困境反转型',
    description: '经营承压，价值取决于修复与生存。',
  },
  {
    value: 'asset_play',
    label: '隐蔽资产型',
    description: '价值主要来自未被市场充分认识的资产。',
  },
];

const RULE_TITLES = new Map(ruleCatalog.map((rule) => [rule.id, rule.title]));

function companyTypeLabel(type: CompanyType) {
  return (
    COMPANY_TYPE_OPTIONS.find((item) => item.value === type)?.label ?? '待分类'
  );
}

function aiEvidenceForRule(
  suggestion: AiAnalysisReport['ruleSuggestions'][number],
): MetricEvidence[] {
  return suggestion.sources
    .filter((source) => source.verified)
    .map((source) => ({
      metricId: `ai.${suggestion.ruleId}`,
      value: suggestion.outcome,
      period: source.publishedAt,
      reportRefIds: source.reportRefId ? [source.reportRefId] : [],
      page: source.page ?? undefined,
      pages: source.page == null ? undefined : [source.page],
      sourceQuote: source.quote,
      sourceName: source.title,
      sourceUrl: source.url,
      publishedAt: source.publishedAt,
      note: suggestion.evidence.join('；'),
    }));
}

const traceMetricLabels: Record<string, string> = {
  adjustedPrice: '年末股价',
  revenue: '营业收入',
  netProfit: '归母净利润',
  eps: '基本每股收益',
  cash: '现金',
  shortTermBorrowings: '短期借款',
  currentPortionNonCurrentLiabilities: '一年内到期的非流动负债',
  longTermBorrowings: '长期借款',
  bondsPayable: '应付债券／融资票据',
  currentLeaseLiabilities: '流动租赁负债',
  nonCurrentLeaseLiabilities: '非流动租赁负债',
  unclassifiedLeaseLiabilities: '未分类租赁负债',
  leaseLiabilities: '租赁负债合计',
  unclassifiedBorrowings: '未分类借款',
  longTermDebt: '长期债务（林奇口径）',
  interestBearingDebt: '全部有息负债（保守代理）',
  lynchNetCash: '林奇口径净现金',
  conservativeNetCash: '保守代理净现金',
  inventory: '存货',
  operatingCashFlow: '经营现金流',
  capitalExpenditure: '资本支出',
  freeCashFlow: '自由现金流代理值',
  pretaxProfit: '税前利润',
  totalAssets: '总资产',
  totalLiabilities: '总负债',
  shareholdersEquity: '股东权益',
  sharesOutstanding: '加权平均股本代理值',
};

function growthRate(current?: number, prior?: number) {
  if (
    typeof current !== 'number' ||
    typeof prior !== 'number' ||
    !Number.isFinite(current) ||
    !Number.isFinite(prior) ||
    prior === 0 ||
    current < 0 ||
    prior < 0
  )
    return undefined;
  return ((current - prior) / Math.abs(prior)) * 100;
}

function growthDisplay(current?: number, prior?: number) {
  if (typeof current !== 'number' || typeof prior !== 'number')
    return undefined;
  if (!Number.isFinite(current) || !Number.isFinite(prior)) return undefined;
  if (prior === 0)
    return current > 0 ? '由零转正' : current < 0 ? '由零转负' : '不可计算';
  if (current < 0 || prior < 0) {
    if (prior < 0 && current >= 0) return '由负转正';
    if (prior >= 0 && current < 0) return '由正转负';
    return '负值期间';
  }
  return growthRate(current, prior);
}

function priorPeriod(period: string) {
  const match = period.match(/^(\d{4})(Q[1-4]|H[12])$/);
  return match ? `${Number(match[1]) - 1}${match[2]}` : undefined;
}

function isAdjacentPeriod(current: string, previous: string) {
  const currentMatch = current.match(/^(\d{4})(Q[1-4]|H[12])$/);
  const previousMatch = previous.match(/^(\d{4})(Q[1-4]|H[12])$/);
  if (!currentMatch || !previousMatch) return false;
  const [currentYear, currentPart] = [Number(currentMatch[1]), currentMatch[2]];
  const [previousYear, previousPart] = [
    Number(previousMatch[1]),
    previousMatch[2],
  ];
  const index = (year: number, part: string) =>
    year * (part.startsWith('Q') ? 4 : 2) + Number(part.slice(1));
  return (
    currentPart.startsWith('Q') === previousPart.startsWith('Q') &&
    index(currentYear, currentPart) === index(previousYear, previousPart) + 1
  );
}

function reportGrowthPoints(dataset: AnalysisDataset) {
  const annualByYear = new Map(
    dataset.annual.map((point) => [point.period, point]),
  );
  const h2 = (dataset.halfYear ?? []).flatMap((half) => {
    const year = half.period.match(/^(\d{4})H1$/)?.[1];
    const annual = year ? annualByYear.get(year) : undefined;
    if (!year || !annual) return [];
    const point: MetricPoint = {
      period: `${year}H2`,
      reportRefIds: [
        ...new Set([...annual.reportRefIds, ...half.reportRefIds]),
      ],
    };
    for (const metric of [
      'revenue',
      'netProfit',
      'grossProfit',
      'operatingProfit',
      'pretaxProfit',
      'operatingCashFlow',
      'capitalExpenditure',
      'freeCashFlow',
    ]) {
      const annualValue = annual[metric];
      const halfValue = half[metric];
      if (
        typeof annualValue === 'number' &&
        typeof halfValue === 'number' &&
        Number.isFinite(annualValue) &&
        Number.isFinite(halfValue)
      )
        point[metric] = annualValue - halfValue;
    }
    if (typeof annual.inventory === 'number')
      point.inventory = annual.inventory;
    return [point];
  });
  const latestAnnualYear = Number(dataset.annual.at(-1)?.period);
  const latestHalfYearYear = Number(
    dataset.halfYear?.at(-1)?.period.slice(0, 4),
  );
  const periods =
    dataset.quarterly.length >= 2
      ? [...dataset.quarterly]
      : dataset.security?.market === 'HK' &&
          (dataset.halfYear?.length ?? 0) > 0 &&
          latestHalfYearYear > latestAnnualYear
        ? [...(dataset.halfYear ?? []), ...h2]
        : [];
  return periods.sort((a, b) => a.period.localeCompare(b.period));
}

function reportGrowthSeries(dataset: AnalysisDataset): MetricPoint[] {
  const annualRows = dataset.annual.map((point, index, points) => {
    const prior = points[index - 1];
    return {
      period: `年度${point.period}`,
      reportRefIds: point.reportRefIds,
      revenueYoY: growthDisplay(point.revenue, prior?.revenue),
      netProfitYoY: growthDisplay(point.netProfit, prior?.netProfit),
      epsYoY: growthDisplay(point.eps, prior?.eps),
    };
  });
  const periods = reportGrowthPoints(dataset);
  const periodRows = periods.map((point, index, points) => {
    const previous = points[index - 1];
    const sequential =
      previous && isAdjacentPeriod(point.period, previous.period)
        ? previous
        : undefined;
    const prior = periods.find(
      (candidate) => candidate.period === priorPeriod(point.period),
    );
    return {
      period: `报告期${point.period}`,
      reportRefIds: point.reportRefIds,
      revenueYoY: growthDisplay(point.revenue, prior?.revenue),
      revenueSequential: growthDisplay(point.revenue, sequential?.revenue),
      netProfitYoY: growthDisplay(point.netProfit, prior?.netProfit),
      netProfitSequential: growthDisplay(
        point.netProfit,
        sequential?.netProfit,
      ),
      epsYoY: growthDisplay(point.eps, prior?.eps),
      epsSequential: growthDisplay(point.eps, sequential?.eps),
    };
  });
  return [...annualRows, ...periodRows] as MetricPoint[];
}

function halfYearValuationPoints(dataset: AnalysisDataset): MetricPoint[] {
  const annualByYear = new Map(
    dataset.annual.map((point) => [Number(point.period.slice(0, 4)), point]),
  );
  const halfByYear = new Map(
    (dataset.halfYear ?? []).map((point) => [
      Number(point.period.slice(0, 4)),
      point,
    ]),
  );
  const sameCurrency =
    dataset.currency === (dataset.security?.currency ?? dataset.currency);
  const points: MetricPoint[] = dataset.annual.map((point) => {
    const pe =
      typeof point.pe === 'number'
        ? point.pe
        : sameCurrency &&
            typeof point.adjustedPrice === 'number' &&
            typeof point.eps === 'number' &&
            point.eps > 0
          ? point.adjustedPrice / point.eps
          : undefined;
    return {
      ...point,
      period: `${point.period.slice(0, 4)}-12`,
      pe,
      metricSources: {
        ...point.metricSources,
        ...(typeof pe === 'number' && !point.metricSources?.pe
          ? {
              pe: {
                label: '年末PE-TTM（计算值）',
                unit: '倍',
                formula: '年末未复权收盘价 ÷ 全年基本EPS',
              },
            }
          : {}),
      },
    };
  });
  for (const [year, half] of halfByYear) {
    const priorAnnual = annualByYear.get(year - 1);
    const priorHalf = halfByYear.get(year - 1);
    const epsTtm =
      typeof half.eps === 'number' &&
      typeof priorAnnual?.eps === 'number' &&
      typeof priorHalf?.eps === 'number'
        ? half.eps + priorAnnual.eps - priorHalf.eps
        : undefined;
    const pe =
      typeof half.pe === 'number'
        ? half.pe
        : sameCurrency &&
            typeof half.adjustedPrice === 'number' &&
            typeof epsTtm === 'number' &&
            epsTtm > 0
          ? half.adjustedPrice / epsTtm
          : undefined;
    points.push({
      ...half,
      period: `${year}-06`,
      eps: epsTtm,
      pe,
      reportRefIds: [
        ...new Set([
          ...half.reportRefIds,
          ...(priorAnnual?.reportRefIds ?? []),
          ...(priorHalf?.reportRefIds ?? []),
        ]),
      ],
      metricSources: {
        ...half.metricSources,
        ...(typeof epsTtm === 'number'
          ? {
              eps: {
                page: half.metricSources?.eps?.page,
                pages: half.metricSources?.eps?.pages,
                label: '截至6月末的EPS-TTM（还原值）',
                unit: `${dataset.currency}/股`,
                formula: '当期H1累计EPS＋上年全年EPS－上年H1累计EPS',
              },
            }
          : {}),
        ...(typeof pe === 'number' && !half.metricSources?.pe
          ? {
              pe: {
                label: '6月末PE-TTM（计算值）',
                unit: '倍',
                formula: '6月末未复权收盘价 ÷ EPS-TTM',
              },
            }
          : {}),
      },
    });
  }
  return points.sort((left, right) => left.period.localeCompare(right.period));
}

function formatMetricValue(
  value: number,
  key: string,
  financialCurrency: string,
  priceCurrency: string,
) {
  if (key === 'adjustedPrice') return `${value.toFixed(2)} ${priceCurrency}/股`;
  if (key === 'eps') return `${value.toFixed(3)} ${financialCurrency}/股`;
  return `${(value / 100_000_000).toLocaleString('zh-CN', {
    maximumFractionDigits: 2,
  })} 亿${financialCurrency}`;
}

function formatAmountAxis(value: number) {
  const amount = value / 100_000_000;
  return `${Math.abs(amount) >= 100 ? amount.toFixed(0) : amount.toFixed(1)}亿`;
}

function countCollectedDataPoints(dataset: AnalysisDataset) {
  const points = [
    ...dataset.annual,
    ...(dataset.halfYear ?? []),
    ...dataset.quarterly,
    ...(dataset.latestComparablePoint ? [dataset.latestComparablePoint] : []),
  ];
  const financialCount = points.reduce(
    (total, point) =>
      total +
      Object.entries(point).filter(
        ([key, value]) =>
          key !== 'isTtm' &&
          typeof value === 'number' &&
          Number.isFinite(value),
      ).length,
    0,
  );
  const marketCount = dataset.currentMarket
    ? Object.values(dataset.currentMarket).filter(
        (value) => typeof value === 'number' && Number.isFinite(value),
      ).length
    : 0;
  return financialCount + marketCount;
}

function scoreInsight(summary: ScoreSummary | null) {
  if (!summary || summary.decision === 'insufficient')
    return {
      grade: '证据不足，暂不评级',
      verdict: `可靠证据尚未覆盖至少${Math.round((summary?.minimumCoverage ?? 0.55) * 100)}%的适用规则。程序不会用少量证据给出“好公司”或“差公司”的确定结论。`,
      comparability: '不可比较',
    };
  const grade =
    summary.decision === 'strong'
      ? '基本面较强'
      : summary.decision === 'promising'
        ? '值得继续研究'
        : summary.decision === 'mixed'
          ? '优劣参半'
          : '风险证据占优';
  const verdict =
    summary.decision === 'strong'
      ? '在当前公开证据下，正向经营与财务特征明显多于风险。'
      : summary.decision === 'promising'
        ? '优势多于风险，但仍需结合估值和关键未知项继续研究。'
        : summary.decision === 'mixed'
          ? '优势和风险并存，当前没有形成足够清晰的质量优势。'
          : '负面证据多于正向证据，应优先核查主要风险而不是只看低估值。';
  return {
    grade,
    verdict,
    comparability: (summary.coverage ?? 0) >= 0.75 ? '可横向比较' : '谨慎比较',
  };
}

const chartDefinitions = [
  {
    id: 'price-eps',
    title: '每半年观察：股价、TTM EPS与PE',
    description:
      '每年6月末和12月末各设一个观察点；股价、近12个月EPS与PE均归一为首个有效点100，直接看升降与背离。',
    auditLabel: '原文方向＋行情口径',
    originalBasis:
      '原文要求比较股价走势线与收益线是否相符；价格复权口径在图内单独标明。',
    source: 'annual' as const,
    kind: 'line' as const,
    defaultView: 'chart' as const,
    series: [
      {
        key: 'adjustedPrice',
        label: '6/12月末股价',
        color: 'var(--ds-accent)',
      },
      { key: 'eps', label: '近12个月EPS', color: 'var(--ds-success)' },
      { key: 'pe', label: 'PE-TTM', color: 'var(--ds-warning)' },
    ],
  },
  {
    id: 'growth',
    title: '十年收入、净利润与每股收益',
    description: '前面为完整年度，最右点优先使用最新法定报告生成的TTM值。',
    auditLabel: '财报辅助图',
    originalBasis:
      '用于核对长期经营事实；不作为彼得·林奇原著中的独立评分公式。',
    source: 'annual' as const,
    kind: 'line' as const,
    defaultView: 'table' as const,
    series: [
      { key: 'revenue', label: '营业收入', color: 'var(--ds-accent)' },
      { key: 'netProfit', label: '净利润', color: 'var(--ds-success)' },
      { key: 'eps', label: '每股收益', color: 'var(--ds-info)' },
    ],
  },
  {
    id: 'cash-debt',
    title: '现金、长期债务与全部有息负债',
    description:
      '长期债务用于林奇原文口径；全部有息负债同时包含短期和长期融资负债，用于保守代理口径。',
    auditLabel: '原文＋保守对照',
    originalBasis:
      '原文口径关注现金减长期债务；全部有息负债仅作更保守的并列对照。',
    source: 'annual' as const,
    kind: 'bar' as const,
    series: [
      { key: 'cash', label: '现金', color: 'var(--ds-success)' },
      { key: 'longTermDebt', label: '长期债务', color: 'var(--ds-warning)' },
      {
        key: 'interestBearingDebt',
        label: '全部有息负债',
        color: 'var(--ds-danger)',
      },
    ],
  },
  {
    id: 'inventory-sales',
    title: '报告期存货与销售同比',
    description:
      '按可用的季度或半年报告期展示同比；对有重大存货的非金融公司，存货增长快于销售增长时标为风险证据。',
    auditLabel: '符合原文',
    originalBasis: '原文明确指出：存货增长速度快于销售增长速度是危险信号。',
    source: 'quarterlyGrowth' as const,
    kind: 'line' as const,
    series: [
      { key: 'inventoryGrowth', label: '存货同比', color: 'var(--ds-danger)' },
      { key: 'revenueGrowth', label: '销售同比', color: 'var(--ds-accent)' },
    ],
  },
  {
    id: 'fcf',
    title: '经营现金流、资本支出与自由现金流代理值',
    description:
      '代理值按经营现金流减全部资本性现金支出计算；财报无法自动拆分维持性与扩张性资本支出。',
    auditLabel: '代理口径',
    originalBasis:
      '原文自由现金流扣除正常资本支出；本图使用全部资本支出，结果更保守但不是原文精确值。',
    source: 'annual' as const,
    kind: 'bar' as const,
    series: [
      {
        key: 'operatingCashFlow',
        label: '经营现金流',
        color: 'var(--ds-accent)',
      },
      {
        key: 'capitalExpenditure',
        label: '资本支出',
        color: 'var(--ds-warning)',
      },
      {
        key: 'freeCashFlow',
        label: '自由现金流（全部资本支出代理）',
        color: 'var(--ds-success)',
      },
    ],
  },
  {
    id: 'growth-rates',
    title: '报告期与年度增长率',
    description:
      '年度列出年度同比；季度或半年列出各报告期同比，最新报告期另列连续环比。负数期间不显示数学百分比。',
    auditLabel: '最新报告口径',
    originalBasis: '本图是事实性数据展示，不把最新同比或环比纳入正式评分。',
    source: 'growthRates' as const,
    kind: 'line' as const,
    defaultView: 'table' as const,
    tableOnly: true,
    series: [
      { key: 'revenueYoY', label: '收入同比', color: 'var(--ds-accent)' },
      { key: 'revenueSequential', label: '收入环比', color: 'var(--ds-info)' },
      { key: 'netProfitYoY', label: '净利润同比', color: 'var(--ds-success)' },
      {
        key: 'netProfitSequential',
        label: '净利润环比',
        color: 'var(--ds-warning)',
      },
      { key: 'epsYoY', label: 'EPS同比', color: 'var(--ds-info)' },
      {
        key: 'epsSequential',
        label: 'EPS环比',
        color: 'var(--ds-text-secondary)',
      },
    ],
  },
  {
    id: 'valuation',
    title: '市盈率、年度EPS同比与模型辅助比值',
    description:
      '亏损时市盈率和比值显示不适用，不能把负市盈率误算成便宜；增长率÷PE仅作模型辅助，不代表统一原文阈值。',
    auditLabel: '原文方向＋模型辅助',
    originalBasis:
      '原文以市盈率与收益增长率是否匹配判断定价是否合理；增长率÷PE为辅助比值，评分仍使用各自已定义规则，不暗示统一原文阈值。',
    source: 'annual' as const,
    kind: 'line' as const,
    defaultView: 'table' as const,
    tableOnly: true,
    series: [
      { key: 'pe', label: '市盈率', color: 'var(--ds-accent)' },
      {
        key: 'earningsGrowth',
        label: '年度EPS同比',
        color: 'var(--ds-success)',
      },
      {
        key: 'lynchValuationRatio',
        label: '增长率÷PE（模型辅助比值）',
        color: 'var(--ds-info)',
      },
    ],
  },
];

function normalizeDataset(raw: unknown): AnalysisDataset {
  if (!raw || typeof raw !== 'object') throw new Error('JSON不是分析数据对象');
  const value = raw as AnalysisDataset;
  if (!/^\d{5,6}$/.test(value.companyCode) || !value.companyName)
    throw new Error('缺少股票代码或公司名称');
  if (!Array.isArray(value.annual) || !Array.isArray(value.quarterly))
    throw new Error('缺少annual或quarterly数组');
  if (!Array.isArray(value.reportRefs))
    throw new Error('缺少reportRefs来源清单');
  value.halfYear ??= [];
  for (const point of [
    ...value.annual,
    ...value.halfYear,
    ...value.quarterly,
  ]) {
    if (
      !point.period ||
      !Array.isArray(point.reportRefIds) ||
      point.reportRefIds.length === 0
    ) {
      throw new Error(`报告期 ${point.period || '未知'} 缺少来源引用`);
    }
  }
  assertTraceableDataset(value);
  return applyDatasetWindow(value);
}

function lookupCache() {
  try {
    return JSON.parse(
      window.localStorage.getItem(LOOKUP_CACHE_KEY) ?? '{}',
    ) as Record<string, OfficialLookup>;
  } catch {
    return {};
  }
}

function cacheLookup(lookup: OfficialLookup) {
  const cache = lookupCache();
  cache[`${lookup.company.market}:${lookup.company.code}`] = lookup;
  window.localStorage.setItem(LOOKUP_CACHE_KEY, JSON.stringify(cache));
}

async function readApiResponse<T>(response: Response, fallback: string) {
  const rawBody = await response.text();
  let body: T & { error?: string };
  try {
    body = JSON.parse(rawBody) as T & { error?: string };
  } catch {
    throw new Error(
      response.ok
        ? '服务返回格式无法读取'
        : `${fallback}（HTTP ${response.status}，服务未返回可读取的错误详情）`,
    );
  }
  if (!response.ok) throw new Error(body.error || fallback);
  return body;
}

function growthSeries(points: MetricPoint[]) {
  return points.map((point) => {
    const prior = points.find(
      (candidate) => candidate.period === priorPeriod(point.period),
    );
    return {
      period: point.period,
      reportRefIds: point.reportRefIds,
      inventoryGrowth: growthDisplay(point.inventory, prior?.inventory),
      revenueGrowth: growthDisplay(point.revenue, prior?.revenue),
    };
  });
}

function annualWithLatest(
  dataset: AnalysisDataset,
  latestBasis: 'flow' | 'instant' = 'flow',
) {
  const annual = dataset.annual.slice(-10);
  const latest = dataset.latestComparablePoint;
  if (!latest || latest.period.replace(/ TTM$/, '') === annual.at(-1)?.period)
    return annual;
  return [
    ...annual,
    {
      ...latest,
      period:
        latestBasis === 'instant'
          ? `${latest.period.replace(/ TTM$/, '')}期末`
          : latest.period,
      adjustedPrice: dataset.currentMarket?.price,
      metricSources: {
        ...latest.metricSources,
        ...(dataset.currentMarket
          ? {
              adjustedPrice: {
                label: '最新市场价格',
                unit: `${dataset.currentMarket.currency}/股`,
                date: dataset.currentMarket.date,
                sourceName: dataset.currentMarket.sourceName,
                sourceUrl: dataset.currentMarket.sourceUrl,
              },
            }
          : {}),
      },
    },
  ];
}

function tracePeriodLabel(point: MetricPoint) {
  return point.period.endsWith(' TTM')
    ? `${point.period.replace(/ TTM$/, '')}（流量TTM／资产期末）`
    : point.period;
}

function sourcePeriodLabel(point: MetricPoint, reports: ReportReference[]) {
  if (!reports.length) return point.reportRefIds.join('；');
  if (point.period.endsWith(' TTM')) return `${reports.length}份报告组合`;
  const dataYear = Number(point.period.slice(0, 4));
  const primary = reports[0];
  const role =
    Number.isFinite(dataYear) && primary.fiscalYear
      ? dataYear < primary.fiscalYear
        ? '上年比较数'
        : dataYear === primary.fiscalYear
          ? '本年数'
          : '历史数据'
      : '';
  return `${primary.title}${role ? ` · ${role}` : ''}${reports.length > 1 ? ` 等${reports.length}份报告` : ''}`;
}

function valuationSeries(dataset: AnalysisDataset) {
  const annual = dataset.annual.map((point, index, points) => {
    const start = points[index - 1];
    const earningsGrowth = growthRate(point.eps, start?.eps);
    const pe =
      typeof point.adjustedPrice === 'number' &&
      typeof point.eps === 'number' &&
      point.eps > 0
        ? point.adjustedPrice / point.eps
        : undefined;
    return {
      ...point,
      pe,
      earningsGrowth: earningsGrowth ?? undefined,
      lynchValuationRatio:
        pe && earningsGrowth && pe > 0 ? earningsGrowth / pe : undefined,
    };
  });
  const latest = dataset.latestComparablePoint;
  if (!latest) return annual.slice(-10);
  const earningsGrowth = undefined;
  const pe = dataset.currentMarket?.peTtm;
  return [
    ...annual.slice(-10),
    {
      ...latest,
      adjustedPrice: dataset.currentMarket?.price,
      pe,
      earningsGrowth: earningsGrowth ?? undefined,
      lynchValuationRatio:
        pe && earningsGrowth && pe > 0 ? earningsGrowth / pe : undefined,
    },
  ];
}

export function FundamentalsWorkbench({
  initialCode,
}: {
  initialCode?: string;
}) {
  const initialQueryHandled = useRef(false);
  const loadingStartedAt = useRef<number | null>(null);
  const [stockCode, setStockCode] = useState('');
  const [lookup, setLookup] = useState<OfficialLookup | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [loadingStage, setLoadingStage] = useState<
    'idle' | 'locating' | 'extracting'
  >('idle');
  const [loadingElapsedSeconds, setLoadingElapsedSeconds] = useState(0);
  const [dataset, setDataset] = useState<AnalysisDataset | null>(null);
  const [extraction, setExtraction] = useState<
    FundamentalsResponse['extraction'] | null
  >(null);
  const [analysis, setAnalysis] = useState<ProgramAnalysis | null>(null);
  const [aiReport, setAiReport] = useState<AiAnalysisReport | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  const aiRequestFingerprint = useRef('');
  const [notice, setNotice] = useState<Notice>(null);
  const [activeSection, setActiveSection] = useState('#overview');

  useEffect(() => {
    const syncSection = () =>
      setActiveSection(window.location.hash || '#overview');
    queueMicrotask(syncSection);
    window.addEventListener('hashchange', syncSection);
    return () => window.removeEventListener('hashchange', syncSection);
  }, []);

  useEffect(() => {
    if (initialCode) return;
    const saved = window.localStorage.getItem(DATASET_STORAGE_KEY);
    if (saved) {
      try {
        const next = normalizeDataset(JSON.parse(saved));
        const savedAnalysis = window.localStorage.getItem(ANALYSIS_STORAGE_KEY);
        const nextAnalysis = savedAnalysis
          ? (JSON.parse(savedAnalysis) as ProgramAnalysis)
          : null;
        const savedAi = window.localStorage.getItem(AI_STORAGE_KEY);
        const nextAi = savedAi
          ? (JSON.parse(savedAi) as {
              companyCode: string;
              metricVersion: string;
              report: AiAnalysisReport;
            })
          : null;
        queueMicrotask(() => {
          setDataset(next);
          setStockCode(next.companyCode);
          if (nextAnalysis?.results && nextAnalysis?.snapshot) {
            setAnalysis(nextAnalysis);
          }
          if (
            nextAi?.companyCode === next.companyCode &&
            nextAi.metricVersion === next.metricVersion
          ) {
            setAiReport(nextAi.report);
            aiRequestFingerprint.current = `${next.companyCode}:${next.generatedAt}`;
          }
        });
      } catch {
        window.localStorage.removeItem(DATASET_STORAGE_KEY);
        window.localStorage.removeItem(ANALYSIS_STORAGE_KEY);
        window.localStorage.removeItem(AI_STORAGE_KEY);
      }
    }
  }, [initialCode]);

  useEffect(() => {
    const startedAt = loadingStartedAt.current;
    if (!lookupLoading || startedAt === null) return;
    const updateElapsed = () =>
      setLoadingElapsedSeconds(
        Math.max(0, Math.floor((Date.now() - startedAt) / 1000)),
      );
    updateElapsed();
    const timer = window.setInterval(updateElapsed, 1000);
    return () => window.clearInterval(timer);
  }, [lookupLoading]);

  const chartData = useMemo(() => {
    if (!dataset) return new Map<string, MetricPoint[]>();
    return new Map(
      chartDefinitions.map((definition) => [
        definition.id,
        definition.source === 'quarterlyGrowth'
          ? growthSeries(
              reportGrowthPoints(dataset).length
                ? reportGrowthPoints(dataset)
                : dataset.quarterly,
            )
          : definition.source === 'growthRates'
            ? reportGrowthSeries(dataset)
            : definition.id === 'price-eps'
              ? [
                  ...halfYearValuationPoints(dataset),
                  ...(dataset.currentMarket
                    ? [{
                        period: `最新行情 ${dataset.currentMarket.date}`,
                        reportRefIds: [],
                        adjustedPrice: dataset.currentMarket.price,
                        pe: dataset.currentMarket.peTtm,
                      }]
                    : []),
                ]
            : definition.id === 'valuation'
              ? valuationSeries(dataset)
              : annualWithLatest(
                  dataset,
                  definition.id === 'cash-debt' ? 'instant' : 'flow',
                ),
      ]),
    );
  }, [dataset]);

  async function lookupStock(codeOverride?: string) {
    const normalized = normalizeSecurityCode(codeOverride ?? stockCode);
    if (!normalized) {
      setNotice({ tone: 'bad', text: '请输入6位A股代码或5位港股代码。' });
      return;
    }
    // A deliberate lookup must never keep showing a cached result while the
    // fresh official-report response is being fetched, including same-stock
    // refreshes after the market data source has changed.
    setDataset(null);
    setAnalysis(null);
    window.localStorage.removeItem(DATASET_STORAGE_KEY);
    window.localStorage.removeItem(ANALYSIS_STORAGE_KEY);
    setStockCode(normalized.code);
    setLookup(null);
    setExtraction(null);
    setAiReport(null);
    setAiError('');
    aiRequestFingerprint.current = '';
    window.localStorage.removeItem(AI_STORAGE_KEY);
    loadingStartedAt.current = Date.now();
    setLoadingElapsedSeconds(0);
    setLookupLoading(true);
    setLoadingStage('locating');
    setNotice({
      tone: 'warn',
      text: '正在确认公司和官方报告，通常只需几秒。',
    });
    let locatedLookup: OfficialLookup | null = null;
    let usedCachedLookup = false;
    try {
      const cached = lookupCache()[`${normalized.market}:${normalized.code}`];
      const cacheAge =
        Date.now() - Date.parse(cached?.source.retrievedAt ?? '');
      if (cached && cacheAge >= 0 && cacheAge < 15 * 60 * 1000) {
        locatedLookup = cached;
        usedCachedLookup = true;
      } else {
        try {
          const lookupResponse = await fetch(
            `/api/official-reports?code=${normalized.code}`,
            { cache: 'no-store' },
          );
          locatedLookup = await readApiResponse<OfficialLookup>(
            lookupResponse,
            '官方披露查询失败',
          );
        } catch (error) {
          if (!cached) throw error;
          locatedLookup = cached;
          usedCachedLookup = true;
        }
      }
      setLookup(locatedLookup);
      cacheLookup(locatedLookup);
      setLoadingStage('extracting');
      setNotice({
        tone: usedCachedLookup ? 'warn' : 'good',
        text: usedCachedLookup
          ? `正在用刚才已确认的${locatedLookup.reports.length}份官方报告继续抽取，无需重复查询巨潮。`
          : `已确认${locatedLookup.company.companyName}，正在从官方定期报告读取并核验数据。`,
      });

      const fundamentalsResponse = await fetch('/api/fundamentals', {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: normalized.code, lookup: locatedLookup }),
      });
      const body = await readApiResponse<FundamentalsResponse>(
        fundamentalsResponse,
        '财务数据抽取失败，请稍后重试',
      );
      setLookup(body.lookup);
      setExtraction(body.extraction);
      setAnalysis(body.analysis);
      cacheLookup(body.lookup);
      const nextDataset = body.dataset ? normalizeDataset(body.dataset) : null;
      if (nextDataset) {
        setDataset(nextDataset);
        if (nextDataset.annual.length >= 10) {
          window.localStorage.setItem(
            DATASET_STORAGE_KEY,
            JSON.stringify(nextDataset),
          );
          window.localStorage.setItem(
            ANALYSIS_STORAGE_KEY,
            JSON.stringify(body.analysis),
          );
        } else {
          window.localStorage.removeItem(DATASET_STORAGE_KEY);
          window.localStorage.removeItem(ANALYSIS_STORAGE_KEY);
        }
      } else {
        setDataset(null);
        window.localStorage.removeItem(DATASET_STORAGE_KEY);
        window.localStorage.removeItem(ANALYSIS_STORAGE_KEY);
      }
      setNotice({
        tone:
          body.dataset && body.dataset.annual.length >= 10 ? 'good' : 'warn',
        text: nextDataset
          ? `已从${body.lookup.source.name}确认${body.lookup.company.companyName}，共统计到 ${countCollectedDataPoints(nextDataset)} 个有效数据。最新报告期为 ${body.extraction.latestReportPeriod ?? '未知'}。${!body.extraction.complete ? '数据不完整，只作初步分析。' : ''}`
          : `已确认${body.lookup.company.companyName}，但年报数字尚未通过自动抽取。`,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : '官方披露查询失败';
      if (locatedLookup) {
        setNotice({
          tone: 'bad',
          text: `已确认${locatedLookup.company.companyName}和${locatedLookup.reports.length}份报告，但财务抽取未完成：${/internal error|reference\s*=|fetch failed/i.test(message) ? '数据服务暂时无法连接官方网站，请重试。' : message}`,
        });
      } else {
        const cached = lookupCache()[`${normalized.market}:${normalized.code}`];
        if (cached) {
          setLookup(cached);
          setNotice({
            tone: 'warn',
            text: `官方查询暂时失败，已显示本机缓存（保存于 ${cached.source.retrievedAt.slice(0, 10)}）。`,
          });
        } else {
          setNotice({
            tone: 'bad',
            text: /internal error|reference\s*=|fetch failed/i.test(message)
              ? '本地服务暂时无法连接官方披露网站，请稍后重试。旧公司的数据不会继续显示。'
              : message,
          });
        }
      }
    } finally {
      setLookupLoading(false);
      setLoadingStage('idle');
      loadingStartedAt.current = null;
    }
  }

  const runInitialLookup = useEffectEvent((code: string) => {
    void lookupStock(code);
  });

  useEffect(() => {
    if (!initialCode || initialQueryHandled.current) return;
    initialQueryHandled.current = true;
    runInitialLookup(initialCode);
  }, [initialCode]);

  const activeName = dataset?.companyName ?? lookup?.company.companyName;
  const activeCode = dataset?.companyCode ?? lookup?.company.code ?? stockCode;
  const activeMarket =
    dataset?.security?.market ?? lookup?.company.market ?? null;
  const activeFinancial =
    dataset?.isFinancialCompany ?? lookup?.company.isFinancialCompany ?? false;
  const datasetComplete = Boolean(dataset && dataset.annual.length >= 10);
  const interimComplete = Boolean(
    dataset &&
    (activeMarket === 'HK'
      ? (dataset.halfYear?.length ?? 0) >= 10
      : dataset.quarterly.length >= 12),
  );
  const fullyComplete = Boolean(
    extraction?.complete ?? (datasetComplete && interimComplete),
  );
  const effectiveCompanyTypes = useMemo(
    () =>
      (aiReport?.companyTypes ?? []).filter(
        (type): type is Exclude<CompanyType, 'unclassified'> =>
          type !== 'unclassified',
      ),
    [aiReport],
  );
  const effectiveProgramResults = useMemo(
    () =>
      analysis
        ? evaluateProgramRules({
            ...analysis.snapshot,
            companyType: effectiveCompanyTypes[0] ?? 'unclassified',
            companyTypes: effectiveCompanyTypes,
          })
        : [],
    [analysis, effectiveCompanyTypes],
  );
  const combinedResults = useMemo(() => {
    const aiResults: RuleResult[] = (aiReport?.ruleSuggestions ?? []).map(
      (suggestion) => ({
        ruleId: suggestion.ruleId,
        outcome: suggestion.outcome,
        evaluator: 'ai',
        evidence: aiEvidenceForRule(suggestion),
        userConfirmed: true,
        note: suggestion.rationale,
      }),
    );
    return mergeRuleResults(effectiveProgramResults, aiResults);
  }, [aiReport, effectiveProgramResults]);
  const combinedScore = useMemo(
    () =>
      analysis
        ? calculateScore(combinedResults, { includeConfirmedAi: true })
        : null,
    [analysis, combinedResults],
  );
  const currentScoreInsight = scoreInsight(combinedScore);
  const keyStrengths = combinedResults
    .filter((item) => item.outcome === 1)
    .slice(0, 3)
    .map((item) => RULE_TITLES.get(item.ruleId) ?? item.ruleId);
  const keyRisks = combinedResults
    .filter((item) => item.outcome === -1)
    .slice(0, 3)
    .map((item) => RULE_TITLES.get(item.ruleId) ?? item.ruleId);
  const missingEvidence = combinedResults
    .filter((item) => item.outcome === 'insufficient')
    .slice(0, 3)
    .map((item) => RULE_TITLES.get(item.ruleId) ?? item.ruleId);

  async function requestAiAnalysis(
    targetDataset = dataset,
    targetAnalysis = analysis,
  ) {
    if (!targetDataset || !targetAnalysis) return;
    setAiLoading(true);
    setAiError('');
    try {
      const response = await fetch('/api/ai-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dataset: targetDataset,
          analysis: targetAnalysis,
        }),
      });
      const body = (await response.json()) as AiAnalysisReport & {
        error?: string;
      };
      if (!response.ok) throw new Error(body.error || '补充研判失败');
      setAiReport(body);
      window.localStorage.setItem(
        AI_STORAGE_KEY,
        JSON.stringify({
          companyCode: targetDataset.companyCode,
          metricVersion: targetDataset.metricVersion,
          report: body,
        }),
      );
    } catch (error) {
      setAiError(
        error instanceof Error ? error.message : 'DeepSeek 证据分析失败',
      );
    } finally {
      setAiLoading(false);
    }
  }

  const runAiAnalysis = useEffectEvent(
    (targetDataset: AnalysisDataset, targetAnalysis: ProgramAnalysis) => {
      void requestAiAnalysis(targetDataset, targetAnalysis);
    },
  );

  useEffect(() => {
    if (!dataset || !analysis || aiReport || aiLoading) return;
    const fingerprint = `${dataset.companyCode}:${dataset.generatedAt}`;
    if (aiRequestFingerprint.current === fingerprint) return;
    aiRequestFingerprint.current = fingerprint;
    runAiAnalysis(dataset, analysis);
  }, [dataset, analysis, aiReport, aiLoading]);

  return (
    <main
      id="main-content"
      className="finance-shell min-h-dvh overflow-x-hidden bg-[var(--ds-canvas)] text-[var(--ds-text-primary)]"
    >
      <a href="#overview" className="skip-link">
        跳到公司概览
      </a>
      <header className="research-header sticky top-0 z-40 border-b bg-[var(--ds-surface)]">
        <div className="research-toolbar mx-auto flex max-w-[1440px] items-center justify-between gap-4 px-4 lg:px-8">
          <Link
            href="/"
            prefetch={false}
            className="flex shrink-0 items-center gap-2 font-semibold"
          >
            <span className="grid size-8 place-items-center rounded-md bg-[var(--ds-primary)] font-mono text-xs text-white">
              LY
            </span>
            <span className="hidden sm:inline">林奇基本面研究</span>
          </Link>
          <div className="research-search flex min-w-0 items-center gap-2">
            <label htmlFor="stock-code" className="sr-only">
              股票代码
            </label>
            <Input
              id="stock-code"
              value={stockCode}
              onChange={(event) => {
                const next = event.target.value.replace(/\D/g, '').slice(0, 6);
                setStockCode(next);
                if (lookup && lookup.company.code !== next) {
                  setLookup(null);
                  setExtraction(null);
                }
                if (dataset && dataset.companyCode !== next) {
                  setDataset(null);
                  setAnalysis(null);
                  setAiReport(null);
                  window.localStorage.removeItem(DATASET_STORAGE_KEY);
                  window.localStorage.removeItem(ANALYSIS_STORAGE_KEY);
                }
                setNotice(null);
              }}
              onKeyDown={(event) => event.key === 'Enter' && lookupStock()}
              placeholder="例如：600519"
              inputMode="numeric"
              aria-label="股票代码"
              aria-describedby={
                !dataset && !lookupLoading ? 'stock-code-help' : undefined
              }
              className="h-11 rounded-sm border-[var(--ds-border-strong)] bg-[var(--ds-surface-elevated)] font-mono text-base tracking-wide text-[var(--ds-text-primary)] placeholder:text-[var(--ds-text-disabled)]"
            />
            <Button
              onClick={() => lookupStock()}
              disabled={lookupLoading}
              className="terminal-button h-11 shrink-0 px-5"
            >
              {lookupLoading ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <FileSearch className="size-4" />
              )}
              {loadingStage === 'locating'
                ? '正在确认公司…'
                : loadingStage === 'extracting'
                  ? '正在读取财报…'
                  : '开始研究'}
            </Button>
          </div>
        </div>
        <nav
          aria-label="研究章节"
          className="research-nav mx-auto flex max-w-[1440px] gap-1 overflow-x-auto px-4 lg:px-8"
        >
          {[
            ['#overview', '概览'],
            ['#latest-comparison', '最新报告'],
            ['#chart-growth-rates', '增长对比'],
            ['#chart-valuation', '估值'],
            ['#debt', '资产负债'],
            ['#chart-fcf', '现金流'],
            ['#research-assessment', '规则与依据'],
          ].map(([href, label]) => (
            <a
              key={href}
              href={href}
              aria-current={activeSection === href ? 'location' : undefined}
              className="shrink-0 px-3 py-3 text-sm font-medium"
            >
              {label}
            </a>
          ))}
        </nav>
      </header>

      <section
        id="overview"
        className="border-b border-[var(--ds-border-subtle)] bg-[var(--ds-surface)]"
      >
        <div className="mx-auto flex min-h-28 max-w-[1440px] flex-col justify-between gap-4 px-4 py-6 sm:flex-row sm:items-end lg:px-8">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-3xl font-semibold tracking-[-0.025em]">
                {activeName ?? '公司研究'}
              </h1>
              {activeName && (
                <Badge
                  variant="outline"
                  className="rounded-sm border-[var(--ds-border-strong)] bg-[var(--ds-surface-subtle)] font-mono text-xs text-[var(--ds-text-secondary)]"
                >
                  {activeCode} · {activeMarket === 'HK' ? 'HKEX' : 'A股'}
                </Badge>
              )}
              {activeFinancial && (
                <Badge className="rounded-sm bg-[var(--ds-warning-bg)] text-[var(--ds-warning)] hover:bg-[var(--ds-warning-bg)]">
                  金融企业 · 不排名
                </Badge>
              )}
            </div>
            <p className="mt-2 text-sm text-[var(--ds-text-tertiary)]">
              {dataset
                ? `${dataset.security?.exchange ?? (activeMarket === 'HK' ? '港交所' : 'A股')} · 最新报告期 ${dataset.latestReportPeriod ?? '未取得'} · 数据更新 ${dataset.generatedAt.slice(0, 10)} · ${dataset.annual.length}个年度 / ${dataset.halfYear?.length ?? 0}个上半年 / ${dataset.quarterly.length}个季度`
                : lookup
                  ? `${lookup.company.exchange} · 交易币种 ${lookup.company.currency}`
                  : '输入股票代码，开始一家公司研究'}
            </p>
          </div>
          {dataset?.currentMarket && (
            <div className="text-right">
              <p className="font-mono text-2xl font-semibold">
                {dataset.currentMarket.price.toFixed(2)}{' '}
                {dataset.currentMarket.currency}
              </p>
              <p className="mt-1 text-xs text-[var(--ds-text-tertiary)]">
                行情日期 {dataset.currentMarket.date}
              </p>
              {analysis && (
                <a
                  href="#research-assessment"
                  className="mt-2 block text-xs text-[var(--ds-accent)]"
                >
                  {activeFinancial || combinedScore?.score == null
                    ? '暂不评级'
                    : combinedScore.reliable
                      ? `辅助评分 ${Math.round(combinedScore.score)}`
                      : '证据不足，暂不评级'}{' '}
                  · 证据覆盖 {((combinedScore?.coverage ?? 0) * 100).toFixed(0)}
                  %
                </a>
              )}
            </div>
          )}
        </div>
      </section>

      <TooltipProvider>
        <div className="research-content mx-auto flex max-w-[1440px] flex-col gap-6 px-4 py-6 lg:px-8">
          {notice && !lookupLoading && (!dataset || notice.tone === 'bad') && (
            <output
              role={notice.tone === 'bad' ? 'alert' : 'status'}
              aria-live={notice.tone === 'bad' ? 'assertive' : 'polite'}
              className={`block rounded-lg border px-4 py-3 text-sm ${
                notice.tone === 'good'
                  ? 'border-[var(--ds-success)]/40 bg-[var(--ds-success-bg)] text-[var(--ds-success)]'
                  : notice.tone === 'bad'
                    ? 'border-[var(--ds-danger)]/40 bg-[var(--ds-danger-bg)] text-[var(--ds-danger)]'
                    : 'border-[var(--ds-warning)]/40 bg-[var(--ds-warning-bg)] text-[var(--ds-warning)]'
              }`}
            >
              {notice.text}
            </output>
          )}

          {lookup && !lookupLoading && !dataset && (
            <details className="research-panel p-4">
              <summary>已确认报告与查询提示</summary>
              <a
                href={lookup.source.url}
                target="_blank"
                rel="noreferrer"
                className="text-[var(--ds-accent)]"
              >
                {lookup.source.name}
              </a>
              {lookup.warnings.map((warning) => (
                <p className="mt-2 text-sm" key={warning}>
                  {warning}
                </p>
              ))}
              {lookup.reports.map((report) => (
                <p key={report.id} className="mt-2">
                  <a href={report.url} target="_blank" rel="noreferrer">
                    {report.title}
                  </a>
                </p>
              ))}
            </details>
          )}
          {!dataset && !lookupLoading && (
            <section
              className="research-panel space-y-3 p-6"
              aria-labelledby="instrument-lookup-title"
            >
              <h2
                id="instrument-lookup-title"
                className="text-xl font-semibold"
              >
                研究一家公司
              </h2>
              <p id="stock-code-help" className="text-sm text-muted-foreground">
                输入6位A股或4–5位港股代码，查看官方财报、增长与估值。
              </p>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => lookupStock('600519')}>
                  贵州茅台 600519
                </Button>
                <Button variant="outline" onClick={() => lookupStock('00700')}>
                  腾讯控股 00700
                </Button>
              </div>
            </section>
          )}
          {lookupLoading && (
            <output
              className="research-panel block min-h-40 p-6"
              aria-live="polite"
            >
              <div className="flex items-start gap-4">
                <LoaderCircle className="mt-0.5 size-6 shrink-0 animate-spin text-[var(--ds-accent)] motion-reduce:animate-none" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="font-semibold">
                      {loadingStage === 'locating'
                        ? '正在确认公司与报告'
                        : '正在读取并核验财报'}
                    </p>
                    <p
                      aria-hidden="true"
                      className="font-mono text-xs tabular-nums text-[var(--ds-text-tertiary)]"
                    >
                      已用时 {Math.floor(loadingElapsedSeconds / 60)}:
                      {String(loadingElapsedSeconds % 60).padStart(2, '0')}
                    </p>
                  </div>
                  <progress
                    className="research-progress mt-4 w-full"
                    aria-label={
                      loadingStage === 'locating'
                        ? '正在确认公司与报告'
                        : '正在读取并核验财报'
                    }
                  />
                  <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                    <p
                      className={
                        loadingStage === 'locating'
                          ? 'font-semibold text-[var(--ds-accent)]'
                          : 'text-[var(--ds-success)]'
                      }
                    >
                      1　确认公司与报告
                    </p>
                    <p
                      className={
                        loadingStage === 'extracting'
                          ? 'font-semibold text-[var(--ds-accent)]'
                          : 'text-[var(--ds-text-tertiary)]'
                      }
                    >
                      2　下载、解析与校验
                    </p>
                  </div>
                  <p className="mt-3 text-sm text-muted-foreground">
                  {loadingStage === 'locating'
                      ? '正在查询官方披露目录，确认证券身份和可用报告。'
                      : '正在处理所需年报和中报；大体积PDF可能需要一至三分钟。完成后会自动显示，未披露或校验失败的数据保持为空。'}
                  </p>
                </div>
              </div>
            </output>
          )}

          {dataset && (
            <section className="space-y-3">
              <div>
                <h2 className="mt-1 text-[17px] font-semibold tracking-tight">
                  市场概览
                </h2>
              </div>
              <div className="ds-kpi-strip grid border-y border-[var(--ds-border-subtle)] grid-cols-2 xl:grid-cols-[0.8fr_0.8fr_1.4fr_1.4fr]">
                <MetricTile
                  label="PE·TTM"
                  value={
                    dataset.currentMarket?.peTtm
                      ? `${dataset.currentMarket.peTtm.toFixed(2)}倍`
                      : '不适用/缺失'
                  }
                  note="行情源当前口径"
                />
                <MetricTile
                  label="PB"
                  value={
                    dataset.currentMarket?.pb
                      ? `${dataset.currentMarket.pb.toFixed(2)}倍`
                      : '缺失'
                  }
                  note="不作为所有行业的通用买入线"
                />
                <MetricTile
                  label="林奇口径每股净现金"
                  value={
                    typeof dataset.latestComparablePoint
                      ?.lynchNetCashPerShare === 'number'
                      ? `${dataset.latestComparablePoint.lynchNetCashPerShare.toFixed(3)} ${dataset.currency}/股`
                      : '缺失'
                  }
                  note={`${dataset.latestReportPeriod ?? '最新报告期'}期末 ·（现金－长期债务）÷股本`}
                />
                <MetricTile
                  label="保守代理每股净现金"
                  value={
                    typeof dataset.latestComparablePoint
                      ?.conservativeNetCashPerShare === 'number'
                      ? `${dataset.latestComparablePoint.conservativeNetCashPerShare.toFixed(3)} ${dataset.currency}/股`
                      : '缺失'
                  }
                  note={`${dataset.latestReportPeriod ?? '最新报告期'}期末 ·（现金－全部有息负债）÷股本；未扣受限资金时仍为代理值`}
                />
              </div>
            </section>
          )}

          {dataset && (
            <LatestReportComparison dataset={dataset} analysis={analysis} />
          )}

          {dataset ? (
            <>
              <section id="financials" className="scroll-mt-32">
                <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
                  <div>
                    <p className="ds-eyebrow">财务质量</p>
                    <h2 className="mt-1 text-[17px] font-semibold tracking-tight">
                      财务趋势与数据表
                    </h2>
                    <p className="mt-2 text-sm text-muted-foreground">
                      年度与报告期分别比较，趋势图可切换为数据表。
                    </p>
                  </div>
                  {activeFinancial && (
                    <Badge className="w-fit bg-[var(--ds-warning-bg)] text-[var(--ds-warning)] hover:bg-[var(--ds-warning-bg)]">
                      金融企业：只查看，不参加排名
                    </Badge>
                  )}
                </div>
                <div className="mt-4 grid min-w-0 gap-5 xl:grid-cols-2">
                  {[...chartDefinitions]
                    .sort(
                      (a, b) =>
                        Number(b.id === 'growth-rates') -
                        Number(a.id === 'growth-rates'),
                    )
                    .map((definition) => (
                      <FundamentalChart
                        key={definition.id}
                        definition={definition}
                        data={chartData.get(definition.id) ?? []}
                        financialCurrency={dataset?.currency}
                        priceCurrency={dataset?.security?.currency}
                        priceAdjustment={dataset.priceAdjustment}
                        historyPoints={
                          definition.id === 'growth-rates'
                            ? [
                                ...dataset.annual,
                                ...reportGrowthPoints(dataset),
                              ]
                            : undefined
                        }
                      />
                    ))}
                </div>
              </section>
              {dataset && (
                <div className="">
                  <DebtStructurePanel dataset={dataset} />
                </div>
              )}
              {analysis && (
                <section
                  id="research-assessment"
                  className="research-panel scroll-mt-32 p-5 sm:p-6"
                >
                  <p className="ds-eyebrow">规则与依据</p>
                  <div className="mt-2 grid gap-5 lg:grid-cols-[1fr_auto] lg:items-end">
                    <div>
                      <h2 className="text-xl font-semibold tracking-tight">
                        {effectiveCompanyTypes.length > 0
                          ? `${effectiveCompanyTypes.map(companyTypeLabel).join(' · ')} · ${activeFinancial ? '仅展示证据' : currentScoreInsight.grade}`
                          : activeFinancial
                            ? '公司类型分析中 · 仅展示证据'
                            : `公司类型分析中 · ${currentScoreInsight.grade}`}
                      </h2>
                      <p className="mt-3 max-w-3xl text-base leading-7 text-[var(--ds-text-secondary)]">
                        {activeFinancial
                          ? '金融企业不套用普通公司排名，保留当前项目已有的财务事实与单条规则证据。'
                          : currentScoreInsight.verdict}
                      </p>
                    </div>
                    <div className="flex items-baseline gap-2 text-right">
                      <span className="text-xs text-[var(--ds-text-tertiary)]">
                        证据评分
                      </span>
                      <span className="font-mono text-3xl font-semibold">
                        {!activeFinancial &&
                        combinedScore?.reliable &&
                        combinedScore.score != null
                          ? Math.round(combinedScore.score)
                          : '—'}
                      </span>
                      <span className="text-xs text-[var(--ds-text-tertiary)]">
                        / 100
                      </span>
                    </div>
                  </div>

                  <div className="mt-7 grid border-y border-[var(--ds-border-subtle)] md:grid-cols-2 xl:grid-cols-4">
                    <ResearchJudgment
                      label="估值"
                      verdict={
                        analysis.snapshot.peContext === 'low'
                          ? '偏低'
                          : analysis.snapshot.peContext === 'extreme'
                            ? '偏高'
                            : analysis.snapshot.peContext === 'normal'
                              ? '合理'
                              : '待判断'
                      }
                      metrics={`PE ${typeof analysis.snapshot.peTtm === 'number' ? `${analysis.snapshot.peTtm.toFixed(2)}倍` : '缺失'} · 最新报告期${analysis.snapshot.latestReportPeriod ?? '缺失'}`}
                    />
                    <ResearchJudgment
                      label="增长"
                      verdict={
                        typeof analysis.snapshot
                          .latestRevenueGrowthYoYPercent === 'number'
                          ? analysis.snapshot.latestRevenueGrowthYoYPercent > 0
                            ? '保持增长'
                            : '增长承压'
                          : '证据不足'
                      }
                      metrics={`营收同比 ${typeof analysis.snapshot.latestRevenueGrowthYoYPercent === 'number' ? `${analysis.snapshot.latestRevenueGrowthYoYPercent.toFixed(2)}%` : '不可计算'} · 净利润同比 ${typeof analysis.snapshot.latestNetProfitGrowthYoYPercent === 'number' ? `${analysis.snapshot.latestNetProfitGrowthYoYPercent.toFixed(2)}%` : '不可计算'}`}
                    />
                    <ResearchJudgment
                      label="财务安全"
                      verdict={
                        typeof analysis.snapshot.debtRatioPercent === 'number'
                          ? analysis.snapshot.debtRatioPercent < 50
                            ? '负债结构较稳健'
                            : '关注负债水平'
                          : '证据不足'
                      }
                      metrics={`资产负债率 ${typeof analysis.snapshot.debtRatioPercent === 'number' ? `${analysis.snapshot.debtRatioPercent.toFixed(2)}%` : '缺失'} · 每股净现金 ${typeof analysis.snapshot.lynchNetCashPerShare === 'number' ? analysis.snapshot.lynchNetCashPerShare.toFixed(3) : '缺失'}`}
                    />
                    <ResearchJudgment
                      label="现金流"
                      verdict={
                        analysis.snapshot.freeCashFlowTrend === 'improving'
                          ? '改善'
                          : analysis.snapshot.freeCashFlowTrend === 'stable'
                            ? '稳定'
                            : analysis.snapshot.freeCashFlowTrend ===
                                'worsening'
                              ? '走弱'
                              : '证据不足'
                      }
                      metrics={`自由现金流 ${typeof analysis.snapshot.freeCashFlow === 'number' ? `${(analysis.snapshot.freeCashFlow / 100_000_000).toLocaleString('zh-CN', { maximumFractionDigits: 2 })}亿${dataset?.currency ?? ''}` : '缺失'}`}
                    />
                  </div>

                  <div className="mt-6 grid gap-6 lg:grid-cols-[1.35fr_0.65fr]">
                    <div>
                      <div>
                        <div>
                          <p className="text-sm font-semibold">
                            AI 自动识别的公司类型
                          </p>
                          <p className="mt-1 text-sm text-[var(--ds-text-tertiary)]">
                            同一家公司可以同时具备多种经营特征；类型用于匹配相应规则，不需要你手动选择。
                          </p>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {aiLoading && (
                            <Badge className="gap-1 bg-[var(--ds-info-bg)] text-[var(--ds-info)]">
                              <LoaderCircle className="size-3 animate-spin" />
                              正在读取证据并分类
                            </Badge>
                          )}
                          {!aiLoading && effectiveCompanyTypes.length === 0 && (
                            <Badge variant="outline">证据不足，暂未分类</Badge>
                          )}
                          {effectiveCompanyTypes.map((type) => {
                            const assessment =
                              aiReport?.companyTypeAssessments.find(
                                (item) => item.type === type,
                              );
                            return (
                              <Badge
                                key={type}
                                title={assessment?.rationale}
                                className="bg-[var(--ds-info-bg)] text-[var(--ds-info)]"
                              >
                                {companyTypeLabel(type)} ·{' '}
                                {Math.round((assessment?.confidence ?? 0) * 100)}%
                              </Badge>
                            );
                          })}
                        </div>
                        {effectiveCompanyTypes.length > 0 && (
                          <details className="mt-3 text-xs text-[var(--ds-text-secondary)]">
                            <summary className="cursor-pointer font-medium text-[var(--ds-accent)]">
                              查看分类依据与原文
                            </summary>
                            <div className="mt-2 space-y-3 border-l-2 border-[var(--ds-border-subtle)] pl-3">
                              {effectiveCompanyTypes.map((type) => {
                                const assessment =
                                  aiReport?.companyTypeAssessments.find(
                                    (item) => item.type === type,
                                  );
                                if (!assessment) return null;
                                return (
                                  <div key={`evidence-${type}`}>
                                    <p className="font-medium text-[var(--ds-text-primary)]">
                                      {companyTypeLabel(type)}
                                    </p>
                                    <p className="mt-1 leading-5">
                                      {assessment.rationale}
                                    </p>
                                    {assessment.metricEvidence?.map(
                                      (evidence) => (
                                        <p
                                          key={`${type}-${evidence.metricId}`}
                                          className="mt-1 font-mono leading-5 text-[var(--ds-text-tertiary)]"
                                        >
                                          {evidence.period} EPS复合增长率：
                                          {typeof evidence.value === 'number'
                                            ? `${evidence.value.toFixed(2)}%`
                                            : '缺失'}
                                          。{evidence.note}
                                        </p>
                                      ),
                                    )}
                                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                                      {assessment.sources
                                        .filter((source) => source.verified)
                                        .map((source) => (
                                          <a
                                            key={`${type}-${source.url}`}
                                            href={
                                              source.page == null
                                                ? source.url
                                                : `${source.url}#page=${source.page}`
                                            }
                                            target="_blank"
                                            rel="noreferrer"
                                            className="text-[var(--ds-accent)] hover:underline"
                                          >
                                            {source.title}
                                            {source.page == null
                                              ? ''
                                              : ` · 第 ${source.page} 页`}
                                          </a>
                                        ))}
                                      {assessment.metricEvidence?.flatMap(
                                        (evidence) =>
                                          evidence.reportRefIds.flatMap(
                                            (reportId) => {
                                              const report =
                                                dataset.reportRefs.find(
                                                  (item) => item.id === reportId,
                                                );
                                              if (!report?.sourceUrl) return [];
                                              return [
                                                <a
                                                  key={`${type}-${reportId}`}
                                                  href={`${report.sourceUrl}${evidence.page ? `#page=${evidence.page}` : ''}`}
                                                  target="_blank"
                                                  rel="noreferrer"
                                                  className="text-[var(--ds-accent)] hover:underline"
                                                >
                                                  {report.title}
                                                  {evidence.page
                                                    ? ` · 第 ${evidence.page} 页`
                                                    : ''}
                                                </a>,
                                              ];
                                            },
                                          ),
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </details>
                        )}
                      </div>
                      <div className="mt-5 grid grid-cols-4 divide-x divide-[var(--ds-border-subtle)] border-y border-[var(--ds-border-subtle)] py-3 text-center text-xs">
                        <ScoreCount
                          label="正向"
                          value={combinedScore?.positiveCount ?? 0}
                        />
                        <ScoreCount
                          label="中性"
                          value={combinedScore?.neutralCount ?? 0}
                        />
                        <ScoreCount
                          label="风险"
                          value={combinedScore?.riskCount ?? 0}
                        />
                        <ScoreCount
                          label="证据不足"
                          value={combinedScore?.insufficientCount ?? 0}
                        />
                      </div>
                    </div>
                    <div className="border-l-0 border-[var(--ds-border-subtle)] lg:border-l lg:pl-6">
                      <p className="text-sm font-semibold">评分怎么看</p>
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-3 print-hidden"
                        onClick={() => window.print()}
                      >
                        <Printer className="size-4" />
                        打印报告
                      </Button>
                      <p className="mt-2 text-sm leading-6 text-[var(--ds-text-secondary)]">
                        80分以上表示当前证据中的优势明显，65—79分值得继续研究，50—64分优劣参半，50分以下表示风险证据占优。
                      </p>
                      <p className="mt-3 text-xs leading-5 text-[var(--ds-text-tertiary)]">
                        当前证据覆盖率{' '}
                        {((combinedScore?.coverage ?? 0) * 100).toFixed(0)}% ·{' '}
                        {currentScoreInsight.comparability}
                        。低于{Math.round((combinedScore?.minimumCoverage ?? 0.55) * 100)}%覆盖率时不评级；这不是林奇原著公式，也不是买卖建议。
                      </p>
                    </div>
                  </div>

                  <div className="mt-6 grid gap-3 md:grid-cols-3">
                    <ConclusionList
                      title="当前优势"
                      items={keyStrengths}
                      empty="尚无已验证的明显优势"
                      tone="positive"
                    />
                    <ConclusionList
                      title="主要风险"
                      items={keyRisks}
                      empty="尚无已验证的重大风险"
                      tone="risk"
                    />
                    <ConclusionList
                      title="仍需补证"
                      items={missingEvidence}
                      empty="关键规则已有证据"
                    />
                  </div>
                </section>
              )}
              <details className="border-y border-[var(--ds-border-subtle)] py-3">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium">
                  <span>数据覆盖与处理说明</span>
                  <span
                    className={
                      fullyComplete
                        ? 'text-[var(--ds-success)]'
                        : 'text-[var(--ds-warning)]'
                    }
                  >
                    {fullyComplete ? '完整' : dataset ? '部分数据' : '尚未就绪'}
                  </span>
                </summary>
                {notice?.tone === 'warn' && (
                  <p className="mt-2 text-sm text-[var(--ds-warning)]">
                    {notice.text}
                  </p>
                )}
                {lookup && (
                  <details className="mt-2 text-sm">
                    <summary>官方报告清单与查询提示</summary>
                    {lookup.warnings.map((warning) => (
                      <p key={warning} className="my-2 text-muted-foreground">
                        {warning}
                      </p>
                    ))}
                    {lookup.reports.map((report) => (
                      <p key={report.id} className="my-2">
                        <a
                          className="text-[var(--ds-accent)] hover:underline"
                          href={report.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {report.title} · {report.date}
                        </a>
                      </p>
                    ))}
                  </details>
                )}

                <p className="mt-3 border-t border-[var(--ds-border-subtle)] pt-3 text-xs leading-5 text-[var(--ds-text-tertiary)]">
                  {dataset
                    ? fullyComplete
                      ? `官方定期报告与程序规则已进入标准数据。图表最新可比点为${dataset.latestComparablePoint?.period ?? dataset.latestReportPeriod}；行情未取得时会单独标明。`
                      : `当前为部分数据：${dataset.annual.length}年、${activeMarket === 'HK' ? `${dataset.halfYear?.length ?? 0}个半年期` : `${dataset.quarterly.length}个还原单季度`}；允许查看，不标记为完整正式分析。`
                    : lookup
                      ? '公司和官方报告已确认；财务表格抽取完成前不显示分数。'
                      : '先输入股票代码，程序会确认市场、公司和报告周期。'}
                </p>
              </details>

              <details
                id="sources"
                className="scroll-mt-32 border-y border-[var(--ds-border-subtle)] py-4"
              >
                <summary className="cursor-pointer list-none text-base font-semibold">
                  查看财报原文与数据来源
                  <span className="ml-3 text-xs font-normal text-[var(--ds-text-tertiary)]">
                    按报告期追溯页码、口径和原始链接
                  </span>
                </summary>
                <Card className="mt-4 border border-[var(--ds-border-subtle)] bg-[var(--ds-surface)] ring-0">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base font-semibold">
                      <Database className="size-5 text-[var(--ds-accent)]" />{' '}
                      图表来源追溯
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {!dataset ? (
                      <EmptyLine text="程序完成官方财报抽表并通过校验后，这里会列出每个数据点对应的原始报告。" />
                    ) : (
                      <div className="max-h-[32rem] space-y-2 overflow-auto pr-1">
                        {[
                          ...dataset.annual,
                          ...(dataset.halfYear ?? []),
                          ...dataset.quarterly,
                          ...(dataset.latestComparablePoint
                            ? [dataset.latestComparablePoint]
                            : []),
                        ]
                          .filter(
                            (point, index, points) =>
                              points.findIndex(
                                (candidate) =>
                                  candidate.period === point.period,
                              ) === index,
                          )
                          .map((point) => {
                            const reports = dataset.reportRefs.filter((ref) =>
                              point.reportRefIds.includes(ref.id),
                            );
                            return (
                              <details
                                key={point.period}
                                className="rounded-lg border border-[var(--ds-border-subtle)] bg-[var(--ds-surface-subtle)] px-3 py-2 text-sm"
                              >
                                <summary
                                  aria-label={`查看${tracePeriodLabel(point)}数据来源`}
                                  className="cursor-pointer list-none"
                                >
                                  <div className="flex items-start justify-between gap-3">
                                    <span className="font-mono font-medium">
                                      {tracePeriodLabel(point)}
                                    </span>
                                    <span className="text-right text-xs text-muted-foreground">
                                      {sourcePeriodLabel(point, reports)}
                                    </span>
                                  </div>
                                </summary>
                                <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                                  {Object.entries(point.metricSources ?? {})
                                    .filter(([key]) => traceMetricLabels[key])
                                    .map(([key, source]) => {
                                      const value = point[key];
                                      return (
                                        <div
                                          key={key}
                                          className="rounded-md bg-[var(--ds-surface-elevated)] px-3 py-2"
                                        >
                                          <div className="flex items-baseline justify-between gap-2">
                                            <span className="text-xs text-muted-foreground">
                                              {traceMetricLabels[key]}
                                            </span>
                                            <span className="font-mono text-xs">
                                              {typeof value === 'number'
                                                ? formatMetricValue(
                                                    value,
                                                    key,
                                                    dataset.currency,
                                                    dataset.security
                                                      ?.currency ??
                                                      dataset.currency,
                                                  )
                                                : '缺失'}
                                            </span>
                                          </div>
                                          <p className="mt-1 text-xs leading-4 text-muted-foreground">
                                            {source.page
                                              ? `第${(source.pages ?? [source.page]).join('、')}页 · `
                                              : source.date
                                                ? `${source.date} · `
                                                : ''}
                                            {source.label}
                                            {source.formula
                                              ? ` · ${source.formula}`
                                              : ''}
                                          </p>
                                          {source.sourceUrl && (
                                            <a
                                              href={source.sourceUrl}
                                              target="_blank"
                                              rel="noreferrer"
                                              className="mt-1 inline-flex items-center gap-1 text-xs text-[var(--ds-accent)] hover:underline"
                                            >
                                              {source.sourceName ??
                                                '打开数据来源'}{' '}
                                              <ExternalLink className="size-3" />
                                            </a>
                                          )}
                                        </div>
                                      );
                                    })}
                                </div>
                                {reports.some((report) => report.sourceUrl) && (
                                  <div className="mt-3 flex flex-wrap gap-3">
                                    {reports.map(
                                      (report) =>
                                        report.sourceUrl && (
                                          <a
                                            key={report.id}
                                            href={report.sourceUrl}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="inline-flex items-center gap-1 text-xs text-[var(--ds-accent)] hover:underline"
                                          >
                                            {report.title}{' '}
                                            <ExternalLink className="size-3" />
                                          </a>
                                        ),
                                    )}
                                  </div>
                                )}
                              </details>
                            );
                          })}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </details>

              <details
                open={Boolean(aiError)}
                className="border-y border-[var(--ds-border-subtle)] py-4"
              >
                <summary className="cursor-pointer list-none text-base font-semibold">
                  AI 定性证据与反方审计
                  <span className="ml-3 text-xs font-normal text-[var(--ds-text-tertiary)]">
                    自动运行 · 合格证据自动计分
                  </span>
                </summary>
                <Card className="mt-4 border border-[var(--ds-border-subtle)] bg-[var(--ds-surface)] ring-0">
                  <CardHeader className="flex flex-row items-start justify-between gap-4">
                    <div>
                      <CardTitle className="flex items-center gap-2 text-base font-semibold">
                        <Sparkles className="size-5 text-[var(--ds-accent)]" />{' '}
                        DeepSeek 证据分析
                      </CardTitle>
                      <p className="mt-2 text-xs leading-5 text-muted-foreground">
                        只读取已取得的法定报告原文、页码和可复算财务证据；只有通过来源校验的结论才进入评分。
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      className="print-hidden shrink-0"
                      onClick={() => {
                        aiRequestFingerprint.current = '';
                        void requestAiAnalysis();
                      }}
                      disabled={!dataset || !analysis || aiLoading}
                    >
                      {aiLoading ? (
                        <LoaderCircle className="size-4 animate-spin" />
                      ) : (
                        <Sparkles className="size-4" />
                      )}
                      {aiLoading ? '读取与核验中' : '重新分析'}
                    </Button>
                  </CardHeader>
                  <CardContent>
                    {aiError ? (
                      <output
                        className="rounded-md border border-[var(--ds-warning)]/30 bg-[var(--ds-warning-bg)] p-3 text-sm leading-6 text-[var(--ds-warning)]"
                      >
                        定性证据暂未完成：{aiError}。财务数据和程序规则仍可查看，可点击“重新分析”恢复。
                      </output>
                    ) : !aiReport ? (
                      <EmptyLine
                        text={
                          aiLoading
                            ? '正在读取法定报告原文、核对页码并生成公司类型。'
                            : '定性证据分析尚未开始。'
                        }
                      />
                    ) : (
                      <div className="space-y-4">
                        <div className="grid gap-3 md:grid-cols-3">
                          <AnalysisText
                            label="公司类型"
                            text={`${aiReport.companyTypes.map(companyTypeLabel).join(' + ')} · 置信度 ${(aiReport.classificationConfidence * 100).toFixed(0)}%\n${aiReport.classificationRationale}`}
                          />
                          <AnalysisText
                            label="分析员观点"
                            text={aiReport.analystView}
                          />
                          <AnalysisText
                            label="反方审计"
                            text={aiReport.bearCase}
                          />
                        </div>
                        <div>
                          <p className="text-sm font-medium">
                            定性规则与补充证据
                          </p>
                          <div className="mt-2 grid gap-2 lg:grid-cols-2">
                            {aiReport.ruleSuggestions.map((suggestion) => (
                                <div
                                  key={suggestion.ruleId}
                                  className="rounded-lg border border-[var(--ds-border-subtle)] bg-[var(--ds-surface-subtle)] p-3"
                                >
                                    <div className="flex items-center justify-between gap-2">
                                      <span className="text-xs font-medium">
                                        {RULE_TITLES.get(suggestion.ruleId) ??
                                          suggestion.ruleId}
                                      </span>
                                      <RuleOutcomeBadge
                                        outcome={suggestion.outcome}
                                      />
                                    </div>
                                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                                      {suggestion.rationale}
                                    </p>
                                    {suggestion.sources.length > 0 && (
                                      <div className="mt-2 space-y-2">
                                        {suggestion.sources.map((source) => (
                                          <div key={`${suggestion.ruleId}-${source.url}`}>
                                            <a
                                              href={
                                                source.page == null
                                                  ? source.url
                                                  : `${source.url}#page=${source.page}`
                                              }
                                              target="_blank"
                                              rel="noreferrer"
                                              className="flex items-start gap-1 text-xs leading-4 text-[var(--ds-accent)] hover:underline"
                                            >
                                              <ExternalLink className="mt-0.5 size-3 shrink-0" />
                                              <span>
                                                {source.publishedAt}
                                                {source.page == null
                                                  ? ''
                                                  : ` · 第${source.page}页`}{' '}
                                                · {source.title}
                                              </span>
                                            </a>
                                            {source.quote && (
                                              <p className="mt-1 border-l-2 border-[var(--ds-border-strong)] pl-2 text-xs leading-5 text-[var(--ds-text-tertiary)]">
                                                {source.quote}
                                              </p>
                                            )}
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                    <p className="mt-2 text-xs text-[var(--ds-warning)]">
                                      {suggestion.sources.some(
                                        (source) => source.verified,
                                      )
                                        ? '来源已通过系统校验，自动纳入综合结果'
                                        : '没有通过校验的来源，不进入评分'}
                                    </p>
                                </div>
                              ))}
                          </div>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          DeepSeek 模型 {aiReport.model} ·{' '}
                          {aiReport.generatedAt.slice(0, 19).replace('T', ' ')}
                        </p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </details>

              {analysis && (
                <details
                  id="rules"
                  className="scroll-mt-32 border-y border-[var(--ds-border-subtle)] py-4"
                >
                  <summary className="cursor-pointer list-none text-base font-semibold">
                    查看 Peter Lynch 规则与计算过程
                    <span className="ml-3 text-xs font-normal text-[var(--ds-text-tertiary)]">
                      公式、原文和单条证据
                    </span>
                  </summary>
                  <div className="mt-5">
                    <RuleAnalysisPanel
                      dataset={dataset}
                      analysis={analysis}
                      results={combinedResults}
                    />
                  </div>
                </details>
              )}
            </>
          ) : null}
        </div>
      </TooltipProvider>

      <footer className="border-t border-[var(--ds-border-subtle)] px-5 py-6 text-center text-xs text-[var(--ds-text-tertiary)] lg:px-8">
        本地使用 · 数据点必须可追溯 · 不构成投资建议
      </footer>
    </main>
  );
}

function formatAmount(value: number | undefined, currency: string) {
  return typeof value === 'number'
    ? `${(value / 100_000_000).toLocaleString('zh-CN', { maximumFractionDigits: 2 })}亿 ${currency}`
    : '—';
}

function DebtStructurePanel({ dataset }: { dataset: AnalysisDataset }) {
  const latest = dataset.latestComparablePoint ?? dataset.annual.at(-1);
  if (!latest) return null;
  const residualLiabilities =
    typeof latest.totalLiabilities === 'number' &&
    typeof latest.interestBearingDebt === 'number'
      ? latest.totalLiabilities - latest.interestBearingDebt
      : undefined;
  const rows = [
    ['shortTermBorrowings', '短期借款', latest.shortTermBorrowings],
    [
      'currentPortionNonCurrentLiabilities',
      '一年内到期的非流动负债',
      latest.currentPortionNonCurrentLiabilities,
    ],
    ['longTermBorrowings', '长期借款', latest.longTermBorrowings],
    ['bondsPayable', '应付债券／融资票据', latest.bondsPayable],
    ['currentLeaseLiabilities', '流动租赁负债', latest.currentLeaseLiabilities],
    [
      'nonCurrentLeaseLiabilities',
      '非流动租赁负债',
      latest.nonCurrentLeaseLiabilities,
    ],
    ['unclassifiedBorrowings', '未分类借款', latest.unclassifiedBorrowings],
    [
      'unclassifiedLeaseLiabilities',
      '未分类租赁负债',
      latest.unclassifiedLeaseLiabilities,
    ],
  ] as const;
  const visibleRows = rows.filter(([, , value]) => typeof value === 'number');
  const sharesSource = latest.metricSources?.sharesOutstanding?.label;
  return (
    <section id="debt" className="scroll-mt-32 space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-[var(--ds-accent)]">
            资产负债
          </p>
          <h2 className="mt-1 text-xl font-semibold">负债结构与每股净现金</h2>
        </div>
        <Badge variant="outline" className="rounded-sm font-mono text-xs">
          {dataset.latestReportPeriod ?? latest.period} 期末
        </Badge>
      </div>
      <div className="grid gap-3 xl:grid-cols-[0.9fr_1.1fr]">
        <Card>
          <CardHeader className="border-b border-[var(--ds-border-subtle)] px-4 py-3">
            <CardTitle className="text-sm">融资负债明细</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="bg-[var(--ds-surface-subtle)]">
                  <TableHead className="h-9 text-xs">项目</TableHead>
                  <TableHead className="h-9 text-right text-xs">金额</TableHead>
                  <TableHead className="h-9 text-right text-xs">
                    占总负债
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleRows.map(([key, label, value]) => (
                  <TableRow key={key}>
                    <TableCell className="py-2 text-xs">{label}</TableCell>
                    <TableCell className="py-2 text-right font-mono text-xs">
                      {formatAmount(value, dataset.currency)}
                    </TableCell>
                    <TableCell className="py-2 text-right font-mono text-xs text-[var(--ds-text-tertiary)]">
                      {typeof value === 'number' &&
                      typeof latest.totalLiabilities === 'number' &&
                      latest.totalLiabilities !== 0
                        ? `${((value / latest.totalLiabilities) * 100).toFixed(1)}%`
                        : '—'}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="bg-[var(--ds-surface-selected)] font-medium">
                  <TableCell className="py-2 text-xs">全部有息负债</TableCell>
                  <TableCell className="py-2 text-right font-mono text-xs">
                    {formatAmount(latest.interestBearingDebt, dataset.currency)}
                  </TableCell>
                  <TableCell className="py-2 text-right font-mono text-xs">
                    {typeof latest.interestBearingDebt === 'number' &&
                    typeof latest.totalLiabilities === 'number' &&
                    latest.totalLiabilities !== 0
                      ? `${((latest.interestBearingDebt / latest.totalLiabilities) * 100).toFixed(1)}%`
                      : '—'}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="py-2 text-xs">其他非有息负债</TableCell>
                  <TableCell className="py-2 text-right font-mono text-xs">
                    {formatAmount(residualLiabilities, dataset.currency)}
                  </TableCell>
                  <TableCell className="py-2 text-right font-mono text-xs text-[var(--ds-text-tertiary)]">
                    总负债－全部有息负债
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
            {!visibleRows.length && (
              <p className="border-t border-[var(--ds-border-subtle)] px-4 py-3 text-xs text-[var(--ds-text-tertiary)]">
                原报告未成功拆出融资负债子项，只保留汇总值；不会猜测拆分。
              </p>
            )}
          </CardContent>
        </Card>
        <div className="grid gap-3">
          <FormulaPanel
            title="林奇口径每股净现金"
            formula="[现金 −（长期借款＋应付债券／融资票据＋非流动租赁负债）] ÷ 总股本"
            substitution={`[${formatAmount(latest.cash, dataset.currency)} − ${formatAmount(latest.longTermDebt, dataset.currency)}] ÷ ${typeof latest.sharesOutstanding === 'number' ? `${(latest.sharesOutstanding / 100_000_000).toFixed(3)}亿股` : '股本缺失'}`}
            result={
              typeof latest.lynchNetCashPerShare === 'number'
                ? `${latest.lynchNetCashPerShare.toFixed(3)} ${dataset.currency}/股`
                : '证据不足'
            }
          />
          <FormulaPanel
            title="保守口径每股净现金"
            formula="[现金 −（短期借款＋一年内到期非流动负债＋长期借款＋应付债券／融资票据＋租赁负债，去重）] ÷ 总股本"
            substitution={`[${formatAmount(latest.cash, dataset.currency)} − ${formatAmount(latest.interestBearingDebt, dataset.currency)}] ÷ ${typeof latest.sharesOutstanding === 'number' ? `${(latest.sharesOutstanding / 100_000_000).toFixed(3)}亿股` : '股本缺失'}`}
            result={
              typeof latest.conservativeNetCashPerShare === 'number'
                ? `${latest.conservativeNetCashPerShare.toFixed(3)} ${dataset.currency}/股`
                : '证据不足'
            }
            conservative
          />
          <div className="flex items-start gap-2 rounded-md border border-[var(--ds-border-subtle)] bg-[var(--ds-surface-subtle)] px-3 py-2 text-xs leading-5 text-[var(--ds-text-tertiary)]">
            <CircleHelp className="mt-0.5 size-3.5 shrink-0" />
            <span>
              分母来源：{sharesSource ?? '总股本缺失'}
              。若使用“归母净利润÷基本EPS”推算，页面明确标记为加权平均股本代理值；未扣除受限资金时，保守结果仍是代理值。
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

function FormulaPanel({
  title,
  formula,
  substitution,
  result,
  conservative = false,
}: {
  title: string;
  formula: string;
  substitution: string;
  result: string;
  conservative?: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold">{title}</p>
            <p className="mt-2 text-sm font-medium leading-6 text-[var(--ds-text-primary)]">
              {formula}
            </p>
          </div>
          <Badge
            className={
              conservative
                ? 'rounded-sm bg-[var(--ds-surface-subtle)] text-[var(--ds-text-secondary)] hover:bg-[var(--ds-surface-subtle)]'
                : 'rounded-sm bg-[var(--ds-info-bg)] text-[var(--ds-info)] hover:bg-[var(--ds-info-bg)]'
            }
          >
            {conservative ? '保守代理' : '林奇原文口径'}
          </Badge>
        </div>
        <div className="mt-3 grid gap-2 border-t border-[var(--ds-border-subtle)] pt-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <p className="font-mono text-xs leading-5 text-[var(--ds-text-tertiary)]">
            本期代入：{substitution}
          </p>
          <p className="font-mono text-lg font-semibold tabular-nums text-[var(--ds-text-primary)]">
            {result}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function MetricTile({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note: string;
}) {
  return (
    <div className="min-w-0 bg-[var(--ds-surface)] p-3">
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <span>{label}</span>
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label={`查看${label}口径说明`}
                className="print-hidden text-[var(--ds-text-disabled)] hover:text-[var(--ds-accent)]"
              />
            }
          >
            <CircleHelp className="size-3" />
          </TooltipTrigger>
          <TooltipContent className="max-w-72 leading-5">{note}</TooltipContent>
        </Tooltip>
      </div>
      <p className="mt-1.5 font-mono text-lg font-semibold tabular-nums tracking-tight text-[var(--ds-text-primary)]">
        {value}
      </p>
    </div>
  );
}

function ResearchJudgment({
  label,
  verdict,
  metrics,
}: {
  label: string;
  verdict: string;
  metrics: string;
}) {
  return (
    <div className="min-w-0 border-b border-[var(--ds-border-subtle)] px-0 py-5 last:border-b-0 md:px-5 md:[&:nth-child(odd)]:border-r xl:border-b-0 xl:border-r xl:first:pl-0 xl:last:border-r-0 xl:last:pr-0">
      <p className="text-xs font-medium text-[var(--ds-text-tertiary)]">
        {label}
      </p>
      <p className="mt-2 text-lg font-semibold tracking-tight">{verdict}</p>
      <p className="mt-2 font-mono text-xs leading-5 text-[var(--ds-text-secondary)]">
        {metrics}
      </p>
    </div>
  );
}

function ScoreCount({ label, value }: { label: string; value: number }) {
  return (
    <div className="px-2 py-1">
      <p className="text-lg font-semibold text-[var(--ds-text-primary)]">
        {value}
      </p>
      <p className="mt-0.5 text-[var(--ds-text-tertiary)]">{label}</p>
    </div>
  );
}

function ConclusionList({
  title,
  items,
  empty,
  tone,
}: {
  title: string;
  items: string[];
  empty: string;
  tone?: 'positive' | 'risk';
}) {
  return (
    <div className="rounded-md border border-[var(--ds-border-subtle)] bg-[var(--ds-surface-subtle)] p-4">
      <p
        className={
          tone === 'positive'
            ? 'text-sm font-semibold text-[var(--ds-success)]'
            : tone === 'risk'
              ? 'text-sm font-semibold text-[var(--ds-danger)]'
              : 'text-sm font-semibold text-[var(--ds-text-primary)]'
        }
      >
        {title}
      </p>
      {items.length ? (
        <ul className="mt-2 space-y-1 text-sm leading-6 text-[var(--ds-text-secondary)]">
          {items.map((item) => (
            <li key={item}>· {item}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm leading-6 text-[var(--ds-text-tertiary)]">
          {empty}
        </p>
      )}
    </div>
  );
}

function RuleOutcomeBadge({ outcome }: { outcome: RuleResult['outcome'] }) {
  const label =
    outcome === 1
      ? '+1'
      : outcome === -1
        ? '-1'
        : outcome === 0
          ? '0'
          : outcome === 'not_applicable'
            ? '不适用'
            : '证据不足';
  const style =
    outcome === 1
      ? 'bg-[var(--ds-success-bg)] text-[var(--ds-success)]'
      : outcome === -1
        ? 'bg-[var(--ds-danger-bg)] text-[var(--ds-danger)]'
        : 'bg-[var(--ds-surface-subtle)] text-[var(--ds-text-tertiary)]';
  return <Badge className={style}>{label}</Badge>;
}

function AnalysisText({ label, text }: { label: string; text: string }) {
  return (
    <div className="rounded-md border border-[var(--ds-border-subtle)] bg-[var(--ds-surface-subtle)] p-3">
      <p className="text-xs font-medium text-[var(--ds-accent)]">{label}</p>
      <p className="mt-2 whitespace-pre-line text-sm leading-6">{text}</p>
    </div>
  );
}

function formatSeriesTableValue(
  value: unknown,
  key: string,
  chartId: string,
  financialCurrency?: string,
  priceCurrency?: string,
) {
  if (typeof value === 'string') return value;
  if (typeof value !== 'number' || !Number.isFinite(value))
    return <MissingMetric />;
  if (key === 'adjustedPrice')
    return `${value.toFixed(2)} ${priceCurrency ?? ''}`.trim();
  if (key === 'eps')
    return `${value.toFixed(3)} ${financialCurrency ?? ''}`.trim();
  if (
    [
      'growth',
      'inventoryGrowth',
      'revenueGrowth',
      'earningsGrowth',
      'revenueYoY',
      'revenueSequential',
      'netProfitYoY',
      'netProfitSequential',
      'epsYoY',
      'epsSequential',
    ].includes(key)
  )
    return `${value.toFixed(2)}%`;
  if (['pe', 'lynchValuationRatio'].includes(key))
    return `${value.toFixed(2)}×`;
  if (['growth', 'growth-history', 'cash-debt', 'fcf'].includes(chartId))
    return `${(value / 100_000_000).toLocaleString('zh-CN', {
      maximumFractionDigits: 2,
    })}亿`;
  return value.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
}

function MissingMetric() {
  return (
    <details className="missing-metric text-xs font-sans font-normal text-muted-foreground">
      <summary aria-label="查看空值说明">—</summary>
      <p className="max-w-48 whitespace-normal py-2 text-left leading-5">
        当前期间缺少可用数值或比较基期。H2
        EPS不以全年减H1还原；详细口径与出处见本模块说明。
      </p>
    </details>
  );
}

function LatestReportComparison({
  dataset,
  analysis,
}: {
  dataset: AnalysisDataset;
  analysis: ProgramAnalysis | null;
}) {
  const points = reportGrowthPoints(dataset);
  const current =
    points.find(
      (point) => point.period === analysis?.snapshot.latestReportPeriod,
    ) ?? dataset.annual.at(-1);
  if (!current) return null;
  const annual = !/[QH]/.test(current.period);
  const pool = annual ? dataset.annual : points;
  const prior = pool.find(
    (point) =>
      point.period ===
      (annual
        ? String(Number(current.period) - 1)
        : priorPeriod(current.period)),
  );
  const previous = points.find((point) =>
    isAdjacentPeriod(current.period, point.period),
  );
  const metrics = [
    {
      key: 'revenue',
      label: '营业收入',
      yoy: analysis?.snapshot.latestRevenueGrowthYoYPercent,
      sequential: analysis?.snapshot.latestRevenueGrowthSequentialPercent,
    },
    {
      key: 'netProfit',
      label: '净利润',
      yoy: analysis?.snapshot.latestNetProfitGrowthYoYPercent,
      sequential: analysis?.snapshot.latestNetProfitGrowthSequentialPercent,
    },
    {
      key: 'eps',
      label: '每股收益 EPS',
      yoy: analysis?.snapshot.latestEpsGrowthYoYPercent,
      sequential: analysis?.snapshot.latestEpsGrowthSequentialPercent,
    },
  ];
  const displayAmount = (point: MetricPoint | undefined, key: string) => {
    const value = point?.[key];
    return typeof value === 'number' && Number.isFinite(value) ? (
      key === 'eps' ? (
        value.toFixed(3)
      ) : (
        (value / 100_000_000).toLocaleString('zh-CN', {
          maximumFractionDigits: 2,
        })
      )
    ) : (
      <MissingMetric />
    );
  };
  const displayGrowth = (
    value: number | null | undefined,
    currentValue: unknown,
    before: unknown,
  ) =>
    typeof value === 'number' ? (
      `${value.toFixed(2)}%`
    ) : typeof currentValue === 'number' && typeof before === 'number' ? (
      typeof growthDisplay(currentValue, before) === 'string' ? (
        growthDisplay(currentValue, before)
      ) : (
        <MissingMetric />
      )
    ) : (
      <MissingMetric />
    );
  return (
    <section
      id="latest-comparison"
      className="research-panel comparison-panel scroll-mt-32 overflow-hidden"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b px-5 py-4">
        <div>
          <p className="ds-eyebrow">最新报告期</p>
          <h2 className="mt-1 text-xl font-semibold">
            {current.period} · 经营表现
          </h2>
        </div>
        <span className="rounded-md bg-[var(--ds-surface-selected)] px-3 py-1.5 text-xs text-[var(--ds-primary)]">
          同比 / 环比 · 仅展示，不计分
        </span>
      </div>
      <p className="px-5 py-3 text-xs text-muted-foreground">
        金额：亿{dataset.currency} · EPS：{dataset.currency}/股 ·
        可横向滚动查看比较期
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="sticky left-0 z-10 min-w-36 bg-[var(--ds-surface)]">
              指标
            </TableHead>
            <TableHead className="text-right">本期 {current.period}</TableHead>
            <TableHead className="text-right">
              上年同期 {prior?.period ?? '未取得'}
            </TableHead>
            <TableHead className="text-right">同比</TableHead>
            {!annual && (
              <TableHead className="text-right">
                上一期 {previous?.period ?? '未取得'}
                {previous?.period.endsWith('H2') ? '（还原）' : ''}
              </TableHead>
            )}
            {!annual && <TableHead className="text-right">环比</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {metrics.map(({ key, label, yoy, sequential }) => (
            <TableRow key={key}>
              <TableCell className="sticky left-0 z-10 bg-[var(--ds-surface)] font-medium">
                {label}
              </TableCell>
              <TableCell className="comparison-current text-right font-mono font-semibold">
                {displayAmount(current, key)}
              </TableCell>
              <TableCell className="text-right font-mono">
                {displayAmount(prior, key)}
              </TableCell>
              <TableCell className="text-right font-mono">
                {displayGrowth(yoy, current[key], prior?.[key])}
              </TableCell>
              {!annual && (
                <TableCell className="text-right font-mono">
                  {displayAmount(previous, key)}
                </TableCell>
              )}
              {!annual && (
                <TableCell className="text-right font-mono">
                  {displayGrowth(sequential, current[key], previous?.[key])}
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <details className="border-t px-5 py-2 text-xs text-muted-foreground">
        <summary>比较口径与空值说明</summary>
        <p className="pb-3 leading-6">
          同比比较上年同一期，环比比较紧邻上一期。H2流量由全年减H1还原；EPS不做相减还原，没有可靠H2
          EPS时环比为“—”。涉及负数只显示方向状态。数值未取得或没有可比期间时保持空白。
          <a href="#sources" className="ml-2 text-[var(--ds-accent)] underline">
            查看原始依据
          </a>
        </p>
      </details>
    </section>
  );
}

function GrowthHistory({
  data,
  series,
  points,
  currency,
}: {
  data: MetricPoint[];
  series: { key: string; label: string; color: string }[];
  points: MetricPoint[];
  currency?: string;
}) {
  const historyByPeriod = new Map(points.map((point) => [point.period, point]));
  const historySeries = [
    { key: 'revenue', label: '营业收入', color: 'var(--ds-accent)' },
    series.find((item) => item.key === 'revenueYoY')!,
    { key: 'netProfit', label: '净利润', color: 'var(--ds-success)' },
    series.find((item) => item.key === 'netProfitYoY')!,
    { key: 'eps', label: '每股收益', color: 'var(--ds-info)' },
    series.find((item) => item.key === 'epsYoY')!,
  ];
  const groups = [
    {
      label: '年度同比',
      points: data.filter((point) => point.period.startsWith('年度')),
    },
    ...['Q1', 'Q2', 'Q3', 'Q4', 'H1', 'H2'].map((period) => ({
      label: `${period} · 各年度同期比较`,
      points: data.filter(
        (point) =>
          point.period.startsWith('报告期') && point.period.endsWith(period),
      ),
    })),
  ].filter((group) => group.points.length);
  return (
    <div className="space-y-6">
      {groups.map(({ label, points }) => (
        <section key={label}>
          <h3 className="mb-3 text-sm font-semibold">{label}</h3>
          <FinancialSeriesTable
            data={points.map((point) => ({
              ...historyByPeriod.get(
                point.period.replace(/^(年度|报告期)/, ''),
              ),
              ...point,
            }))}
            series={historySeries}
            chartId="growth-history"
            financialCurrency={currency}
          />
        </section>
      ))}
      <p className="text-xs text-muted-foreground">
        金额：亿{currency} · EPS：{currency}/股 · 增长率：% ·
        最新期环比见上方“最新报告” · H2为全年减H1的流量还原，EPS不做相减。
      </p>
    </div>
  );
}

function FinancialSeriesTable({
  data,
  series,
  chartId,
  financialCurrency,
  priceCurrency,
}: {
  data: MetricPoint[];
  series: { key: string; label: string; color: string }[];
  chartId: string;
  financialCurrency?: string;
  priceCurrency?: string;
}) {
  return (
    <div className="overflow-x-auto rounded-md border border-[var(--ds-border-subtle)]">
      <p className="px-4 py-2 text-xs text-muted-foreground">
        {chartId === 'growth-rates' || chartId === 'inventory-sales'
          ? '增长率：%'
          : chartId === 'price-eps'
            ? `股价：${priceCurrency}/股 · EPS：${financialCurrency}/股 · PE：倍`
          : chartId === 'valuation'
            ? 'PE及比值：倍 · 增长率：%'
            : `金额：亿${financialCurrency ?? '财报币种'} · 每股指标：${financialCurrency ?? '财报币种'}/股`}{' '}
        · 横向滚动查看历史
      </p>
      <Table>
        <TableHeader>
          <TableRow className="bg-[var(--ds-surface-subtle)] hover:bg-[var(--ds-surface-subtle)]">
            <TableHead className="sticky left-0 z-10 min-w-36 bg-[var(--ds-surface-subtle)]">
              指标
            </TableHead>
            {data.map((point) => (
              <TableHead
                key={point.period}
                className="min-w-28 text-right font-mono text-xs"
              >
                {point.period.replace(/^(年度|报告期)/, '')}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {series.map((item) => (
            <TableRow key={item.key}>
              <TableCell className="sticky left-0 z-10 bg-[var(--ds-surface)] font-medium">
                <span className="inline-flex items-center gap-2">
                  <span
                    className="size-2 rounded-full"
                    style={{ backgroundColor: item.color }}
                  />
                  {item.label}
                </span>
              </TableCell>
              {data.map((point) => (
                <TableCell
                  key={`${item.key}-${point.period}`}
                  className={`text-right font-mono text-xs tabular-nums ${point === data.at(-1) ? 'bg-[var(--ds-surface-selected)]' : ''}`}
                >
                  {formatSeriesTableValue(
                    point[item.key],
                    item.key,
                    chartId,
                    financialCurrency,
                    priceCurrency,
                  )}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function FundamentalChart({
  definition,
  data,
  financialCurrency,
  priceCurrency,
  priceAdjustment,
  historyPoints,
}: {
  definition: {
    id: string;
    title: string;
    description: string;
    kind: 'line' | 'bar';
    defaultView?: 'chart' | 'table';
    tableOnly?: boolean;
    auditLabel: string;
    originalBasis: string;
    series: { key: string; label: string; color: string }[];
  };
  data: MetricPoint[];
  financialCurrency?: string;
  priceCurrency?: string;
  priceAdjustment?: AnalysisDataset['priceAdjustment'];
  historyPoints?: MetricPoint[];
}) {
  const [view, setView] = useState<'chart' | 'table'>(
    definition.defaultView ?? 'chart',
  );
  const resolvedSeries = definition.series.map((series) =>
    series.key === 'adjustedPrice'
      ? {
          ...series,
          label:
            definition.id === 'price-eps'
              ? '6/12月末未复权股价'
              : priceAdjustment === 'forward'
                ? '年末前复权股价'
                : '年末未复权股价',
        }
      : series,
  );
  const availableSeries = resolvedSeries.filter((series) =>
    data.some((point) => typeof point[series.key] === 'number'),
  );
  const usable =
    availableSeries.length > 0 ||
    ((definition.tableOnly === true || view === 'table') && data.length > 0);
  const config = Object.fromEntries(
    availableSeries.map((series) => [
      series.key,
      { label: series.label, color: series.color },
    ]),
  ) as ChartConfig;
  const amountChart = ['growth', 'cash-debt', 'fcf'].includes(definition.id);
  const dualAxis = ['growth', 'price-eps', 'valuation'].includes(definition.id);
  const priceEpsChart = definition.id === 'price-eps';
  const priceEpsBases = Object.fromEntries(
    resolvedSeries.map((series) => [
      series.key,
      data.find((point) => typeof point[series.key] === 'number')?.[series.key],
    ]),
  );
  const priceEpsTrendData = data.map((point) => ({
    ...point,
    ...Object.fromEntries(
      resolvedSeries.flatMap((series) => {
        const value = point[series.key];
        const base = priceEpsBases[series.key];
        return typeof value === 'number' && typeof base === 'number' && base !== 0
          ? [[series.key, (value / base) * 100]]
          : [];
      }),
    ),
  }));
  const missingSeries = resolvedSeries.filter(
    (series) => !data.some((point) => typeof point[series.key] === 'number'),
  );
  const derivedKeys = new Set([
    'inventoryGrowth',
    'revenueGrowth',
    'growth',
    'pe',
    'earningsGrowth',
    'lynchValuationRatio',
    'revenueYoY',
    'revenueSequential',
    'netProfitYoY',
    'netProfitSequential',
    'epsYoY',
    'epsSequential',
  ]);
  const expectedValues = data.length * resolvedSeries.length;
  const plottedValues = data.flatMap((point) =>
    resolvedSeries
      .filter((series) => typeof point[series.key] === 'number')
      .map((series) => ({ point, key: series.key })),
  );
  const verifiedValues = plottedValues.filter(
    ({ point, key }) =>
      point.reportRefIds.length > 0 &&
      (Boolean(point.metricSources?.[key]) || derivedKeys.has(key)),
  ).length;

  return (
    <Card
      id={`chart-${definition.id}`}
      className={`scroll-mt-32 min-w-0 overflow-hidden shadow-none ${definition.tableOnly ? 'xl:col-span-2' : ''}`}
    >
      <CardHeader className="ds-panel-heading flex flex-col items-start justify-between gap-3 sm:flex-row sm:gap-4">
        <div className="min-w-0">
          <CardTitle className="text-base font-semibold tracking-tight">
            {definition.title}
          </CardTitle>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">
            {definition.description}
          </p>
        </div>
        <div className="print-hidden flex shrink-0 flex-wrap items-center justify-end gap-2">
          {usable && definition.id !== 'growth-rates' && (
            <Badge
              variant="outline"
              className="rounded-sm border-[var(--ds-success)]/30 bg-[var(--ds-success-bg)] text-[var(--ds-success)]"
            >
              {priceEpsChart ? `有数据 ${plottedValues.length}/${expectedValues} 项` : `已核验 ${verifiedValues}/${expectedValues} 点`}
            </Badge>
          )}
          {definition.tableOnly ? (
            <Badge
              variant="outline"
              className="shrink-0 bg-[var(--ds-surface-subtle)] text-[var(--ds-text-secondary)]"
            >
              表格呈现
            </Badge>
          ) : (
            <div className="print-hidden flex shrink-0 rounded-md border border-[var(--ds-border-subtle)] bg-[var(--ds-surface-subtle)] p-0.5">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-pressed={view === 'chart'}
                className={`h-7 rounded-sm gap-1 px-2 text-xs ${view === 'chart' ? 'bg-[var(--ds-surface-selected)] text-[var(--ds-text-primary)] shadow-none hover:bg-[var(--ds-surface-selected)]' : 'text-[var(--ds-text-tertiary)]'}`}
                onClick={() => setView('chart')}
              >
                <ChartNoAxesCombined className="size-3.5" /> 图
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-pressed={view === 'table'}
                className={`h-7 rounded-sm gap-1 px-2 text-xs ${view === 'table' ? 'bg-[var(--ds-surface-selected)] text-[var(--ds-text-primary)] shadow-none hover:bg-[var(--ds-surface-selected)]' : 'text-[var(--ds-text-tertiary)]'}`}
                onClick={() => setView('table')}
              >
                <Table2 className="size-3.5" /> 表
              </Button>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {priceEpsChart && usable && (
          <p className="mb-2 text-xs text-muted-foreground">
            6月末与12月末股价取明确标注来源的未复权收盘价。EPS统一为截至该观察点的近12个月：6月末用“当期H1＋上年全年－上年H1”还原，12月末用全年EPS。表格保留原值。
          </p>
        )}
        {priceEpsChart && (
          <p className="mb-4 text-xs text-[var(--ds-text-tertiary)]">
            {resolvedSeries.map((series) => `${series.label}：${data.filter((point) => typeof point[series.key] === 'number').length}个有效点`).join(' · ')}。
            只有一个有效点时显示圆点；缺失期间不连线，留空不代表零。
          </p>
        )}
        {usable && !definition.tableOnly && missingSeries.length > 0 && (
          <p className="mb-2 text-xs text-[var(--ds-warning)]">
            缺少{missingSeries.map((series) => series.label).join('、')}
            ，本图未绘制该数据。
          </p>
        )}
        {!usable ? (
          <div className="grid h-[250px] place-items-center rounded-lg border border-dashed border-[var(--ds-border-strong)] bg-[var(--ds-surface-subtle)] px-6 text-center">
            <div>
              <LineChartIcon className="mx-auto size-7 text-[var(--ds-text-disabled)]" />
              <p className="mt-3 text-sm font-medium">等待可追溯数据</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                没有可靠数据时不画示例线。
              </p>
            </div>
          </div>
        ) : definition.id === 'growth-rates' ? (
          <GrowthHistory
            data={data}
            series={resolvedSeries}
            points={historyPoints ?? []}
            currency={financialCurrency}
          />
        ) : view === 'table' ? (
          <FinancialSeriesTable
            data={data}
            series={resolvedSeries}
            chartId={definition.id}
            financialCurrency={financialCurrency}
            priceCurrency={priceCurrency}
          />
        ) : priceEpsChart ? (
          <div className="space-y-5">
            <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs">
              <span className="text-[var(--ds-accent)]">蓝线：股价</span>
              <span className="text-[var(--ds-success)]">绿线：EPS</span>
              <span className="text-[var(--ds-warning)]">橙线：PE-TTM</span>
              <span className="text-muted-foreground">各序列首个有效点＝100；比较变化方向与幅度，不比较绝对高低</span>
            </div>
            <ChartContainer config={config} className="h-[320px] w-full aspect-auto">
              <LineChart data={priceEpsTrendData} margin={{ left: 0, right: 8, top: 12, bottom: 0 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="period" tickLine={false} axisLine={false} minTickGap={22} />
                <YAxis width={58} tickLine={false} axisLine={false} tickFormatter={(value) => `${Number(value).toFixed(0)}`} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Line type="monotone" dataKey="adjustedPrice" stroke="var(--ds-accent)" strokeWidth={2.5} dot={{ r: 3 }} connectNulls={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="eps" stroke="var(--ds-success)" strokeWidth={2.5} dot={{ r: 3 }} connectNulls={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="pe" stroke="var(--ds-warning)" strokeWidth={2.5} dot={{ r: 3 }} connectNulls={false} isAnimationActive={false} />
              </LineChart>
            </ChartContainer>
            <FinancialSeriesTable data={data} series={resolvedSeries} chartId={definition.id} financialCurrency={financialCurrency} priceCurrency={priceCurrency} />
            <p className="text-xs leading-5 text-muted-foreground">折线向上或向下表示相对各自起点的增长或下降。股价涨幅快于EPS时，PE通常扩张；EPS涨幅快于股价时，PE通常收缩。表格保留真实原值。</p>
          </div>
        ) : (
          <ChartContainer
            config={config}
            className="h-[270px] w-full aspect-auto"
          >
            {definition.kind === 'bar' ? (
              <BarChart
                data={data}
                margin={{ left: 0, right: 8, top: 8, bottom: 0 }}
              >
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="period"
                  tickLine={false}
                  axisLine={false}
                  minTickGap={22}
                />
                <YAxis
                  width={58}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={amountChart ? formatAmountAxis : undefined}
                />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Legend content={<ChartLegendContent />} />
                {availableSeries.map((series) => (
                  <Bar
                    key={series.key}
                    dataKey={series.key}
                    fill={`var(--color-${series.key})`}
                    radius={[3, 3, 0, 0]}
                  />
                ))}
              </BarChart>
            ) : (
              <LineChart
                data={data}
                margin={{ left: 0, right: 8, top: 8, bottom: 0 }}
              >
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="period"
                  tickLine={false}
                  axisLine={false}
                  interval={priceEpsChart ? 0 : undefined}
                  minTickGap={priceEpsChart ? 0 : 22}
                  tickFormatter={(value) =>
                    priceEpsChart && String(value).startsWith('最新行情')
                      ? '最新'
                      : String(value)
                  }
                />
                <YAxis
                  yAxisId={dualAxis ? 'amount' : undefined}
                  width={58}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={amountChart ? formatAmountAxis : undefined}
                />
                {dualAxis && (
                  <YAxis
                    yAxisId="secondary"
                    orientation="right"
                    width={42}
                    tickLine={false}
                    axisLine={false}
                  />
                )}
                <ChartTooltip content={<ChartTooltipContent />} />
                <Legend content={<ChartLegendContent />} />
                {availableSeries.map((series) => (
                  <Line
                    key={series.key}
                    type="monotone"
                    dataKey={series.key}
                    yAxisId={
                      dualAxis
                        ? series.key === 'eps' ||
                          series.key === 'lynchValuationRatio'
                          ? 'secondary'
                          : 'amount'
                        : undefined
                    }
                    stroke={`var(--color-${series.key})`}
                    strokeWidth={2}
                    dot={{ r: 2 }}
                    connectNulls={false}
                  />
                ))}
              </LineChart>
            )}
          </ChartContainer>
        )}
        <details className="mt-4 border-t border-[var(--ds-border-subtle)] pt-3">
          <summary className="text-xs text-muted-foreground">
            口径与数据覆盖
          </summary>
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant="outline"
              className="rounded-sm bg-[var(--ds-surface-subtle)] text-[var(--ds-text-secondary)]"
            >
              原文核对：{definition.auditLabel}
            </Badge>
            {definition.id !== 'growth-rates' &&
              expectedValues > 0 &&
              verifiedValues < expectedValues && (
                <span className="text-xs text-[var(--ds-warning)]">
                  仍有 {expectedValues - verifiedValues}{' '}
                  个应展示点未形成可核验值（数据缺失或计算边界）
                </span>
              )}
          </div>
          <p className="mt-2 text-xs leading-5 text-[var(--ds-text-tertiary)]">
            {definition.originalBasis}
          </p>
        </details>
      </CardContent>
    </Card>
  );
}

function EmptyLine({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-dashed border-[var(--ds-border-strong)] bg-[var(--ds-surface-subtle)] p-4 text-sm text-[var(--ds-text-tertiary)]">
      <ShieldCheck className="mt-0.5 size-4 shrink-0" />
      {text}
    </div>
  );
}
