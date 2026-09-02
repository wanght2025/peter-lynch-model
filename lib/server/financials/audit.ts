import type { MetricPoint, ReportReference } from '@/lib/analysis-types';

const FINANCIAL_METRICS = [
  'revenue',
  'netProfit',
  'eps',
  'cash',
  'inventory',
  'interestBearingDebt',
  'operatingCashFlow',
  'capitalExpenditure',
] as const;

function closeEnough(actual: number, expected: number) {
  return Math.abs(actual - expected) <= Math.max(1, Math.abs(expected) * 1e-10);
}

export function auditAnnualData(
  annual: MetricPoint[],
  reportRefs: ReportReference[],
) {
  const errors: string[] = [];
  const warnings: string[] = [];
  const knownReports = new Set(reportRefs.map((report) => report.id));
  let financialValuesChecked = 0;
  let priceValuesChecked = 0;
  let derivedFormulasChecked = 0;
  let sourceLinksChecked = 0;

  for (let index = 0; index < annual.length; index += 1) {
    const point = annual[index];
    const year = Number(point.period.slice(0, 4));
    if (!Number.isInteger(year)) errors.push(`${point.period}不是有效财务年度`);
    if (index > 0 && year !== Number(annual[index - 1].period) + 1)
      warnings.push(`${annual[index - 1].period}至${point.period}年度不连续`);
    if (point.reportRefIds.some((id) => !knownReports.has(id)))
      errors.push(`${point.period}引用了不存在的年报`);

    for (const metric of FINANCIAL_METRICS) {
      const value = point[metric];
      const source = point.metricSources?.[metric];
      if (value === undefined) {
        warnings.push(`${point.period}缺少${metric}，相关图表与规则保持空白`);
        continue;
      }
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        errors.push(`${point.period}的${metric}不是有效数字`);
        continue;
      }
      financialValuesChecked += 1;
      if (!source?.page || !source.label || !source.unit)
        errors.push(`${point.period}的${metric}缺少财报页码、标签或单位`);
      else sourceLinksChecked += 1;
    }

    if (typeof point.adjustedPrice === 'number') {
      priceValuesChecked += 1;
      const source = point.metricSources?.adjustedPrice;
      if (
        point.adjustedPrice <= 0 ||
        !source?.date?.startsWith(String(year)) ||
        !source.sourceUrl
      )
        errors.push(`${point.period}的年末股价缺少正确日期或行情来源`);
      else sourceLinksChecked += 1;
    }

    if (
      typeof point.cash === 'number' &&
      typeof point.longTermDebt === 'number'
    ) {
      const expected = point.cash - point.longTermDebt;
      if (
        typeof point.lynchNetCash !== 'number' ||
        !closeEnough(point.lynchNetCash, expected)
      )
        errors.push(`${point.period}的林奇口径净现金公式不一致`);
      else derivedFormulasChecked += 1;
    }
    if (
      typeof point.cash === 'number' &&
      typeof point.interestBearingDebt === 'number'
    ) {
      const expected = point.cash - point.interestBearingDebt;
      if (
        typeof point.conservativeNetCash !== 'number' ||
        !closeEnough(point.conservativeNetCash, expected) ||
        typeof point.netCash !== 'number' ||
        !closeEnough(point.netCash, expected)
      )
        errors.push(`${point.period}的保守代理净现金公式不一致`);
      else derivedFormulasChecked += 1;
    }
    if (
      typeof point.operatingCashFlow === 'number' &&
      typeof point.capitalExpenditure === 'number'
    ) {
      const expected = point.operatingCashFlow - point.capitalExpenditure;
      if (
        typeof point.freeCashFlow !== 'number' ||
        !closeEnough(point.freeCashFlow, expected)
      )
        errors.push(`${point.period}的自由现金流代理值公式不一致`);
      else derivedFormulasChecked += 1;
    }

    const priorCash = annual[index - 1]?.cash;
    if (
      typeof priorCash === 'number' &&
      priorCash > 0 &&
      typeof point.cash === 'number' &&
      (point.cash / priorCash < 0.25 || point.cash / priorCash > 4)
    )
      warnings.push(
        `${point.period}现金及现金等价物同比变化超过75%，需结合会计分类和附注复核，不能直接当经营拐点。`,
      );
  }

  if (errors.length)
    throw new Error(`数据一致性校验未通过：${errors.join('；')}`);
  return {
    warnings,
    summary: {
      financialValuesChecked,
      priceValuesChecked,
      derivedFormulasChecked,
      sourceLinksChecked,
    },
  };
}
