import { normalizeSecurityCode } from '@/lib/official-filings';
import { lookupAShare } from '@/lib/server/official-filings/a-share';
import { lookupHkShare } from '@/lib/server/official-filings/hk-share';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const normalized = normalizeSecurityCode(url.searchParams.get('code') ?? '');
  if (!normalized) {
    return Response.json(
      { error: '请输入6位A股代码或5位港股代码' },
      { status: 400 },
    );
  }

  try {
    const lookup =
      normalized.market === 'HK'
        ? await lookupHkShare(normalized.code)
        : await lookupAShare(normalized.code);
    return Response.json(lookup, {
      headers: { 'Cache-Control': 'private, max-age=300' },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : '官方披露查询失败';
    const missing = /未找到/.test(message);
    return Response.json(
      { error: message, retryable: !missing },
      { status: missing ? 404 : 502 },
    );
  }
}
