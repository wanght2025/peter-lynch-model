import type {
  AnalysisDataset,
  MetricEvidence,
  MetricPoint,
  ProgramAnalysis,
  ProgramMetricSnapshot,
} from '@/lib/analysis-types';
import { calculateScore, evaluateProgramRules } from '@/lib/scoring-engine';

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
  const sourceKey: Record<string, string> = {
    'balance.cash': 'cash',
    'balance.long_term_debt': 'longTermDebt',
    'balance.interest_bearing_debt': 'interestBearingDebt',
    'shares.outstanding': 'sharesOutstanding',
    'balance.lynch_net_cash_per_share': 'lynchNetCashPerShare',
    'balance.conservative_net_cash_per_share':
      'conservativeNetCashPerShare',
    'balance.equity_ratio': 'equityRatio',
    'balance.debt_ratio': 'debtRatio',
    'cashflow.free': 'freeCashFlow',
    'growth.inventory_yoy': 'inventory',
    'growth.revenue_yoy': 'revenue',
    'margin.pretax': 'pretaxMargin',
    'valuation.pe_history_median': 'adjustedPrice',
    'valuation.pe_history_min': 'adjustedPrice',
    'valuation.pe_history_max': 'adjustedPrice',
    'balance.cash_change': 'cash',
    'balance.interest_bearing_debt_change': 'interestBearingDebt',
  };
  const source = point.metricSources?.[sourceKey[metricId]];
  return [
    {
      metricId,
      value,
      unit: unit ?? source?.unit,
      period: point.period,
      formula: formula ?? source?.formula,
      reportRefIds: point.reportRefIds,
      page: source?.page,
      pages: source?.pages,
      sourceLabel: source?.label,
      sourceName: source?.sourceName,
      sourceUrl: source?.sourceUrl,
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
  const source =
    metricId === 'valuation.pe_ttm' ? market.fieldSources?.peTtm : undefined;
  return [
    {
      metricId,
      value,
      unit,
      period: market.date,
      formula,
      reportRefIds: [],
      sourceName: source?.sourceName ?? market.sourceName,
      sourceUrl: source?.sourceUrl ?? market.sourceUrl,
    },
  ];
}

function percentGrowth(current?: number, prior?: number) {
  if (
    !number(current) ||
    !number(prior) ||
    prior === 0 ||
    current < 0 ||
    prior < 0
  )
    return null;
  return ((current - prior) / Math.abs(prior)) * 100;
}

const H2_FLOW_METRICS = [
  'revenue',
  'netProfit',
  'grossProfit',
  'operatingProfit',
  'pretaxProfit',
  'operatingCashFlow',
  'capitalExpenditure',
  'freeCashFlow',
] as const;

function priorYearPeriod(period: string) {
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

function h2Points(dataset: AnalysisDataset) {
  const annualByYear = new Map(
    dataset.annual.map((point) => [point.period, point]),
  );
  return (dataset.halfYear ?? []).flatMap((half) => {
    const year = half.period.match(/^(\d{4})H1$/)?.[1];
    const annual = year ? annualByYear.get(year) : undefined;
    if (!year || !annual) return [];
    const point: MetricPoint = {
      period: `${year}H2`,
      reportRefIds: [
        ...new Set([...annual.reportRefIds, ...half.reportRefIds]),
      ],
      metricSources: {},
    };
    for (const metric of H2_FLOW_METRICS) {
      const annualValue = annual[metric];
      const halfValue = half[metric];
      if (number(annualValue) && number(halfValue)) {
        point[metric] = annualValue - halfValue;
      }
    }
    for (const key of [
      'cash',
      'inventory',
      'totalAssets',
      'totalLiabilities',
      'shareholdersEquity',
      'interestBearingDebt',
      'shortTermBorrowings',
      'longTermBorrowings',
      'longTermDebt',
    ]) {
      const value = annual[key];
      if (number(value)) point[key] = value;
    }
    return [point];
  });
}

function reportingPoints(dataset: AnalysisDataset) {
  if (dataset.quarterly.length >= 2) {
    return {
      frequency: 'quarterly' as const,
      points: [...dataset.quarterly].sort((a, b) =>
        a.period.localeCompare(b.period),
      ),
    };
  }
  if (
    dataset.security?.market === 'HK' &&
    (dataset.halfYear?.length ?? 0) >= 1
  ) {
    const latestHalfYear = [...(dataset.halfYear ?? [])]
      .sort((a, b) => a.period.localeCompare(b.period))
      .at(-1);
    const latestAnnualYear = Number(dataset.annual.at(-1)?.period);
    const latestHalfYearYear = Number(latestHalfYear?.period.slice(0, 4));
    if (!(latestHalfYearYear > latestAnnualYear)) {
      return {
        frequency: 'annual' as const,
        points: [...dataset.annual].sort((a, b) =>
          a.period.localeCompare(b.period),
        ),
      };
    }
    return {
      frequency: 'half_year' as const,
      points: [...(dataset.halfYear ?? []), ...h2Points(dataset)].sort((a, b) =>
        a.period.localeCompare(b.period),
      ),
    };
  }
  return {
    frequency: 'annual' as const,
    points: [...dataset.annual].sort((a, b) =>
      a.period.localeCompare(b.period),
    ),
  };
}

function latestReportComparison(dataset: AnalysisDataset) {
  const { frequency, points } = reportingPoints(dataset);
  const current = points.at(-1);
  if (!current) {
    return {
      frequency,
      current: undefined,
      sequential: undefined,
      priorYear: undefined,
    };
  }
  const previous = points.at(-2);
  const sequential =
    frequency !== 'annual' &&
    previous &&
    isAdjacentPeriod(current.period, previous.period)
      ? previous
      : undefined;
  const priorPeriod = priorYearPeriod(current.period);
  const priorYear = priorPeriod
    ? points.find((point) => point.period === priorPeriod)
    : points.find(
        (point) => point.period === String(Number(current.period) - 1),
      );
  return { frequency, current, sequential, priorYear };
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

export function buildProgramAnalysis(
  dataset: AnalysisDataset,
): ProgramAnalysis {
  const latest = dataset.latestComparablePoint ?? dataset.annual.at(-1);
  const priorAnnual = dataset.latestComparablePoint
    ? dataset.annual.at(-1)
    : dataset.annual.at(-2);
  const latestComparison = latestReportComparison(dataset);
  const latestReport = latestComparison.current ?? dataset.annual.at(-1);
  const latestPriorYear = latestComparison.priorYear;
  const latestSequential = latestComparison.sequential;
  const annualCurrent = dataset.annual.at(-1);
  const annualPrior = dataset.annual.at(-2);
  const inventoryGrowthYoYPercent = percentGrowth(
    annualCurrent?.inventory,
    annualPrior?.inventory,
  );
  const revenueGrowthYoYPercent = percentGrowth(
    annualCurrent?.revenue,
    annualPrior?.revenue,
  );
  const latestRevenueGrowthYoYPercent = percentGrowth(
    latestReport?.revenue,
    latestPriorYear?.revenue,
  );
  const latestRevenueGrowthSequentialPercent = percentGrowth(
    latestReport?.revenue,
    latestSequential?.revenue,
  );
  const latestNetProfitGrowthYoYPercent = percentGrowth(
    latestReport?.netProfit,
    latestPriorYear?.netProfit,
  );
  const latestNetProfitGrowthSequentialPercent = percentGrowth(
    latestReport?.netProfit,
    latestSequential?.netProfit,
  );
  const latestEpsGrowthYoYPercent = percentGrowth(
    latestReport?.eps,
    latestPriorYear?.eps,
  );
  const latestEpsGrowthSequentialPercent = percentGrowth(
    latestReport?.eps,
    latestSequential?.eps,
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
        annualCurrent,
        '%',
      ),
      ...evidence(
        'growth.revenue_yoy',
        revenueGrowthYoYPercent,
        annualCurrent,
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
    latestReportPeriod: latestReport?.period ?? null,
    latestComparisonPeriod:
      latestPriorYear?.period ?? latestSequential?.period ?? null,
    latestReportingFrequency: latestComparison.frequency,
    latestRevenueGrowthYoYPercent,
    latestRevenueGrowthSequentialPercent,
    latestNetProfitGrowthYoYPercent,
    latestNetProfitGrowthSequentialPercent,
    latestEpsGrowthYoYPercent,
    latestEpsGrowthSequentialPercent,
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
