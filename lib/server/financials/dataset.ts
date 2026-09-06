import type {
  AnalysisDataset,
  MetricPoint,
  MetricSource,
  ReportReference,
} from '@/lib/analysis-types';
import type { FundamentalsResponse } from '@/lib/fundamentals';
import type { OfficialFiling, OfficialLookup } from '@/lib/official-filings';
import {
  extractAnnualReport,
  extractFinancialReport,
} from '@/lib/server/financials/annual-report';
import { auditAnnualData } from '@/lib/server/financials/audit';
import { buildProgramAnalysis } from '@/lib/server/analysis/program-analysis';
import {
  attachAnnualPrices,
  fetchCurrentMarket,
} from '@/lib/server/market-data/annual-prices';

const MAX_PDF_BYTES = 30 * 1024 * 1024;
const ADDITIVE_METRICS = [
  'revenue',
  'netProfit',
  'grossProfit',
  'operatingProfit',
  'pretaxProfit',
  'operatingCashFlow',
  'capitalExpenditure',
  'freeCashFlow',
] as const;
const POINT_IN_TIME_METRICS = [
  'cash',
  'shortTermBorrowings',
  'currentPortionNonCurrentLiabilities',
  'longTermBorrowings',
  'bondsPayable',
  'currentLeaseLiabilities',
  'nonCurrentLeaseLiabilities',
  'unclassifiedLeaseLiabilities',
  'leaseLiabilities',
  'unclassifiedBorrowings',
  'longTermDebt',
  'interestBearingDebt',
  'lynchNetCash',
  'lynchNetCashPerShare',
  'conservativeNetCash',
  'conservativeNetCashPerShare',
  'netCash',
  'netCashPerShare',
  'inventory',
  'tradeReceivables',
  'tradePayables',
  'sharesOutstanding',
  'totalAssets',
  'totalLiabilities',
  'shareholdersEquity',
  'equityRatio',
  'debtRatio',
] as const;

type Download = {
  report: OfficialFiling;
  bytes: Uint8Array | null;
  error: string | null;
};

function selectAnnualPairs(reports: OfficialFiling[], includeBoundary = false) {
  const coveredYears = new Set<number>();
  const selected: OfficialFiling[] = [];
  for (const report of reports
    .filter((item) => item.reportKind === 'annual' && item.fiscalYear)
    .sort((a, b) => (b.fiscalYear ?? 0) - (a.fiscalYear ?? 0))) {
    const year = report.fiscalYear as number;
    if (coveredYears.has(year) || coveredYears.has(year - 1)) continue;
    selected.push(report);
    coveredYears.add(year);
    coveredYears.add(year - 1);
    if (selected.length === 5) break;
  }
  if (includeBoundary && selected.length < 5) {
    for (const report of reports.filter(
      (item) => item.reportKind === 'annual' && item.fiscalYear,
    )) {
      const year = report.fiscalYear!;
      if (coveredYears.has(year) && coveredYears.has(year - 1)) continue;
      selected.push(report);
      coveredYears.add(year);
      coveredYears.add(year - 1);
      if (selected.length === 5) break;
    }
  }
  return selected;
}

function selectInterimReports(lookup: OfficialLookup) {
  const reports = lookup.reports
    .filter(
      (report) =>
        report.fiscalYear &&
        (lookup.company.market === 'HK'
          ? ['q1', 'half_year', 'q3', 'quarterly'].includes(report.reportKind)
          : ['q1', 'half_year', 'q3'].includes(report.reportKind)),
    )
    .sort((a, b) => (b.fiscalYear ?? 0) - (a.fiscalYear ?? 0));

  if (lookup.company.market === 'A_SHARE') {
    return ['q1', 'half_year', 'q3'].flatMap((reportKind) => {
      const coveredYears = new Set<number>();
      return reports
        .filter((report) => report.reportKind === reportKind)
        .filter((report) => {
          const year = report.fiscalYear as number;
          if (coveredYears.has(year) || coveredYears.has(year - 1))
            return false;
          coveredYears.add(year);
          coveredYears.add(year - 1);
          return coveredYears.size <= 4;
        });
    });
  }

  // Use quarterly filings when there are enough inputs to reconstruct
  // consecutive single quarters; retain half-year filings as the fallback
  // and for balance-sheet comparison.
  const quarterly = reports.filter((report) =>
    ['q1', 'q3', 'quarterly'].includes(report.reportKind),
  );
  const halfYear = reports.filter(
    (report) => report.reportKind === 'half_year',
  );
  return [...quarterly.slice(0, 12), ...halfYear.slice(0, 10)];
}

function latestReport(reports: OfficialFiling[]) {
  return [...reports].sort((a, b) => {
    const dateDifference = Date.parse(b.date) - Date.parse(a.date);
    if (Number.isFinite(dateDifference) && dateDifference !== 0)
      return dateDifference;
    return (b.fiscalYear ?? 0) - (a.fiscalYear ?? 0);
  })[0];
}

async function sha256(bytes: Uint8Array) {
  const data = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

async function fetchPdfOnce(report: OfficialFiling) {
  const maxBytes = /^\d{5}$/.test(report.code)
    ? 40 * 1024 * 1024
    : MAX_PDF_BYTES;
  const url = report.extractionUrl ?? report.url;
  const response = await fetch(url, {
    headers: {
      Accept: 'application/pdf,*/*;q=0.8',
      Referer:
        report.sourceName === '香港交易所披露易'
          ? 'https://www1.hkexnews.hk/'
          : 'https://www.cninfo.com.cn/',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
    },
    signal: AbortSignal.timeout(90_000),
  });
  if (!response.ok) throw new Error(`PDF下载失败：${response.status}`);
  const declaredSize = Number(response.headers.get('content-length'));
  if (declaredSize > maxBytes)
    throw new Error(`PDF超过${maxBytes / 1024 / 1024}MB安全上限`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maxBytes)
    throw new Error(`PDF超过${maxBytes / 1024 / 1024}MB安全上限`);
  if (new TextDecoder().decode(bytes.slice(0, 4)) !== '%PDF')
    throw new Error('官方链接没有返回PDF文件');
  return bytes;
}

async function fetchPdf(report: OfficialFiling) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await fetchPdfOnce(report);
    } catch (error) {
      lastError = error;
      if (attempt < 2)
        await new Promise((resolve) =>
          setTimeout(resolve, 750 * (attempt + 1)),
        );
    }
  }
  throw lastError;
}

async function downloadReports(reports: OfficialFiling[], batchSize: number) {
  const downloads: Download[] = [];
  for (let index = 0; index < reports.length; index += batchSize) {
    const batch = await Promise.all(
      reports.slice(index, index + batchSize).map(async (report) => {
        try {
          return { report, bytes: await fetchPdf(report), error: null };
        } catch (error) {
          return {
            report,
            bytes: null,
            error: error instanceof Error ? error.message : 'PDF下载失败',
          };
        }
      }),
    );
    downloads.push(...batch);
  }
  return downloads;
}

function reportReference(
  lookup: OfficialLookup,
  report: OfficialFiling,
  fileSha256: string,
): ReportReference {
  return {
    id: report.id,
    companyCode: lookup.company.code,
    companyName: lookup.company.companyName,
    reportDate: report.date,
    reportKind: report.reportKind,
    title: report.extractionTitle ?? report.title,
    sourceName: report.sourceName,
    sourceUrl: report.extractionUrl ?? report.url,
    fileSha256,
    importedAt: new Date().toISOString(),
    market: lookup.company.market,
    language: report.extractionUrl ? 'en' : report.language,
    fiscalYear: report.fiscalYear,
  };
}

function hasFinancialData(point: MetricPoint) {
  return [
    point.revenue,
    point.netProfit,
    point.eps,
    point.cash,
    point.interestBearingDebt,
    point.operatingCashFlow,
    point.capitalExpenditure,
  ].some((value) => typeof value === 'number');
}

function mergeReportIds(...points: Array<MetricPoint | undefined>) {
  return [...new Set(points.flatMap((point) => point?.reportRefIds ?? []))];
}

function calculatedSource(
  label: string,
  formula: string,
  ...sources: Array<MetricSource | undefined>
): MetricSource {
  const pages = [
    ...new Set(
      sources.flatMap(
        (source) => source?.pages ?? (source?.page ? [source.page] : []),
      ),
    ),
  ];
  return {
    page: pages[0],
    pages,
    label,
    unit: sources.find(Boolean)?.unit ?? '原报表单位',
    formula,
  };
}

function subtractPeriod(
  period: string,
  current: MetricPoint,
  previous: MetricPoint,
): MetricPoint {
  const point: MetricPoint = {
    period,
    reportRefIds: mergeReportIds(current, previous),
    metricSources: {},
  };
  for (const metric of ADDITIVE_METRICS) {
    const currentValue = current[metric];
    const previousValue = previous[metric];
    if (typeof currentValue !== 'number' || typeof previousValue !== 'number')
      continue;
    point[metric] = currentValue - previousValue;
    point.metricSources![metric] = calculatedSource(
      '累计值还原单季度',
      `${current.period}累计值－${previous.period}累计值`,
      current.metricSources?.[metric],
      previous.metricSources?.[metric],
    );
  }
  for (const metric of POINT_IN_TIME_METRICS) {
    const value = current[metric];
    if (typeof value === 'number') point[metric] = value;
    if (current.metricSources?.[metric])
      point.metricSources![metric] = current.metricSources[metric];
  }
  return point;
}

function toAShareSingleQuarters(
  annual: MetricPoint[],
  cumulative: MetricPoint[],
) {
  const byPeriod = new Map(cumulative.map((point) => [point.period, point]));
  const annualByYear = new Map(annual.map((point) => [point.period, point]));
  const years = new Set(
    cumulative
      .map((point) => Number(point.period.slice(0, 4)))
      .filter(Number.isFinite),
  );
  const quarters: MetricPoint[] = [];
  for (const year of [...years].sort((a, b) => a - b)) {
    const q1 = byPeriod.get(`${year}Q1`);
    const half = byPeriod.get(`${year}H1`);
    const q3 = byPeriod.get(`${year}Q3`);
    const full = annualByYear.get(String(year));
    if (q1) quarters.push({ ...q1, period: `${year}Q1` });
    if (half && q1) quarters.push(subtractPeriod(`${year}Q2`, half, q1));
    if (q3 && half) quarters.push(subtractPeriod(`${year}Q3`, q3, half));
    if (full && q3) quarters.push(subtractPeriod(`${year}Q4`, full, q3));
  }
  return quarters.sort((a, b) => a.period.localeCompare(b.period)).slice(-12);
}

function hasConsecutiveQuarters(points: MetricPoint[]) {
  const index = (period: string) => {
    const match = period.match(/^(\d{4})Q([1-4])$/);
    return match ? Number(match[1]) * 4 + Number(match[2]) : null;
  };
  return points.some((point, position) => {
    const current = index(point.period);
    const next = index(points[position + 1]?.period ?? '');
    return current !== null && next === current + 1;
  });
}

function sumTtm(period: string, points: MetricPoint[], balance: MetricPoint) {
  const result: MetricPoint = {
    period: `${period} TTM`,
    reportRefIds: mergeReportIds(...points, balance),
    metricSources: {},
    isTtm: 1,
  };
  for (const metric of ADDITIVE_METRICS) {
    const values = points.map((point) => point[metric]);
    if (values.length && values.every((value) => typeof value === 'number')) {
      result[metric] = (values as number[]).reduce(
        (sum, value) => sum + value,
        0,
      );
      result.metricSources![metric] = calculatedSource(
        '滚动十二个月',
        points.map((point) => point.period).join('＋'),
        ...points.map((point) => point.metricSources?.[metric]),
      );
    }
  }
  for (const metric of POINT_IN_TIME_METRICS) {
    const value = balance[metric];
    if (typeof value === 'number') result[metric] = value;
    if (balance.metricSources?.[metric])
      result.metricSources![metric] = balance.metricSources[metric];
  }
  return result;
}

function latestAShareComparable(quarters: MetricPoint[]) {
  if (quarters.length < 4) return undefined;
  const latestFour = quarters.slice(-4);
  return sumTtm(latestFour.at(-1)!.period, latestFour, latestFour.at(-1)!);
}

function latestHkComparable(annual: MetricPoint[], halfYear: MetricPoint[]) {
  const latest = halfYear.at(-1);
  const latestAnnual = annual.at(-1);
  if (!latest) return undefined;
  const year = Number(latest.period.slice(0, 4));
  if (Number(latestAnnual?.period) >= year) return undefined;
  const priorAnnual = annual.find((point) => point.period === String(year - 1));
  const priorHalf = halfYear.find((point) => point.period === `${year - 1}H1`);
  if (!priorAnnual || !priorHalf) return undefined;
  const result: MetricPoint = {
    period: `${latest.period} TTM`,
    reportRefIds: mergeReportIds(latest, priorAnnual, priorHalf),
    metricSources: {},
    isTtm: 1,
  };
  for (const metric of ADDITIVE_METRICS) {
    const a = latest[metric];
    const b = priorAnnual[metric];
    const c = priorHalf[metric];
    if (
      typeof a === 'number' &&
      typeof b === 'number' &&
      typeof c === 'number'
    ) {
      result[metric] = a + b - c;
      result.metricSources![metric] = calculatedSource(
        '港股滚动十二个月',
        `${latest.period}＋${priorAnnual.period}－${priorHalf.period}`,
        latest.metricSources?.[metric],
        priorAnnual.metricSources?.[metric],
        priorHalf.metricSources?.[metric],
      );
    }
  }
  for (const metric of POINT_IN_TIME_METRICS) {
    const value = latest[metric];
    if (typeof value === 'number') result[metric] = value;
    if (latest.metricSources?.[metric])
      result.metricSources![metric] = latest.metricSources[metric];
  }
  return result;
}

export async function buildAnnualDataset(
  lookup: OfficialLookup,
): Promise<FundamentalsResponse> {
  const annualReports = selectAnnualPairs(
    lookup.reports,
    lookup.company.market === 'HK',
  );
  const interimReports = selectInterimReports(lookup);
  const selected = [...annualReports, ...interimReports];
  const narrativeReportIds = new Set(
    [latestReport(annualReports), latestReport(interimReports)]
      .filter((report): report is OfficialFiling => Boolean(report))
      .map((report) => report.id),
  );
  const downloads = await downloadReports(selected, 2);
  const annualPoints = new Map<string, MetricPoint>();
  const interimPoints = new Map<string, MetricPoint>();
  const reportRefs: ReportReference[] = [];
  const statuses: FundamentalsResponse['extraction']['reports'] = [];
  const warnings: string[] = [];
  const currencies: string[] = [];
  const narrativeEvidence = [] as NonNullable<AnalysisDataset['narrativeEvidence']>;

  for (const download of downloads) {
    if (!download.bytes) {
      statuses.push({
        reportId: download.report.id,
        fiscalYear: download.report.fiscalYear,
        title: download.report.title,
        status: 'failed',
        warning: download.error ?? 'PDF下载失败',
      });
      warnings.push(`${download.report.title}：${download.error}`);
      continue;
    }
    try {
      const hash = await sha256(download.bytes);
      const extraction =
        download.report.reportKind === 'annual'
          ? await extractAnnualReport(download.bytes, download.report, {
              includeNarrative: narrativeReportIds.has(download.report.id),
            })
          : await extractFinancialReport(download.bytes, download.report, {
              includeNarrative: narrativeReportIds.has(download.report.id),
            });
      currencies.push(extraction.financialCurrency);
      reportRefs.push(reportReference(lookup, download.report, hash));
      narrativeEvidence.push(...(extraction.narrativeEvidence ?? []));
      const targetPoints =
        download.report.reportKind === 'annual' ? annualPoints : interimPoints;
      for (const point of extraction.points.filter(hasFinancialData)) {
        const existing = targetPoints.get(point.period);
        if (!existing) {
          targetPoints.set(point.period, point);
          continue;
        }
        // Prefer newer comparative/restated flows, filling only missing fields
        // from the report for this exact period (especially interim balances).
        for (const [key, value] of Object.entries(point)) {
          if (typeof value !== 'number' || typeof existing[key] === 'number')
            continue;
          existing[key] = value;
          existing.reportRefIds = mergeReportIds(existing, point);
          if (point.metricSources?.[key]) {
            existing.metricSources ??= {};
            existing.metricSources[key] = point.metricSources[key];
          }
        }
      }
      warnings.push(
        ...extraction.warnings.map(
          (item) => `${download.report.title}：${item}`,
        ),
      );
      statuses.push({
        reportId: download.report.id,
        fiscalYear: download.report.fiscalYear,
        title: download.report.title,
        status: 'parsed',
        warning: extraction.warnings.join('；') || undefined,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : '定期报告抽取失败';
      statuses.push({
        reportId: download.report.id,
        fiscalYear: download.report.fiscalYear,
        title: download.report.title,
        status: 'failed',
        warning: message,
      });
      warnings.push(`${download.report.title}：${message}`);
    }
  }

  const annual = [...annualPoints.values()].sort((a, b) =>
    a.period.localeCompare(b.period),
  );
  const cumulativeInterim = [...interimPoints.values()].sort((a, b) =>
    a.period.localeCompare(b.period),
  );
  const reconstructedQuarters = toAShareSingleQuarters(
    annual,
    cumulativeInterim,
  );
  const halfYear = cumulativeInterim
    .filter((point) => point.period.includes('H1'))
    .slice(-10);
  const quarterly =
    lookup.company.market === 'A_SHARE'
      ? reconstructedQuarters
      : hasConsecutiveQuarters(reconstructedQuarters)
        ? reconstructedQuarters
        : [];
  const latestComparablePoint =
    lookup.company.market === 'HK'
      ? latestHkComparable(annual, halfYear)
      : latestAShareComparable(quarterly);

  let priceResult: Awaited<ReturnType<typeof attachAnnualPrices>> = {
    priceSource: undefined,
    priceAdjustment: 'none',
    priceDate: '',
    warnings: [],
  };
  let currentMarket: AnalysisDataset['currentMarket'];
  if (annual.length) {
    const marketResults = await Promise.allSettled([
      fetchCurrentMarket(lookup.company),
      attachAnnualPrices(
        lookup.company,
        annual,
        halfYear,
        currencies[0] === 'CNY' || currencies[0] === 'HKD'
          ? currencies[0]
          : lookup.company.currency,
      ),
    ]);
    if (marketResults[0].status === 'fulfilled')
      currentMarket = marketResults[0].value;
    else {
      warnings.push(
        `当前行情获取失败：${marketResults[0].reason instanceof Error ? marketResults[0].reason.message : '未知错误'}`,
      );
    }
    if (marketResults[1].status === 'fulfilled')
      priceResult = marketResults[1].value;
    else {
      warnings.push(
        `历史行情获取失败：${marketResults[1].reason instanceof Error ? marketResults[1].reason.message : '未知错误'}`,
      );
    }
    warnings.push(...priceResult.warnings);
  }

  const latestReportPoint =
    lookup.company.market === 'HK' && quarterly.length >= 2
      ? quarterly.at(-1)
      : latestComparablePoint;
  const latestReportPeriod =
    latestReportPoint?.period.replace(/ TTM$/, '') ?? annual.at(-1)?.period;
  const dataset: AnalysisDataset | null = annual.length
    ? {
        security: lookup.company,
        companyCode: lookup.company.code,
        companyName: lookup.company.companyName,
        companyType: 'unclassified',
        companyTypes: [],
        industry: '',
        isFinancialCompany: lookup.company.isFinancialCompany,
        currency: currencies[0] ?? lookup.company.currency,
        annual,
        halfYear,
        quarterly,
        reportingPolicy: lookup.reportingPolicy,
        priceDate: currentMarket?.date ?? priceResult.priceDate,
        priceAdjustment: priceResult.priceAdjustment,
        priceSource: priceResult.priceSource,
        currentMarket,
        latestReportPeriod,
        latestComparablePoint,
        reportRefs,
        narrativeEvidence: narrativeEvidence.length
          ? narrativeEvidence
          : undefined,
        ruleVersion: 'rules.verified.v1',
        metricVersion: 'official-periodic-pdf-market.v6',
        generatedAt: new Date().toISOString(),
      }
    : null;

  const audit = auditAnnualData(annual, reportRefs, [...halfYear, ...quarterly]);
  warnings.push(...audit.warnings);
  const latestBalancePoint = latestComparablePoint ?? annual.at(-1);
  if (/货币资金/.test(latestBalancePoint?.metricSources?.cash?.label ?? ''))
    warnings.push(
      '保守净现金的现金端取自“货币资金”；未取得受限资金附注明细时，该结果仍是代理值。',
    );
  if (
    typeof latestBalancePoint?.currentPortionNonCurrentLiabilities ===
      'number' &&
    typeof latestBalancePoint?.leaseLiabilities === 'number'
  )
    warnings.push(
      '最新报告同时列示一年内到期的非流动负债与租赁负债；当前分别按流动和非流动部分处理，仍应结合债务附注复核。',
    );
  if (
    (typeof latestBalancePoint?.unclassifiedBorrowings === 'number' ||
      typeof latestBalancePoint?.unclassifiedLeaseLiabilities === 'number') &&
    typeof latestBalancePoint.longTermDebt !== 'number'
  )
    warnings.push(
      '最新报告存在无法区分流动/非流动的借款或租赁负债，林奇口径保持缺失，保守代理口径仍可计算。',
    );
  const annualComplete = annual.length >= 10;
  const interimComplete =
    lookup.company.market === 'HK'
      ? halfYear.length >= 10
      : quarterly.length >= 12;
  if (!annualComplete)
    warnings.push(`目前只抽取到${annual.length}个年度，不进入正式评分。`);
  if (!interimComplete)
    warnings.push(
      lookup.company.market === 'HK'
        ? `目前只抽取到${halfYear.length}个半年期。`
        : `目前只还原出${quarterly.length}个单季度。`,
    );
  return {
    lookup,
    dataset,
    analysis: dataset ? buildProgramAnalysis(dataset) : null,
    extraction: {
      requestedReports: selected.length,
      parsedReports: statuses.filter((item) => item.status === 'parsed').length,
      annualYears: annual.length,
      quarterlyPeriods: quarterly.length,
      halfYearPeriods: halfYear.length,
      latestReportPeriod,
      complete: annualComplete && interimComplete,
      audit: audit.summary,
      warnings: [...new Set(warnings)],
      reports: statuses,
    },
  };
}
