import { ahPairCode } from '@/lib/ah-pairs';
import {
  filingCoverage,
  financialCompanyByName,
  reportingPolicyFor,
  type OfficialFiling,
  type OfficialLookup,
} from '@/lib/official-filings';

const HKEX_BASE = 'https://www1.hkexnews.hk';

type HkStock = { code: string; id: string; name: string };
type HkexRecord = Record<string, unknown>;

function stringField(row: HkexRecord, ...keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === 'string' || typeof value === 'number')
      return String(value).trim();
  }
  return '';
}

function collectStocks(value: unknown, result: HkStock[] = []): HkStock[] {
  if (Array.isArray(value)) {
    value.forEach((item) => collectStocks(item, result));
    return result;
  }
  if (!value || typeof value !== 'object') return result;
  const row = value as HkexRecord;
  const code = stringField(row, 'c', 'code', 'stockCode', 'stock_code');
  const id = stringField(row, 'i', 'id', 'stockId', 'stock_id');
  const name = stringField(row, 'n', 'name', 'stockName', 'stock_name');
  if (/^\d{1,5}$/.test(code) && id && name)
    result.push({ code: code.padStart(5, '0'), id, name });
  Object.values(row).forEach((item) => collectStocks(item, result));
  return result;
}

function collectAnnouncementRows(value: unknown): HkexRecord[] {
  if (Array.isArray(value))
    return value.filter(
      (item): item is HkexRecord => !!item && typeof item === 'object',
    );
  if (!value || typeof value !== 'object') return [];
  const row = value as HkexRecord;
  for (const key of ['result', 'records', 'announcements', 'data']) {
    const child = row[key];
    if (Array.isArray(child)) return collectAnnouncementRows(child);
  }
  return [];
}

function classifyReport(title: string): OfficialFiling['reportKind'] | null {
  if (/(ANNUAL REPORT|年度報告|年度报告|年報|年报)/i.test(title))
    return 'annual';
  if (/(INTERIM REPORT|HALF[- ]YEAR REPORT|中期報告|中期报告|半年報告|半年报告)/i.test(title))
    return 'half_year';
  if (/(FIRST QUARTERLY REPORT|第一季度報告|第一季度报告)/i.test(title))
    return 'q1';
  if (/(THIRD QUARTERLY REPORT|第三季度報告|第三季度报告)/i.test(title))
    return 'q3';
  if (/(QUARTERLY REPORT|季度報告|季度报告)/i.test(title)) return 'quarterly';
  return null;
}

function normalizeDate(value: string) {
  const yearFirst = value.match(/(20\d{2})[/-](\d{1,2})[/-](\d{1,2})/);
  if (yearFirst)
    return `${yearFirst[1]}-${yearFirst[2].padStart(2, '0')}-${yearFirst[3].padStart(2, '0')}`;
  const dayFirst = value.match(/(\d{1,2})[/-](\d{1,2})[/-](20\d{2})/);
  if (dayFirst)
    return `${dayFirst[3]}-${dayFirst[2].padStart(2, '0')}-${dayFirst[1].padStart(2, '0')}`;
  return '';
}

function inferredFiscalYear(
  title: string,
  date: string,
  kind: OfficialFiling['reportKind'],
) {
  const explicit = Number(title.match(/(20\d{2})/)?.[1]);
  if (explicit) return explicit;
  const publicationYear = Number(date.slice(0, 4));
  if (!publicationYear) return undefined;
  return kind === 'annual' ? publicationYear - 1 : publicationYear;
}

function selectReportPeriods(reports: OfficialFiling[]) {
  const displayPreference = (report: OfficialFiling) =>
    (report.isCorrection ? 10 : 0) +
    (report.language === 'bilingual' ? 3 : report.language === 'zh' ? 2 : 1);
  const grouped = new Map<string, OfficialFiling[]>();
  for (const report of reports) {
    const key = report.fiscalYear
      ? `${report.reportKind}:${report.fiscalYear}`
      : report.id;
    grouped.set(key, [...(grouped.get(key) ?? []), report]);
  }
  const selected = [...grouped.values()]
    .map((versions) => {
      const display = [...versions].sort(
        (a, b) => displayPreference(b) - displayPreference(a),
      )[0];
      const english = versions.find((report) => report.language === 'en');
      return english && english.url !== display.url
        ? {
            ...display,
            extractionUrl: english.url,
            extractionTitle: english.title,
          }
        : display;
    })
    .sort((a, b) => b.date.localeCompare(a.date));
  const limits: Record<OfficialFiling['reportKind'], number> = {
    annual: 10,
    half_year: 10,
    q1: 12,
    q3: 12,
    quarterly: 12,
  };
  const counts = new Map<OfficialFiling['reportKind'], number>();
  return selected.filter((report) => {
    const count = counts.get(report.reportKind) ?? 0;
    if (count >= limits[report.reportKind]) return false;
    counts.set(report.reportKind, count + 1);
    return true;
  });
}

function languageOf(title: string): OfficialFiling['language'] {
  const hasChinese = /[\u3400-\u9fff]/.test(title);
  const hasLatin = /[A-Za-z]/.test(title);
  return hasChinese && hasLatin
    ? 'bilingual'
    : hasChinese
      ? 'zh'
      : hasLatin
        ? 'en'
        : 'unknown';
}

async function activeStocks(language: 'e' | 'c') {
  const response = await fetch(
    `${HKEX_BASE}/ncms/script/eds/activestock_sehk_${language}.json`,
    {
      headers: {
        Accept: 'application/json, text/plain, */*',
        Referer: `${HKEX_BASE}/search/titlesearch.xhtml`,
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
      },
    },
  );
  if (!response.ok)
    throw new Error(`港交所证券列表查询失败：${response.status}`);
  return collectStocks(await response.json());
}

async function titleSearch(stockId: string, language: 'en' | 'zh') {
  const today = new Date();
  const start = new Date(today);
  start.setUTCFullYear(start.getUTCFullYear() - 11);
  const compact = (date: Date) =>
    date.toISOString().slice(0, 10).replaceAll('-', '');
  const params = new URLSearchParams({
    sortDir: '0',
    sortByOptions: 'DateTime',
    category: '0',
    market: 'SEHK',
    stockId,
    documentType: '-1',
    fromDate: compact(start),
    toDate: compact(today),
    title: '',
    searchType: '1',
    t1code: '40000',
    t2Gcode: '-2',
    t2code: '-2',
    rowRange: '2000',
    lang: language,
  });
  const response = await fetch(
    `${HKEX_BASE}/search/titleSearchServlet.do?${params.toString()}`,
    {
      headers: {
        Accept: 'application/json, text/javascript, */*; q=0.01',
        Referer: `${HKEX_BASE}/search/titlesearch.xhtml?lang=${language}`,
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
        'X-Requested-With': 'XMLHttpRequest',
      },
    },
  );
  if (!response.ok) throw new Error(`港交所公告查询失败：${response.status}`);
  const outer = (await response.json()) as unknown;
  if (outer && typeof outer === 'object' && 'result' in outer) {
    const encoded = (outer as HkexRecord).result;
    if (typeof encoded === 'string') {
      try {
        return collectAnnouncementRows(JSON.parse(encoded));
      } catch {
        throw new Error('港交所公告返回格式无法识别');
      }
    }
  }
  return collectAnnouncementRows(outer);
}

export async function lookupHkShare(code: string): Promise<OfficialLookup> {
  const [englishStocks, chineseStocks] = await Promise.all([
    activeStocks('e'),
    activeStocks('c').catch(() => []),
  ]);
  const stock = englishStocks.find((item) => item.code === code);
  if (!stock) throw new Error('港交所披露易未找到这个港股代码');
  const chinese = chineseStocks.find((item) => item.code === code);
  const rows = (
    await Promise.all([
      titleSearch(stock.id, 'en'),
      titleSearch(stock.id, 'zh').catch(() => []),
    ])
  ).flat();
  const seen = new Set<string>();
  const reports = selectReportPeriods(
    rows
    .map((row): OfficialFiling | null => {
      const title = stringField(row, 'TITLE', 'title', 'HEADLINE', 'headline');
      const kind = classifyReport(title);
      const link = stringField(row, 'FILE_LINK', 'fileLink', 'link', 'url');
      const date = normalizeDate(
        stringField(row, 'DATE_TIME', 'dateTime', 'RELEASE_TIME', 'date'),
      );
      const id = link || `${date}:${title}`;
      if (
        !kind ||
        !id ||
        seen.has(id) ||
        /(ENVIRONMENTAL|SOCIAL|GOVERNANCE|SUSTAINABILITY|ESG|環境、社會|可持續發展)/i.test(
          title,
        )
      )
        return null;
      seen.add(id);
      return {
        id,
        code,
        companyName: chinese?.name || stock.name,
        title,
        date,
        fileType: stringField(row, 'FILE_TYPE', 'fileType') || 'PDF',
        url: link.startsWith('http')
          ? link
          : `${HKEX_BASE}${link.startsWith('/') ? '' : '/'}${link}`,
        sourceName: '香港交易所披露易',
        reportKind: kind,
        fiscalYear: inferredFiscalYear(title, date, kind),
        language: languageOf(title),
        isCorrection: /(REVISED|UPDATED|更正|修訂|更新)/i.test(title),
        isSummary: false,
      };
    })
      .filter((item): item is OfficialFiling => item !== null),
  );
  const coverage = filingCoverage(reports);
  const companyName = chinese?.name || stock.name;
  const isFinancialCompany = financialCompanyByName(companyName);
  const warnings: string[] = [];
  if (coverage.annual < 10)
    warnings.push(`只找到${coverage.annual}份完整年报，可能是上市年限不足或报告仅以另一语言披露。`);
  if (coverage.halfYear < 10)
    warnings.push(`只找到${coverage.halfYear}份中期报告，将按实际可用报告期分析。`);
  if (coverage.quarterly === 0)
    warnings.push('这家公司没有披露可用季度报告；港股规则允许只用年报和中报，不会伪造季度数据。');

  return {
    company: {
      market: 'HK',
      exchange: 'HKEX',
      code,
      displayCode: code,
      companyName,
      companyNameEn: stock.name,
      issuerId: stock.id,
      currency: 'HKD',
      ahPairCode: ahPairCode(code),
      isFinancialCompany,
      rankEligible: !isFinancialCompany,
    },
    reports,
    coverage,
    reportingPolicy: reportingPolicyFor('HK'),
    source: {
      name: '香港交易所披露易',
      url: `${HKEX_BASE}/search/titlesearch.xhtml?category=0&market=SEHK&stockId=${encodeURIComponent(stock.id)}`,
      retrievedAt: new Date().toISOString(),
    },
    warnings,
  };
}
