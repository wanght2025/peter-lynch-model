import type {
  ReportKind,
  ReportingPolicy,
  SecurityIdentity,
  SecurityMarket,
} from '@/lib/analysis-types';

export type OfficialFiling = {
  id: string;
  code: string;
  companyName: string;
  title: string;
  date: string;
  fileType: string;
  url: string;
  extractionUrl?: string;
  extractionTitle?: string;
  sourceName: string;
  reportKind: ReportKind;
  fiscalYear?: number;
  language: 'zh' | 'en' | 'bilingual' | 'unknown';
  isCorrection: boolean;
  isSummary: boolean;
};

export type OfficialLookup = {
  company: SecurityIdentity;
  reports: OfficialFiling[];
  coverage: {
    annual: number;
    halfYear: number;
    quarterly: number;
    oldestDate?: string;
    newestDate?: string;
  };
  reportingPolicy: ReportingPolicy;
  source: { name: string; url: string; retrievedAt: string };
  warnings: string[];
};

/** Raised only when the upstream source confirms that a security does not exist. */
export class SecurityNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecurityNotFoundError';
  }
}

export function normalizeSecurityCode(input: unknown): {
  market: SecurityMarket;
  code: string;
} | null {
  if (typeof input !== 'string' && typeof input !== 'number') return null;
  const text = input.toString().trim().toUpperCase();
  const prefix = text.match(/^(SH|SZ|BJ|HK)[:.\s-]*/)?.[1];
  const suffix = text.match(/\.(HK|SH|SZ|BJ)$/)?.[1];
  if (prefix && suffix && prefix !== suffix) return null;
  const marketHint = prefix ?? suffix;
  const cleaned = text
    .replace(/^(SH|SZ|BJ|HK)[:.\s-]*/, '')
    .replace(/\.(HK|SH|SZ|BJ)$/, '');
  if (!/^\d+$/.test(cleaned)) return null;
  // Canonical identity: market + five-digit HK code; provider prefixes stay
  // in the provider adapters. Six-digit zero-padded HK input is accepted.
  if (
    marketHint === 'HK' ||
    (!marketHint && /^0(?:0[4-9]|[1-9]\d)\d{3}$/.test(cleaned))
  ) {
    if (
      !/^\d{1,6}$/.test(cleaned) ||
      Number(cleaned) < 1 ||
      Number(cleaned) > 99999
    )
      return null;
    return { market: 'HK', code: String(Number(cleaned)).padStart(5, '0') };
  }
  if (!marketHint && /^\d{1,5}$/.test(cleaned) && Number(cleaned) > 0)
    return { market: 'HK', code: cleaned.padStart(5, '0') };
  if (/^\d{6}$/.test(cleaned)) return { market: 'A_SHARE', code: cleaned };
  return null;
}

export function reportingPolicyFor(market: SecurityMarket): ReportingPolicy {
  if (market === 'HK') {
    return {
      annualTarget: 10,
      quarterlyTarget: 0,
      halfYearTarget: 10,
      quarterlyAvailability: 'actual_only',
      ttmMethod: 'latest_half_plus_prior_annual_minus_prior_half',
      note: '港股使用10个完整年度；有连续可比季度时按季度，否则按实际披露的半年期。',
    };
  }
  return {
    annualTarget: 10,
    quarterlyTarget: 12,
    halfYearTarget: 0,
    quarterlyAvailability: 'required',
    ttmMethod: 'four_single_quarters',
    note: 'A股使用10个完整年度和最近12个单季度；累计数据须先还原为单季度。',
  };
}

export function filingCoverage(reports: OfficialFiling[]) {
  const dates = reports
    .map((report) => report.date)
    .filter(Boolean)
    .sort();
  return {
    annual: reports.filter((report) => report.reportKind === 'annual').length,
    halfYear: reports.filter((report) => report.reportKind === 'half_year')
      .length,
    quarterly: reports.filter((report) =>
      ['q1', 'q3', 'quarterly'].includes(report.reportKind),
    ).length,
    oldestDate: dates.at(0),
    newestDate: dates.at(-1),
  };
}

export function financialCompanyByName(name: string) {
  return /(银行|銀行|保险|保險|证券|證券|信托|信託|期货|期貨|BANK|INSURANCE|SECURITIES)/i.test(
    name,
  );
}
