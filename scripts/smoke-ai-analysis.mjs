const baseUrl = (process.env.BASE_URL || 'http://localhost:3000').replace(
  /\/$/,
  '',
);

async function json(path, init = {}, timeout = 300_000) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    signal: AbortSignal.timeout(timeout),
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(`${path} HTTP ${response.status}: ${body.error ?? '未知错误'}`);
  }
  return body;
}

console.log('查询 600519 官方报告…');
const lookup = await json('/api/official-reports?code=600519');
console.log(`抽取 ${lookup.company.companyName} 真实财报数据…`);
const fundamentals = await json('/api/fundamentals', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ code: '600519', lookup }),
});

const { dataset, analysis } = fundamentals;
if (!dataset || !analysis) throw new Error('财报数据或程序分析缺失');
if ((dataset.narrativeEvidence?.length ?? 0) === 0) {
  throw new Error('未提取到带页码的财报原文证据');
}

console.log(
  `已得到 ${dataset.annual.length} 年年度数据、${dataset.narrativeEvidence.length} 条带页码原文；调用 DeepSeek…`,
);
const report = await json('/api/ai-analysis', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ dataset, analysis }),
});

const acceptedTypes = report.companyTypeAssessments.filter((assessment) =>
  report.companyTypes.includes(assessment.type),
);
if (report.companyTypes.includes('unclassified') || acceptedTypes.length === 0) {
  throw new Error('600519 未得到有证据的自动公司分类');
}
if (
  acceptedTypes.some(
    (assessment) => !assessment.sources.some((source) => source.verified),
  )
) {
  throw new Error('已接受的公司类型缺少已校验来源');
}
const scoredRules = report.ruleSuggestions.filter(
  (rule) => !['insufficient', 'not_applicable'].includes(String(rule.outcome)),
);
if (
  scoredRules.some(
    (rule) => !rule.sources.some((source) => source.verified),
  )
) {
  throw new Error('已判断的 AI 规则缺少已校验来源');
}

console.log(
  JSON.stringify(
    {
      company: dataset.companyName,
      latestReportPeriod: dataset.latestReportPeriod,
      annualPoints: dataset.annual.length,
      narrativeEvidence: dataset.narrativeEvidence.length,
      companyTypes: report.companyTypes,
      typeAssessments: report.companyTypeAssessments.map((item) => ({
        type: item.type,
        confidence: item.confidence,
        verifiedSources: item.sources.filter((source) => source.verified).length,
      })),
      acceptedTypeEvidence: acceptedTypes.map((item) => ({
        type: item.type,
        verifiedSources: item.sources.filter((source) => source.verified).length,
      })),
      aiRules: report.ruleSuggestions.length,
      evidencedAiRules: scoredRules.length,
      insufficientAiRules: report.ruleSuggestions.filter(
        (rule) => rule.outcome === 'insufficient',
      ).length,
      model: report.model,
    },
    null,
    2,
  ),
);
console.log('真实数据 + DeepSeek 证据链冒烟通过');
