import type {
  CompanyType,
  MetricEvidence,
  RuleOutcome,
} from '@/lib/analysis-types';

export type AiEvidenceSource = {
  title: string;
  url: string;
  publishedAt: string;
  reportRefId: string;
  page: number | null;
  quote: string;
  verified: boolean;
  sourceType:
    | 'official_disclosure'
    | 'company_announcement'
    | 'reputable_news';
};

export type AiRuleSuggestion = {
  ruleId: string;
  outcome: RuleOutcome;
  rationale: string;
  evidence: string[];
  sources: AiEvidenceSource[];
};

export type AiCompanyTypeAssessment = {
  type: CompanyType;
  confidence: number;
  rationale: string;
  evidence: string[];
  sources: AiEvidenceSource[];
  metricEvidence?: MetricEvidence[];
};

export type AiAnalysisReport = {
  companyTypes: CompanyType[];
  companyTypeAssessments: AiCompanyTypeAssessment[];
  classificationConfidence: number;
  classificationRationale: string;
  analystView: string;
  bearCase: string;
  falsificationSignals: string[];
  ruleSuggestions: AiRuleSuggestion[];
  model: string;
  generatedAt: string;
};
