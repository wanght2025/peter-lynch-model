import { extractText, getDocumentProxy } from 'unpdf';

import type {
  MetricPoint,
  MetricSource,
  NarrativeEvidence,
  NarrativeEvidenceTopic,
} from '@/lib/analysis-types';
import type { OfficialFiling } from '@/lib/official-filings';

type TextPage = { number: number; text: string; lines: string[] };
type ValuePair = {
  current?: number;
  previous?: number;
  source: MetricSource & { page: number };
};

export type FinancialReportExtraction = {
  points: MetricPoint[];
  financialCurrency: 'CNY' | 'HKD' | 'USD';
  warnings: string[];
  narrativeEvidence?: NarrativeEvidence[];
};

type FinancialReportExtractionOptions = {
  includeNarrative?: boolean;
};

const NUMBER_TOKEN = /\(?-?\d[\d,]*(?:\.\d+)?\)?|[–—-]/g;

function cleanLine(value: string) {
  return value
    .replace(/[\u00a0\u2007\u202f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseNumber(token: string) {
  if (/^[–—-]$/.test(token)) return 0;
  const negative = /^\(.*\)$/.test(token) || token.startsWith('-');
  const value = Number(token.replace(/[(),]/g, ''));
  return Number.isFinite(value)
    ? negative
      ? -Math.abs(value)
      : value
    : undefined;
}

function numberTokens(value: string) {
  return [...value.matchAll(NUMBER_TOKEN)]
    .map((match) => parseNumber(match[0]))
    .filter((item): item is number => item !== undefined);
}

function isOrdinalPlaceholder(values: number[]) {
  return (
    values.length === 2 &&
    Number.isInteger(values[0]) &&
    Math.abs(values[0]) <= 20 &&
    values[1] === 0
  );
}

function unitInfo(text: string) {
  if (/RMB\s*[’']?\s*0{3}\b|人民币\s*千元/i.test(text))
    return { multiplier: 1_000, label: '人民币千元' };
  if (/RMB\s*[’']?\s*Million|人民[幣币]百[萬万]元/i.test(text))
    return { multiplier: 1_000_000, label: '人民币百万元' };
  if (/HKD\s*[’']?\s*Million|港[幣币]百[萬万]元/i.test(text))
    return { multiplier: 1_000_000, label: '港币百万元' };
  if (/USD\s*[’']?\s*Million|美元百[萬万]元/i.test(text))
    return { multiplier: 1_000_000, label: '美元百万元' };
  if (/单位[：:]\s*万元/.test(text))
    return { multiplier: 10_000, label: '人民币万元' };
  if (/单位[：:]\s*千元/.test(text))
    return { multiplier: 1_000, label: '人民币千元' };
  return { multiplier: 1, label: '元' };
}

function financialCurrency(text: string): 'CNY' | 'HKD' | 'USD' {
  if (/HKD|港[幣币]/i.test(text)) return 'HKD';
  if (/USD|美元/i.test(text)) return 'USD';
  return 'CNY';
}

function findStartPage(
  pages: TextPage[],
  heading: RegExp[],
  signals: RegExp[],
) {
  let best: { index: number; score: number } | null = null;
  for (let index = 0; index < pages.length; index += 1) {
    const page = pages[index];
    if (!heading.some((pattern) => pattern.test(cleanLine(page.text)))) continue;
    // Some CNInfo statements put the title on one page and the column
    // headings/line items on the following one or two pages.
    const nearbyText = pages
      .slice(index, index + 3)
      .map((item) => item.text)
      .join('\n');
    const score = signals.filter((pattern) => pattern.test(cleanLine(nearbyText))).length;
    if (score && (!best || score > best.score)) best = { index, score };
  }
  return best ? best.index : -1;
}

function statementPages(pages: TextPage[], start: number, count = 3) {
  return start < 0 ? [] : pages.slice(start, start + count);
}

function pairFromMatch(
  pages: TextPage[],
  patterns: RegExp[],
  followingLines = 2,
  applyUnit = true,
): ValuePair | null {
  for (const page of pages) {
    for (let index = 0; index < page.lines.length; index += 1) {
      let line = page.lines[index];
      let pattern = patterns.find((candidate) => candidate.test(line));
      if (!pattern && !/\d/.test(line)) {
        for (let length = 2; length <= 3 && !pattern; length += 1) {
          line = page.lines.slice(index, index + length).join(' ');
          pattern = patterns.find((candidate) => candidate.test(line));
        }
      }
      if (!pattern) continue;
      const match = line.match(pattern);
      const start =
        match?.index === undefined ? 0 : match.index + match[0].length;
      let values = numberTokens(line.slice(start));
      for (
        let offset = 1;
        (values.length < 2 || (applyUnit && isOrdinalPlaceholder(values))) &&
        offset <= followingLines;
        offset += 1
      ) {
        values = [...values, ...numberTokens(page.lines[index + offset] ?? '')];
      }
      if (values.length < 2) continue;
      const [current, previous] = values.slice(-2);
      const unit = unitInfo(pages.map((item) => item.text).join('\n'));
      const multiplier = applyUnit ? unit.multiplier : 1;
      return {
        current: current * multiplier,
        previous: previous * multiplier,
        source: {
          page: page.number,
          label: match?.[0] ?? line,
          unit: applyUnit ? `${unit.label}（已换算为元）` : '元/股',
        },
      };
    }
  }
  return null;
}

function allPairsFromMatch(pages: TextPage[], patterns: RegExp[]) {
  const results: ValuePair[] = [];
  const unit = unitInfo(pages.map((item) => item.text).join('\n'));
  for (const page of pages) {
    for (const line of page.lines) {
      const pattern = patterns.find((candidate) => candidate.test(line));
      if (!pattern) continue;
      const match = line.match(pattern);
      const start =
        match?.index === undefined ? 0 : match.index + match[0].length;
      const values = numberTokens(line.slice(start));
      if (values.length < 2 || isOrdinalPlaceholder(values)) continue;
      const pair = values.slice(-2);
      results.push({
        current: pair[0] * unit.multiplier,
        previous: pair[1] * unit.multiplier,
        source: {
          page: page.number,
          label: match?.[0] ?? line,
          unit: `${unit.label}（已换算为元）`,
        },
      });
    }
  }
  return results;
}

function pairsBySection(pages: TextPage[], patterns: RegExp[]) {
  const current: ValuePair[] = [];
  const nonCurrent: ValuePair[] = [];
  const unclassified: ValuePair[] = [];
  const unit = unitInfo(pages.map((item) => item.text).join('\n'));
  let section: 'current' | 'non_current' | null = null;
  for (const page of pages) {
    for (const line of page.lines) {
      if (
        /^(?:非流动负债|非流動負債|Non-current liabilities)(?:[：:]|\s|$)/i.test(
          line,
        )
      )
        section = 'non_current';
      else if (
        /^(?:流动负债|流動負債|Current liabilities)(?:[：:]|\s|$)/i.test(line)
      )
        section = 'current';
      const pattern = patterns.find((candidate) => candidate.test(line));
      if (!pattern) continue;
      const match = line.match(pattern);
      const start =
        match?.index === undefined ? 0 : match.index + match[0].length;
      const values = numberTokens(line.slice(start));
      if (values.length < 2) continue;
      const pair: ValuePair = {
        current: values.at(-2)! * unit.multiplier,
        previous: values.at(-1)! * unit.multiplier,
        source: {
          page: page.number,
          label: `${section === 'current' ? '流动' : section === 'non_current' ? '非流动' : '未分类'}${match?.[0] ?? line}`,
          unit: `${unit.label}（已换算为元）`,
        },
      };
      if (section === 'current') current.push(pair);
      else if (section === 'non_current') nonCurrent.push(pair);
      else unclassified.push(pair);
    }
  }
  return { current, nonCurrent, unclassified };
}

function sumPairs(
  pairs: ValuePair[],
  label: string,
  formula = '所列项目相加',
): ValuePair | null {
  if (!pairs.length) return null;
  const pages = [...new Set(pairs.map((pair) => pair.source.page))];
  return {
    current: pairs.reduce((sum, pair) => sum + (pair.current ?? 0), 0),
    previous: pairs.reduce((sum, pair) => sum + (pair.previous ?? 0), 0),
    source: {
      page: pages[0],
      pages,
      label,
      unit: pairs[0].source.unit,
      formula,
    },
  };
}

function sumAbsolutePairs(pairs: ValuePair[], label: string): ValuePair | null {
  if (!pairs.length) return null;
  const pages = [...new Set(pairs.map((pair) => pair.source.page))];
  return {
    current: pairs.reduce((sum, pair) => sum + Math.abs(pair.current ?? 0), 0),
    previous: pairs.reduce(
      (sum, pair) => sum + Math.abs(pair.previous ?? 0),
      0,
    ),
    source: {
      page: pages[0],
      pages,
      label,
      unit: pairs[0].source.unit,
      formula: '购建固定资产、无形资产和土地使用权现金支出相加',
    },
  };
}

function setPair(
  current: MetricPoint,
  previous: MetricPoint,
  key: string,
  pair: ValuePair | null,
) {
  if (!pair) return;
  if (pair.current !== undefined) current[key] = pair.current;
  if (pair.previous !== undefined) previous[key] = pair.previous;
  current.metricSources ??= {};
  previous.metricSources ??= {};
  current.metricSources[key] = pair.source;
  previous.metricSources[key] = pair.source;
}

function sourcePages(source: MetricSource) {
  return source.pages ?? (source.page ? [source.page] : []);
}

function addDerived(point: MetricPoint) {
  if (
    typeof point.cash === 'number' &&
    typeof point.longTermDebt === 'number'
  ) {
    point.lynchNetCash = point.cash - point.longTermDebt;
    const cashSource = point.metricSources?.cash;
    const debtSource = point.metricSources?.longTermDebt;
    if (cashSource && debtSource) {
      point.metricSources ??= {};
      point.metricSources.lynchNetCash = {
        page: cashSource.page ?? debtSource.page,
        pages: [
          ...new Set([...sourcePages(cashSource), ...sourcePages(debtSource)]),
        ],
        label: '林奇口径净现金',
        unit: '元',
        formula: '现金－长期债务',
      };
    }
  }
  if (
    typeof point.cash === 'number' &&
    typeof point.interestBearingDebt === 'number'
  ) {
    point.conservativeNetCash = point.cash - point.interestBearingDebt;
    point.netCash = point.conservativeNetCash;
    const cashSource = point.metricSources?.cash;
    const debtSource = point.metricSources?.interestBearingDebt;
    if (cashSource && debtSource) {
      point.metricSources ??= {};
      const source: MetricSource = {
        page: cashSource.page ?? debtSource.page,
        pages: [
          ...new Set([...sourcePages(cashSource), ...sourcePages(debtSource)]),
        ],
        label: '保守代理净现金',
        unit: '元',
        formula:
          '现金－全部有息负债；若无法取得受限资金明细，现金端仍可能包含受限资金',
      };
      point.metricSources.conservativeNetCash = source;
      point.metricSources.netCash = source;
    }
  }
  if (
    typeof point.operatingCashFlow === 'number' &&
    typeof point.capitalExpenditure === 'number'
  ) {
    point.freeCashFlow = point.operatingCashFlow - point.capitalExpenditure;
    const operatingSource = point.metricSources?.operatingCashFlow;
    const capitalSource = point.metricSources?.capitalExpenditure;
    if (operatingSource && capitalSource) {
      point.metricSources ??= {};
      point.metricSources.freeCashFlow = {
        page: operatingSource.page ?? capitalSource.page,
        pages: [
          ...new Set([
            ...sourcePages(operatingSource),
            ...sourcePages(capitalSource),
          ]),
        ],
        label: '自由现金流代理值',
        unit: '元',
        formula: '经营现金流－全部资本性现金支出；未区分维持性与扩张性资本支出',
      };
    }
  }
  if (
    typeof point.shareholdersEquity === 'number' &&
    typeof point.totalAssets === 'number' &&
    point.totalAssets !== 0
  ) {
    point.equityRatio = (point.shareholdersEquity / point.totalAssets) * 100;
  }
  if (
    typeof point.totalLiabilities === 'number' &&
    typeof point.totalAssets === 'number' &&
    point.totalAssets !== 0
  ) {
    point.debtRatio = (point.totalLiabilities / point.totalAssets) * 100;
  }
  if (
    typeof point.pretaxProfit === 'number' &&
    typeof point.revenue === 'number' &&
    point.revenue !== 0
  ) {
    point.pretaxMargin = (point.pretaxProfit / point.revenue) * 100;
  }
  if (
    typeof point.netProfit === 'number' &&
    typeof point.eps === 'number' &&
    point.eps !== 0
  ) {
    point.sharesOutstanding = point.netProfit / point.eps;
    point.metricSources ??= {};
    point.metricSources.sharesOutstanding = {
      label: '加权平均股本代理值',
      unit: '股',
      formula: '归母净利润÷基本每股收益；不等同于期末流通股本',
    };
    if (typeof point.lynchNetCash === 'number' && point.sharesOutstanding > 0)
      point.lynchNetCashPerShare = point.lynchNetCash / point.sharesOutstanding;
    if (
      typeof point.conservativeNetCash === 'number' &&
      point.sharesOutstanding > 0
    ) {
      point.conservativeNetCashPerShare =
        point.conservativeNetCash / point.sharesOutstanding;
      point.netCashPerShare = point.conservativeNetCashPerShare;
    }
  }
}

function reportPeriods(filing: OfficialFiling) {
  const year = filing.fiscalYear;
  if (!year) throw new Error('定期报告缺少财政年度');
  if (filing.reportKind === 'q1')
    return { current: `${year}Q1`, previous: `${year - 1}Q1` };
  if (filing.reportKind === 'half_year')
    return { current: `${year}H1`, previous: `${year - 1}H1` };
  if (filing.reportKind === 'q3')
    return { current: `${year}Q3`, previous: `${year - 1}Q3` };
  return { current: String(year), previous: String(year - 1) };
}

const STATEMENT_OUTLINE_HEADINGS = [
  /合并利润表/,
  /綜合收益表/,
  /Consolidated\s+(?:Income\s+Statement|Statement\s+of\s+Profit\s+or\s+Loss(?:\s+and\s+Other\s+Comprehensive\s+Income)?)/i,
  /合并资产负债表/,
  /綜合財務狀況表/,
  /Consolidated Statement of Financial Position/i,
  /合并现金流量表/,
  /綜合現金流量表/,
  /Consolidated Statement of Cash Flows/i,
];

const NARRATIVE_KEYWORDS: Record<NarrativeEvidenceTopic, RegExp> = {
  business:
    /主营业务|主要业务|主要产品|业务模式|principal activities|business review|revenue by segment/i,
  customers:
    /前五名客户|五大客户|最大客户|主要客户|客户集中|five largest customers|largest customer|customer concentration/i,
  ownership:
    /机构持股|机构投资者|前十名股东|持股情况|institutional ownership|substantial shareholders?|shareholding structure/i,
  product:
    /产品结构|主要产品|产品收入|品牌系列|product mix|principal products?|revenue by product/i,
  industry:
    /行业环境|行业发展|行业格局|市场需求|供需|industry outlook|industry development|market demand|supply and demand/i,
  competition:
    /竞争格局|竞争优势|市场地位|市场份额|competitive advantage|competition|market position|market share/i,
  expansion:
    /扩张计划|扩产|新增产能|门店拓展|增长计划|expansion plan|capacity expansion|new stores|growth plan/i,
  acquisition:
    /收购|并购|重大资产重组|对外投资|acquisition|merger|business combination|external investment/i,
  technology:
    /研发投入|核心技术|技术创新|数字化|research and development|core technolog|technological innovation|digitalization/i,
  risk:
    /经营风险|风险因素|重大风险|持续经营|principal risks?|risk factors?|going concern/i,
  debt:
    /债务到期|借款到期|有息负债|融资安排|debt maturit|borrowings? due|interest-bearing debt|financing arrangement/i,
  dividend: /股息|分红|派息|dividend|distribution/i,
  buyback: /回购|购回股份|share repurchase|buyback/i,
  insider:
    /董事权益|董事持股|管理层持股|董监高增持|董监高减持|directors?' interests|management shareholding|insider (?:buying|selling)/i,
  spinoff: /分拆|剥离|出售附属|spin[- ]?off|divest(?:ment|ed)?/i,
  assets:
    /投资物业|土地储备|矿业权|品牌价值|隐蔽资产|investment propert|land bank|mineral rights|brand value|hidden assets/i,
};

const MAX_NARRATIVE_EVIDENCE = 36;
const MAX_NARRATIVE_PER_TOPIC = 2;
const MAX_NARRATIVE_QUOTE_LENGTH = 360;

function extractNarrativeEvidence(
  pages: TextPage[],
  reportRefId: string,
): NarrativeEvidence[] {
  const evidence: NarrativeEvidence[] = [];
  const seen = new Set<string>();
  for (const [topic, keyword] of Object.entries(NARRATIVE_KEYWORDS) as Array<[
    NarrativeEvidenceTopic,
    RegExp,
  ]>) {
    let topicCount = 0;
    for (const page of pages) {
      for (let index = 0; index < page.lines.length; index += 1) {
        if (!keyword.test(page.lines[index])) continue;
        const quote = page.lines
          .slice(Math.max(0, index - 1), index + 2)
          .join(' ')
          .slice(0, MAX_NARRATIVE_QUOTE_LENGTH)
          .trim();
        const dedupeKey = quote.toLocaleLowerCase();
        if (!quote || seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        evidence.push({ topic, reportRefId, page: page.number, quote });
        topicCount += 1;
        if (
          topicCount >= MAX_NARRATIVE_PER_TOPIC ||
          evidence.length >= MAX_NARRATIVE_EVIDENCE
        )
          break;
      }
      if (
        topicCount >= MAX_NARRATIVE_PER_TOPIC ||
        evidence.length >= MAX_NARRATIVE_EVIDENCE
      )
        break;
    }
    if (evidence.length >= MAX_NARRATIVE_EVIDENCE) break;
  }
  return evidence;
}

async function pageText(
  pdf: Awaited<ReturnType<typeof getDocumentProxy>>,
  pageNumber: number,
) {
  const content = await (await pdf.getPage(pageNumber)).getTextContent();
  return content.items
    .filter((item) => 'str' in item)
    .map((item) => ('str' in item ? item.str + (item.hasEOL ? '\n' : '') : ''))
    .join('');
}

async function outlinedStatementPages(
  pdf: Awaited<ReturnType<typeof getDocumentProxy>>,
) {
  const outline = await pdf.getOutline();
  if (!outline?.length) return [];
  const items = outline.flatMap(function flatten(item): typeof outline {
    return [item, ...(item.items?.flatMap(flatten) ?? [])];
  });
  const starts: number[] = [];
  for (const item of items) {
    if (!STATEMENT_OUTLINE_HEADINGS.some((pattern) => pattern.test(item.title)))
      continue;
    const destination =
      typeof item.dest === 'string'
        ? await pdf.getDestination(item.dest)
        : item.dest;
    const pageRef = destination?.[0];
    if (!pageRef || typeof pageRef === 'number') continue;
    starts.push((await pdf.getPageIndex(pageRef)) + 1);
  }
  if (starts.length < 3) return [];
  const pageNumbers = [
    ...new Set(starts.flatMap((start) => [start, start + 1, start + 2])),
  ]
    .filter((pageNumber) => pageNumber <= pdf.numPages)
    .sort((a, b) => a - b);
  const texts = await Promise.all(
    pageNumbers.map((pageNumber) => pageText(pdf, pageNumber)),
  );
  return texts.map((text, index) => ({
    number: pageNumbers[index],
    text,
    lines: text.split(/\r?\n/).map(cleanLine).filter(Boolean),
  }));
}

export async function extractFinancialReport(
  bytes: Uint8Array,
  filing: OfficialFiling,
  options: FinancialReportExtractionOptions = {},
): Promise<FinancialReportExtraction> {
  if (!filing.fiscalYear) throw new Error('定期报告缺少财政年度');
  const pdf = await getDocumentProxy(bytes);
  let pages = await outlinedStatementPages(pdf);
  if (!pages.length) {
    const extracted = await extractText(pdf);
    pages = extracted.text.map((text, index) => ({
      number: index + 1,
      text,
      lines: text.split(/\r?\n/).map(cleanLine).filter(Boolean),
    }));
  }
  let narrativePages = pages;
  if (options.includeNarrative && pages.length < pdf.numPages) {
    const extracted = await extractText(pdf);
    narrativePages = extracted.text.map((text, index) => ({
      number: index + 1,
      text,
      lines: text.split(/\r?\n/).map(cleanLine).filter(Boolean),
    }));
  }

  const incomeStart = findStartPage(
    pages,
    [
      /合并(?:年初[到至]报告期末)?利润表/,
      /綜合收益表/,
      /Consolidated Income Statement/i,
      /Consolidated\s+Statement\s+of\s+Profit\s+or\s+Loss(?:\s+and\s+Other\s+Comprehensive\s+Income)?/i,
    ],
    [
      /营业总收入|Revenues|REVENUE\b|Value-added Services/i,
      /营业成本|Cost of revenues/i,
    ],
  );
  const balanceStart = findStartPage(
    pages,
    [
      /合并资产负债表/,
      /綜合財務狀況表/,
      /Consolidated Statement of Financial Position/i,
    ],
    [
      /货币资金|Cash and cash equivalents|Cash and bank balances/i,
      /流动资产|Current assets/i,
    ],
  );
  const cashFlowStart = findStartPage(
    pages,
    [
      /合并(?:年初[到至]报告期末)?现金流量表/,
      /綜合現金流量表/,
      /Consolidated Statement of Cash Flows/i,
    ],
    [
      /经营活动产生的现金流量|Cash flows from operating activities|Net cash flows/i,
    ],
  );
  const income = statementPages(pages, incomeStart);
  const balance = statementPages(pages, balanceStart);
  const cashFlow = statementPages(pages, cashFlowStart);

  const reportId = filing.id;
  const periods = reportPeriods(filing);
  const current: MetricPoint = {
    period: periods.current,
    reportRefIds: [reportId],
  };
  const previous: MetricPoint = {
    period: periods.previous,
    reportRefIds: [reportId],
  };

  let revenue = pairFromMatch(income, [
    /^其中[：:]?营业收入/,
    /^一、营业收入/,
    /^营业收入/,
    /^营业总收入/,
    /^Revenues?\b/i,
  ]);
  if (!revenue) {
    revenue = sumPairs(
      [
        pairFromMatch(income, [/^Value-added Services/i], 0),
        pairFromMatch(
          income,
          [/^Marketing Services/i, /^Online Advertising/i],
          0,
        ),
        pairFromMatch(income, [/^FinTech and Business Services/i], 0),
        pairFromMatch(income, [/^Others\b/i], 0),
      ].filter((item): item is ValuePair => item !== null),
      '收入分部合计',
      '各收入分部相加',
    );
  }
  setPair(current, previous, 'revenue', revenue);
  setPair(current, previous, 'grossProfit', pairFromMatch(income, [/^Gross profit\b/i], 0));
  setPair(current, previous, 'operatingProfit', pairFromMatch(income, [/^Operating profit\b/i, /^Profit from operations\b/i], 0));
  setPair(
    current,
    previous,
    'netProfit',
    pairFromMatch(income, [
      /归属于母公司(?:股东|所有者)的净利润/,
      /归属于上市公司股东的净利润/,
      /^Equity holders of the Company/i,
      /^Owners of the Company/i,
      /Profit attributable to owners of the Company/i,
      /Attributable to owners of the parent/i,
    ], 6),
  );
  setPair(
    current,
    previous,
    'pretaxProfit',
    pairFromMatch(income, [
      /^四、利润总额/,
      /^利润总额/,
      /^Profit before (?:income )?tax/i,
      /^Profit before taxation/i,
    ]),
  );
  setPair(
    current,
    previous,
    'eps',
    pairFromMatch(
      income,
      [/基本每股收益/, /^[–—-]\s*basic\b/i, /^Basic earnings per share/i, /^Basic and diluted\b/i, /^Basic\s*$/i],
      2,
      false,
    ),
  );
  const flowKeys = new Set(Object.keys(previous));
  const totalAssets = pairFromMatch(
    balance,
    [
      /^资产总计(?:\s|$)/,
      /^資產總額(?:\s|$)/,
      /^Total assets(?!\s+less current liabilities)(?:\s|$)/i,
    ],
    0,
  );
  const totalNonCurrentAssets = pairFromMatch(
    balance,
    [
      /^非流动资产合计/,
      /^非流動資產總額/,
      /^Total non-current assets(?:\s|$)/i,
    ],
    0,
  );
  const totalCurrentAssets = pairFromMatch(
    balance,
    [/^流动资产合计/, /^流動資產總額/, /^Total current assets(?:\s|$)/i],
    0,
  );
  setPair(
    current,
    previous,
    'totalAssets',
    totalAssets ??
      (totalNonCurrentAssets && totalCurrentAssets
        ? sumPairs(
            [totalNonCurrentAssets, totalCurrentAssets],
            '资产总额（由流动及非流动资产合计推导）',
            '非流动资产合计＋流动资产合计',
          )
        : null),
  );
  const totalLiabilities = pairFromMatch(
    balance,
    [/^负债合计(?:\s|$)/, /^負債總額(?:\s|$)/, /^Total liabilities(?:\s|$)/i],
    0,
  );
  setPair(
    current,
    previous,
    'shareholdersEquity',
    pairFromMatch(
      balance,
      [
        /^归属于母公司所有者权益合计/,
        /^归属于母公司股东权益合计/,
        /^Equity attributable to (?:equity holders|owners) of the Company/i,
        /^Total equity\b/i,
      ],
      0,
    ),
  );
  if (totalLiabilities) {
    setPair(current, previous, 'totalLiabilities', totalLiabilities);
  } else if (
    typeof current.totalAssets === 'number' &&
    typeof previous.totalAssets === 'number' &&
    typeof current.shareholdersEquity === 'number' &&
    typeof previous.shareholdersEquity === 'number'
  ) {
    const assetsSource = current.metricSources?.totalAssets;
    const equitySource = current.metricSources?.shareholdersEquity;
    if (assetsSource && equitySource) {
      setPair(current, previous, 'totalLiabilities', {
        current: current.totalAssets - current.shareholdersEquity,
        previous: previous.totalAssets - previous.shareholdersEquity,
        source: {
          page: assetsSource.page ?? equitySource.page ?? 0,
          pages: [
            ...new Set([
              ...sourcePages(assetsSource),
              ...sourcePages(equitySource),
            ]),
          ],
          label: '负债总额（由资产总额及股东权益推导）',
          unit: '元',
          formula: '资产总额－股东权益',
        },
      });
    }
  }
  setPair(
    current,
    previous,
    'cash',
    pairFromMatch(
      balance,
      [
        /^货币资金/,
        /^現金及現金等價物/,
        /^Cash and cash equivalents/i,
        /^Bank balances and cash/i,
        /^Cash and bank balances/i,
      ],
      0,
    ),
  );
  setPair(
    current,
    previous,
    'inventory',
    pairFromMatch(balance, [/^存货/, /^存貨/, /^Inventories\b/i], 0),
  );
  setPair(current, previous, 'tradeReceivables', pairFromMatch(balance, [/^Trade receivables\b/i], 0));
  setPair(current, previous, 'tradePayables', pairFromMatch(balance, [/^Trade payables\b/i], 0));
  const sectionBorrowings = pairsBySection(balance, [
    /^借款$/,
    /^Borrowings(?! due )\b/i,
    /^Bank borrowings\b/i,
    /^Other borrowings\b/i,
    /^Interest-bearing bank(?: and other)? borrowings\b/i,
  ]);
  const shortTermBorrowings = sumPairs(
    [
      ...allPairsFromMatch(balance, [
        /^短期借款/,
        /^Short[- ]term (?:bank )?borrowings\b/i,
        /^Current (?:bank )?borrowings\b/i,
      ]),
      ...sectionBorrowings.current,
    ],
    '短期借款',
  );
  const currentPortionNonCurrentLiabilities = sumPairs(
    allPairsFromMatch(balance, [
      /^一年内到期的非流动负债/,
      /^Current portion of (?:long[- ]term )?(?:bank )?borrowings\b/i,
      /^Borrowings due within one year\b/i,
    ]),
    '一年内到期的非流动负债（有息债务代理）',
  );
  const longTermBorrowings = sumPairs(
    [
      ...allPairsFromMatch(balance, [
        /^长期借款/,
        /^Long[- ]term (?:bank )?borrowings\b/i,
        /^Non-current (?:bank )?borrowings\b/i,
        /^Borrowings due after one year\b/i,
      ]),
      ...sectionBorrowings.nonCurrent,
    ],
    '长期借款',
  );
  const bondsPayable = sumPairs(
    allPairsFromMatch(balance, [
      /^应付债券/,
      /^Bonds payable\b/i,
      /^Debentures\b/i,
      /^Notes payable\b/i,
      /^Senior notes\b/i,
    ]),
    '应付债券／融资票据',
  );
  const sectionLeaseLiabilities = pairsBySection(balance, [
    /^租赁负债/,
    /^Lease liabilities\b/i,
  ]);
  const classifiedLeasePairs = [
    ...sectionLeaseLiabilities.current,
    ...sectionLeaseLiabilities.nonCurrent,
  ];
  const unclassifiedLeaseLiabilities = sumPairs(
    sectionLeaseLiabilities.unclassified.length || classifiedLeasePairs.length
      ? sectionLeaseLiabilities.unclassified
      : allPairsFromMatch(balance, [/^租赁负债/, /^Lease liabilities\b/i]),
    '未分类租赁负债',
  );
  const currentLeaseLiabilities = sumPairs(
    sectionLeaseLiabilities.current,
    '流动租赁负债',
  );
  const nonCurrentLeaseLiabilities = sumPairs(
    sectionLeaseLiabilities.nonCurrent,
    '非流动租赁负债',
  );
  const leaseLiabilities = sumPairs(
    [
      currentLeaseLiabilities,
      nonCurrentLeaseLiabilities,
      unclassifiedLeaseLiabilities,
    ].filter((item): item is ValuePair => item !== null),
    '租赁负债合计',
  );
  const unclassifiedBorrowings = sumPairs(
    sectionBorrowings.unclassified.length ||
      sectionBorrowings.current.length ||
      sectionBorrowings.nonCurrent.length
      ? sectionBorrowings.unclassified
      : allPairsFromMatch(balance, [
          /^借款$/,
          /^Borrowings(?! due )\b/i,
          /^Bank borrowings\b/i,
          /^Other borrowings\b/i,
        ]),
    '未分类借款',
  );
  setPair(current, previous, 'shortTermBorrowings', shortTermBorrowings);
  setPair(
    current,
    previous,
    'currentPortionNonCurrentLiabilities',
    currentPortionNonCurrentLiabilities,
  );
  setPair(current, previous, 'longTermBorrowings', longTermBorrowings);
  setPair(current, previous, 'bondsPayable', bondsPayable);
  setPair(
    current,
    previous,
    'currentLeaseLiabilities',
    currentLeaseLiabilities,
  );
  setPair(
    current,
    previous,
    'nonCurrentLeaseLiabilities',
    nonCurrentLeaseLiabilities,
  );
  setPair(
    current,
    previous,
    'unclassifiedLeaseLiabilities',
    unclassifiedLeaseLiabilities,
  );
  setPair(current, previous, 'leaseLiabilities', leaseLiabilities);
  setPair(current, previous, 'unclassifiedBorrowings', unclassifiedBorrowings);
  const longTermDebt =
    unclassifiedBorrowings || unclassifiedLeaseLiabilities
      ? null
      : sumPairs(
          [longTermBorrowings, bondsPayable, nonCurrentLeaseLiabilities].filter(
            (item): item is ValuePair => item !== null,
          ),
          '林奇口径长期债务',
          '长期借款＋应付债券/融资票据＋非流动租赁负债',
        );
  setPair(current, previous, 'longTermDebt', longTermDebt);
  const detailedBorrowings = [
    shortTermBorrowings,
    currentPortionNonCurrentLiabilities,
    longTermBorrowings,
  ].filter((item): item is ValuePair => item !== null);
  const leaseDebtForTotal = currentPortionNonCurrentLiabilities
    ? nonCurrentLeaseLiabilities
    : leaseLiabilities;
  setPair(
    current,
    previous,
    'interestBearingDebt',
    sumPairs(
      [
        unclassifiedBorrowings ??
          sumPairs(detailedBorrowings, '短期及长期借款合计'),
        bondsPayable,
        leaseDebtForTotal,
      ].filter((item): item is ValuePair => item !== null),
      '全部有息负债（保守代理）',
      '短期借款＋一年内到期非流动负债＋长期借款＋应付债券/融资票据＋租赁负债；若“一年内到期非流动负债”已包含流动租赁部分，则只另加非流动租赁负债',
    ),
  );
  if (filing.reportKind === 'half_year' && /^\d{5}$/.test(filing.code)) {
    // HK interim comparative balance columns are prior year-end balances.
    // Keep comparative income/cash flows, but never label December as June.
    // The actual previous interim report supplies that period's balance.
    for (const key of Object.keys(previous)) {
      if (flowKeys.has(key) || key === 'metricSources') continue;
      delete previous[key];
      if (previous.metricSources) delete previous.metricSources[key];
    }
  }
  setPair(
    current,
    previous,
    'operatingCashFlow',
    pairFromMatch(cashFlow, [
      /^经营活动产生的现金流量净额/,
      /^经营活动产生的现金流$/,
      /經營活動所得現金流量淨額/,
      /Net cash flows generated from operating activities/i,
      /Net cash flows from operating activities/i,
      /Net cash generated from operating activities/i,
      /Net cash flows used in operating activities/i,
      /Net cash flows \(used in\)\/from operating activities/i,
    ]),
  );
  setPair(
    current,
    previous,
    'capitalExpenditure',
    sumAbsolutePairs(
      [
        pairFromMatch(cashFlow, [
          /购建固定资产/,
          /^Purchase of(?:\/prepayments?)? (?:for )?property, plant and equipment/i,
          /^Purchases of items of property, plant and equipment\b/i,
        ]),
        pairFromMatch(cashFlow, [
          /^Purchase of(?:\/prepayments?)? for intangible assets/i,
        ]),
        pairFromMatch(cashFlow, [
          /^Purchase of(?:\/prepayments?)? for land use rights/i,
        ]),
      ].filter((item): item is ValuePair => item !== null),
      '资本支出',
    ),
  );

  addDerived(current);
  addDerived(previous);
  const warnings: string[] = [];
  const required = [
    'revenue',
    'netProfit',
    'eps',
    'cash',
    'interestBearingDebt',
    'operatingCashFlow',
    'capitalExpenditure',
  ];
  for (const key of required) {
    if (typeof current[key] !== 'number')
      warnings.push(`${filing.fiscalYear}年缺少${key}`);
  }

  return {
    points: [previous, current],
    financialCurrency: financialCurrency(
      [...income, ...balance, ...cashFlow].map((page) => page.text).join('\n'),
    ),
    warnings,
    ...(options.includeNarrative
      ? {
          narrativeEvidence: extractNarrativeEvidence(
            narrativePages,
            filing.id,
          ),
        }
      : {}),
  };
}

export async function extractAnnualReport(
  bytes: Uint8Array,
  filing: OfficialFiling,
  options: FinancialReportExtractionOptions = {},
): Promise<FinancialReportExtraction> {
  if (filing.reportKind !== 'annual') throw new Error('不是年度报告');
  return extractFinancialReport(bytes, filing, options);
}
