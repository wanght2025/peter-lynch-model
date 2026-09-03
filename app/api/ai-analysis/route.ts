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
  const currentDate = new Date();
  const cutoffDate = new Date(currentDate);
  cutoffDate.setUTCDate(cutoffDate.getUTCDate() - 365);
  cutoffDate.setUTCHours(0, 0, 0, 0);
  const currentDateText = currentDate.toISOString().slice(0, 10);
  const cutoffDateText = cutoffDate.toISOString().slice(0, 10);
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      store: false,
      tools: [{ type: 'web_search' }],
      include: ['web_search_call.action.sources'],
      max_tool_calls: 8,
      instructions: `你是彼得·林奇方法的证据分析员和反方审计员。当前日期是${currentDateText}。先使用输入中的官方报告与已抽取数字；只有定性证据不足或需要核对近期公司事件时才使用网页搜索。所有网页证据必须发布于${cutoffDateText}至${currentDateText}之间，即最近365天；优先交易所公告、监管披露和公司公告，其次才是可靠新闻。回购必须核对实际完成数量、注销或库存股处理以及股本变化，回购计划不能当成已完成回购。不得使用发布日期不明、超出时间范围或无法打开的网页。每条网页证据必须返回可点击URL、标题和发布日期；没有足够证据必须输出insufficient。未经用户确认的AI建议不进入正式得分。`,
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
                    sources: {
                      type: 'array',
                      items: {
                        type: 'object',
                        additionalProperties: false,
                        properties: {
                          title: { type: 'string' },
                          url: { type: 'string' },
                          publishedAt: { type: 'string' },
                          sourceType: {
                            type: 'string',
                            enum: [
                              'official_disclosure',
                              'company_announcement',
                              'reputable_news',
                            ],
                          },
                        },
                        required: ['title', 'url', 'publishedAt', 'sourceType'],
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
  parsed.ruleSuggestions = parsed.ruleSuggestions.map((suggestion) => {
    const sources = (suggestion.sources ?? []).filter((source) => {
      const publishedAt = Date.parse(source.publishedAt);
      let sourceUrl: URL;
      try {
        sourceUrl = new URL(source.url);
      } catch {
        return false;
      }
      return (
        ['http:', 'https:'].includes(sourceUrl.protocol) &&
        Number.isFinite(publishedAt) &&
        publishedAt >= cutoffDate.getTime() &&
        publishedAt <= currentDate.getTime()
      );
    });
    const needsRecentEventEvidence = [
      'LYN-08-BUYBACK',
      'LYN-08-INSIDER-BUYING',
    ].includes(suggestion.ruleId);
    if (
      needsRecentEventEvidence &&
      suggestion.outcome !== 'insufficient' &&
      sources.length === 0
    ) {
      return {
        ...suggestion,
        outcome: 'insufficient' as const,
        rationale: `${suggestion.rationale}；最近365天内没有可核验来源，不纳入评分。`,
        sources,
      };
    }
    return { ...suggestion, sources };
  });
  return Response.json({
    ...parsed,
    model,
    generatedAt: new Date().toISOString(),
  } satisfies AiAnalysisReport);
}
