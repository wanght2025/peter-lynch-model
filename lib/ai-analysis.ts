import type { CompanyType, RuleOutcome } from '@/lib/analysis-types';

export type AiRuleSuggestion = {
  ruleId: string;
  outcome: RuleOutcome;
  rationale: string;
  evidence: string[];
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
