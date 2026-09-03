import type { CompanyType, RuleOutcome } from '@/lib/analysis-types';

export type AiRuleSuggestion = {
  ruleId: string;
  outcome: RuleOutcome;
  rationale: string;
  evidence: string[];
  sources: Array<{
    title: string;
    url: string;
    publishedAt: string;
    sourceType:
      | 'official_disclosure'
      | 'company_announcement'
      | 'reputable_news';
  }>;
};

export type AiAnalysisReport = {
  companyTypes: CompanyType[];
  classificationConfidence: number;
  classificationRationale: string;
  analystView: string;
  bearCase: string;
  falsificationSignals: string[];
  ruleSuggestions: AiRuleSuggestion[];
  model: string;
  generatedAt: string;
};
