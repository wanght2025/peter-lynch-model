import type {
  CompanyType,
  MetricPoint,
  ProgramMetricSnapshot,
  RuleOutcome,
  RuleResult,
  ScoreSummary,
} from '@/lib/analysis-types';

export const PROGRAM_RULE_IDS = [
  'LYN-08-SPINOFF',
  'LYN-08-LOW-INSTITUTIONAL',
  'LYN-08-INSIDER-BUYING',
  'LYN-08-BUYBACK',
  'LYN-09-CUSTOMER-CONCENTRATION',
  'LYN-13-PE-HALF-DOUBLE',
  'LYN-13-DIVIDEND-PEG',
  'LYN-13-NET-CASH',
  'LYN-13-BALANCE-SHEET',
  'LYN-13-PAYOUT-SAFETY',
  'LYN-13-FCF',
  'LYN-13-INVENTORY-SALES',
  'LYN-13-PRETAX-MARGIN',
  'LYN-15-FAST-GROWTH-PREFERENCE',
  'LYN-10-PE-CONTEXT',
  'LYN-12-CASH-DEBT-TREND',
] as const;

export const AI_RULE_IDS = [
  'LYN-06-PRODUCT-MATERIALITY',
  'LYN-08-ZERO-GROWTH-INDUSTRY',
  'LYN-08-NICHE',
  'LYN-08-REPEAT-PURCHASE',
  'LYN-08-TECH-USER',
  'LYN-09-AVOID-HOT-STOCK',
  'LYN-09-AVOID-NEXT',
  'LYN-09-DIWORSEIFICATION',
  'LYN-13-DEBT-STRUCTURE',
  'LYN-15-FAST-REPLICATION',
  'LYN-15-CYCLICAL',
  'LYN-15-TURNAROUND',
  'LYN-15-ASSET-PLAY',
  'LYN-10-AVOID-EXTREME-PE',
] as const;

function isKnownNumber(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function hasCompanyType(snapshot: ProgramMetricSnapshot, types: CompanyType[]) {
  const selected = snapshot.companyTypes?.length
    ? snapshot.companyTypes
    : [snapshot.companyType];
  return selected.some((type) => types.includes(type));
}

function result(
  snapshot: ProgramMetricSnapshot,
  ruleId: string,
  outcome: RuleOutcome,
  note?: string,
): RuleResult {
  return {
    ruleId,
    outcome,
    evaluator: 'program',
    evidence: snapshot.evidenceByRule?.[ruleId] ?? [],
    userConfirmed: true,
    note,
  };
}

function insufficient(
  snapshot: ProgramMetricSnapshot,
  ruleId: string,
  note: string,
) {
  return result(snapshot, ruleId, 'insufficient', note);
}

function evaluateProgramRule(
  snapshot: ProgramMetricSnapshot,
  ruleId: string,
): RuleResult {
  switch (ruleId) {
    case 'LYN-08-SPINOFF':
      if (snapshot.isSpinoff === undefined)
        return insufficient(snapshot, ruleId, '缺少公司沿革或分拆公告');
      return result(snapshot, ruleId, snapshot.isSpinoff ? 1 : 0);

    case 'LYN-08-LOW-INSTITUTIONAL':
      if (
        snapshot.institutionalOwnershipClearlyLow === undefined ||
        snapshot.analystCoverageClearlyLow === undefined
      ) {
        return insufficient(snapshot, ruleId, '缺少机构持股或分析师覆盖证据');
      }
      return result(
        snapshot,
        ruleId,
        snapshot.institutionalOwnershipClearlyLow &&
          snapshot.analystCoverageClearlyLow
          ? 1
          : 0,
      );

    case 'LYN-08-INSIDER-BUYING':
      if (snapshot.insiderNetBuy === undefined)
        return insufficient(snapshot, ruleId, '缺少最近12个月内部人士交易披露');
      return result(snapshot, ruleId, snapshot.insiderNetBuy ? 1 : 0);

    case 'LYN-08-BUYBACK':
      if (snapshot.completedBuybackReducedShares === undefined) {
        return insufficient(
          snapshot,
          ruleId,
          '缺少已完成回购、注销或股本变动证据',
        );
      }
      return result(
        snapshot,
        ruleId,
        snapshot.completedBuybackReducedShares ? 1 : 0,
      );

    case 'LYN-09-CUSTOMER-CONCENTRATION':
      if (snapshot.majorCustomerDependency === undefined)
        return insufficient(snapshot, ruleId, '缺少主要客户依赖披露');
      return result(
        snapshot,
        ruleId,
        snapshot.majorCustomerDependency ? -1 : 0,
      );

    case 'LYN-13-PE-HALF-DOUBLE': {
      if (
        snapshot.earningsPositive === false ||
        !isKnownNumber(snapshot.peTtm)
      ) {
        return result(snapshot, ruleId, 'not_applicable', '亏损或市盈率不成立');
      }
      if (!isKnownNumber(snapshot.earningsCagr5yPercent)) {
        return insufficient(snapshot, ruleId, '缺少5年收益复合增长率');
      }
      if (snapshot.earningsCagr5yPercent <= 0 || snapshot.peTtm <= 0) {
        return result(
          snapshot,
          ruleId,
          'not_applicable',
          '收益增长率或市盈率不为正',
        );
      }
      const ratio = snapshot.peTtm / snapshot.earningsCagr5yPercent;
      return result(
        snapshot,
        ruleId,
        ratio <= 0.5 ? 1 : ratio >= 2 ? -1 : 0,
        `PE/5年收益增长率=${ratio.toFixed(2)}`,
      );
    }

    case 'LYN-13-DIVIDEND-PEG': {
      if (
        snapshot.earningsPositive === false ||
        !isKnownNumber(snapshot.peTtm) ||
        snapshot.peTtm <= 0
      ) {
        return result(snapshot, ruleId, 'not_applicable', '亏损或市盈率不成立');
      }
      if (
        !isKnownNumber(snapshot.earningsCagr5yPercent) ||
        !isKnownNumber(snapshot.dividendYieldPercent)
      ) {
        return insufficient(snapshot, ruleId, '缺少增长率或股息率');
      }
      const ratio =
        (snapshot.earningsCagr5yPercent + snapshot.dividendYieldPercent) /
        snapshot.peTtm;
      const label = ratio >= 2 ? '，达到书中“理想”标记' : '';
      return result(
        snapshot,
        ruleId,
        ratio >= 1.5 ? 1 : ratio < 1 ? -1 : 0,
        `林奇估值比=${ratio.toFixed(2)}${label}`,
      );
    }

    case 'LYN-13-NET-CASH':
      if (
        !isKnownNumber(snapshot.cash) ||
        !isKnownNumber(snapshot.longTermDebt) ||
        !isKnownNumber(snapshot.interestBearingDebt) ||
        !isKnownNumber(snapshot.sharesOutstanding) ||
        !isKnownNumber(snapshot.lynchNetCashPerShare) ||
        !isKnownNumber(snapshot.conservativeNetCashPerShare) ||
        !isKnownNumber(snapshot.currentPrice) ||
        snapshot.sharesOutstanding <= 0 ||
        snapshot.currentPrice <= 0
      ) {
        return insufficient(
          snapshot,
          ruleId,
          '缺少现金、长期债务、全部有息负债、股本、双口径每股净现金或当前股价',
        );
      }
      const lynchSupport =
        snapshot.lynchNetCashPerShare / snapshot.currentPrice;
      const conservativeSupport =
        snapshot.conservativeNetCashPerShare / snapshot.currentPrice;
      return result(
        snapshot,
        ruleId,
        snapshot.cash - snapshot.longTermDebt > 0 &&
          snapshot.lynchNetCashPerShare > 0
          ? 1
          : 0,
        `林奇口径/股价=${(lynchSupport * 100).toFixed(1)}%；保守代理口径/股价=${(conservativeSupport * 100).toFixed(1)}%；原文没有统一比例门槛`,
      );

    case 'LYN-13-BALANCE-SHEET':
      if (snapshot.isFinancialCompany)
        return result(
          snapshot,
          ruleId,
          'not_applicable',
          '金融企业不套用普通公司资产负债规则',
        );
      if (
        !isKnownNumber(snapshot.equityRatioPercent) ||
        !isKnownNumber(snapshot.debtRatioPercent)
      ) {
        return insufficient(snapshot, ruleId, '缺少股东权益率或负债率');
      }
      return result(
        snapshot,
        ruleId,
        snapshot.equityRatioPercent >= 70 &&
          snapshot.equityRatioPercent <= 80 &&
          snapshot.debtRatioPercent < 25
          ? 1
          : 0,
        '“约75%”在程序中按70%—80%识别，属于本模型的展示容差，不是林奇新增阈值',
      );

    case 'LYN-13-PAYOUT-SAFETY':
      if (!hasCompanyType(snapshot, ['slow_grower', 'stalwart'])) {
        return result(
          snapshot,
          ruleId,
          'not_applicable',
          '首版仅对缓慢增长型和稳定增长型计分',
        );
      }
      if (
        !snapshot.dividendHistoryComplete ||
        snapshot.dividendMaintainedThroughCycle === undefined
      ) {
        return insufficient(snapshot, ruleId, '缺少完整周期的股息记录');
      }
      return result(
        snapshot,
        ruleId,
        snapshot.dividendMaintainedThroughCycle ? 1 : -1,
      );

    case 'LYN-13-FCF':
      if (snapshot.isFinancialCompany)
        return result(
          snapshot,
          ruleId,
          'not_applicable',
          '金融企业不套用普通公司自由现金流口径',
        );
      if (
        !isKnownNumber(snapshot.freeCashFlow) ||
        snapshot.freeCashFlowTrend == null
      ) {
        return insufficient(snapshot, ruleId, '缺少自由现金流或趋势');
      }
      return result(
        snapshot,
        ruleId,
        snapshot.freeCashFlow > 0 && snapshot.freeCashFlowTrend !== 'worsening'
          ? 1
          : snapshot.freeCashFlow < 0 &&
              snapshot.freeCashFlowTrend === 'worsening'
            ? -1
            : 0,
      );

    case 'LYN-13-INVENTORY-SALES':
      if (
        snapshot.isFinancialCompany ||
        snapshot.hasMaterialInventory === false
      ) {
        return result(
          snapshot,
          ruleId,
          'not_applicable',
          '行业没有可比的重要存货口径',
        );
      }
      if (
        !isKnownNumber(snapshot.inventoryGrowthYoYPercent) ||
        !isKnownNumber(snapshot.revenueGrowthYoYPercent)
      ) {
        return insufficient(snapshot, ruleId, '缺少存货或销售同比增长率');
      }
      return result(
        snapshot,
        ruleId,
        snapshot.inventoryGrowthYoYPercent > snapshot.revenueGrowthYoYPercent
          ? -1
          : 1,
      );

    case 'LYN-13-PRETAX-MARGIN':
      if (snapshot.isFinancialCompany)
        return result(
          snapshot,
          ruleId,
          'not_applicable',
          '首版不对金融企业进行普通行业利润率排名',
        );
      if (
        snapshot.pretaxMarginPeerPosition == null ||
        snapshot.pretaxMarginTrend == null
      ) {
        return insufficient(snapshot, ruleId, '缺少同口径同行或历史利润率');
      }
      return result(
        snapshot,
        ruleId,
        snapshot.pretaxMarginPeerPosition === 'higher' &&
          snapshot.pretaxMarginTrend !== 'worsening'
          ? 1
          : snapshot.pretaxMarginPeerPosition === 'lower' &&
              snapshot.pretaxMarginTrend === 'worsening'
            ? -1
            : 0,
      );

    case 'LYN-15-FAST-GROWTH-PREFERENCE':
      if (!hasCompanyType(snapshot, ['fast_grower']))
        return result(snapshot, ruleId, 'not_applicable', '非快速增长型');
      if (!isKnownNumber(snapshot.earningsCagr5yPercent))
        return insufficient(snapshot, ruleId, '缺少5年收益复合增长率');
      return result(
        snapshot,
        ruleId,
        snapshot.earningsCagr5yPercent >= 20 &&
          snapshot.earningsCagr5yPercent <= 25
          ? 1
          : 0,
        snapshot.earningsCagr5yPercent > 25
          ? '高于25%，显示书中警告但本条不自动扣分'
          : undefined,
      );

    case 'LYN-10-PE-CONTEXT':
      if (
        snapshot.earningsPositive === false ||
        !isKnownNumber(snapshot.peTtm)
      ) {
        return result(
          snapshot,
          ruleId,
          'not_applicable',
          '亏损公司不计算市盈率',
        );
      }
      if (snapshot.peContext == null)
        return insufficient(snapshot, ruleId, '缺少公司历史、类型或同行市盈率');
      return result(
        snapshot,
        ruleId,
        snapshot.peContext === 'low'
          ? 1
          : snapshot.peContext === 'extreme'
            ? -1
            : 0,
        snapshot.peContext === 'mixed'
          ? '已展示当前PE与公司历史区间；原文没有统一数字通过线，本条保持中性'
          : undefined,
      );

    case 'LYN-12-CASH-DEBT-TREND':
      if (snapshot.isFinancialCompany)
        return result(
          snapshot,
          ruleId,
          'not_applicable',
          '金融企业不套用普通公司的现金债务趋势规则',
        );
      if (
        !isKnownNumber(snapshot.cashChange) ||
        !isKnownNumber(snapshot.interestBearingDebtChange)
      ) {
        return insufficient(
          snapshot,
          ruleId,
          '缺少两个可比报告期的现金或有息负债',
        );
      }
      return result(
        snapshot,
        ruleId,
        snapshot.cashChange > 0 && snapshot.interestBearingDebtChange < 0
          ? 1
          : snapshot.cashChange < 0 && snapshot.interestBearingDebtChange > 0
            ? -1
            : 0,
      );

    default:
      throw new Error(`未知程序规则：${ruleId}`);
  }
}

export function evaluateProgramRules(
  snapshot: ProgramMetricSnapshot,
): RuleResult[] {
  return PROGRAM_RULE_IDS.map((ruleId) =>
    evaluateProgramRule(snapshot, ruleId),
  );
}

export function calculateScore(
  results: RuleResult[],
  options: { includeConfirmedAi?: boolean } = {},
): ScoreSummary {
  const includeConfirmedAi = options.includeConfirmedAi ?? false;
  const pendingAiRuleIds = results
    .filter((item) => item.evaluator === 'ai' && !item.userConfirmed)
    .map((item) => item.ruleId);
  const included = results.filter(
    (item) =>
      item.evaluator === 'program' ||
      item.evaluator === 'human' ||
      (includeConfirmedAi && item.evaluator === 'ai' && item.userConfirmed),
  );
  const applicable = included.filter(
    (item) => item.outcome !== 'not_applicable',
  );
  const positiveCount = applicable.filter((item) => item.outcome === 1).length;
  const riskCount = applicable.filter((item) => item.outcome === -1).length;
  const neutralCount = applicable.filter((item) => item.outcome === 0).length;
  const insufficientCount = applicable.filter(
    (item) => item.outcome === 'insufficient',
  ).length;
  const evidencedApplicableCount = applicable.length - insufficientCount;
  const applicableCount = applicable.length;

  return {
    score:
      evidencedApplicableCount === 0
        ? null
        : 50 + (50 * (positiveCount - riskCount)) / evidencedApplicableCount,
    coverage:
      applicableCount === 0 ? null : evidencedApplicableCount / applicableCount,
    positiveCount,
    riskCount,
    neutralCount,
    applicableCount,
    evidencedApplicableCount,
    insufficientCount,
    notApplicableCount: included.length - applicableCount,
    includedRuleIds: included.map((item) => item.ruleId),
    pendingAiRuleIds,
  };
}

export function calculateCagr(
  startValue: number,
  endValue: number,
  years: number,
): number | null {
  if (
    !Number.isFinite(startValue) ||
    !Number.isFinite(endValue) ||
    startValue <= 0 ||
    endValue <= 0 ||
    years <= 0
  ) {
    return null;
  }
  return (Math.pow(endValue / startValue, 1 / years) - 1) * 100;
}

export function trailingTwelveMonths(
  points: MetricPoint[],
  metricId: string,
): number | null {
  const values = points.slice(-4).map((point) => point[metricId]);
  if (
    values.length !== 4 ||
    values.some((value) => typeof value !== 'number' || !Number.isFinite(value))
  ) {
    return null;
  }
  return (values as number[]).reduce((sum, value) => sum + value, 0);
}

export function halfYearTrailingTwelveMonths(
  latestHalf: number | null | undefined,
  priorAnnual: number | null | undefined,
  priorHalf: number | null | undefined,
): number | null {
  if (
    !isKnownNumber(latestHalf) ||
    !isKnownNumber(priorAnnual) ||
    !isKnownNumber(priorHalf)
  ) {
    return null;
  }
  return latestHalf + priorAnnual - priorHalf;
}

function quarterOf(period: string): { year: string; quarter: number } | null {
  const named = period.match(/^(\d{4})[-/]?Q([1-4])$/i);
  if (named) return { year: named[1], quarter: Number(named[2]) };
  const dated = period.match(/^(\d{4})-(03-31|06-30|09-30|12-31)$/);
  if (!dated) return null;
  const quarterByDate: Record<string, number> = {
    '03-31': 1,
    '06-30': 2,
    '09-30': 3,
    '12-31': 4,
  };
  return { year: dated[1], quarter: quarterByDate[dated[2]] };
}

export function cumulativeToSingleQuarter(
  cumulativePoints: MetricPoint[],
  additiveMetricIds: string[],
): MetricPoint[] {
  const sorted = [...cumulativePoints].sort((a, b) =>
    a.period.localeCompare(b.period),
  );
  const priorByYear = new Map<string, MetricPoint>();

  return sorted.map((point) => {
    const parsed = quarterOf(point.period);
    if (!parsed) return { ...point };
    const prior = priorByYear.get(parsed.year);
    const single: MetricPoint = { ...point };
    for (const metricId of additiveMetricIds) {
      const currentValue = point[metricId];
      if (typeof currentValue !== 'number') continue;
      if (parsed.quarter === 1) {
        single[metricId] = currentValue;
        continue;
      }
      const priorValue = prior?.[metricId];
      single[metricId] =
        typeof priorValue === 'number' ? currentValue - priorValue : undefined;
    }
    priorByYear.set(parsed.year, point);
    return single;
  });
}

export function classifyFinancialCompany(industry: string): boolean {
  return /(银行|保险|证券|券商|多元金融|信托|期货)/.test(industry);
}

export function isRankEligible(
  isFinancialCompany: boolean,
  companyType: CompanyType,
): boolean {
  return !isFinancialCompany && companyType !== 'unclassified';
}
