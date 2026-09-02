import type {
  AnalysisDataset,
  MetricPoint,
  ReportReference,
} from '@/lib/analysis-types';

export const ANNUAL_DISPLAY_LIMIT = 10;
export const ANNUAL_CALCULATION_LIMIT = 11;
export const QUARTERLY_DISPLAY_LIMIT = 12;
export const HALF_YEAR_DISPLAY_LIMIT = 10;

export function activeReportReferences(
  reportRefs: ReportReference[],
): ReportReference[] {
  const supersededIds = new Set(
    reportRefs.flatMap((report) =>
      report.correctedFromId ? [report.correctedFromId] : [],
    ),
  );
  return reportRefs.filter(
    (report) => !report.supersededById && !supersededIds.has(report.id),
  );
}

function sortAndLimit(points: MetricPoint[], limit: number) {
  return [...points]
    .sort((a, b) => a.period.localeCompare(b.period))
    .slice(-limit);
}

export function applyDatasetWindow(dataset: AnalysisDataset): AnalysisDataset {
  return {
    ...dataset,
    annual: sortAndLimit(dataset.annual, ANNUAL_CALCULATION_LIMIT),
    halfYear: sortAndLimit(dataset.halfYear ?? [], HALF_YEAR_DISPLAY_LIMIT),
    quarterly: sortAndLimit(dataset.quarterly, QUARTERLY_DISPLAY_LIMIT),
  };
}

export function analysisVersionKey(dataset: AnalysisDataset) {
  const activeHashes = activeReportReferences(dataset.reportRefs)
    .map((report) => report.fileSha256)
    .sort()
    .join(':');
  return [
    dataset.companyCode,
    dataset.priceDate,
    dataset.priceAdjustment,
    dataset.ruleVersion,
    dataset.metricVersion,
    activeHashes,
  ].join('|');
}

export function assertTraceableDataset(dataset: AnalysisDataset) {
  const knownRefs = new Set(dataset.reportRefs.map((report) => report.id));
  for (const point of [
    ...dataset.annual,
    ...(dataset.halfYear ?? []),
    ...dataset.quarterly,
  ]) {
    if (!point.reportRefIds.length)
      throw new Error(`${point.period} 缺少报告来源`);
    for (const reportId of point.reportRefIds) {
      if (!knownRefs.has(reportId))
        throw new Error(`${point.period} 引用了不存在的报告：${reportId}`);
    }
  }
}
