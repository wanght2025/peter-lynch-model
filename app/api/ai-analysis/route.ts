import type { AnalysisDataset, ProgramAnalysis } from '@/lib/analysis-types';
import type { AiAnalysisReport } from '@/lib/ai-analysis';
import { AI_RULE_IDS } from '@/lib/scoring-engine';
import { ruleCatalog } from '@/lib/rule-catalog';

const OUTCOMES = [1, 0, -1, 'not_applicable', 'insufficient'] as const;

function compactDataset(dataset: AnalysisDataset, analysis: ProgramAnalysis) {
  const latest = dataset.latestComparablePoint ?? dataset.annual.at(-1);
  return {
    company: {
      code: dataset.companyCode,
      name: dataset.companyName,
      market: dataset.security?.market,
      financialCompany: dataset.isFinancialCompany,
      confirmedLynchTypes: dataset.companyTypes ?? [dataset.companyType],
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
    programResults: analysis.results,
    officialReports: dataset.reportRefs.map((report) => ({
      id: report.id,
      title: report.title,
      reportDate: report.reportDate,
      kind: report.reportKind,
      source: report.sourceName,
    })),
  };
}

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: '未配置OPENAI_API_KEY，程序评分仍可正常使用。' },
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
      AI_RULE_IDS.includes(rule.id as (typeof AI_RULE_IDS)[number]),
    )
    .map((rule) => ({
      id: rule.id,
      title: rule.title,
      excerpt: rule.excerpt,
      requiredEvidence: rule.requiredEvidence,
      scoreSpec: rule.scoreSpec,
    }));
  const model = process.env.OPENAI_MODEL || 'gpt-5.4';
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      store: false,
      instructions:
        '你是彼得·林奇方法的证据分析员和反方审计员。只能使用输入中的官方报告元数据和已抽取数字；不得补充记忆中的公司事实。同一公司可以同时具有多个林奇类型特征，companyTypes应返回所有有直接证据支持的类型；没有可靠分类证据时只返回unclassified。定性规则缺少原文证据时必须输出insufficient。AI建议不是正式得分，需要用户确认。',
      input: JSON.stringify({
        rules: aiRules,
        evidence: compactDataset(body.dataset, body.analysis),
      }),
      text: {
        format: {
          type: 'json_schema',
          name: 'lynch_evidence_analysis',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              companyTypes: {
                type: 'array',
                minItems: 1,
                uniqueItems: true,
                items: {
                  type: 'string',
                  enum: [
                    'slow_grower',
                    'stalwart',
                    'fast_grower',
                    'cyclical',
                    'turnaround',
                    'asset_play',
                    'unclassified',
                  ],
                },
              },
              classificationConfidence: {
                type: 'number',
                minimum: 0,
                maximum: 1,
              },
              classificationRationale: { type: 'string' },
              analystView: { type: 'string' },
              bearCase: { type: 'string' },
              falsificationSignals: {
                type: 'array',
                items: { type: 'string' },
              },
              ruleSuggestions: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    ruleId: { type: 'string', enum: [...AI_RULE_IDS] },
                    outcome: { enum: [...OUTCOMES] },
                    rationale: { type: 'string' },
                    evidence: { type: 'array', items: { type: 'string' } },
                  },
                  required: ['ruleId', 'outcome', 'rationale', 'evidence'],
                },
              },
            },
            required: [
              'companyTypes',
              'classificationConfidence',
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
  const payload = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    const error = payload.error as { message?: string } | undefined;
    return Response.json(
      { error: error?.message || `OpenAI请求失败：${response.status}` },
      { status: 502 },
    );
  }
  const output = payload.output as Array<Record<string, unknown>> | undefined;
  const message = output?.find((item) => item.type === 'message');
  const content = message?.content as
    | Array<Record<string, unknown>>
    | undefined;
  const text = content?.find((item) => item.type === 'output_text')?.text;
  if (typeof text !== 'string')
    return Response.json({ error: 'AI没有返回可读分析' }, { status: 502 });
  const parsed = JSON.parse(text) as Omit<
    AiAnalysisReport,
    'model' | 'generatedAt'
  >;
  return Response.json({
    ...parsed,
    model,
    generatedAt: new Date().toISOString(),
  } satisfies AiAnalysisReport);
}
