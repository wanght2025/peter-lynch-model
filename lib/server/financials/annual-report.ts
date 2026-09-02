import { extractText, getDocumentProxy } from 'unpdf';

import type { MetricPoint, MetricSource } from '@/lib/analysis-types';
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

function unitInfo(text: string) {
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
    if (!heading.some((pattern) => pattern.test(page.text))) continue;
    const score = signals.filter((pattern) => pattern.test(page.text)).length;
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
      const line = page.lines[index];
      const pattern = patterns.find((candidate) => candidate.test(line));
      if (!pattern) continue;
      const match = line.match(pattern);
      const start =
        match?.index === undefined ? 0 : match.index + match[0].length;
      let values = numberTokens(line.slice(start));
      for (
        let offset = 1;
        values.length < 2 && offset <= followingLines;
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
      const pair =
        values.length === 2 &&
        Math.abs(values[0]) <= 200 &&
        Math.abs(values[1]) >= 1_000_000
          ? [values[1], 0]
          : values.length >= 2
            ? values.slice(-2)
            : [0, 0];
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
  /Consolidated (?:Income Statement|Statement of Profit or Loss)/i,
  /合并资产负债表/,
  /綜合財務狀況表/,
  /Consolidated Statement of Financial Position/i,
  /合并现金流量表/,
  /綜合現金流量表/,
  /Consolidated Statement of Cash Flows/i,
];

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

  const incomeStart = findStartPage(
    pages,
    [/合并利润表/, /綜合收益表/, /Consolidated Income Statement/i],
    [/营业总收入|Revenues|Value-added Services/i, /营业成本|Cost of revenues/i],
  );
  const balanceStart = findStartPage(
    pages,
    [
      /合并资产负债表/,
      /綜合財務狀況表/,
      /Consolidated Statement of Financial Position/i,
    ],
    [/货币资金|Cash and cash equivalents/i, /流动资产|Current assets/i],
  );
  const cashFlowStart = findStartPage(
    pages,
    [
      /合并现金流量表/,
      /綜合現金流量表/,
      /Consolidated Statement of Cash Flows/i,
    ],
    [/经营活动产生的现金流量|Cash flows from operating activities/i],
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
    /^Revenue\b/i,
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
  setPair(
    current,
    previous,
    'netProfit',
    pairFromMatch(income, [
      /归属于母公司(?:股东|所有者)的净利润/,
      /归属于上市公司股东的净利润/,
      /^Equity holders of the Company/i,
      /Profit attributable to owners of the Company/i,
    ]),
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
      [/基本每股收益/, /^[–—-]\s*basic\b/i, /^Basic earnings per share/i],
      2,
      false,
    ),
  );
  setPair(
    current,
    previous,
    'totalAssets',
    pairFromMatch(balance, [/^资产总计/, /^資產總額/, /^Total assets\b/i], 0),
  );
  setPair(
    current,
    previous,
    'totalLiabilities',
    pairFromMatch(
      balance,
      [/^负债合计/, /^負債總額/, /^Total liabilities\b/i],
      0,
    ),
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
  const sectionBorrowings = pairsBySection(balance, [
    /^借款$/,
    /^Borrowings(?! due )\b/i,
    /^Bank borrowings\b/i,
    /^Other borrowings\b/i,
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
  setPair(
    current,
    previous,
    'operatingCashFlow',
    pairFromMatch(cashFlow, [
      /^经营活动产生的现金流量净额/,
      /^经营活动产生的现金流$/,
      /經營活動所得現金流量淨額/,
      /Net cash flows generated from operating activities/i,
      /Net cash generated from operating activities/i,
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
  };
}

export async function extractAnnualReport(
  bytes: Uint8Array,
  filing: OfficialFiling,
): Promise<FinancialReportExtraction> {
  if (filing.reportKind !== 'annual') throw new Error('不是年度报告');
  return extractFinancialReport(bytes, filing);
}
