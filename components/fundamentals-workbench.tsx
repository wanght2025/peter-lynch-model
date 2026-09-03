'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  Database,
  ExternalLink,
  FileSearch,
  LineChart as LineChartIcon,
  ChartNoAxesCombined,
  LoaderCircle,
  Printer,
  Search,
  ShieldCheck,
  Sparkles,
  Table2,
  CircleHelp,
  Layers3,
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
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover';
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
  calculateCagr,
  calculateScore,
  evaluateProgramRules,
} from '@/lib/scoring-engine';
import type { AiAnalysisReport } from '@/lib/ai-analysis';
import type { FundamentalsResponse } from '@/lib/fundamentals';
import {
  normalizeSecurityCode,
  type OfficialLookup,
} from '@/lib/official-filings';
import type {
  AnalysisDataset,
  MetricPoint,
  ProgramAnalysis,
  RuleResult,
  ScoreSummary,
  CompanyType,
  ReportReference,
} from '@/lib/analysis-types';

type Notice = { tone: 'good' | 'warn' | 'bad'; text: string } | null;

const DATASET_STORAGE_KEY = 'lynch-official-analysis-dataset-v8';
const ANALYSIS_STORAGE_KEY = 'lynch-program-analysis-v3';
const LOOKUP_CACHE_KEY = 'lynch-official-lookup-cache-v2';

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

function companyTypeLabel(type: CompanyType) {
  return (
    COMPANY_TYPE_OPTIONS.find((item) => item.value === type)?.label ?? '待分类'
  );
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
  if (!summary?.score && summary?.score !== 0)
    return {
      grade: '待评分',
      verdict: '还没有足够的可验证规则。',
      comparability: '不可比较',
    };
  const coverage = summary.coverage ?? 0;
  const score = summary.score;
  const grade =
    score >= 80
      ? '优秀'
      : score >= 65
        ? '良好'
        : score >= 50
          ? '一般'
          : score >= 35
            ? '偏弱'
            : '高风险';
  const verdict =
    score >= 80
      ? '基本面、估值与风险项整体匹配，进入优先研究区。'
      : score >= 65
        ? '优势多于风险，具备继续研究价值。'
        : score >= 50
          ? '优势与风险接近，暂未形成明显胜率。'
          : score >= 35
            ? '风险多于正向证据，需要更高安全边际。'
            : '关键风险明显，不宜仅凭低估值买入。';
  return {
    grade: coverage < 0.6 ? `${grade}（证据偏少）` : grade,
    verdict,
    comparability:
      coverage >= 0.75
        ? '可横向比较'
        : coverage >= 0.6
          ? '谨慎比较'
          : '仅作初筛',
  };
}

const chartDefinitions = [
  {
    id: 'price-eps',
    title: '年末/最新股价与年度EPS',
    description:
      '历史点为各年最后交易日股价与年度EPS；最右点为最新市价与最新法定报告期TTM EPS。',
    auditLabel: '原文方向＋行情口径',
    originalBasis:
      '原文要求比较股价走势线与收益线是否相符；价格复权口径在图内单独标明。',
    source: 'annual' as const,
    kind: 'line' as const,
    series: [
      {
        key: 'adjustedPrice',
        label: '年末股价',
        color: 'var(--ds-accent)',
      },
      { key: 'eps', label: '年度每股收益', color: 'var(--ds-success)' },
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
    title: '存货增长率与销售增长率',
    description:
      '优先用最近12个季度；对有重大存货的非金融公司，存货增长快于销售增长时标为风险证据。',
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
    title: '3年、5年与10年每股收益增长率',
    description:
      '对应第13章表13-1的复利关系；5年用于评分，缺少边界年度时不计算。',
    auditLabel: '符合原文方向',
    originalBasis:
      '原文强调真正影响股价的是收益增长率；这里统一使用EPS复合增长率。',
    source: 'growthRates' as const,
    kind: 'bar' as const,
    series: [
      { key: 'growth', label: 'EPS复合增长率', color: 'var(--ds-accent)' },
    ],
  },
  {
    id: 'valuation',
    title: '市盈率、5年收益增长率与模型辅助比值',
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
        label: '5年收益增长率',
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
  return points.map((point, index) => {
    const prior = points[index - 4];
    const growth = (current?: number, before?: number) =>
      typeof current === 'number' && typeof before === 'number' && before !== 0
        ? ((current - before) / Math.abs(before)) * 100
        : undefined;
    return {
      period: point.period,
      reportRefIds: point.reportRefIds,
      inventoryGrowth: growth(point.inventory, prior?.inventory),
      revenueGrowth: growth(point.revenue, prior?.revenue),
    };
  });
}

function epsGrowthRateSeries(points: MetricPoint[]) {
  const annual = [...points]
    .filter((point) => typeof point.eps === 'number')
    .sort((a, b) => a.period.localeCompare(b.period));
  const end = annual.at(-1);
  const endYear = Number(end?.period.slice(0, 4));
  if (!end || !Number.isFinite(endYear)) return [];
  return [3, 5, 10].map((years) => {
    const start = annual.find(
      (point) => Number(point.period.slice(0, 4)) === endYear - years,
    );
    const growth =
      start && typeof start.eps === 'number' && typeof end.eps === 'number'
        ? calculateCagr(start.eps, end.eps, years)
        : null;
    return {
      period: `${years}年`,
      growth: growth ?? undefined,
      reportRefIds: start
        ? [...new Set([...start.reportRefIds, ...end.reportRefIds])]
        : end.reportRefIds,
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
    const start = points[index - 5];
    const earningsGrowth =
      start && typeof start.eps === 'number' && typeof point.eps === 'number'
        ? calculateCagr(start.eps, point.eps, 5)
        : null;
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
  const latestYear = Number(latest.period.slice(0, 4));
  const start = dataset.annual.find(
    (point) => Number(point.period.slice(0, 4)) === latestYear - 5,
  );
  const earningsGrowth =
    start && typeof start.eps === 'number' && typeof latest.eps === 'number'
      ? calculateCagr(start.eps, latest.eps, 5)
      : null;
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

export function FundamentalsWorkbench() {
  const [stockCode, setStockCode] = useState('');
  const [lookup, setLookup] = useState<OfficialLookup | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [loadingStage, setLoadingStage] = useState<
    'idle' | 'locating' | 'extracting'
  >('idle');
  const [dataset, setDataset] = useState<AnalysisDataset | null>(null);
  const [extraction, setExtraction] = useState<
    FundamentalsResponse['extraction'] | null
  >(null);
  const [analysis, setAnalysis] = useState<ProgramAnalysis | null>(null);
  const [aiReport, setAiReport] = useState<AiAnalysisReport | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [confirmedAiRules, setConfirmedAiRules] = useState<Set<string>>(
    new Set(),
  );
  const [confirmedCompanyTypes, setConfirmedCompanyTypes] = useState<
    Exclude<CompanyType, 'unclassified'>[]
  >([]);
  const [notice, setNotice] = useState<Notice>(null);

  useEffect(() => {
    const saved = window.localStorage.getItem(DATASET_STORAGE_KEY);
    if (saved) {
      try {
        const next = normalizeDataset(JSON.parse(saved));
        const savedAnalysis = window.localStorage.getItem(ANALYSIS_STORAGE_KEY);
        const nextAnalysis = savedAnalysis
          ? (JSON.parse(savedAnalysis) as ProgramAnalysis)
          : null;
        queueMicrotask(() => {
          setDataset(next);
          setStockCode(next.companyCode);
          if (nextAnalysis?.results && nextAnalysis?.snapshot) {
            setAnalysis(nextAnalysis);
          }
        });
      } catch {
        window.localStorage.removeItem(DATASET_STORAGE_KEY);
        window.localStorage.removeItem(ANALYSIS_STORAGE_KEY);
      }
    }
  }, []);

  const chartData = useMemo(() => {
    if (!dataset) return new Map<string, MetricPoint[]>();
    return new Map(
      chartDefinitions.map((definition) => [
        definition.id,
        definition.source === 'quarterlyGrowth'
          ? growthSeries(dataset.quarterly)
          : definition.source === 'growthRates'
            ? epsGrowthRateSeries(dataset.annual)
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
    const changingSecurity = Boolean(
      dataset && dataset.companyCode !== normalized.code,
    );
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
    setConfirmedAiRules(new Set());
    if (changingSecurity) setConfirmedCompanyTypes([]);
    setLookupLoading(true);
    setLoadingStage('locating');
    setNotice({
      tone: 'warn',
      text: '正在确认公司和官方报告，通常只需几秒。',
    });
    let locatedLookup: OfficialLookup | null = null;
    try {
      const lookupResponse = await fetch(
        `/api/official-reports?code=${normalized.code}`,
        { cache: 'no-store' },
      );
      locatedLookup = await readApiResponse<OfficialLookup>(
        lookupResponse,
        '官方披露查询失败',
      );
      setLookup(locatedLookup);
      cacheLookup(locatedLookup);
      setLoadingStage('extracting');
      setNotice({
        tone: 'good',
        text: `已确认${locatedLookup.company.companyName}，正在从官方定期报告读取并核验数据。`,
      });

      const fundamentalsResponse = await fetch(
        `/api/fundamentals?code=${normalized.code}`,
        { cache: 'no-store' },
      );
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
    }
  }

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
  const combinedScore = useMemo(() => {
    if (!analysis) return null;
    const primaryCompanyType = confirmedCompanyTypes[0] ?? 'unclassified';
    const programResults = evaluateProgramRules({
      ...analysis.snapshot,
      companyType: primaryCompanyType,
      companyTypes: confirmedCompanyTypes,
    });
    const aiResults: RuleResult[] = (aiReport?.ruleSuggestions ?? []).map(
      (suggestion) => ({
        ruleId: suggestion.ruleId,
        outcome: suggestion.outcome,
        evaluator: 'ai',
        evidence: [],
        userConfirmed: confirmedAiRules.has(suggestion.ruleId),
        note: suggestion.rationale,
      }),
    );
    return calculateScore([...programResults, ...aiResults], {
      includeConfirmedAi: true,
    });
  }, [analysis, aiReport, confirmedAiRules, confirmedCompanyTypes]);
  const effectiveProgramResults = useMemo(
    () =>
      analysis
        ? evaluateProgramRules({
            ...analysis.snapshot,
            companyType: confirmedCompanyTypes[0] ?? 'unclassified',
            companyTypes: confirmedCompanyTypes,
          })
        : [],
    [analysis, confirmedCompanyTypes],
  );
  const collectedDataCount = dataset ? countCollectedDataPoints(dataset) : 0;
  const currentScoreInsight = scoreInsight(combinedScore);

  async function requestAiAnalysis() {
    if (!dataset || !analysis) return;
    setAiLoading(true);
    setNotice(null);
    try {
      const response = await fetch('/api/ai-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dataset: {
            ...dataset,
            companyType: confirmedCompanyTypes[0] ?? 'unclassified',
            companyTypes: confirmedCompanyTypes,
          },
          analysis,
        }),
      });
      const body = (await response.json()) as AiAnalysisReport & {
        error?: string;
      };
      if (!response.ok) throw new Error(body.error || '补充研判失败');
      setAiReport(body);
      setConfirmedAiRules(new Set());
      setConfirmedCompanyTypes([]);
    } catch (error) {
      setNotice({
        tone: 'warn',
        text: error instanceof Error ? error.message : '补充研判失败',
      });
    } finally {
      setAiLoading(false);
    }
  }

  return (
    <main className="finance-shell min-h-screen overflow-x-hidden bg-[var(--ds-canvas)] text-[var(--ds-text-primary)]">
      <header className="sticky top-0 z-40 border-b border-[var(--ds-border-subtle)] bg-[var(--ds-app-chrome)] text-[var(--ds-text-primary)]">
        <div className="mx-auto flex h-12 max-w-[1600px] items-center justify-between gap-4 px-4 lg:px-6">
          <div className="flex items-center gap-3">
            <span className="grid size-7 place-items-center rounded-[5px] bg-[var(--ds-primary)] font-mono text-[10px] font-bold tracking-tight text-white">
              LY
            </span>
            <div className="leading-none">
              <p className="text-[13px] font-semibold tracking-[0.02em]">
                林奇基本面研究
              </p>
              <p className="mt-1 text-[10px] text-[var(--ds-text-tertiary)]">
                官方财报 · 估值 · 财务质量
              </p>
            </div>
          </div>
          <nav className="print-hidden hidden h-full items-center text-[11px] font-semibold tracking-wide md:flex">
            <a
              className="flex h-full items-center border-b-2 border-[var(--ds-accent)] px-3"
              href="#overview"
            >
              概览
            </a>
            <Link
              className="flex h-full items-center border-b-2 border-transparent px-3 text-[var(--ds-text-secondary)] hover:text-[var(--ds-text-primary)]"
              href="/rules"
            >
              规则参考
            </Link>
            <a
              className="flex h-full items-center border-b-2 border-transparent px-3 text-[var(--ds-text-secondary)] hover:text-[var(--ds-text-primary)]"
              href="#financials"
            >
              财务
            </a>
            <a
              className="flex h-full items-center border-b-2 border-transparent px-3 text-[var(--ds-text-secondary)] hover:text-[var(--ds-text-primary)]"
              href="#debt"
            >
              负债
            </a>
            <a
              className="flex h-full items-center border-b-2 border-transparent px-3 text-[var(--ds-text-secondary)] hover:text-[var(--ds-text-primary)]"
              href="#sources"
            >
              来源
            </a>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="ml-2 h-8 rounded-sm text-[var(--ds-text-secondary)] hover:bg-[var(--ds-surface-selected)] hover:text-[var(--ds-text-primary)]"
              onClick={() => window.print()}
              disabled={!dataset}
            >
              <Printer className="size-4" /> 导出报告
            </Button>
          </nav>
        </div>
      </header>

      <div className="research-tape" aria-label="研究工作流状态">
        <div className="mx-auto flex min-w-max max-w-[1600px] items-center px-4 lg:px-6">
          <TapeItem label="评分标准" value="100 分制" />
          <TapeItem label="主要数据" value="官方定期报告" tone="evidence" />
          <TapeItem label="判断方式" value="程序计算 + 人工确认" />
          <TapeItem
            label="状态"
            value={
              fullyComplete
                ? '可以分析'
                : dataset
                  ? '部分数据'
                  : lookup
                    ? '报告已确认'
                    : '等待输入代码'
            }
            tone={fullyComplete ? 'good' : 'muted'}
          />
        </div>
      </div>

      <section
        id="overview"
        className="border-b border-[var(--ds-border-subtle)] bg-[var(--ds-surface)]"
      >
        <div className="mx-auto flex min-h-14 max-w-[1600px] flex-col justify-between gap-3 px-4 py-2.5 sm:flex-row sm:items-center lg:px-6">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-base font-semibold tracking-[0.01em]">
                {activeName ?? '研究一家公司，从股票代码开始'}
              </h1>
              {activeName && (
                <Badge
                  variant="outline"
                  className="rounded-sm border-[var(--ds-border-strong)] bg-[var(--ds-surface-subtle)] font-mono text-[10px] text-[var(--ds-text-secondary)]"
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
            <p className="mt-1 text-[11px] text-[var(--ds-text-tertiary)]">
              官方定期报告 · 十年年度数据 · 最新法定报告形成滚动值 ·
              关键数字可追溯
            </p>
          </div>
          {dataset && (
            <CompanyTypePicker
              selected={confirmedCompanyTypes}
              suggestions={aiReport?.companyTypes ?? []}
              onChange={setConfirmedCompanyTypes}
            />
          )}
        </div>
      </section>

      <TooltipProvider>
        <div className="mx-auto max-w-[1600px] space-y-4 px-4 py-4 lg:px-6">
          {notice && (
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

          <section
            className={`grid gap-3 ${dataset ? '' : 'xl:grid-cols-[minmax(0,1.65fr)_minmax(280px,0.7fr)]'}`}
          >
            <div
              className="terminal-panel"
              data-channel="program"
              data-ready={dataset ? 'true' : undefined}
              aria-labelledby="instrument-lookup-title"
            >
              <div className="flex h-full flex-col p-4 sm:p-5">
                <div className="lookup-form-grid grid gap-4 lg:grid-cols-[minmax(220px,0.7fr)_minmax(320px,1.3fr)] lg:items-end">
                  <div className="lookup-intro">
                    <p className="terminal-label flex items-center gap-2 text-[var(--ds-accent)]">
                      <Search className="size-3.5" /> 公司研究
                    </p>
                    <h2
                      id="instrument-lookup-title"
                      className="mt-2 text-xl font-semibold tracking-tight sm:text-2xl"
                    >
                      研究一家公司，从股票代码开始
                    </h2>
                    <p className="mt-2 max-w-xl text-sm leading-6 text-[var(--ds-text-tertiary)]">
                      输入 6 位 A 股或 5
                      位港股代码。我们会先核对公司身份和报告范围，再整理估值、增长、负债与现金流。无需了解彼得·林奇的术语。
                    </p>
                  </div>
                  <div className="space-y-2">
                    <label
                      htmlFor="stock-code"
                      className="block text-xs font-semibold text-[var(--ds-text-secondary)]"
                    >
                      股票代码
                    </label>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Input
                        id="stock-code"
                        value={stockCode}
                        onChange={(event) => {
                          const next = event.target.value
                            .replace(/\D/g, '')
                            .slice(0, 6);
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
                            window.localStorage.removeItem(
                              ANALYSIS_STORAGE_KEY,
                            );
                          }
                          setNotice(null);
                        }}
                        onKeyDown={(event) =>
                          event.key === 'Enter' && lookupStock()
                        }
                        placeholder="例如：600519"
                        inputMode="numeric"
                        aria-label="股票代码"
                        aria-describedby="stock-code-help"
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
                    <div
                      id="stock-code-help"
                      className="lookup-examples flex flex-wrap items-center gap-2 text-xs text-[var(--ds-text-tertiary)]"
                    >
                      <span>没有代码？试试</span>
                      <button
                        type="button"
                        onClick={() => lookupStock('600519')}
                        disabled={lookupLoading}
                        className="rounded border border-[var(--ds-border-subtle)] bg-[var(--ds-surface-subtle)] px-2 py-1 font-medium text-[var(--ds-text-secondary)] hover:border-[var(--ds-accent)] hover:text-[var(--ds-accent)]"
                      >
                        贵州茅台 600519
                      </button>
                      <button
                        type="button"
                        onClick={() => lookupStock('00700')}
                        disabled={lookupLoading}
                        className="rounded border border-[var(--ds-border-subtle)] bg-[var(--ds-surface-subtle)] px-2 py-1 font-medium text-[var(--ds-text-secondary)] hover:border-[var(--ds-accent)] hover:text-[var(--ds-accent)]"
                      >
                        腾讯控股 00700
                      </button>
                    </div>
                    {lookupLoading && (
                      <div
                        className="h-1 overflow-hidden rounded-full bg-[var(--ds-surface-selected)]"
                        aria-hidden="true"
                      >
                        <div
                          className={`h-full bg-[var(--ds-accent)] transition-[width] duration-300 ${loadingStage === 'locating' ? 'w-1/3' : 'w-2/3'}`}
                        />
                      </div>
                    )}
                  </div>
                </div>
                {lookup && !dataset && (
                  <div className="mt-5 border-t border-[var(--ds-border-subtle)] pt-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="font-medium">
                          {lookup.company.companyName}（{lookup.company.code}）
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {lookup.company.market === 'HK' ? '港股' : 'A股'} ·{' '}
                          {lookup.company.exchange} · 交易币种{' '}
                          {lookup.company.currency} · 官方来源已确认 · 查询时间{' '}
                          {lookup.source.retrievedAt.slice(0, 10)}
                        </p>
                        {lookup.company.ahPairCode && (
                          <p className="mt-1 text-xs text-[var(--ds-warning)]">
                            A/H 同一发行人 · 另一市场代码{' '}
                            {lookup.company.ahPairCode}
                            （财务数据可复用，股价与估值分开）
                          </p>
                        )}
                      </div>
                      <a
                        href={lookup.source.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-sm text-[var(--ds-accent)] hover:text-[var(--ds-accent-hover)] hover:underline"
                      >
                        打开{lookup.source.name}{' '}
                        <ExternalLink className="size-3.5" />
                      </a>
                    </div>
                    <div className="mt-3 rounded-md border border-[var(--ds-border-subtle)] bg-[var(--ds-surface-subtle)] px-4 py-3">
                      <p className="text-sm font-medium">
                        官方定期报告来源已确认
                      </p>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        具体报告类型与清单放在下方折叠区，需要追溯时再查看。
                      </p>
                    </div>
                    <p className="mt-3 text-xs leading-5 text-muted-foreground">
                      {lookup.reportingPolicy.note}
                    </p>
                    {lookup.warnings.length > 0 && (
                      <details className="mt-3 rounded-md border border-[var(--ds-warning)]/40 bg-[var(--ds-warning-bg)] px-3 py-2 text-xs text-[var(--ds-warning)]">
                        <summary className="cursor-pointer font-medium">
                          {lookup.warnings.length}条查询口径提示
                        </summary>
                        <div className="mt-2 space-y-1 leading-5">
                          {lookup.warnings.map((warning) => (
                            <p key={warning}>• {warning}</p>
                          ))}
                        </div>
                      </details>
                    )}
                    {extraction && (
                      <div className="mt-3 rounded-lg border border-[var(--ds-success)]/40 bg-[var(--ds-success-bg)] px-3 py-2 text-xs leading-5 text-[var(--ds-success)]">
                        <p className="font-medium">
                          已统计{' '}
                          {dataset
                            ? collectedDataCount
                            : extraction.audit.financialValuesChecked +
                              extraction.audit.priceValuesChecked}{' '}
                          个可核验数据点
                        </p>
                        {extraction.warnings.length > 0 && (
                          <details className="mt-2 text-[var(--ds-success)]">
                            <summary className="cursor-pointer font-medium">
                              查看{extraction.warnings.length}条数据质量提示
                            </summary>
                            <div className="mt-1 space-y-1">
                              {extraction.warnings.map((warning) => (
                                <p key={warning}>• {warning}</p>
                              ))}
                            </div>
                          </details>
                        )}
                      </div>
                    )}
                    <details className="mt-3 rounded-lg border border-[var(--ds-border-subtle)] bg-[var(--ds-surface-subtle)] px-3 py-2">
                      <summary className="cursor-pointer text-sm font-medium text-[var(--ds-text-primary)]">
                        查看官方报告清单
                      </summary>
                      <div className="mt-3 max-h-72 space-y-2 overflow-auto pr-1">
                        {lookup.reports.map((report) => (
                          <a
                            key={report.id}
                            href={report.url}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-start justify-between gap-3 rounded-lg bg-[var(--ds-surface-elevated)] px-3 py-2 text-sm hover:ring-1 hover:ring-[var(--ds-accent)]"
                          >
                            <span className="line-clamp-2">
                              <span className="mr-2 text-[10px] text-[var(--ds-accent)]">
                                {report.reportKind === 'annual'
                                  ? '年报'
                                  : report.reportKind === 'half_year'
                                    ? '中报'
                                    : '季报'}
                              </span>
                              {report.title}
                            </span>
                            <span className="shrink-0 font-mono text-xs text-muted-foreground">
                              {report.date}
                            </span>
                          </a>
                        ))}
                      </div>
                    </details>
                  </div>
                )}
                {!lookup && !dataset && (
                  <div className="mt-auto grid grid-cols-2 border-t border-[var(--ds-border-subtle)] pt-5 sm:grid-cols-4">
                    {[
                      ['01', '确认公司', '市场与证券代码'],
                      ['02', '读取报告', '财务原表'],
                      ['03', '核对口径', '报告期与来源'],
                      ['04', '形成结果', '指标与依据'],
                    ].map(([code, title, note]) => (
                      <div
                        key={code}
                        className="border-l border-[var(--ds-border-subtle)] px-3 first:border-l-0 first:pl-0"
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[9px] text-[var(--ds-accent)]">
                            {code}
                          </span>
                          <span className="text-[11px] font-semibold text-[var(--ds-text-secondary)]">
                            {title}
                          </span>
                        </div>
                        <p className="mt-1 font-mono text-[9px] text-[var(--ds-text-disabled)]">
                          {note}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {!dataset && (
              <aside className="terminal-panel" data-channel="evidence">
                <div className="p-4 sm:p-5">
                  <p className="terminal-label flex items-center gap-2 text-[var(--ds-success)]">
                    <CircleHelp className="size-3.5" /> 结果说明
                  </p>
                  <h2 className="mt-2 text-base font-semibold">
                    研究结果怎么看
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-[var(--ds-text-tertiary)]">
                    彼得·林奇方法关注增长、估值、负债和现金流。这里先展示结论，再提供报告、页码和计算过程。
                  </p>
                  <div className="mt-4 divide-y divide-[var(--ds-border-subtle)] border-y border-[var(--ds-border-subtle)]">
                    <ResearchGateRow
                      code="01"
                      title="公司与报告"
                      note="确认研究对象和数据范围"
                    />
                    <ResearchGateRow
                      code="02"
                      title="先看四项"
                      note="估值、增长、负债、现金流"
                    />
                    <ResearchGateRow
                      code="03"
                      title="查看依据"
                      note="回到公式、页码与原始报告"
                    />
                  </div>
                  <div className="mt-4 flex items-center justify-between gap-3 text-xs">
                    <span className="text-[var(--ds-text-tertiary)]">
                      公司类型
                    </span>
                    <span className="text-right font-semibold text-[var(--ds-success)]">
                      {confirmedCompanyTypes.length > 0
                        ? confirmedCompanyTypes
                            .map(companyTypeLabel)
                            .join(' + ')
                        : '数据出来后再选择'}
                    </span>
                  </div>
                </div>
              </aside>
            )}
          </section>

          <section className="ds-kpi-strip grid grid-cols-1">
            <StatusCard
              label="已统计有效数据"
              value={`${collectedDataCount} 个`}
              note={
                dataset
                  ? '财务与行情数字均经过报告期、格式和来源检查；详细分类仅在追溯区查看。'
                  : lookup
                    ? '正在读取并核验数据，完成后显示总数。'
                    : '输入股票代码后显示可用数据总数。'
              }
            />
          </section>

          <details className="rounded-lg border border-[var(--ds-border-subtle)] bg-[var(--ds-surface)] px-4 py-3">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium">
              <span>数据处理状态与口径</span>
              <Badge
                className={
                  fullyComplete
                    ? 'rounded-sm bg-[var(--ds-success-bg)] text-[var(--ds-success)] hover:bg-[var(--ds-success-bg)]'
                    : 'rounded-sm bg-[var(--ds-warning-bg)] text-[var(--ds-warning)] hover:bg-[var(--ds-warning-bg)]'
                }
              >
                {fullyComplete
                  ? '数据已就绪'
                  : dataset
                    ? '数据不完整'
                    : '尚未就绪'}
              </Badge>
            </summary>
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

          {dataset && (
            <section className="space-y-3">
              <div>
                <p className="ds-eyebrow">公司概览</p>
                <h2 className="mt-1 text-[17px] font-semibold tracking-tight">
                  市场快照与核心指标
                </h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  最新价格截至 {dataset.currentMarket?.date ?? '未取得'}
                  ；基本面截至{' '}
                  {dataset.latestReportPeriod ?? dataset.annual.at(-1)?.period}
                  ，滚动值与完整年度值分开标注。
                </p>
              </div>
              <div className="ds-kpi-strip grid sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
                <MetricTile
                  label="最新价格"
                  value={
                    dataset.currentMarket
                      ? `${dataset.currentMarket.price.toFixed(2)} ${dataset.currentMarket.currency}`
                      : '缺失'
                  }
                  note={dataset.currentMarket?.date ?? '未取得行情'}
                />
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
                  label="5年EPS CAGR"
                  value={
                    typeof analysis?.snapshot.earningsCagr5yPercent === 'number'
                      ? `${analysis.snapshot.earningsCagr5yPercent.toFixed(2)}%`
                      : '缺少边界年度'
                  }
                  note="只使用完整年度"
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
                <MetricTile
                  label="最新报告期"
                  value={dataset.latestReportPeriod ?? '未知'}
                  note={
                    dataset.latestComparablePoint?.period ?? '未生成最新可比值'
                  }
                />
              </div>
            </section>
          )}

          {analysis && (
            <section className="grid gap-4 xl:grid-cols-[0.72fr_1.28fr]">
              <Card className="finance-score-card border-l-4 border-l-[var(--ds-accent)]">
                <CardHeader className="ds-panel-heading">
                  <CardTitle className="text-sm font-semibold">
                    综合评分
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-4">
                  <div className="flex flex-wrap items-end justify-between gap-3">
                    <div className="flex items-end gap-3">
                      <span className="text-4xl font-semibold tracking-tight text-[var(--ds-text-primary)]">
                        {!activeFinancial && combinedScore?.score != null
                          ? Math.round(combinedScore.score)
                          : '—'}
                      </span>
                      <span className="pb-1 text-xs text-[var(--ds-text-tertiary)]">
                        / 100
                      </span>
                    </div>
                    <Badge className="rounded-sm bg-[var(--ds-info-bg)] text-[var(--ds-accent)] hover:bg-[var(--ds-info-bg)]">
                      {activeFinancial ? '不评级' : currentScoreInsight.grade}
                    </Badge>
                  </div>
                  <p className="mt-3 text-sm font-medium leading-6 text-[var(--ds-text-primary)]">
                    {activeFinancial
                      ? '金融企业不套用普通公司排名，只展示单条证据。'
                      : currentScoreInsight.verdict}
                  </p>
                  {combinedScore?.score != null && (
                    <div className="mt-4">
                      <div className="relative h-2 overflow-hidden rounded-full bg-[var(--ds-border-subtle)]">
                        <div
                          className="h-full rounded-full bg-[var(--ds-accent)]"
                          style={{
                            width: `${Math.max(0, Math.min(100, combinedScore.score))}%`,
                          }}
                        />
                      </div>
                      <div className="mt-1 flex justify-between text-[10px] text-[var(--ds-text-tertiary)]">
                        <span>0 高风险</span>
                        <span>50 一般</span>
                        <span>65 良好</span>
                        <span>80 优秀</span>
                        <span>100</span>
                      </div>
                    </div>
                  )}
                  <p className="mt-3 rounded-md bg-[var(--ds-surface-subtle)] px-3 py-2 text-xs leading-5 text-[var(--ds-text-secondary)]">
                    证据覆盖率{' '}
                    {((combinedScore?.coverage ?? 0) * 100).toFixed(0)}% ·{' '}
                    {currentScoreInsight.comparability}
                    {confirmedCompanyTypes.length === 0
                      ? ' · 尚未确认公司类型，类型专属规则暂未启用'
                      : ''}
                  </p>
                  <div className="mt-4 grid grid-cols-4 divide-x divide-[var(--ds-border-subtle)] border-t border-[var(--ds-border-subtle)] pt-3 text-center text-xs">
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
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="ds-panel-heading">
                  <CardTitle className="text-sm font-semibold">
                    怎么和其他股票比较
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm leading-6 text-muted-foreground">
                    所有股票使用同一套100分尺度：80分以上进入优选研究区，65—79分值得继续研究，50—64分表现一般，50分以下风险证据占优。
                  </p>
                  <p className="mt-2 text-xs leading-5 text-[var(--ds-text-tertiary)]">
                    这是同一规则库与同一公式下的横向初筛；公司类型与证据充足度会改变有效规则数，不冒充实时全市场百分位排名。
                  </p>
                  <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <CoverageCount
                      label="正向"
                      value={combinedScore?.positiveCount ?? 0}
                    />
                    <CoverageCount
                      label="中性"
                      value={combinedScore?.neutralCount ?? 0}
                    />
                    <CoverageCount
                      label="风险"
                      value={combinedScore?.riskCount ?? 0}
                    />
                    <CoverageCount
                      label="证据不足"
                      value={combinedScore?.insufficientCount ?? 0}
                    />
                  </div>
                  <p className="mt-4 rounded-md bg-[var(--ds-warning-bg)] px-3 py-2 text-xs leading-5 text-[var(--ds-warning)]">
                    横向比较必须同时看证据覆盖率。覆盖率低于60%的分数只作初筛；当前缺失的回购、内部人士等事件可在“补充研判”中检索最近一年证据，再由你确认。
                  </p>
                </CardContent>
              </Card>
            </section>
          )}

          {dataset && <DebtStructurePanel dataset={dataset} />}

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
                      趋势关系默认用图，跨单位或需要精确核对的数据默认用表；每个模块都可切换。
                    </p>
                  </div>
                  {activeFinancial && (
                    <Badge className="w-fit bg-[var(--ds-warning-bg)] text-[var(--ds-warning)] hover:bg-[var(--ds-warning-bg)]">
                      金融企业：只查看，不参加排名
                    </Badge>
                  )}
                </div>
                <div className="mt-4 grid gap-4 xl:grid-cols-2">
                  {chartDefinitions.map((definition) => (
                    <FundamentalChart
                      key={definition.id}
                      definition={definition}
                      data={chartData.get(definition.id) ?? []}
                      financialCurrency={dataset?.currency}
                      priceCurrency={dataset?.security?.currency}
                      priceAdjustment={dataset.priceAdjustment}
                    />
                  ))}
                </div>
              </section>

              <section id="sources" className="scroll-mt-32">
                <Card className="border border-[var(--ds-border-subtle)] bg-[var(--ds-surface)] ring-0">
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
                                          <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
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
                                              className="mt-1 inline-flex items-center gap-1 text-[10px] text-[var(--ds-accent)] hover:underline"
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
              </section>

              <section>
                <Card className="border border-[var(--ds-border-subtle)] bg-[var(--ds-surface)] ring-0">
                  <CardHeader className="flex flex-row items-start justify-between gap-4">
                    <div>
                      <CardTitle className="flex items-center gap-2 text-base font-semibold">
                        <Sparkles className="size-5 text-[var(--ds-accent)]" />{' '}
                        补充研判（可选）
                      </CardTitle>
                      <p className="mt-2 text-xs leading-5 text-muted-foreground">
                        先用财报证据；不足时补查最近365天公告与新闻。每条来源可打开核验，未经你确认的判断不会进入综合结果。
                      </p>
                    </div>
                    <Button
                      type="button"
                      className="print-hidden shrink-0 bg-[var(--ds-accent)] text-[var(--ds-app-chrome)] hover:bg-[var(--ds-accent-hover)]"
                      onClick={requestAiAnalysis}
                      disabled={!dataset || !analysis || aiLoading}
                    >
                      {aiLoading ? (
                        <LoaderCircle className="size-4 animate-spin" />
                      ) : (
                        <Sparkles className="size-4" />
                      )}
                      {aiLoading ? '检索与整理中' : '补查近一年证据'}
                    </Button>
                  </CardHeader>
                  <CardContent>
                    {!aiReport ? (
                      <EmptyLine text="需要补充回购、内部人士等定性证据时，可检索最近365天公告与新闻；程序评分可独立使用。" />
                    ) : (
                      <div className="space-y-4">
                        <div className="grid gap-3 md:grid-cols-3">
                          <AnalysisText
                            label="公司类型建议"
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
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="print-hidden rounded-md text-xs"
                          onClick={() =>
                            setConfirmedCompanyTypes(
                              aiReport.companyTypes.filter(
                                (
                                  type,
                                ): type is Exclude<
                                  CompanyType,
                                  'unclassified'
                                > => type !== 'unclassified',
                              ),
                            )
                          }
                        >
                          采用并确认建议的公司类型
                        </Button>
                        <div>
                          <p className="text-sm font-medium">14条定性判断</p>
                          <div className="mt-2 grid gap-2 lg:grid-cols-2">
                            {aiReport.ruleSuggestions.map((suggestion) => {
                              const confirmed = confirmedAiRules.has(
                                suggestion.ruleId,
                              );
                              return (
                                <label
                                  key={suggestion.ruleId}
                                  aria-label={`确认定性判断${suggestion.ruleId}`}
                                  className="flex cursor-pointer gap-3 rounded-lg border border-[var(--ds-border-subtle)] bg-[var(--ds-surface-subtle)] p-3"
                                >
                                  <input
                                    type="checkbox"
                                    className="print-hidden mt-1"
                                    checked={confirmed}
                                    onChange={(event) => {
                                      const next = new Set(confirmedAiRules);
                                      if (event.target.checked)
                                        next.add(suggestion.ruleId);
                                      else next.delete(suggestion.ruleId);
                                      setConfirmedAiRules(next);
                                    }}
                                  />
                                  <div className="min-w-0">
                                    <div className="flex items-center justify-between gap-2">
                                      <span className="font-mono text-[11px]">
                                        {suggestion.ruleId}
                                      </span>
                                      <RuleOutcomeBadge
                                        outcome={suggestion.outcome}
                                      />
                                    </div>
                                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                                      {suggestion.rationale}
                                    </p>
                                    {(suggestion.sources?.length ?? 0) > 0 && (
                                      <div className="mt-2 space-y-1">
                                        {suggestion.sources.map((source) => (
                                          <a
                                            key={`${suggestion.ruleId}-${source.url}`}
                                            href={source.url}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="flex items-start gap-1 text-[10px] leading-4 text-[var(--ds-accent)] hover:underline"
                                          >
                                            <ExternalLink className="mt-0.5 size-3 shrink-0" />
                                            <span>
                                              {source.publishedAt} ·{' '}
                                              {source.title}
                                            </span>
                                          </a>
                                        ))}
                                      </div>
                                    )}
                                    <p className="mt-1 text-[10px] text-[var(--ds-warning)]">
                                      {confirmed
                                        ? '已由用户确认纳入'
                                        : '未确认，不进入总分'}
                                    </p>
                                  </div>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                        <p className="text-[11px] text-muted-foreground">
                          模型 {aiReport.model} ·{' '}
                          {aiReport.generatedAt.slice(0, 19).replace('T', ' ')}
                        </p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </section>

              <section className="rounded-sm border border-[var(--ds-warning)]/40 bg-[var(--ds-warning-bg)] p-4">
                <div className="flex gap-3">
                  <AlertTriangle className="mt-0.5 size-5 shrink-0 text-[var(--ds-warning)]" />
                  <div>
                    <p className="font-medium text-[var(--ds-warning)]">
                      图表不是评分本身
                    </p>
                    <p className="mt-1 text-sm leading-6 text-[var(--ds-text-secondary)]">
                      图表帮助理解趋势；总分只使用可验证规则。定性判断需要你确认，未确认前不进入综合评分。
                    </p>
                  </div>
                </div>
              </section>

              {analysis && (
                <section id="rules" className="scroll-mt-32 space-y-3">
                  <div>
                    <p className="ds-eyebrow">报告末尾 · 评分依据</p>
                    <h2 className="mt-1 text-[17px] font-semibold tracking-tight">
                      单条规则与证据
                    </h2>
                    <p className="mt-2 text-sm text-muted-foreground">
                      这里是参考与复核区，不打断前面的结论、数据和图表阅读。
                    </p>
                  </div>
                  <RuleAnalysisPanel
                    dataset={dataset}
                    analysis={analysis}
                    results={effectiveProgramResults}
                  />
                </section>
              )}
            </>
          ) : (
            <ResearchModuleMap state={lookup ? 'located' : 'waiting'} />
          )}
        </div>
      </TooltipProvider>

      <footer className="border-t border-[var(--ds-border-subtle)] px-5 py-6 text-center text-xs text-[var(--ds-text-tertiary)] lg:px-8">
        本地使用 · 数据点必须可追溯 · 不构成投资建议
      </footer>
    </main>
  );
}

function TapeItem({
  label,
  value,
  tone = 'muted',
}: {
  label: string;
  value: string;
  tone?: 'muted' | 'evidence' | 'good';
}) {
  const valueClass =
    tone === 'evidence'
      ? 'text-[var(--ds-evidence)]'
      : tone === 'good'
        ? 'text-[var(--ds-success)]'
        : 'text-[var(--ds-text-secondary)]';

  return (
    <div className="flex h-8 items-center gap-2 border-r border-[var(--ds-border-subtle)] px-3 first:pl-0 sm:px-4">
      <span className="font-mono text-[9px] tracking-[0.14em] text-[var(--ds-text-disabled)]">
        {label}
      </span>
      <span className={`font-mono text-[10px] font-semibold ${valueClass}`}>
        {value}
      </span>
    </div>
  );
}

function ResearchGateRow({
  code,
  title,
  note,
}: {
  code: string;
  title: string;
  note: string;
}) {
  return (
    <div className="grid grid-cols-[24px_88px_1fr] items-center gap-2 py-2.5 text-xs">
      <span className="font-mono text-[10px] text-[var(--ds-evidence)]">
        {code}
      </span>
      <span className="font-semibold text-[var(--ds-text-primary)]">
        {title}
      </span>
      <span className="text-right text-[11px] text-[var(--ds-text-tertiary)]">
        {note}
      </span>
    </div>
  );
}

function ResearchModuleMap({ state }: { state: 'waiting' | 'located' }) {
  const modules = [
    ['01', '估值与价格', 'PE / PB / Lynch PEG'],
    ['02', '盈利能力', '收入 / EPS / 利润率'],
    ['03', '资产负债', '净现金 / 债务结构'],
    ['04', '现金与资本', '现金流 / 股息 / 回购'],
    ['05', '规则证据', '原文 / 公式 / 本次代入'],
    ['06', '来源追溯', '报告 / 页码 / 数据点'],
  ] as const;

  return (
    <section className="terminal-panel" aria-labelledby="module-map-title">
      <div className="flex flex-col justify-between gap-3 border-b border-[var(--ds-border-subtle)] px-4 py-3 sm:flex-row sm:items-end">
        <div>
          <p className="terminal-label">研究内容</p>
          <h2 id="module-map-title" className="mt-1 text-base font-semibold">
            {state === 'located'
              ? '报告已定位，等待数据校验'
              : '查询后将形成六个研究模块'}
          </h2>
        </div>
        <p className="max-w-xl text-xs leading-5 text-[var(--ds-text-tertiary)] sm:text-right">
          没有可靠数据的项目会明确标为“缺失”，不会用示例线或默认分数冒充结果。
        </p>
      </div>
      <div className="module-map grid sm:grid-cols-2 xl:grid-cols-3">
        {modules.map(([code, title, note]) => (
          <div
            key={code}
            className="grid min-h-16 grid-cols-[28px_1fr_auto] items-center gap-3 border-b border-r border-[var(--ds-border-subtle)] px-4 py-3"
          >
            <span className="font-mono text-[10px] text-[var(--ds-text-disabled)]">
              {code}
            </span>
            <div>
              <p className="text-xs font-semibold text-[var(--ds-text-secondary)]">
                {title}
              </p>
              <p className="mt-1 font-mono text-[9px] text-[var(--ds-text-disabled)]">
                {note}
              </p>
            </div>
            <span className="text-[10px] text-[var(--ds-text-disabled)]">
              待数据
            </span>
          </div>
        ))}
      </div>
    </section>
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
            DEBT & NET CASH
          </p>
          <h2 className="mt-1 text-xl font-semibold">负债结构与每股净现金</h2>
        </div>
        <Badge variant="outline" className="rounded-sm font-mono text-[10px]">
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
          <div className="flex items-start gap-2 rounded-md border border-[var(--ds-border-subtle)] bg-[var(--ds-surface-subtle)] px-3 py-2 text-[11px] leading-5 text-[var(--ds-text-tertiary)]">
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
          <p className="font-mono text-[11px] leading-5 text-[var(--ds-text-tertiary)]">
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

function CompanyTypePicker({
  selected,
  suggestions,
  onChange,
}: {
  selected: Exclude<CompanyType, 'unclassified'>[];
  suggestions: CompanyType[];
  onChange: (types: Exclude<CompanyType, 'unclassified'>[]) => void;
}) {
  const suggested = suggestions.filter(
    (type): type is Exclude<CompanyType, 'unclassified'> =>
      type !== 'unclassified',
  );
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            className="h-9 min-w-56 justify-between rounded-md border-[var(--ds-border-strong)] bg-[var(--ds-surface-elevated)] px-3 text-xs"
          />
        }
      >
        <span className="flex min-w-0 items-center gap-2">
          <Layers3 className="size-4 text-[var(--ds-accent)]" />
          <span className="truncate">
            {selected.length
              ? selected.map(companyTypeLabel).join(' + ')
              : '公司类型：待确认'}
          </span>
        </span>
        <span className="text-[var(--ds-text-tertiary)]">⌄</span>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-80 rounded-md border-[var(--ds-border-subtle)] bg-[var(--ds-surface-elevated)] p-3"
      >
        <PopoverHeader>
          <PopoverTitle>林奇公司类型（可多选）</PopoverTitle>
          <PopoverDescription>
            同一公司可同时具有多种特征；类型专属规则按已确认类型的并集匹配。
          </PopoverDescription>
        </PopoverHeader>
        <div className="mt-1 space-y-1">
          {COMPANY_TYPE_OPTIONS.map((option) => {
            const checked = selected.includes(option.value);
            const aiSuggested = suggested.includes(option.value);
            return (
              <label
                key={option.value}
                aria-label={`选择公司类型：${option.label}`}
                className="flex cursor-pointer gap-2 rounded-md px-2 py-2 hover:bg-[var(--ds-surface-selected)]"
              >
                <input
                  type="checkbox"
                  className="mt-0.5 accent-[var(--ds-accent)]"
                  checked={checked}
                  onChange={(event) =>
                    onChange(
                      event.target.checked
                        ? [...selected, option.value]
                        : selected.filter((type) => type !== option.value),
                    )
                  }
                />
                <span className="min-w-0">
                  <span className="flex items-center gap-2 text-xs font-medium">
                    {option.label}
                    {aiSuggested && (
                      <span className="rounded-sm bg-[var(--ds-info-bg)] px-1.5 py-0.5 text-[9px] text-[var(--ds-info)]">
                        补充建议
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block text-[10px] leading-4 text-[var(--ds-text-tertiary)]">
                    {option.description}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
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
      <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
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

function CoverageCount({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-[var(--ds-border-subtle)] bg-[var(--ds-surface-subtle)] px-3 py-3 text-center">
      <p className="text-xl font-semibold text-[var(--ds-text-primary)]">
        {value}
      </p>
      <p className="mt-1 text-[11px] text-muted-foreground">{label}</p>
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
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  if (key === 'adjustedPrice')
    return `${value.toFixed(2)} ${priceCurrency ?? ''}`.trim();
  if (key === 'eps')
    return `${value.toFixed(3)} ${financialCurrency ?? ''}`.trim();
  if (
    ['growth', 'inventoryGrowth', 'revenueGrowth', 'earningsGrowth'].includes(
      key,
    )
  )
    return `${value.toFixed(2)}%`;
  if (['pe', 'lynchValuationRatio'].includes(key))
    return `${value.toFixed(2)}×`;
  if (['growth', 'cash-debt', 'fcf'].includes(chartId))
    return `${(value / 100_000_000).toLocaleString('zh-CN', {
      maximumFractionDigits: 2,
    })}亿`;
  return value.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
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
      <Table>
        <TableHeader>
          <TableRow className="bg-[var(--ds-surface-subtle)] hover:bg-[var(--ds-surface-subtle)]">
            <TableHead className="sticky left-0 z-10 min-w-36 bg-[var(--ds-surface-subtle)]">
              指标
            </TableHead>
            {data.map((point) => (
              <TableHead
                key={point.period}
                className="min-w-28 text-right font-mono text-[11px]"
              >
                {point.period}
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
                  className="text-right font-mono text-xs tabular-nums"
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
}) {
  const [view, setView] = useState<'chart' | 'table'>(
    definition.defaultView ?? 'chart',
  );
  const resolvedSeries = definition.series.map((series) =>
    series.key === 'adjustedPrice'
      ? {
          ...series,
          label:
            priceAdjustment === 'forward' ? '年末前复权股价' : '年末未复权股价',
        }
      : series,
  );
  const availableSeries = resolvedSeries.filter((series) =>
    data.some((point) => typeof point[series.key] === 'number'),
  );
  const usable = availableSeries.length > 0;
  const config = Object.fromEntries(
    availableSeries.map((series) => [
      series.key,
      { label: series.label, color: series.color },
    ]),
  ) as ChartConfig;
  const amountChart = ['growth', 'cash-debt', 'fcf'].includes(definition.id);
  const dualAxis = ['growth', 'price-eps', 'valuation'].includes(definition.id);
  const priceEpsChart = definition.id === 'price-eps';
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
      className="scroll-mt-24 overflow-hidden"
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
          {usable && (
            <Badge
              variant="outline"
              className="rounded-sm border-[var(--ds-success)]/30 bg-[var(--ds-success-bg)] text-[var(--ds-success)]"
            >
              已核验 {verifiedValues}/{expectedValues} 点
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
          <p className="mb-2 text-[11px] text-muted-foreground">
            左轴：股价（{priceCurrency ?? '交易币种'}/股） · 右轴：每股收益（
            {financialCurrency ?? '财报币种'}/股） · 历史股价
            {priceAdjustment === 'forward' ? '前复权' : '未复权'}
            ；最右端为行情日最新价格
          </p>
        )}
        {usable && missingSeries.length > 0 && (
          <p className="mb-2 text-[11px] text-[var(--ds-warning)]">
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
        ) : view === 'table' ? (
          <FinancialSeriesTable
            data={data}
            series={availableSeries}
            chartId={definition.id}
            financialCurrency={financialCurrency}
            priceCurrency={priceCurrency}
          />
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
                  minTickGap={22}
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
        <div className="mt-4 border-t border-[var(--ds-border-subtle)] pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant="outline"
              className="rounded-sm bg-[var(--ds-surface-subtle)] text-[var(--ds-text-secondary)]"
            >
              原文核对：{definition.auditLabel}
            </Badge>
            {expectedValues > 0 && verifiedValues < expectedValues && (
              <span className="text-[11px] text-[var(--ds-warning)]">
                仍有 {expectedValues - verifiedValues}{' '}
                个应展示点未形成可核验值（数据缺失或计算边界）
              </span>
            )}
          </div>
          <p className="mt-2 text-[11px] leading-5 text-[var(--ds-text-tertiary)]">
            {definition.originalBasis}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function StatusCard({
  label,
  value,
  note,
}: {
  label: string;
  value: string | number;
  note: string;
}) {
  return (
    <div className="min-w-0 bg-[var(--ds-surface)] p-3 sm:p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold tracking-tight text-[var(--ds-text-primary)] sm:text-2xl">
        {value}
      </p>
      <p className="mt-1 text-[11px] text-muted-foreground">{note}</p>
    </div>
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
