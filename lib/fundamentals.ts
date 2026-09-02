import type { AnalysisDataset, ProgramAnalysis } from '@/lib/analysis-types';
import type { OfficialLookup } from '@/lib/official-filings';

export type FundamentalsExtractionStatus = {
  reportId: string;
  fiscalYear?: number;
  title: string;
  status: 'parsed' | 'failed';
  warning?: string;
};

export type FundamentalsResponse = {
  lookup: OfficialLookup;
  dataset: AnalysisDataset | null;
  analysis: ProgramAnalysis | null;
  extraction: {
    requestedReports: number;
    parsedReports: number;
    annualYears: number;
    quarterlyPeriods: number;
    halfYearPeriods: number;
    latestReportPeriod?: string;
    complete: boolean;
    audit: {
      financialValuesChecked: number;
      priceValuesChecked: number;
      derivedFormulasChecked: number;
      sourceLinksChecked: number;
    };
    warnings: string[];
    reports: FundamentalsExtractionStatus[];
  };
};
