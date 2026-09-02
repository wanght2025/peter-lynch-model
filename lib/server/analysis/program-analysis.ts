import type {
  AnalysisDataset,
  MetricEvidence,
  MetricPoint,
  ProgramAnalysis,
  ProgramMetricSnapshot,
} from '@/lib/analysis-types';
import {
  calculateCagr,
  calculateScore,
  evaluateProgramRules,
} from '@/lib/scoring-engine';

function number(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function evidence(
  metricId: string,
  value: number | null | undefined,
  point: MetricPoint | undefined,
  unit?: string,
  formula?: string,
): MetricEvidence[] {
  if (!number(value) || !point) return [];
  return [
    {
      metricId,
      value,
      unit,
      period: point.period,
      formula,
      reportRefIds: point.reportRefIds,
    },
  ];
}

function marketEvidence(
  metricId: string,
  value: number | null | undefined,
  dataset: AnalysisDataset,
  unit?: string,
  formula?: string,
): MetricEvidence[] {
  const market = dataset.currentMarket;
  if (!number(value) || !market) return [];
  return [
    {
      metricId,
      value,
      unit,
      period: market.date,
      formula,
      reportRefIds: [],
      sourceName: market.sourceName,
      sourceUrl: market.sourceUrl,
    },
  ];
}

function percentGrowth(current?: number, prior?: number) {
  if (!number(current) || !number(prior) || prior === 0) return null;
  return ((current - prior) / Math.abs(prior)) * 100;
}

function trend(values: Array<number | undefined>) {
  const known = values.filter(number);
  if (known.length < 3) return null;
  const change = known.at(-1)! - known[0];
  const tolerance = Math.max(Math.abs(known[0]) * 0.05, 1);
  return change > tolerance
    ? ('improving' as const)
    : change < -tolerance
      ? ('worsening' as const)
      : ('stable' as const);
}

function annualCagr(dataset: AnalysisDataset, years: number) {
  const end = dataset.annual.at(-1);
  if (!end || !number(end.eps)) return null;
  const endYear = Number(end.period.slice(0, 4));
  const start = dataset.annual.find(
    (point) => Number(point.period.slice(0, 4)) === endYear - years,
  );
  return start && number(start.eps)
    ? calculateCagr(start.eps, end.eps, years)
    : null;
}

function latestComparablePeriods(dataset: AnalysisDataset) {
  if (dataset.security?.market === 'A_SHARE' && dataset.quarterly.length >= 5) {
    return {
      current: dataset.quarterly.at(-1),
      prior: dataset.quarterly.at(-5),
    };
  }
  const half = dataset.halfYear ?? [];
  if (dataset.security?.market === 'HK' && half.length >= 2) {
    const current = half.at(-1);
    const year = Number(current?.period.slice(0, 4));
    return {
      current,
      prior: half.find(
        (point) => Number(point.period.slice(0, 4)) === year - 1,
      ),
    };
  }
  return {
    current: dataset.annual.at(-1),
    prior: dataset.annual.at(-2),
  };
}

export function buildProgramAnalysis(
  dataset: AnalysisDataset,
): ProgramAnalysis {
  const latest = dataset.latestComparablePoint ?? dataset.annual.at(-1);
  const priorAnnual = dataset.latestComparablePoint
    ? dataset.annual.at(-1)
    : dataset.annual.at(-2);
  const comparable = latestComparablePeriods(dataset);
  const earningsCagr5yPercent = annualCagr(dataset, 5);
  const inventoryGrowthYoYPercent = percentGrowth(
    comparable.current?.inventory,
    comparable.prior?.inventory,
  );
  const revenueGrowthYoYPercent = percentGrowth(
    comparable.current?.revenue,
    comparable.prior?.revenue,
  );
  const derivedFreeCashFlow = (point?: MetricPoint) =>
    number(point?.freeCashFlow)
      ? point.freeCashFlow
      : number(point?.operatingCashFlow) && number(point?.capitalExpenditure)
        ? point.operatingCashFlow - point.capitalExpenditure
        : undefined;
  const derivedPretaxMargin = (point?: MetricPoint) =>
    number(point?.pretaxMargin)
      ? point.pretaxMargin
      : number(point?.pretaxProfit) &&
          number(point?.revenue) &&
          point.revenue !== 0
        ? (point.pretaxProfit / point.revenue) * 100
        : undefined;
  const derivedEquityRatio = number(latest?.equityRatio)
    ? latest.equityRatio
    : number(latest?.shareholdersEquity) &&
        number(latest?.totalAssets) &&
        latest.totalAssets !== 0
      ? (latest.shareholdersEquity / latest.totalAssets) * 100
      : undefined;
  const derivedDebtRatio = number(latest?.debtRatio)
    ? latest.debtRatio
    : number(latest?.totalLiabilities) &&
        number(latest?.totalAssets) &&
        latest.totalAssets !== 0
      ? (latest.totalLiabilities / latest.totalAssets) * 100
      : undefined;
  const latestFreeCashFlow = derivedFreeCashFlow(latest);
  const latestPretaxMargin = derivedPretaxMargin(latest);
  const freeCashFlowTrend = trend(
    dataset.annual.slice(-3).map(derivedFreeCashFlow),
  );
  const pretaxMarginTrend = trend(
    dataset.annual.slice(-3).map(derivedPretaxMargin),
  );
  const historicalPeValues = dataset.annual
    .map((point) =>
      number(point.adjustedPrice) && number(point.eps) && point.eps > 0
        ? point.adjustedPrice / point.eps
        : undefined,
    )
    .filter(number)
    .sort((a, b) => a - b);
  const historicalPeMedian = historicalPeValues.length
    ? historicalPeValues.length % 2 === 0
      ? (historicalPeValues[historicalPeValues.length / 2 - 1] +
          historicalPeValues[historicalPeValues.length / 2]) /
        2
      : historicalPeValues[Math.floor(historicalPeValues.length / 2)]
    : undefined;
  const latestConservativeNetCash =
    number(latest?.cash) && number(latest?.interestBearingDebt)
      ? latest.cash - latest.interestBearingDebt
      : undefined;
  const latestConservativeNetCashPerShare =
    number(latestConservativeNetCash) &&
    number(latest?.sharesOutstanding) &&
    latest.sharesOutstanding > 0
      ? latestConservativeNetCash / latest.sharesOutstanding
      : undefined;
  const latestLynchNetCash =
    number(latest?.cash) && number(latest?.longTermDebt)
      ? latest.cash - latest.longTermDebt
      : undefined;
  const latestLynchNetCashPerShare =
    number(latestLynchNetCash) &&
    number(latest?.sharesOutstanding) &&
    latest.sharesOutstanding > 0
      ? latestLynchNetCash / latest.sharesOutstanding
      : undefined;
  const cashChange =
    latest && priorAnnual && number(latest.cash) && number(priorAnnual.cash)
      ? latest.cash - priorAnnual.cash
      : null;
  const interestBearingDebtChange =
    latest &&
    priorAnnual &&
    number(latest.interestBearingDebt) &&
    number(priorAnnual.interestBearingDebt)
      ? latest.interestBearingDebt - priorAnnual.interestBearingDebt
      : null;

  const evidenceByRule: Record<string, MetricEvidence[]> = {
    'LYN-13-PE-HALF-DOUBLE': [
      ...marketEvidence(
        'valuation.pe_ttm',
        dataset.currentMarket?.peTtm,
        dataset,
        '倍',
      ),
      ...evidence(
        'growth.earnings_cagr_5y',
        earningsCagr5yPercent,
        dataset.annual.at(-1),
        '%',
        '最近5个完整年度EPS复合增长率',
      ),
    ],
    'LYN-13-DIVIDEND-PEG': [
      ...marketEvidence(
        'valuation.pe_ttm',
        dataset.currentMarket?.peTtm,
        dataset,
        '倍',
      ),
      ...evidence(
        'growth.earnings_cagr_5y',
        earningsCagr5yPercent,
        dataset.annual.at(-1),
        '%',
        '最近5个完整年度EPS复合增长率',
      ),
      ...marketEvidence(
        'valuation.dividend_yield',
        dataset.currentMarket?.dividendYield,
        dataset,
        '%',
      ),
    ],
    'LYN-13-NET-CASH': [
      ...evidence('balance.cash', latest?.cash, latest, dataset.currency),
      ...evidence(
        'balance.long_term_debt',
        latest?.longTermDebt,
        latest,
        dataset.currency,
        '长期借款＋应付债券/融资票据＋非流动租赁负债',
      ),
      ...evidence(
        'balance.interest_bearing_debt',
        latest?.interestBearingDebt,
        latest,
        dataset.currency,
      ),
      ...evidence(
        'shares.outstanding',
        latest?.sharesOutstanding,
        latest,
        '股',
      ),
      ...evidence(
        'balance.lynch_net_cash_per_share',
        latestLynchNetCashPerShare,
        latest,
        `${dataset.currency}/股`,
        '(现金－长期债务)÷股本',
      ),
      ...evidence(
        'balance.conservative_net_cash_per_share',
        latestConservativeNetCashPerShare,
        latest,
        `${dataset.currency}/股`,
        '(现金－全部有息负债)÷股本',
      ),
      ...marketEvidence(
        'valuation.current_price',
        dataset.currentMarket?.price,
        dataset,
        `${dataset.currency}/股`,
      ),
    ],
    'LYN-13-BALANCE-SHEET': [
      ...evidence(
        'balance.equity_ratio',
        derivedEquityRatio,
        latest,
        '%',
        '股东权益÷总资产',
      ),
      ...evidence(
        'balance.debt_ratio',
        derivedDebtRatio,
        latest,
        '%',
        '总负债÷总资产',
      ),
    ],
    'LYN-13-FCF': evidence(
      'cashflow.free',
      latestFreeCashFlow,
      latest,
      dataset.currency,
      '经营现金流－全部资本性现金支出（代理口径）',
    ),
    'LYN-13-INVENTORY-SALES': [
      ...evidence(
        'growth.inventory_yoy',
        inventoryGrowthYoYPercent,
        comparable.current,
        '%',
      ),
      ...evidence(
        'growth.revenue_yoy',
        revenueGrowthYoYPercent,
        comparable.current,
        '%',
      ),
    ],
    'LYN-13-PRETAX-MARGIN': evidence(
      'margin.pretax',
      latestPretaxMargin,
      latest,
      '%',
      '税前利润÷营业收入',
    ),
    'LYN-15-FAST-GROWTH-PREFERENCE': evidence(
      'growth.earnings_cagr_5y',
      earningsCagr5yPercent,
      dataset.annual.at(-1),
      '%',
    ),
    'LYN-10-PE-CONTEXT': [
      ...marketEvidence(
        'valuation.pe_ttm',
        dataset.currentMarket?.peTtm,
        dataset,
        '倍',
      ),
      ...evidence(
        'valuation.pe_history_median',
        historicalPeMedian,
        latest,
        '倍',
        '可用完整年度PE中位数',
      ),
      ...evidence(
        'valuation.pe_history_min',
        historicalPeValues.at(0),
        latest,
        '倍',
      ),
      ...evidence(
        'valuation.pe_history_max',
        historicalPeValues.at(-1),
        latest,
        '倍',
      ),
    ],
    'LYN-12-CASH-DEBT-TREND': [
      ...evidence('balance.cash_change', cashChange, latest, dataset.currency),
      ...evidence(
        'balance.interest_bearing_debt_change',
        interestBearingDebtChange,
        latest,
        dataset.currency,
      ),
    ],
  };

  const snapshot: ProgramMetricSnapshot = {
    isFinancialCompany: dataset.isFinancialCompany,
    companyType: dataset.companyType,
    companyTypes: dataset.companyTypes ?? [dataset.companyType],
    peTtm: dataset.currentMarket?.peTtm ?? null,
    currentPrice: dataset.currentMarket?.price ?? null,
    earningsPositive: number(latest?.netProfit)
      ? latest.netProfit > 0
      : undefined,
    earningsCagr5yPercent,
    dividendYieldPercent: dataset.currentMarket?.dividendYield ?? null,
    cash: latest?.cash ?? null,
    longTermDebt: latest?.longTermDebt ?? null,
    interestBearingDebt: latest?.interestBearingDebt ?? null,
    sharesOutstanding: latest?.sharesOutstanding ?? null,
    lynchNetCashPerShare: latestLynchNetCashPerShare ?? null,
    conservativeNetCashPerShare: latestConservativeNetCashPerShare ?? null,
    netCashPerShare: latestConservativeNetCashPerShare ?? null,
    equityRatioPercent: derivedEquityRatio ?? null,
    debtRatioPercent: derivedDebtRatio ?? null,
    freeCashFlow: latestFreeCashFlow ?? null,
    freeCashFlowTrend,
    inventoryGrowthYoYPercent,
    revenueGrowthYoYPercent,
    hasMaterialInventory: number(latest?.inventory)
      ? Math.abs(latest.inventory) > 0
      : undefined,
    pretaxMarginTrend,
    pretaxMarginPeerPosition: null,
    peContext:
      dataset.currentMarket?.peTtm && historicalPeValues.length >= 5
        ? 'mixed'
        : null,
    cashChange,
    interestBearingDebtChange,
    evidenceByRule,
  };
  const results = evaluateProgramRules(snapshot);
  return {
    results,
    summary: calculateScore(results),
    snapshot,
    generatedAt: new Date().toISOString(),
  };
}
