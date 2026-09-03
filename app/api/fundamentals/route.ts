import {
  normalizeSecurityCode,
  type OfficialLookup,
} from '@/lib/official-filings';
import { buildAnnualDataset } from '@/lib/server/financials/dataset';
import { lookupAShare } from '@/lib/server/official-filings/a-share';
import { lookupHkShare } from '@/lib/server/official-filings/hk-share';

type NormalizedCode = NonNullable<ReturnType<typeof normalizeSecurityCode>>;

function isOfficialReportUrl(url: unknown, market: NormalizedCode['market']) {
  if (typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === 'https:' &&
      (market === 'A_SHARE'
        ? parsed.hostname === 'static.cninfo.com.cn'
        : parsed.hostname === 'www1.hkexnews.hk')
    );
  } catch {
    return false;
  }
}

function isOfficialLookup(
  value: unknown,
  normalized: NormalizedCode,
): value is OfficialLookup {
  if (!value || typeof value !== 'object') return false;
  const lookup = value as Partial<OfficialLookup>;
  if (
    lookup.company?.code !== normalized.code ||
    lookup.company.market !== normalized.market ||
    !Array.isArray(lookup.reports) ||
    lookup.reports.length === 0 ||
    lookup.reports.length > 50
  )
    return false;
  return lookup.reports.every(
    (report) =>
      report &&
      report.code === normalized.code &&
      typeof report.id === 'string' &&
      typeof report.title === 'string' &&
      isOfficialReportUrl(report.url, normalized.market) &&
      (!report.extractionUrl ||
        isOfficialReportUrl(report.extractionUrl, normalized.market)),
  );
}

async function respond(normalized: NormalizedCode, lookup?: OfficialLookup) {
  try {
    const resolvedLookup =
      lookup ??
      (normalized.market === 'HK'
        ? await lookupHkShare(normalized.code)
        : await lookupAShare(normalized.code));
    return Response.json(await buildAnnualDataset(resolvedLookup), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '财报自动抽取失败';
    const missing = /未找到/.test(message);
    return Response.json(
      { error: message, retryable: !missing },
      { status: missing ? 404 : 502 },
    );
  }
}

function invalidCodeResponse() {
  return Response.json(
    { error: '请输入6位A股代码或5位港股代码' },
    { status: 400 },
  );
}

export async function GET(request: Request) {
  const normalized = normalizeSecurityCode(
    new URL(request.url).searchParams.get('code') ?? '',
  );
  if (!normalized) {
    return invalidCodeResponse();
  }
  return respond(normalized);
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { code?: unknown; lookup?: unknown };
    const normalized = normalizeSecurityCode(
      typeof body.code === 'string' ? body.code : '',
    );
    if (!normalized) return invalidCodeResponse();
    if (!isOfficialLookup(body.lookup, normalized)) {
      return Response.json(
        { error: '官方报告清单无效，请重新查询' },
        { status: 400 },
      );
    }
    return respond(normalized, body.lookup);
  } catch {
    return Response.json({ error: '请求内容无效' }, { status: 400 });
  }
}
