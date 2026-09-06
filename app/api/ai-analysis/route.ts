import type {
  AnalysisDataset,
  MetricEvidence,
  ProgramAnalysis,
  ReportReference,
} from '@/lib/analysis-types';
import type {
  AiAnalysisReport,
  AiCompanyTypeAssessment,
  AiEvidenceSource,
  AiRuleSuggestion,
} from '@/lib/ai-analysis';
import { AI_ANALYSIS_RULE_IDS } from '@/lib/scoring-engine';
import { ruleCatalog } from '@/lib/rule-catalog';

const OUTCOMES = [1, 0, -1, 'not_applicable', 'insufficient'] as const;
const COMPANY_TYPES = [
  'slow_grower',
  'stalwart',
  'fast_grower',
  'cyclical',
  'turnaround',
  'asset_play',
  'unclassified',
] as const;
const OFFICIAL_HOSTS = new Set([
  'static.cninfo.com.cn',
  'www.cninfo.com.cn',
  'www1.hkexnews.hk',
  'www.hkexnews.hk',
  'www.sse.com.cn',
  'sse.com.cn',
  'www.szse.cn',
  'szse.cn',
  'www.bse.cn',
  'bse.cn',
]);

function reportMap(dataset: AnalysisDataset) {
  return new Map(dataset.reportRefs.map((report) => [report.id, report]));
}

function compactMetricEvidence(
  evidence: MetricEvidence[],
  reports: Map<string, ReportReference>,
) {
  return evidence.map((item) => ({
    metricId: item.metricId,
    value: item.value,
    unit: item.unit,
    period: item.period,
    formula: item.formula,
    page: item.page,
    pages: item.pages,
    sourceLabel: item.sourceLabel,
    sourceQuote: item.sourceQuote,
    sourceName: item.sourceName,
    sourceUrl: item.sourceUrl,
    reports: item.reportRefIds
      .map((id) => reports.get(id))
      .filter((report): report is ReportReference => Boolean(report))
      .map((report) => ({
        id: report.id,
        title: report.title,
        reportDate: report.reportDate,
        sourceUrl: report.sourceUrl,
        fileSha256: report.fileSha256,
      })),
  }));
}

function compactDataset(dataset: AnalysisDataset, analysis: ProgramAnalysis) {
  const reports = reportMap(dataset);
  const latest = dataset.latestComparablePoint ?? dataset.annual.at(-1);
  return {
    company: {
      code: dataset.companyCode,
      name: dataset.companyName,
      market: dataset.security?.market,
      financialCompany: dataset.isFinancialCompany,
    },
    latestReportPeriod: dataset.latestReportPeriod,
    currentMarket: dataset.currentMarket,
    latestComparablePoint: latest,
    annual: dataset.annual.slice(-10).map((point) => ({
      period: point.period,
      revenue: point.revenue,
      netProfit: point.netProfit,
      eps: point.eps,
      cash: point.cash,
      interestBearingDebt: point.interestBearingDebt,
      inventory: point.inventory,
      freeCashFlow: point.freeCashFlow,
      pretaxMargin: point.pretaxMargin,
    })),
    programResults: analysis.results.map((result) => ({
      ruleId: result.ruleId,
      outcome: result.outcome,
      note: result.note,
      evidence: compactMetricEvidence(result.evidence, reports),
    })),
    officialReports: dataset.reportRefs.map((report) => ({
      id: report.id,
      title: report.title,
      reportDate: report.reportDate,
      kind: report.reportKind,
      source: report.sourceName,
      sourceUrl: report.sourceUrl,
      fileSha256: report.fileSha256,
    })),
    narrativeEvidence: (dataset.narrativeEvidence ?? []).map((item) => {
      const report = reports.get(item.reportRefId);
      return {
        topic: item.topic,
        reportRefId: item.reportRefId,
        page: item.page,
        quote: item.quote,
        title: report?.title,
        reportDate: report?.reportDate,
        sourceUrl: report?.sourceUrl,
      };
    }),
  };
}

function normalizeQuote(value: string) {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, '');
}

function parseJsonObject(value: string) {
  const text = value.trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('JSON object not found');
  return JSON.parse(text.slice(start, end + 1)) as unknown;
}

function removeTradingDirective(value: string) {
  return value.replace(
    /(?:建议|宜|应当|应该|适合|不宜|可以|可|谨慎)(?:立即|继续|谨慎|暂时)?(?:买入|卖出|持有|加仓|减仓|观望)/g,
    '继续研究',
  );
}

function exactDatasetUrls(dataset: AnalysisDataset) {
  const urls = new Set(
    dataset.reportRefs
      .map((report) => report.sourceUrl)
      .filter((url): url is string => Boolean(url)),
  );
  if (dataset.currentMarket?.sourceUrl)
    urls.add(dataset.currentMarket.sourceUrl);
  for (const source of Object.values(
    dataset.currentMarket?.fieldSources ?? {},
  )) {
    if (source?.sourceUrl) urls.add(source.sourceUrl);
  }
  if (dataset.priceSource?.url) urls.add(dataset.priceSource.url);
  return urls;
}

function verifiedLocalQuote(
  source: AiRuleSuggestion['sources'][number],
  dataset: AnalysisDataset,
) {
  if (!source.reportRefId || source.page == null || !source.quote) return false;
  const expected = normalizeQuote(source.quote);
  return (dataset.narrativeEvidence ?? []).some((item) => {
    if (item.reportRefId !== source.reportRefId || item.page !== source.page)
      return false;
    const actual = normalizeQuote(item.quote);
    return (
      expected.length >= 8 &&
      (actual.includes(expected) || expected.includes(actual))
    );
  });
}

function verifySource(
  source: AiEvidenceSource,
  dataset: AnalysisDataset,
  cutoffDate: Date,
  currentDate: Date,
) {
  let sourceUrl: URL;
  try {
    sourceUrl = new URL(source.url);
  } catch {
    return false;
  }
  if (sourceUrl.protocol !== 'https:') return false;
  const knownUrls = exactDatasetUrls(dataset);
  if (knownUrls.has(source.url)) {
    const matchingReport = dataset.reportRefs.find(
      (report) => report.sourceUrl === source.url,
    );
    if (!matchingReport) return true;
    return (
      source.reportRefId === matchingReport.id &&
      verifiedLocalQuote(source, dataset)
    );
  }
  const publishedAt = Date.parse(source.publishedAt);
  return (
    OFFICIAL_HOSTS.has(sourceUrl.hostname.toLowerCase()) &&
    Number.isFinite(publishedAt) &&
    publishedAt >= cutoffDate.getTime() &&
    publishedAt <= currentDate.getTime() &&
    normalizeQuote(source.quote).length >= 8
  );
}

function sanitizeSources(
  sources: AiEvidenceSource[],
  dataset: AnalysisDataset,
  cutoffDate: Date,
  currentDate: Date,
) {
  const seen = new Set<string>();
  return (sources ?? []).flatMap((source) => {
    if (!source?.url || seen.has(source.url)) return [];
    seen.add(source.url);
    const verified = verifySource(source, dataset, cutoffDate, currentDate);
    return [{ ...source, verified }];
  });
}

function sanitizeSuggestions(
  suggestions: AiRuleSuggestion[],
  dataset: AnalysisDataset,
  cutoffDate: Date,
  currentDate: Date,
) {
  const received = new Map<string, AiRuleSuggestion>();
  for (const suggestion of suggestions ?? []) {
    if (
      !AI_ANALYSIS_RULE_IDS.includes(
        suggestion.ruleId as (typeof AI_ANALYSIS_RULE_IDS)[number],
      ) ||
      received.has(suggestion.ruleId)
    )
      continue;
    received.set(suggestion.ruleId, suggestion);
  }
  return AI_ANALYSIS_RULE_IDS.map((ruleId) => {
    const suggestion = received.get(ruleId);
    if (!suggestion) {
      return {
        ruleId,
        outcome: 'insufficient' as const,
        rationale: 'DeepSeek 未返回这条规则的完整证据，系统保持证据不足。',
        evidence: [],
        sources: [],
      };
    }
    const sources = sanitizeSources(
      suggestion.sources,
      dataset,
      cutoffDate,
      currentDate,
    );
    const hasVerifiedSource = sources.some((source) => source.verified);
    if (
      !['insufficient', 'not_applicable'].includes(
        String(suggestion.outcome),
      ) &&
      !hasVerifiedSource
    ) {
      return {
        ...suggestion,
        outcome: 'insufficient' as const,
        rationale: `${suggestion.rationale}；没有通过系统校验的法定披露证据，不进入评分。`,
        sources,
      };
    }
    return { ...suggestion, sources };
  });
}

function sanitizeCompanyTypes(
  assessments: AiCompanyTypeAssessment[],
  dataset: AnalysisDataset,
  cutoffDate: Date,
  currentDate: Date,
): {
  companyTypes: AiAnalysisReport['companyTypes'];
  companyTypeAssessments: AiCompanyTypeAssessment[];
} {
  const unique = new Map<string, AiCompanyTypeAssessment>();
  for (const assessment of assessments ?? []) {
    if (
      !COMPANY_TYPES.includes(assessment.type) ||
      assessment.type === 'unclassified' ||
      unique.has(assessment.type)
    )
      continue;
    const sources = sanitizeSources(
      assessment.sources,
      dataset,
      cutoffDate,
      currentDate,
    );
    const metricEvidence = classificationMetricEvidence(
      assessment.type,
      dataset,
    );
    unique.set(assessment.type, {
      ...assessment,
      confidence: Math.max(0, Math.min(1, assessment.confidence)),
      sources,
      metricEvidence,
    });
  }
  const sorted = [...unique.values()].sort(
    (a, b) => b.confidence - a.confidence,
  );
  const accepted = sorted.filter(
    (item) =>
      item.confidence >= 0.55 &&
      (item.sources.some((source) => source.verified) ||
        Boolean(item.metricEvidence?.length)),
  );
  return {
    companyTypes: accepted.length
      ? accepted.map((item) => item.type)
      : ['unclassified'],
    companyTypeAssessments: sorted,
  };
}

function classificationMetricEvidence(
  type: AiCompanyTypeAssessment['type'],
  dataset: AnalysisDataset,
): MetricEvidence[] {
  if (!['slow_grower', 'stalwart', 'fast_grower'].includes(type)) return [];
  const points = dataset.annual
    .filter((point) => typeof point.eps === 'number' && point.eps > 0)
    .slice(-6);
  if (points.length < 4) return [];
  const start = points[0];
  const end = points.at(-1)!;
  const years = Number.parseInt(end.period, 10) - Number.parseInt(start.period, 10);
  if (!Number.isFinite(years) || years <= 0) return [];
  const cagr = (Math.pow(end.eps! / start.eps!, 1 / years) - 1) * 100;
  const matches =
    (type === 'slow_grower' && cagr >= 0 && cagr <= 6) ||
    (type === 'stalwart' && cagr >= 8 && cagr <= 15) ||
    (type === 'fast_grower' && cagr >= 18 && cagr <= 28);
  if (!matches) return [];
  const source = end.metricSources?.eps;
  return [
    {
      metricId: 'classification.eps_cagr',
      value: cagr,
      unit: '%',
      period: `${start.period}—${end.period}`,
      formula: `(${end.eps!.toFixed(3)} / ${start.eps!.toFixed(3)}) ^ (1 / ${years}) - 1`,
      reportRefIds: [...new Set([...start.reportRefIds, ...end.reportRefIds])],
      page: source?.page,
      pages: source?.pages,
      sourceLabel: source?.label,
      note:
        '分类校验容差为本模型设置：缓慢0—6%、稳定8—15%、快速18—28%；原著典型区间分别为2—4%、10—12%、20—25%。',
    },
  ];
}

export async function POST(request: Request) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: '未配置 DEEPSEEK_API_KEY，已保留程序财务分析。' },
      { status: 503 },
    );
  }
  const body = (await request.json()) as {
    dataset?: AnalysisDataset;
    analysis?: ProgramAnalysis;
  };
  if (!body.dataset || !body.analysis) {
    return Response.json(
      { error: '缺少可追溯数据或程序评分' },
      { status: 400 },
    );
  }
  const aiRules = ruleCatalog
    .filter((rule) =>
      AI_ANALYSIS_RULE_IDS.includes(
        rule.id as (typeof AI_ANALYSIS_RULE_IDS)[number],
      ),
    )
    .map((rule) => ({
      id: rule.id,
      title: rule.title,
      excerpt: rule.excerpt,
      appliesTo: rule.appliesTo,
      requiredEvidence: rule.requiredEvidence,
      scoreSpec: rule.scoreSpec,
    }));
  const model = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash';
  const currentDate = new Date();
  const cutoffDate = new Date(currentDate);
  cutoffDate.setUTCDate(cutoffDate.getUTCDate() - 365);
  cutoffDate.setUTCHours(0, 0, 0, 0);
  const currentDateText = currentDate.toISOString().slice(0, 10);
  let response: Response;
  try {
    response = await fetch('https://api.deepseek.com/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
      model,
      reasoning: { effort: 'none' },
      max_output_tokens: 12_000,
      instructions: `你是彼得·林奇方法的证据分析员和反方审计员。当前日期是${currentDateText}。必须输出符合给定schema的JSON，不得输出Markdown。只使用输入中的法定报告原文摘录、页码、财务证据和报告URL，不得凭记忆补充外部资料。引用财报摘录时必须逐字复制quote，并返回相同reportRefId、page和sourceUrl。不得编造数字、原文、URL、页码、发布日期或行业比较。回购必须核对实际完成数量、注销或库存股处理以及股本变化，回购计划不能当成已完成回购。没有足够证据必须输出insufficient。公司可以同时属于多种类型；对每种类型分别给出置信度、理由和证据，不能要求用户自行分类。不得给出买入、卖出、持有、加减仓、目标价或其他交易建议，只判断公司质量、风险与待验证信号。对每条输入规则都必须返回且只能返回一次。所有解释使用简明中文。`,
      input: JSON.stringify({
        rules: aiRules,
        evidence: compactDataset(body.dataset, body.analysis),
      }),
      text: {
        format: {
          type: 'json_schema',
          name: 'lynch_evidence_analysis',
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              companyTypeAssessments: {
                type: 'array',
                maxItems: 3,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    type: { type: 'string', enum: [...COMPANY_TYPES] },
                    confidence: { type: 'number', minimum: 0, maximum: 1 },
                    rationale: { type: 'string' },
                    evidence: {
                      type: 'array',
                      maxItems: 3,
                      items: { type: 'string' },
                    },
                    sources: {
                      type: 'array',
                      maxItems: 2,
                      items: {
                        type: 'object',
                        additionalProperties: false,
                        properties: {
                          title: { type: 'string' },
                          url: { type: 'string' },
                          publishedAt: { type: 'string' },
                          reportRefId: { type: 'string' },
                          page: { type: ['number', 'null'] },
                          quote: { type: 'string' },
                          sourceType: {
                            type: 'string',
                            enum: [
                              'official_disclosure',
                              'company_announcement',
                              'reputable_news',
                            ],
                          },
                        },
                        required: [
                          'title',
                          'url',
                          'publishedAt',
                          'reportRefId',
                          'page',
                          'quote',
                          'sourceType',
                        ],
                      },
                    },
                  },
                  required: [
                    'type',
                    'confidence',
                    'rationale',
                    'evidence',
                    'sources',
                  ],
                },
              },
              classificationRationale: { type: 'string' },
              analystView: { type: 'string' },
              bearCase: { type: 'string' },
              falsificationSignals: {
                type: 'array',
                maxItems: 5,
                items: { type: 'string' },
              },
              ruleSuggestions: {
                type: 'array',
                maxItems: AI_ANALYSIS_RULE_IDS.length,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    ruleId: {
                      type: 'string',
                      enum: [...AI_ANALYSIS_RULE_IDS],
                    },
                    outcome: { enum: [...OUTCOMES] },
                    rationale: { type: 'string' },
                    evidence: {
                      type: 'array',
                      maxItems: 3,
                      items: { type: 'string' },
                    },
                    sources: {
                      type: 'array',
                      maxItems: 2,
                      items: {
                        type: 'object',
                        additionalProperties: false,
                        properties: {
                          title: { type: 'string' },
                          url: { type: 'string' },
                          publishedAt: { type: 'string' },
                          reportRefId: { type: 'string' },
                          page: { type: ['number', 'null'] },
                          quote: { type: 'string' },
                          sourceType: {
                            type: 'string',
                            enum: [
                              'official_disclosure',
                              'company_announcement',
                              'reputable_news',
                            ],
                          },
                        },
                        required: [
                          'title',
                          'url',
                          'publishedAt',
                          'reportRefId',
                          'page',
                          'quote',
                          'sourceType',
                        ],
                      },
                    },
                  },
                  required: [
                    'ruleId',
                    'outcome',
                    'rationale',
                    'evidence',
                    'sources',
                  ],
                },
              },
            },
            required: [
              'companyTypeAssessments',
              'classificationRationale',
              'analystView',
              'bearCase',
              'falsificationSignals',
              'ruleSuggestions',
            ],
          },
        },
      },
      }),
      signal: AbortSignal.timeout(120_000),
    });
  } catch (error) {
    const timedOut =
      error instanceof DOMException && error.name === 'TimeoutError';
    return Response.json(
      {
        error: timedOut
          ? 'DeepSeek 分析超过120秒，请稍后重试'
          : 'DeepSeek 服务暂时无法连接',
      },
      { status: timedOut ? 504 : 502 },
    );
  }
  const payload = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    const error = payload.error as { message?: string } | undefined;
    return Response.json(
      { error: error?.message || `DeepSeek 请求失败：${response.status}` },
      { status: 502 },
    );
  }
  const output = payload.output as Array<Record<string, unknown>> | undefined;
  const message = output?.find((item) => item.type === 'message');
  const content = message?.content as Array<Record<string, unknown>> | undefined;
  const outputText = content?.find((item) => item.type === 'output_text')?.text;
  if (typeof outputText !== 'string' || !outputText.trim()) {
    const incomplete = payload.incomplete_details as
      | { reason?: string }
      | undefined;
    return Response.json(
      {
        error: `DeepSeek 没有返回可读分析${incomplete?.reason ? `：${incomplete.reason}` : ''}`,
      },
      { status: 502 },
    );
  }
  let parsed: {
    companyTypeAssessments: AiCompanyTypeAssessment[];
    classificationRationale: string;
    analystView: string;
    bearCase: string;
    falsificationSignals: string[];
    ruleSuggestions: AiRuleSuggestion[];
  };
  try {
    parsed = parseJsonObject(outputText) as typeof parsed;
  } catch {
    const incomplete = payload.incomplete_details as
      | { reason?: string }
      | undefined;
    return Response.json(
      {
        error: `DeepSeek 返回的 JSON 无法解析${incomplete?.reason ? `：${incomplete.reason}` : ''}（${outputText.length}字符）`,
      },
      { status: 502 },
    );
  }
  const companyTypeResult = sanitizeCompanyTypes(
    parsed.companyTypeAssessments,
    body.dataset,
    cutoffDate,
    currentDate,
  );
  const classificationConfidence =
    companyTypeResult.companyTypeAssessments.find((assessment) =>
      companyTypeResult.companyTypes.includes(assessment.type),
    )?.confidence ?? 0;
  return Response.json({
    ...parsed,
    analystView: removeTradingDirective(parsed.analystView),
    bearCase: removeTradingDirective(parsed.bearCase),
    ...companyTypeResult,
    classificationConfidence,
    ruleSuggestions: sanitizeSuggestions(
      parsed.ruleSuggestions,
      body.dataset,
      cutoffDate,
      currentDate,
    ),
    model,
    generatedAt: new Date().toISOString(),
  } satisfies AiAnalysisReport);
}
