import type {
  AnalysisDataset,
  MetricPoint,
} from '@/lib/analysis-types';

export const ANNUAL_CALCULATION_LIMIT = 11;
export const QUARTERLY_DISPLAY_LIMIT = 12;
export const HALF_YEAR_DISPLAY_LIMIT = 10;

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
