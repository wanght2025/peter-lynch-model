import { ahPairCode } from '@/lib/ah-pairs';
import {
  filingCoverage,
  financialCompanyByName,
  reportingPolicyFor,
  SecurityNotFoundError,
  type OfficialFiling,
  type OfficialLookup,
} from '@/lib/official-filings';

const CNINFO_BASE = 'https://www.cninfo.com.cn';

type CninfoSecurity = {
  code?: string | number;
  zwjc?: string;
  secName?: string;
  orgId?: string;
  plate?: string;
};

type CninfoAnnouncement = {
  announcementId?: string;
  announcementTitle?: string;
  announcementTime?: number;
  adjunctUrl?: string;
  secCode?: string;
  secName?: string;
  adjunctType?: string;
};

function marketColumn(code: string) {
  if (/^(6|68)/.test(code)) return 'sse';
  if (/^(4|8|92)/.test(code)) return 'third';
  return 'szse';
}

function exchangeFor(code: string): 'SSE' | 'SZSE' | 'BSE' {
  if (/^(6|68)/.test(code)) return 'SSE';
  if (/^(4|8|92)/.test(code)) return 'BSE';
  return 'SZSE';
}

function reportKind(title: string): OfficialFiling['reportKind'] | null {
  if (/(第一季度报告|一季度报告)/.test(title)) return 'q1';
  if (/半年度报告/.test(title)) return 'half_year';
  if (/(第三季度报告|三季度报告)/.test(title)) return 'q3';
  if (/年度报告/.test(title)) return 'annual';
  return null;
}

function languageOf(title: string): OfficialFiling['language'] {
  return /(英文版|英文|ENGLISH)/i.test(title) ? 'en' : 'zh';
}

function selectReportPeriods(reports: OfficialFiling[]) {
  const best = new Map<string, OfficialFiling>();
  for (const report of reports) {
    const key = report.fiscalYear
      ? `${report.reportKind}:${report.fiscalYear}`
      : report.id;
    const previous = best.get(key);
    const preference = (item: OfficialFiling) => [
      item.isCorrection ? 1 : 0,
      item.language === 'zh' ? 2 : item.language === 'bilingual' ? 1 : 0,
      Number(item.date.replaceAll('-', '')) || 0,
    ];
    const current = preference(report);
    const prior = previous && preference(previous);
    if (
      !prior ||
      current.some(
        (value, index) =>
          value > prior[index] &&
          current.slice(0, index).every((v, i) => v === prior[i]),
      )
    )
      best.set(key, report);
  }
  const limits: Record<OfficialFiling['reportKind'], number> = {
    annual: 10,
    q1: 4,
    half_year: 4,
    q3: 4,
    quarterly: 4,
  };
  const counts = new Map<OfficialFiling['reportKind'], number>();
  return [...best.values()]
    .sort((a, b) => b.date.localeCompare(a.date))
    .filter((report) => {
      const count = counts.get(report.reportKind) ?? 0;
      if (count >= limits[report.reportKind]) return false;
      counts.set(report.reportKind, count + 1);
      return true;
    });
}

function formatDate(timestamp?: number) {
  if (!timestamp) return '';
  return new Date(timestamp).toISOString().slice(0, 10);
}

export async function lookupAShare(code: string): Promise<OfficialLookup> {
  const securityResponse = await fetch(
    `${CNINFO_BASE}/new/information/topSearch/detailOfQuery`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/json, text/plain, */*',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        Origin: CNINFO_BASE,
        Referer: `${CNINFO_BASE}/new/commonUrl?url=disclosure/list/notice`,
        'X-Requested-With': 'XMLHttpRequest',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
      },
      body: new URLSearchParams({
        keyWord: code,
        maxSecNum: '10',
        maxListNum: '5',
      }),
    },
  );
  if (!securityResponse.ok)
    throw new Error(`巨潮证券查询失败：${securityResponse.status}`);
  const securityData = (await securityResponse.json()) as {
    keyBoardList?: CninfoSecurity[];
  };
  if (!Array.isArray(securityData.keyBoardList))
    throw new Error('巨潮证券查询返回格式无法识别');
  const security = securityData.keyBoardList.find(
    (item) =>
      String(item.code ?? '')
        .trim()
        .padStart(6, '0') === code,
  );
  if (!security?.orgId)
    throw new SecurityNotFoundError('巨潮资讯未找到这个A股代码');

  const end = new Date().toISOString().slice(0, 10);
  const startDate = new Date();
  startDate.setUTCFullYear(startDate.getUTCFullYear() - 11);
  const start = startDate.toISOString().slice(0, 10);
  const common = {
    pageSize: '30',
    column: security.plate || marketColumn(code),
    tabName: 'fulltext',
    plate: '',
    stock: `${code},${security.orgId}`,
    searchkey: '',
    secid: '',
    category:
      'category_ndbg_szsh;category_bndbg_szsh;category_yjdbg_szsh;category_sjdbg_szsh',
    trade: '',
    seDate: `${start}~${end}`,
    sortName: 'announcementTime',
    sortType: 'desc',
    isHLtitle: 'true',
  };
  const page = async (pageNum: number) => {
    const response = await fetch(`${CNINFO_BASE}/new/hisAnnouncement/query`, {
      method: 'POST',
      headers: {
        Accept: 'application/json, text/plain, */*',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        Origin: CNINFO_BASE,
        Referer: `${CNINFO_BASE}/new/disclosure/stock?stockCode=${code}`,
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
      },
      body: new URLSearchParams({ ...common, pageNum: String(pageNum) }),
    });
    if (!response.ok) throw new Error(`巨潮公告查询失败：${response.status}`);
    return (await response.json()) as {
      announcements?: CninfoAnnouncement[];
      totalAnnouncement?: number;
      totalpages?: number;
      hasMore?: boolean;
    };
  };

  const first = await page(1);
  const calculatedPages = Math.ceil((first.totalAnnouncement ?? 0) / 30);
  const pageCount = Math.min(
    12,
    Math.max(
      first.totalpages ?? 0,
      calculatedPages,
      first.hasMore ? 2 : 1,
    ),
  );
  const remaining =
    pageCount > 1
      ? await Promise.all(
          Array.from({ length: pageCount - 1 }, (_, index) => page(index + 2)),
        )
      : [];
  const seen = new Set<string>();
  const reports = selectReportPeriods(
    [first, ...remaining]
    .flatMap((item) => item.announcements ?? [])
    .map((item): OfficialFiling | null => {
      const title = (item.announcementTitle ?? '').replace(/<[^>]+>/g, '');
      const kind = reportKind(title);
      const id = item.announcementId ?? item.adjunctUrl ?? '';
      if (!kind || !id || /摘要/.test(title) || seen.has(id)) return null;
      seen.add(id);
      return {
        id,
        code: item.secCode ?? code,
        companyName:
          item.secName ?? security.zwjc ?? security.secName ?? code,
        title,
        date: formatDate(item.announcementTime),
        fileType: item.adjunctType ?? 'PDF',
        url: item.adjunctUrl
          ? `${CNINFO_BASE.replace('www.', 'static.')}/${item.adjunctUrl.replace(/^\//, '')}`
          : '',
        sourceName: '巨潮资讯网法定披露平台',
        reportKind: kind,
        fiscalYear: Number(title.match(/(20\d{2})/)?.[1]) || undefined,
        language: languageOf(title),
        isCorrection: /(更正|修订|更新)/.test(title),
        isSummary: false,
      };
    })
      .filter((item): item is OfficialFiling => item !== null),
  );

  const companyName =
    security.zwjc ?? security.secName ?? reports[0]?.companyName ?? code;
  const isFinancialCompany = financialCompanyByName(companyName);
  const coverage = filingCoverage(reports);
  const warnings: string[] = [];
  if (coverage.annual < 10)
    warnings.push(`只有${coverage.annual}个可用完整年度；上市不足10年的公司使用全部可用年度。`);
  const interimInputs = coverage.halfYear + coverage.quarterly;
  if (interimInputs < 12)
    warnings.push(`只有${interimInputs}个中期报告输入，可能不足以还原最近12个单季度。`);
  return {
    company: {
      market: 'A_SHARE',
      exchange: exchangeFor(code),
      code,
      displayCode: code,
      companyName,
      issuerId: security.orgId,
      currency: 'CNY',
      ahPairCode: ahPairCode(code),
      isFinancialCompany,
      rankEligible: !isFinancialCompany,
    },
    reports,
    coverage,
    reportingPolicy: reportingPolicyFor('A_SHARE'),
    source: {
      name: '巨潮资讯网法定披露平台',
      url: `${CNINFO_BASE}/new/disclosure/stock?orgId=${encodeURIComponent(security.orgId)}&stockCode=${code}`,
      retrievedAt: new Date().toISOString(),
    },
    warnings,
  };
}
