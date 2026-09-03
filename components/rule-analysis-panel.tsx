'use client';

import Link from 'next/link';
import {
  AlertTriangle,
  ArrowUpRight,
  BookOpen,
  Calculator,
  CheckCircle2,
  Database,
  ExternalLink,
  HelpCircle,
  MinusCircle,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type {
  AnalysisDataset,
  MetricEvidence,
  MetricPoint,
  ProgramAnalysis,
  RuleOutcome,
  RuleResult,
} from '@/lib/analysis-types';
import { ruleCatalog, type LynchRuleCandidate } from '@/lib/rule-catalog';
import { calculateCagr } from '@/lib/scoring-engine';

type ValueKind =
  | 'amount'
  | 'perShare'
  | 'price'
  | 'percent'
  | 'multiple'
  | 'shares';

type HistoryColumn = {
  key: string;
  label: string;
  kind: ValueKind;
};

type HistoryRow = {
  period: string;
  values: Record<string, number | undefined>;
  reportRefIds: string[];
};

type HistoryTable = {
  columns: HistoryColumn[];
  rows: HistoryRow[];
  note: string;
} | null;

const metricLabels: Record<string, string> = {
  'valuation.pe_ttm': '市盈率（TTM）',
  'growth.earnings_cagr_5y': '5年EPS复合增长率',
  'valuation.dividend_yield': '当前股息率',
  'balance.cash': '现金',
  'balance.long_term_debt': '长期债务（林奇口径）',
  'balance.interest_bearing_debt': '全部有息负债（保守代理）',
  'shares.outstanding': '股本',
  'balance.lynch_net_cash_per_share': '林奇口径每股净现金',
  'balance.conservative_net_cash_per_share': '保守代理每股净现金',
  'valuation.current_price': '当前股价',
  'balance.equity_ratio': '股东权益率',
  'balance.debt_ratio': '负债率',
  'cashflow.free': '自由现金流（全部资本支出代理）',
  'growth.inventory_yoy': '存货同比增长率',
  'growth.revenue_yoy': '营业收入同比增长率',
  'margin.pretax': '税前利润率',
  'balance.cash_change': '现金变化',
  'balance.interest_bearing_debt_change': '有息负债变化',
  'valuation.pe_history_median': '历史PE中位数',
  'valuation.pe_history_min': '历史PE最低值',
  'valuation.pe_history_max': '历史PE最高值',
};

const groups = [
  {
    title: '估值与成长',
    description: '当前估值、历史估值与EPS增长是否匹配。',
    ruleIds: [
      'LYN-13-PE-HALF-DOUBLE',
      'LYN-13-DIVIDEND-PEG',
      'LYN-10-PE-CONTEXT',
      'LYN-15-FAST-GROWTH-PREFERENCE',
    ],
  },
  {
    title: '财务安全与现金回报',
    description: '资产负债表、现金、债务、自由现金流代理和股息安全。',
    ruleIds: [
      'LYN-13-NET-CASH',
      'LYN-13-BALANCE-SHEET',
      'LYN-12-CASH-DEBT-TREND',
      'LYN-13-FCF',
      'LYN-13-PAYOUT-SAFETY',
    ],
  },
  {
    title: '经营质量',
    description: '存货、销售、客户依赖与税前利润率。',
    ruleIds: [
      'LYN-13-INVENTORY-SALES',
      'LYN-13-PRETAX-MARGIN',
      'LYN-09-CUSTOMER-CONCENTRATION',
    ],
  },
  {
    title: '公司事件与持有人行为',
    description: '分拆、机构覆盖、内部人士交易和实际回购。',
    ruleIds: [
      'LYN-08-SPINOFF',
      'LYN-08-LOW-INSTITUTIONAL',
      'LYN-08-INSIDER-BUYING',
      'LYN-08-BUYBACK',
    ],
  },
] as const;

const ruleMap = new Map(ruleCatalog.map((rule) => [rule.id, rule]));

function known(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function outcomeLabel(outcome: RuleOutcome) {
  return outcome === 1
    ? '+1 正向'
    : outcome === -1
      ? '-1 风险'
      : outcome === 0
        ? '0 中性'
        : outcome === 'not_applicable'
          ? '不适用'
          : '证据不足';
}

function outcomeStyle(outcome: RuleOutcome) {
  return outcome === 1
    ? 'border border-[var(--ds-success)]/30 bg-[var(--ds-success-bg)] text-[var(--ds-success)]'
    : outcome === -1
      ? 'border border-[var(--ds-danger)]/30 bg-[var(--ds-danger-bg)] text-[var(--ds-danger)]'
      : outcome === 'insufficient'
        ? 'border border-[var(--ds-warning)]/30 bg-[var(--ds-warning-bg)] text-[var(--ds-warning)]'
        : outcome === 'not_applicable'
          ? 'border border-[var(--ds-border-subtle)] bg-[var(--ds-surface-subtle)] text-[var(--ds-text-secondary)]'
          : 'border border-[var(--ds-border-subtle)] bg-[var(--ds-surface-subtle)] text-[var(--ds-text-secondary)]';
}

function OutcomeIcon({ outcome }: { outcome: RuleOutcome }) {
  const Icon =
    outcome === 1
      ? CheckCircle2
      : outcome === -1
        ? AlertTriangle
        : outcome === 0
          ? MinusCircle
          : outcome === 'insufficient'
            ? HelpCircle
            : MinusCircle;
  return <Icon aria-hidden="true" className="size-3.5 shrink-0" />;
}

function formatValue(
  value: number | undefined,
  kind: ValueKind,
  currency: string,
) {
  if (!known(value)) return '—';
  if (kind === 'amount') {
    return `${(value / 100_000_000).toLocaleString('zh-CN', { maximumFractionDigits: 2 })}亿 ${currency}`;
  }
  if (kind === 'shares') {
    return `${(value / 100_000_000).toLocaleString('zh-CN', { maximumFractionDigits: 3 })}亿股`;
  }
  if (kind === 'perShare') return `${value.toFixed(3)} ${currency}/股`;
  if (kind === 'price') return `${value.toFixed(2)} ${currency}/股`;
  if (kind === 'percent') return `${value.toFixed(2)}%`;
  return `${value.toFixed(2)}倍`;
}

function displayEvidenceValue(evidence: MetricEvidence, currency: string) {
  if (!known(evidence.value)) return String(evidence.value ?? '缺失');
  if (evidence.unit === '%') return `${evidence.value.toFixed(2)}%`;
  if (evidence.unit === '倍') return `${evidence.value.toFixed(2)}倍`;
  if (evidence.unit === '股')
    return `${(evidence.value / 100_000_000).toFixed(3)}亿股`;
  if (evidence.unit?.endsWith('/股'))
    return `${evidence.value.toFixed(3)} ${evidence.unit}`;
  if (evidence.unit === currency)
    return `${(evidence.value / 100_000_000).toFixed(2)}亿 ${currency}`;
  return `${evidence.value.toLocaleString('zh-CN')} ${evidence.unit ?? ''}`.trim();
}

function pointPeriod(point: MetricPoint, basis: 'flow' | 'instant') {
  if (basis === 'instant' && point.period.endsWith(' TTM')) {
    return `${point.period.replace(/ TTM$/, '')} 期末`;
  }
  return point.period;
}

function annualAndLatest(dataset: AnalysisDataset, basis: 'flow' | 'instant') {
  const points = [...dataset.annual];
  if (dataset.latestComparablePoint) points.push(dataset.latestComparablePoint);
  return points
    .filter(
      (point, index, values) =>
        values.findIndex((item) => item.period === point.period) === index,
    )
    .map((point) => ({ ...point, period: pointPeriod(point, basis) }))
    .reverse();
}

function percentGrowth(current?: number, prior?: number) {
  if (!known(current) || !known(prior) || prior === 0) return undefined;
  return ((current - prior) / Math.abs(prior)) * 100;
}

function valuationRows(dataset: AnalysisDataset, analysis: ProgramAnalysis) {
  const annualRows = dataset.annual.map((point, index, points) => {
    const start = points[index - 5];
    const growth =
      start && known(start.eps) && known(point.eps)
        ? (calculateCagr(start.eps, point.eps, 5) ?? undefined)
        : undefined;
    const pe =
      known(point.adjustedPrice) && known(point.eps) && point.eps > 0
        ? point.adjustedPrice / point.eps
        : undefined;
    return {
      period: point.period,
      values: {
        price: point.adjustedPrice,
        eps: point.eps,
        pe,
        growth,
        ratio:
          known(pe) && known(growth) && growth > 0 ? pe / growth : undefined,
      },
      reportRefIds: point.reportRefIds,
    } satisfies HistoryRow;
  });
  const latest = dataset.latestComparablePoint;
  if (latest) {
    const pe = dataset.currentMarket?.peTtm;
    const growth = analysis.snapshot.earningsCagr5yPercent ?? undefined;
    annualRows.push({
      period: `${latest.period.replace(/ TTM$/, '')} 当前`,
      values: {
        price: dataset.currentMarket?.price,
        eps: latest.eps,
        pe,
        growth,
        ratio:
          known(pe) && known(growth) && growth > 0 ? pe / growth : undefined,
      },
      reportRefIds: latest.reportRefIds,
    });
  }
  return annualRows.reverse();
}

function ruleHistory(
  ruleId: string,
  dataset: AnalysisDataset,
  analysis: ProgramAnalysis,
): HistoryTable {
  const instant = annualAndLatest(dataset, 'instant');
  const flow = annualAndLatest(dataset, 'flow');
  const historicalPriceLabel =
    dataset.priceAdjustment === 'forward' ? '年末前复权价' : '年末未复权价';
  if (['LYN-13-PE-HALF-DOUBLE', 'LYN-10-PE-CONTEXT'].includes(ruleId)) {
    return {
      columns: [
        { key: 'price', label: '股价', kind: 'price' },
        { key: 'eps', label: 'EPS', kind: 'perShare' },
        { key: 'pe', label: 'PE', kind: 'multiple' },
        { key: 'growth', label: '5年EPS CAGR', kind: 'percent' },
        { key: 'ratio', label: 'PE/CAGR', kind: 'multiple' },
      ],
      rows: valuationRows(dataset, analysis),
      note: `完整年度按${historicalPriceLabel}计算；“当前”行使用最新市价、PE·TTM和最近5个完整年度EPS增长率。`,
    };
  }
  if (ruleId === 'LYN-13-DIVIDEND-PEG') {
    return {
      columns: [
        { key: 'eps', label: 'EPS', kind: 'perShare' },
        { key: 'dividendPerShare', label: '每股股息', kind: 'perShare' },
        { key: 'dividendYield', label: '股息率', kind: 'percent' },
        { key: 'payoutRatio', label: '派息率', kind: 'percent' },
      ],
      rows: flow.map((point) => ({
        period: point.period,
        values: {
          eps: point.eps,
          dividendPerShare: point.dividendPerShare,
          dividendYield: point.dividendYield,
          payoutRatio: point.payoutRatio,
        },
        reportRefIds: point.reportRefIds,
      })),
      note: '股息历史尚未完整接入时保留空值，不能用估算值补齐。',
    };
  }
  if (['LYN-13-NET-CASH', 'LYN-12-CASH-DEBT-TREND'].includes(ruleId)) {
    return {
      columns: [
        { key: 'cash', label: '现金', kind: 'amount' },
        { key: 'longTermDebt', label: '长期债务', kind: 'amount' },
        { key: 'totalDebt', label: '全部有息负债', kind: 'amount' },
        { key: 'lynchPerShare', label: '林奇/股', kind: 'perShare' },
        {
          key: 'conservativePerShare',
          label: '保守代理/股',
          kind: 'perShare',
        },
        { key: 'price', label: '同期／当前股价', kind: 'price' },
        { key: 'lynchSupport', label: '林奇/股价', kind: 'percent' },
        {
          key: 'conservativeSupport',
          label: '保守代理/股价',
          kind: 'percent',
        },
      ],
      rows: instant.map((point) => {
        const lynchNetCash = known(point.lynchNetCash)
          ? point.lynchNetCash
          : known(point.cash) && known(point.longTermDebt)
            ? point.cash - point.longTermDebt
            : undefined;
        const conservativeNetCash = known(point.conservativeNetCash)
          ? point.conservativeNetCash
          : known(point.cash) && known(point.interestBearingDebt)
            ? point.cash - point.interestBearingDebt
            : undefined;
        const lynchPerShare = known(point.lynchNetCashPerShare)
          ? point.lynchNetCashPerShare
          : known(lynchNetCash) &&
              known(point.sharesOutstanding) &&
              point.sharesOutstanding > 0
            ? lynchNetCash / point.sharesOutstanding
            : undefined;
        const conservativePerShare = known(point.conservativeNetCashPerShare)
          ? point.conservativeNetCashPerShare
          : known(conservativeNetCash) &&
              known(point.sharesOutstanding) &&
              point.sharesOutstanding > 0
            ? conservativeNetCash / point.sharesOutstanding
            : undefined;
        const latestPoint = point.period.includes('期末');
        const price = latestPoint
          ? dataset.currentMarket?.price
          : point.adjustedPrice;
        return {
          period: point.period,
          values: {
            cash: point.cash,
            longTermDebt: point.longTermDebt,
            totalDebt: point.interestBearingDebt,
            lynchPerShare,
            conservativePerShare,
            price,
            lynchSupport:
              known(lynchPerShare) && known(price) && price > 0
                ? (lynchPerShare / price) * 100
                : undefined,
            conservativeSupport:
              known(conservativePerShare) && known(price) && price > 0
                ? (conservativePerShare / price) * 100
                : undefined,
          },
          reportRefIds: point.reportRefIds,
        };
      }),
      note: `林奇口径＝现金－长期债务；保守代理＝现金－全部有息负债。现金和债务均为报告日时点值，历史比值使用同期${historicalPriceLabel}，最新比值使用当前股价；原文没有统一比例门槛。`,
    };
  }
  if (ruleId === 'LYN-13-BALANCE-SHEET') {
    return {
      columns: [
        { key: 'assets', label: '总资产', kind: 'amount' },
        { key: 'liabilities', label: '总负债', kind: 'amount' },
        { key: 'equity', label: '股东权益', kind: 'amount' },
        { key: 'equityRatio', label: '股东权益率', kind: 'percent' },
        { key: 'debtRatio', label: '负债率', kind: 'percent' },
      ],
      rows: instant.map((point) => ({
        period: point.period,
        values: {
          assets: point.totalAssets,
          liabilities: point.totalLiabilities,
          equity: point.shareholdersEquity,
          equityRatio: known(point.equityRatio)
            ? point.equityRatio
            : known(point.shareholdersEquity) &&
                known(point.totalAssets) &&
                point.totalAssets !== 0
              ? (point.shareholdersEquity / point.totalAssets) * 100
              : undefined,
          debtRatio: known(point.debtRatio)
            ? point.debtRatio
            : known(point.totalLiabilities) &&
                known(point.totalAssets) &&
                point.totalAssets !== 0
              ? (point.totalLiabilities / point.totalAssets) * 100
              : undefined,
        },
        reportRefIds: point.reportRefIds,
      })),
      note: '资产负债表指标均为期末时点值。',
    };
  }
  if (ruleId === 'LYN-13-FCF') {
    return {
      columns: [
        { key: 'ocf', label: '经营现金流', kind: 'amount' },
        { key: 'capex', label: '资本支出', kind: 'amount' },
        { key: 'fcf', label: '自由现金流代理值', kind: 'amount' },
      ],
      rows: flow.map((point) => ({
        period: point.period,
        values: {
          ocf: point.operatingCashFlow,
          capex: point.capitalExpenditure,
          fcf: known(point.freeCashFlow)
            ? point.freeCashFlow
            : known(point.operatingCashFlow) && known(point.capitalExpenditure)
              ? point.operatingCashFlow - point.capitalExpenditure
              : undefined,
        },
        reportRefIds: point.reportRefIds,
      })),
      note: '最新期间的利润表和现金流量表使用TTM；代理值无法拆分维持性与扩张性资本支出。',
    };
  }
  if (ruleId === 'LYN-13-INVENTORY-SALES') {
    const points = dataset.quarterly;
    return {
      columns: [
        { key: 'inventory', label: '存货', kind: 'amount' },
        { key: 'revenue', label: '单季营业收入', kind: 'amount' },
        { key: 'inventoryGrowth', label: '存货同比', kind: 'percent' },
        { key: 'revenueGrowth', label: '销售同比', kind: 'percent' },
        { key: 'gap', label: '增速差', kind: 'percent' },
      ],
      rows: points
        .map((point, index) => {
          const prior = points[index - 4];
          const inventoryGrowth = percentGrowth(
            point.inventory,
            prior?.inventory,
          );
          const revenueGrowth = percentGrowth(point.revenue, prior?.revenue);
          return {
            period: point.period,
            values: {
              inventory: point.inventory,
              revenue: point.revenue,
              inventoryGrowth,
              revenueGrowth,
              gap:
                known(inventoryGrowth) && known(revenueGrowth)
                  ? inventoryGrowth - revenueGrowth
                  : undefined,
            },
            reportRefIds: point.reportRefIds,
          } satisfies HistoryRow;
        })
        .reverse(),
      note: 'A股以还原后的单季度收入和对应期末存货计算同比；最新季度排在最上方。',
    };
  }
  if (ruleId === 'LYN-13-PRETAX-MARGIN') {
    return {
      columns: [
        { key: 'revenue', label: '营业收入', kind: 'amount' },
        { key: 'pretaxProfit', label: '税前利润', kind: 'amount' },
        { key: 'pretaxMargin', label: '税前利润率', kind: 'percent' },
      ],
      rows: flow.map((point) => ({
        period: point.period,
        values: {
          revenue: point.revenue,
          pretaxProfit: point.pretaxProfit,
          pretaxMargin: known(point.pretaxMargin)
            ? point.pretaxMargin
            : known(point.pretaxProfit) &&
                known(point.revenue) &&
                point.revenue !== 0
              ? (point.pretaxProfit / point.revenue) * 100
              : undefined,
        },
        reportRefIds: point.reportRefIds,
      })),
      note: '这里只展示公司自身历史；同行分位尚未接入时不形成同行结论。',
    };
  }
  if (ruleId === 'LYN-15-FAST-GROWTH-PREFERENCE') {
    return {
      columns: [
        { key: 'eps', label: 'EPS', kind: 'perShare' },
        { key: 'growth', label: '截至该年的5年CAGR', kind: 'percent' },
      ],
      rows: dataset.annual
        .map((point, index, points) => {
          const start = points[index - 5];
          return {
            period: point.period,
            values: {
              eps: point.eps,
              growth:
                start && known(start.eps) && known(point.eps)
                  ? (calculateCagr(start.eps, point.eps, 5) ?? undefined)
                  : undefined,
            },
            reportRefIds: point.reportRefIds,
          } satisfies HistoryRow;
        })
        .reverse(),
      note: '5年复合增长率只使用完整年度，边界年度不足时保持空白。',
    };
  }
  if (ruleId === 'LYN-13-PAYOUT-SAFETY') {
    return {
      columns: [
        { key: 'eps', label: 'EPS', kind: 'perShare' },
        { key: 'dividendPerShare', label: '每股股息', kind: 'perShare' },
        { key: 'payoutRatio', label: '派息率', kind: 'percent' },
      ],
      rows: dataset.annual
        .map((point) => ({
          period: point.period,
          values: {
            eps: point.eps,
            dividendPerShare: point.dividendPerShare,
            payoutRatio: point.payoutRatio,
          },
          reportRefIds: point.reportRefIds,
        }))
        .reverse(),
      note: '需要完整周期股息记录；未接入年份明确显示空白。',
    };
  }
  if (ruleId === 'LYN-08-BUYBACK') {
    return {
      columns: [
        { key: 'shares', label: '股本', kind: 'shares' },
        { key: 'buybackShares', label: '已完成回购股数', kind: 'shares' },
      ],
      rows: instant.map((point) => ({
        period: point.period,
        values: {
          shares: point.sharesOutstanding,
          buybackShares: point.buybackShares,
        },
        reportRefIds: point.reportRefIds,
      })),
      note: '股本与回购公告数据尚未完整接入时保留空值。',
    };
  }
  return null;
}

function substitutedFormula(
  ruleId: string,
  dataset: AnalysisDataset,
  analysis: ProgramAnalysis,
) {
  const snapshot = analysis.snapshot;
  const latest = dataset.latestComparablePoint ?? dataset.annual.at(-1);
  if (
    ruleId === 'LYN-13-PE-HALF-DOUBLE' &&
    known(snapshot.peTtm) &&
    known(snapshot.earningsCagr5yPercent) &&
    snapshot.earningsCagr5yPercent !== 0
  ) {
    return `${snapshot.peTtm.toFixed(2)} ÷ ${snapshot.earningsCagr5yPercent.toFixed(2)} = ${(snapshot.peTtm / snapshot.earningsCagr5yPercent).toFixed(2)}`;
  }
  if (
    ruleId === 'LYN-13-DIVIDEND-PEG' &&
    known(snapshot.peTtm) &&
    known(snapshot.earningsCagr5yPercent) &&
    known(snapshot.dividendYieldPercent) &&
    snapshot.peTtm !== 0
  ) {
    return `(${snapshot.earningsCagr5yPercent.toFixed(2)} + ${snapshot.dividendYieldPercent.toFixed(2)}) ÷ ${snapshot.peTtm.toFixed(2)} = ${((snapshot.earningsCagr5yPercent + snapshot.dividendYieldPercent) / snapshot.peTtm).toFixed(2)}`;
  }
  if (
    ruleId === 'LYN-13-NET-CASH' &&
    known(latest?.cash) &&
    known(latest?.longTermDebt) &&
    known(latest?.interestBearingDebt)
  ) {
    const lynchNetCash = latest.cash - latest.longTermDebt;
    const conservativeNetCash = latest.cash - latest.interestBearingDebt;
    const shares = latest.sharesOutstanding;
    const price = dataset.currentMarket?.price;
    const lynchPerShare =
      known(shares) && shares > 0 ? lynchNetCash / shares : undefined;
    const conservativePerShare =
      known(shares) && shares > 0 ? conservativeNetCash / shares : undefined;
    const support = (value: number | undefined) =>
      known(value) && known(price) && price > 0
        ? `，占股价${((value / price) * 100).toFixed(1)}%`
        : '';
    return `林奇：${(latest.cash / 100_000_000).toFixed(2)}亿 − ${(latest.longTermDebt / 100_000_000).toFixed(2)}亿 = ${(lynchNetCash / 100_000_000).toFixed(2)}亿${known(lynchPerShare) ? `，${lynchPerShare.toFixed(3)} ${dataset.currency}/股${support(lynchPerShare)}` : ''}\n保守代理：${(latest.cash / 100_000_000).toFixed(2)}亿 − ${(latest.interestBearingDebt / 100_000_000).toFixed(2)}亿 = ${(conservativeNetCash / 100_000_000).toFixed(2)}亿${known(conservativePerShare) ? `，${conservativePerShare.toFixed(3)} ${dataset.currency}/股${support(conservativePerShare)}` : ''}`;
  }
  if (
    ruleId === 'LYN-13-BALANCE-SHEET' &&
    known(latest?.totalAssets) &&
    latest.totalAssets !== 0
  ) {
    const equity = latest.shareholdersEquity;
    const liabilities = latest.totalLiabilities;
    if (known(equity) && known(liabilities)) {
      return `股东权益率 ${((equity / latest.totalAssets) * 100).toFixed(2)}%；负债率 ${((liabilities / latest.totalAssets) * 100).toFixed(2)}%`;
    }
  }
  if (
    ruleId === 'LYN-13-FCF' &&
    known(latest?.operatingCashFlow) &&
    known(latest?.capitalExpenditure)
  ) {
    return `${(latest.operatingCashFlow / 100_000_000).toFixed(2)}亿 − ${(latest.capitalExpenditure / 100_000_000).toFixed(2)}亿 = ${((latest.operatingCashFlow - latest.capitalExpenditure) / 100_000_000).toFixed(2)}亿 ${dataset.currency}`;
  }
  if (
    ruleId === 'LYN-13-INVENTORY-SALES' &&
    known(snapshot.inventoryGrowthYoYPercent) &&
    known(snapshot.revenueGrowthYoYPercent)
  ) {
    return `${snapshot.inventoryGrowthYoYPercent.toFixed(2)}% − ${snapshot.revenueGrowthYoYPercent.toFixed(2)}% = ${(snapshot.inventoryGrowthYoYPercent - snapshot.revenueGrowthYoYPercent).toFixed(2)}个百分点`;
  }
  if (
    ruleId === 'LYN-12-CASH-DEBT-TREND' &&
    known(snapshot.cashChange) &&
    known(snapshot.interestBearingDebtChange)
  ) {
    return `现金变化 ${(snapshot.cashChange / 100_000_000).toFixed(2)}亿；有息负债变化 ${(snapshot.interestBearingDebtChange / 100_000_000).toFixed(2)}亿 ${dataset.currency}`;
  }
  if (
    ruleId === 'LYN-15-FAST-GROWTH-PREFERENCE' &&
    known(snapshot.earningsCagr5yPercent)
  ) {
    return `最近5个完整年度EPS CAGR = ${snapshot.earningsCagr5yPercent.toFixed(2)}%`;
  }
  return null;
}

function reportTitle(dataset: AnalysisDataset, ids: string[]) {
  const reports = dataset.reportRefs.filter((ref) => ids.includes(ref.id));
  if (reports.length === 0) return '来源引用缺失';
  return reports.map((report) => report.title).join('；');
}

function RuleHistoryTable({
  history,
  dataset,
}: {
  history: NonNullable<HistoryTable>;
  dataset: AnalysisDataset;
}) {
  return (
    <div className="mt-4 overflow-hidden border-y border-[var(--ds-border-subtle)] bg-[var(--ds-surface)]">
      <div className="border-b border-[var(--ds-border-subtle)] px-3 py-2">
        <p className="text-xs font-medium text-[var(--ds-text-primary)]">
          历年数据（最新期间在上）
        </p>
        <p className="mt-1 text-[11px] leading-5 text-[var(--ds-text-tertiary)]">
          {history.note}
        </p>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="whitespace-nowrap">期间</TableHead>
              {history.columns.map((column) => (
                <TableHead key={column.key} className="text-right">
                  {column.label}
                </TableHead>
              ))}
              <TableHead>来源</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {history.rows.map((row, index) => (
              <TableRow key={`${row.period}-${index}`}>
                <TableCell className="whitespace-nowrap font-mono text-xs font-medium tabular-nums text-[var(--ds-text-secondary)]">
                  {row.period}
                </TableCell>
                {history.columns.map((column) => (
                  <TableCell
                    key={column.key}
                    className="whitespace-nowrap text-right font-mono text-xs tabular-nums text-[var(--ds-text-primary)]"
                  >
                    {formatValue(
                      row.values[column.key],
                      column.kind,
                      dataset.currency,
                    )}
                  </TableCell>
                ))}
                <TableCell
                  className="max-w-56 truncate text-xs text-[var(--ds-text-tertiary)]"
                  title={reportTitle(dataset, row.reportRefIds)}
                >
                  {reportTitle(dataset, row.reportRefIds)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function DebtStructureTable({ dataset }: { dataset: AnalysisDataset }) {
  const points = annualAndLatest(dataset, 'instant');
  const columns = [
    ['shortTermBorrowings', '短期借款'],
    ['currentPortionNonCurrentLiabilities', '一年内到期非流动负债'],
    ['longTermBorrowings', '长期借款'],
    ['bondsPayable', '应付债券/融资票据'],
    ['currentLeaseLiabilities', '流动租赁负债'],
    ['nonCurrentLeaseLiabilities', '非流动租赁负债'],
    ['unclassifiedLeaseLiabilities', '未分类租赁负债'],
    ['unclassifiedBorrowings', '未分类借款'],
    ['interestBearingDebt', '全部有息负债'],
  ] as const;
  return (
    <div className="mt-4 overflow-hidden border-y border-[var(--ds-border-subtle)] bg-[var(--ds-surface)]">
      <div className="border-b border-[var(--ds-border-subtle)] px-3 py-2">
        <p className="text-xs font-medium text-[var(--ds-text-primary)]">
          负债结构拆分
        </p>
        <p className="mt-1 text-[11px] leading-5 text-[var(--ds-text-tertiary)]">
          有息负债不是长期负债：它包含短期和长期融资负债。破折号表示没有从该公司报表中可靠提取，不代表金额为零；“一年内到期非流动负债”仍需结合附注确认具体组成。
        </p>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="whitespace-nowrap">期间</TableHead>
              {columns.map(([key, label]) => (
                <TableHead key={key} className="min-w-32 text-right">
                  {label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {points.map((point) => (
              <TableRow key={point.period}>
                <TableCell className="whitespace-nowrap font-mono text-xs font-medium tabular-nums text-[var(--ds-text-secondary)]">
                  {point.period}
                </TableCell>
                {columns.map(([key]) => (
                  <TableCell
                    key={key}
                    className="whitespace-nowrap text-right font-mono text-xs tabular-nums text-[var(--ds-text-primary)]"
                  >
                    {formatValue(
                      point[key] as number | undefined,
                      'amount',
                      dataset.currency,
                    )}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function RuleDetail({
  rule,
  result,
  dataset,
  analysis,
}: {
  rule: LynchRuleCandidate;
  result: RuleResult;
  dataset: AnalysisDataset;
  analysis: ProgramAnalysis;
}) {
  const spec = rule.scoreSpec;
  const history = ruleHistory(rule.id, dataset, analysis);
  const substitution = substitutedFormula(rule.id, dataset, analysis);
  const evidenceReports = dataset.reportRefs.filter((ref) =>
    result.evidence.some((item) => item.reportRefIds.includes(ref.id)),
  );
  const marketSources = result.evidence.filter(
    (item) => item.sourceName && item.sourceUrl,
  );
  return (
    <div className="px-1 pb-4 text-[var(--ds-text-primary)]">
      <div className="grid gap-2 border-y border-[var(--ds-border-subtle)]">
        <div className="grid gap-3 border-b border-[var(--ds-border-subtle)] py-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div>
            <div className="flex items-center gap-2 text-xs font-medium text-[var(--ds-warning)]">
              <span className="font-mono text-[10px]">01</span>
              <BookOpen aria-hidden="true" className="size-4" /> 书中规则
            </div>
            <p className="mt-2 border-l-2 border-[var(--ds-warning)]/40 pl-3 text-sm leading-6">
              “{rule.excerpt}”
            </p>
            <p className="mt-2 pl-3 text-[11px] text-[var(--ds-text-tertiary)]">
              {rule.chapter} · {rule.section} · {rule.locator}
            </p>
          </div>
          <div>
            <div className="flex items-center gap-2 text-xs font-medium text-[var(--ds-info)]">
              <span className="font-mono text-[10px]">02</span>
              <Calculator aria-hidden="true" className="size-4" />{' '}
              {spec?.formula ? '程序判断与公式' : '程序判断方法'}
            </div>
            <p className="mt-2 font-mono text-xs leading-5 text-[var(--ds-text-secondary)]">
              {spec?.formula ?? '按法定披露确认方向，不设置自创数字门槛'}
            </p>
            <p className="mt-2 whitespace-pre-line border-l-2 border-[var(--ds-info)]/40 bg-[var(--ds-surface-subtle)] px-3 py-1.5 font-mono text-xs leading-5 text-[var(--ds-text-primary)]">
              {substitution ??
                result.note ??
                '当前证据不足，暂时无法代入或判断'}
            </p>
          </div>
        </div>

        {spec && (
          <div className="grid gap-2 border-b border-[var(--ds-border-subtle)] py-3 sm:grid-cols-2 xl:grid-cols-4">
            {spec.positive && (
              <Criterion label="正向" text={spec.positive} tone="positive" />
            )}
            {spec.neutral && <Criterion label="中性" text={spec.neutral} />}
            {spec.risk && (
              <Criterion label="风险" text={spec.risk} tone="risk" />
            )}
            {spec.notApplicable && (
              <Criterion label="不适用" text={spec.notApplicable} />
            )}
          </div>
        )}

        <div className="grid gap-3 py-3 lg:grid-cols-2">
          <div>
            <p className="flex items-center gap-2 text-xs font-medium text-[var(--ds-info)]">
              <span className="font-mono text-[10px]">03</span>{' '}
              实际代入：本次计算输入
            </p>
            {result.evidence.length ? (
              <div className="mt-2 space-y-2">
                {result.evidence.map((item, index) => (
                  <div
                    key={`${item.metricId}-${index}`}
                    className="flex items-start justify-between gap-3 text-xs"
                  >
                    <div>
                      <p>{metricLabels[item.metricId] ?? item.metricId}</p>
                      <p className="mt-0.5 text-[10px] text-[var(--ds-text-tertiary)]">
                        {item.period ?? '期间未知'}
                        {item.formula ? ` · ${item.formula}` : ''}
                      </p>
                    </div>
                    <span className="shrink-0 font-mono tabular-nums text-[var(--ds-text-primary)]">
                      {displayEvidenceValue(item, dataset.currency)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-xs leading-5 text-[var(--ds-warning)]">
                {result.note ?? `仍需：${rule.requiredEvidence.join('、')}`}
              </p>
            )}
          </div>
          <div>
            <div className="flex items-center gap-2 text-xs font-medium text-[var(--ds-warning)]">
              <span className="font-mono text-[10px]">04</span>
              <Database aria-hidden="true" className="size-4" /> 证据来源链
            </div>
            {evidenceReports.length || marketSources.length ? (
              <div className="mt-2 space-y-1.5">
                {evidenceReports.map((report) =>
                  report.sourceUrl ? (
                    <a
                      key={report.id}
                      href={report.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-start gap-1 text-xs text-[var(--ds-warning)] hover:underline"
                    >
                      <ExternalLink className="mt-0.5 size-3 shrink-0" />{' '}
                      {report.title}
                    </a>
                  ) : (
                    <p
                      key={report.id}
                      className="text-xs text-[var(--ds-text-secondary)]"
                    >
                      {report.title}
                    </p>
                  ),
                )}
                {marketSources.map((item, index) => (
                  <a
                    key={`${item.metricId}-${index}`}
                    href={item.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-start gap-1 text-xs text-[var(--ds-info)] hover:underline"
                  >
                    <ExternalLink className="mt-0.5 size-3 shrink-0" />{' '}
                    {item.sourceName} · 行情日期 {item.period}
                  </a>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-xs leading-5 text-[var(--ds-text-tertiary)]">
                {result.outcome === 'insufficient'
                  ? `缺少：${rule.requiredEvidence.join('、')}`
                  : '本条为分类或方向判断，当前没有单独的报告来源。'}
              </p>
            )}
          </div>
        </div>

        {history && <RuleHistoryTable history={history} dataset={dataset} />}
        {['LYN-13-NET-CASH', 'LYN-12-CASH-DEBT-TREND'].includes(rule.id) && (
          <DebtStructureTable dataset={dataset} />
        )}
      </div>
    </div>
  );
}

function Criterion({
  label,
  text,
  tone,
}: {
  label: string;
  text: string;
  tone?: 'positive' | 'risk';
}) {
  return (
    <div
      className={`rounded-sm border px-3 py-2 text-xs leading-5 ${tone === 'positive' ? 'border-[var(--ds-success)]/30 bg-[var(--ds-success-bg)] text-[var(--ds-success)]' : tone === 'risk' ? 'border-[var(--ds-danger)]/30 bg-[var(--ds-danger-bg)] text-[var(--ds-danger)]' : 'border-[var(--ds-border-subtle)] bg-[var(--ds-surface-elevated)] text-[var(--ds-text-secondary)]'}`}
    >
      <span className="font-medium">{label}：</span>
      {text}
    </div>
  );
}

export function RuleAnalysisPanel({
  dataset,
  analysis,
  results,
}: {
  dataset: AnalysisDataset;
  analysis: ProgramAnalysis;
  results: RuleResult[];
}) {
  const resultMap = new Map(results.map((result) => [result.ruleId, result]));
  return (
    <section id="rules" className="space-y-4 text-[var(--ds-text-primary)]">
      <div>
        <p className="ds-eyebrow">RULE SIGNALS</p>
        <h2 className="mt-1 text-[17px] font-semibold tracking-tight">
          关键规则与证据
        </h2>
        <p className="mt-2 text-sm leading-6 text-[var(--ds-text-secondary)]">
          点击任一规则，在悬浮详情中查看原文、公式、历年数据、负债结构和官方来源，不再拉长主页面。
        </p>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        {groups.map((group) => (
          <div
            key={group.title}
            className="h-fit border-y border-[var(--ds-border-subtle)] bg-[var(--ds-surface)]"
          >
            <div className="flex items-baseline justify-between gap-3 border-b border-[var(--ds-border-subtle)] px-3 py-2">
              <h3 className="text-sm font-semibold tracking-tight">
                {group.title}
              </h3>
              <span className="text-[10px] text-[var(--ds-text-tertiary)]">
                {group.ruleIds.length} 条规则
              </span>
            </div>
            <div className="border-b border-[var(--ds-border-subtle)] px-3 py-2">
              <p className="text-xs leading-5 text-[var(--ds-text-tertiary)]">
                {group.description}
              </p>
            </div>
            <div className="p-1">
              <div>
                {group.ruleIds.map((ruleId) => {
                  const rule = ruleMap.get(ruleId);
                  const result = resultMap.get(ruleId);
                  if (!rule || !result) return null;
                  return (
                    <Dialog key={ruleId}>
                      <DialogTrigger
                        render={
                          <button
                            type="button"
                            aria-label={`查看规则详情：${rule.title}`}
                            className="group flex w-full items-center gap-3 rounded-sm px-3 py-2.5 text-left hover:bg-[var(--ds-surface-selected)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--ds-focus)]"
                          />
                        }
                      >
                        <OutcomeIcon outcome={result.outcome} />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium leading-5 text-[var(--ds-text-primary)]">
                            {rule.title}
                          </span>
                          <span className="mt-1 block truncate text-[11px] font-normal text-[var(--ds-text-tertiary)]">
                            {result.evidence.length
                              ? `已读取 ${result.evidence.length} 项证据`
                              : `仍需 ${rule.requiredEvidence.join('、')}`}
                          </span>
                        </span>
                        <Badge
                          className={`shrink-0 gap-1 ${outcomeStyle(result.outcome)}`}
                        >
                          <OutcomeIcon outcome={result.outcome} />
                          <span>{outcomeLabel(result.outcome)}</span>
                        </Badge>
                        <ArrowUpRight className="size-4 shrink-0 text-[var(--ds-text-disabled)] transition-colors group-hover:text-[var(--ds-accent)]" />
                      </DialogTrigger>
                      <DialogContent className="finance-dialog max-h-[90vh] w-[min(96vw,1280px)] max-w-[min(96vw,1280px)] overflow-y-auto border-[var(--ds-border-strong)] bg-[var(--ds-canvas)] p-0 text-[var(--ds-text-primary)] sm:max-w-[min(96vw,1280px)]">
                        <DialogHeader className="sticky top-0 z-20 border-b border-[var(--ds-border-strong)] bg-[var(--ds-app-chrome)] px-5 py-4 pr-14">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge
                              className={`gap-1 ${outcomeStyle(result.outcome)}`}
                            >
                              <OutcomeIcon outcome={result.outcome} />
                              <span>{outcomeLabel(result.outcome)}</span>
                            </Badge>
                            <span className="font-mono text-[11px] text-[var(--ds-text-tertiary)]">
                              {rule.id}
                            </span>
                          </div>
                          <DialogTitle className="text-xl font-semibold tracking-tight text-[var(--ds-text-primary)]">
                            {rule.title}
                          </DialogTitle>
                          <DialogDescription>
                            {group.title} · {rule.chapter} · 数据与公式均可追溯
                          </DialogDescription>
                        </DialogHeader>
                        <div className="p-5">
                          <RuleDetail
                            rule={rule}
                            result={result}
                            dataset={dataset}
                            analysis={analysis}
                          />
                        </div>
                      </DialogContent>
                    </Dialog>
                  );
                })}
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="border-t border-[var(--ds-border-subtle)] bg-[var(--ds-surface-subtle)] px-4 py-3 text-xs text-[var(--ds-text-secondary)]">
        完整53条规则库已移到独立参考页。{' '}
        <Link
          href="/rules"
          className="font-medium text-[var(--ds-accent)] hover:underline"
        >
          打开规则参考
        </Link>
      </div>
    </section>
  );
}
