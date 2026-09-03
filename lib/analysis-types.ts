export type RuleOutcome = 1 | 0 | -1 | 'not_applicable' | 'insufficient';
export type RuleEvaluator = 'program' | 'ai' | 'human';
export type CompanyType =
  | 'slow_grower'
  | 'stalwart'
  | 'fast_grower'
  | 'cyclical'
  | 'turnaround'
  | 'asset_play'
  | 'unclassified';

export type SecurityMarket = 'A_SHARE' | 'HK';
export type SecurityExchange = 'SSE' | 'SZSE' | 'BSE' | 'HKEX';
export type ReportKind = 'annual' | 'q1' | 'half_year' | 'q3' | 'quarterly';

export type SecurityIdentity = {
  market: SecurityMarket;
  exchange: SecurityExchange;
  code: string;
  displayCode: string;
  companyName: string;
  companyNameEn?: string;
  issuerId: string;
  currency: 'CNY' | 'HKD';
  ahPairCode?: string;
  isFinancialCompany: boolean;
  rankEligible: boolean;
};

export type ReportingPolicy = {
  annualTarget: 10;
  quarterlyTarget: 12 | 0;
  halfYearTarget: 10 | 0;
  quarterlyAvailability: 'required' | 'actual_only';
  ttmMethod:
    | 'four_single_quarters'
    | 'latest_half_plus_prior_annual_minus_prior_half';
  note: string;
};

export type ReportReference = {
  id: string;
  companyCode: string;
  companyName: string;
  reportDate: string;
  reportKind: ReportKind;
  title: string;
  sourceName: string;
  sourceUrl?: string;
  fileName?: string;
  fileSha256: string;
  correctedFromId?: string;
  supersededById?: string;
  importedAt: string;
  market?: SecurityMarket;
  language?: 'zh' | 'en' | 'bilingual' | 'unknown';
  fiscalYear?: number;
};

export type MetricEvidence = {
  metricId: string;
  value: number | string | boolean | null;
  unit?: string;
  period?: string;
  formula?: string;
  reportRefIds: string[];
  sourceCells?: string[];
  sourceName?: string;
  sourceUrl?: string;
  note?: string;
};

export type MetricSource = {
  page?: number;
  pages?: number[];
  label: string;
  unit: string;
  formula?: string;
  date?: string;
  sourceName?: string;
  sourceUrl?: string;
};

export type PriceSource = {
  name: string;
  url: string;
  retrievedAt: string;
  currency: 'CNY' | 'HKD';
  adjustment: 'forward' | 'none';
  sampling: 'calendar_year_end';
  crossCheck?: {
    name: string;
    url: string;
    date: string;
    primaryRawClose: number;
    checkedRawClose: number;
    differencePercent: number;
    passed: boolean;
  };
};

export type CurrentMarketSnapshot = {
  price: number;
  date: string;
  currency: 'CNY' | 'HKD';
  peTtm?: number;
  pb?: number;
  marketCap?: number;
  dividendYield?: number;
  sourceName: string;
  sourceUrl: string;
  retrievedAt: string;
};

export type MetricPoint = {
  period: string;
  reportRefIds: string[];
  revenue?: number;
  netProfit?: number;
  eps?: number;
  adjustedPrice?: number;
  cash?: number;
  shortTermBorrowings?: number;
  currentPortionNonCurrentLiabilities?: number;
  longTermBorrowings?: number;
  bondsPayable?: number;
  currentLeaseLiabilities?: number;
  nonCurrentLeaseLiabilities?: number;
  unclassifiedLeaseLiabilities?: number;
  leaseLiabilities?: number;
  unclassifiedBorrowings?: number;
  longTermDebt?: number;
  interestBearingDebt?: number;
  lynchNetCash?: number;
  lynchNetCashPerShare?: number;
  conservativeNetCash?: number;
  conservativeNetCashPerShare?: number;
  netCash?: number;
  netCashPerShare?: number;
  inventory?: number;
  operatingCashFlow?: number;
  capitalExpenditure?: number;
  freeCashFlow?: number;
  pretaxMargin?: number;
  sharesOutstanding?: number;
  buybackShares?: number;
  dividendPerShare?: number;
  payoutRatio?: number;
  pe?: number;
  earningsGrowth?: number;
  dividendYield?: number;
  lynchValuationRatio?: number;
  equityRatio?: number;
  debtRatio?: number;
  pretaxProfit?: number;
  totalAssets?: number;
  totalLiabilities?: number;
  shareholdersEquity?: number;
  isTtm?: number;
  metricSources?: Record<string, MetricSource>;
  [metricId: string]:
    | string
    | string[]
    | number
    | Record<string, MetricSource>
    | undefined;
};

export type AnalysisDataset = {
  security?: SecurityIdentity;
  companyCode: string;
  companyName: string;
  companyType: CompanyType;
  companyTypes?: CompanyType[];
  industry: string;
  isFinancialCompany: boolean;
  currency: string;
  annual: MetricPoint[];
  halfYear?: MetricPoint[];
  quarterly: MetricPoint[];
  reportingPolicy?: ReportingPolicy;
  priceDate: string;
  priceAdjustment: 'none' | 'forward' | 'backward';
  priceSource?: PriceSource;
  currentMarket?: CurrentMarketSnapshot;
  latestReportPeriod?: string;
  latestComparablePoint?: MetricPoint;
  reportRefs: ReportReference[];
  ruleVersion: string;
  metricVersion: string;
  generatedAt: string;
};

export type ProgramAnalysis = {
  results: RuleResult[];
  summary: ScoreSummary;
  snapshot: ProgramMetricSnapshot;
  generatedAt: string;
};

export type RuleResult = {
  ruleId: string;
  outcome: RuleOutcome;
  evaluator: RuleEvaluator;
  evidence: MetricEvidence[];
  userConfirmed: boolean;
  note?: string;
};

export type ScoreSummary = {
  score: number | null;
  coverage: number | null;
  positiveCount: number;
  riskCount: number;
  neutralCount: number;
  applicableCount: number;
  evidencedApplicableCount: number;
  insufficientCount: number;
  notApplicableCount: number;
  includedRuleIds: string[];
  pendingAiRuleIds: string[];
};

export type ProgramMetricSnapshot = {
  isFinancialCompany: boolean;
  companyType: CompanyType;
  companyTypes?: CompanyType[];
  isSpinoff?: boolean;
  institutionalOwnershipClearlyLow?: boolean;
  analystCoverageClearlyLow?: boolean;
  insiderNetBuy?: boolean;
  completedBuybackReducedShares?: boolean;
  majorCustomerDependency?: boolean;
  peTtm?: number | null;
  currentPrice?: number | null;
  earningsPositive?: boolean;
  earningsCagr5yPercent?: number | null;
  dividendYieldPercent?: number | null;
  cash?: number | null;
  longTermDebt?: number | null;
  interestBearingDebt?: number | null;
  sharesOutstanding?: number | null;
  lynchNetCashPerShare?: number | null;
  conservativeNetCashPerShare?: number | null;
  netCashPerShare?: number | null;
  equityRatioPercent?: number | null;
  debtRatioPercent?: number | null;
  dividendHistoryComplete?: boolean;
  dividendMaintainedThroughCycle?: boolean;
  freeCashFlow?: number | null;
  freeCashFlowTrend?: 'improving' | 'stable' | 'worsening' | null;
  inventoryGrowthYoYPercent?: number | null;
  revenueGrowthYoYPercent?: number | null;
  hasMaterialInventory?: boolean;
  pretaxMarginPeerPosition?: 'higher' | 'middle' | 'lower' | null;
  pretaxMarginTrend?: 'improving' | 'stable' | 'worsening' | null;
  peContext?: 'low' | 'normal' | 'extreme' | 'mixed' | null;
  cashChange?: number | null;
  interestBearingDebtChange?: number | null;
  evidenceByRule?: Record<string, MetricEvidence[]>;
};
