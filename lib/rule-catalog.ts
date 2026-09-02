import bookSourceData from '@/data/rules/book-source.json';
import chapterAuditData from '@/data/rules/chapter-audit.v0.1.json';
import exclusionsData from '@/data/rules/exclusions.candidate.v0.1.json';
import rulesData from '@/data/rules/rules.verified.v1.json';

export type RuleStatus = 'candidate' | 'verified' | 'rejected' | 'deprecated';
export type RuleKind =
  | 'guardrail'
  | 'checklist'
  | 'direction'
  | 'classification'
  | 'definition'
  | 'threshold'
  | 'formula';
export type RuleAutomation = 'hard' | 'human' | 'none';
export type RuleSignal =
  | 'positive'
  | 'risk'
  | 'neutral'
  | 'mixed'
  | 'gate'
  | 'critical';

export type LynchRuleCandidate = {
  id: string;
  title: string;
  chapter: string;
  section: string;
  locator: string;
  excerpt: string;
  kind: RuleKind;
  appliesTo: string[];
  automation: RuleAutomation;
  signal: RuleSignal;
  scoreEligible: boolean;
  duplicateGroup?: string;
  requiredEvidence: string[];
  ambiguity: string;
  status: RuleStatus;
  order?: number;
  decision?: 'scoring' | 'reminder' | 'excluded';
  evaluator?: 'program' | 'ai' | 'none';
  userConfirmed?: boolean;
  scoreSpec?: {
    formula: string;
    positive?: string | null;
    risk?: string | null;
    neutral?: string;
    notApplicable?: string;
    thresholdSource?: string;
    [key: string]: unknown;
  } | null;
};

export type ExclusionCandidate = {
  id: string;
  chapter: string;
  locator: string;
  summary: string;
  reason: string;
  status: 'candidate_exclusion';
};

export const bookSource = bookSourceData;
export const chapterAudit = chapterAuditData;
export const lockedRuleMetadata = {
  version: rulesData.version,
  status: rulesData.status,
  lockedAt: rulesData.lockedAt,
  counts: rulesData.counts,
  disclosure: rulesData.disclosure,
};
export const scoringPolicy = rulesData.scoringPolicy;
export const ruleCatalog = rulesData.rules as LynchRuleCandidate[];
export const exclusionCatalog = exclusionsData.items as ExclusionCandidate[];

export const companyTypeLabels: Record<string, string> = {
  all: '所有类型',
  portfolio: '投资者/组合',
  slow_grower: '缓慢增长型',
  stalwart: '稳定增长型',
  fast_grower: '快速增长型',
  cyclical: '周期型',
  turnaround: '困境反转型',
  asset_play: '隐蔽资产型',
  unclassified: '待分类',
};

export const ruleKindLabels: Record<RuleKind, string> = {
  guardrail: '流程护栏',
  checklist: '定性检查',
  direction: '原文方向',
  classification: '分类前置',
  definition: '原文定义',
  threshold: '明确阈值',
  formula: '明确公式',
};

export const automationLabels: Record<RuleAutomation, string> = {
  hard: '程序可算',
  human: '人工确认',
  none: '不执行',
};

export const signalLabels: Record<RuleSignal, string> = {
  positive: '正向',
  risk: '风险',
  neutral: '中性',
  mixed: '双向判断',
  gate: '流程门槛',
  critical: '重大风险',
};
