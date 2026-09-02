import { setDefaultResultOrder } from 'node:dns';

import type {
  CurrentMarketSnapshot,
  MetricPoint,
  PriceSource,
  SecurityIdentity,
} from '@/lib/analysis-types';

type DailyPrice = { date: string; close: number };

type EastmoneyResponse = {
  data?: {
    code?: string;
    name?: string;
    klines?: string[];
  };
};

type EastmoneyQuoteResponse = {
  data?: Record<string, string | number | null>;
};

type TencentResponse = {
  code?: number;
  data?: Record<string, { day?: Array<Array<string | object>> }>;
};

const EASTMONEY_FIELDS =
  'fields1=f1%2Cf2%2Cf3%2Cf4%2Cf5%2Cf6&fields2=f51%2Cf52%2Cf53%2Cf54%2Cf55%2Cf56%2Cf57%2Cf58%2Cf59%2Cf60%2Cf61';

setDefaultResultOrder('ipv4first');

function eastmoneySecurityId(security: SecurityIdentity) {
  if (security.market === 'HK') return `116.${security.code}`;
  return `${security.exchange === 'SSE' ? '1' : '0'}.${security.code}`;
}

function tencentSymbol(security: SecurityIdentity) {
  if (security.market === 'HK') return `hk${security.code}`;
  const prefix =
    security.exchange === 'SSE'
      ? 'sh'
      : security.exchange === 'BSE'
        ? 'bj'
        : 'sz';
  return `${prefix}${security.code}`;
}

function eastmoneyUrl(
  security: SecurityIdentity,
  firstYear: number,
  lastYear: number,
  adjustment: 0 | 1,
) {
  const params = [
    `secid=${eastmoneySecurityId(security)}`,
    EASTMONEY_FIELDS,
    'klt=101',
    `fqt=${adjustment}`,
    `beg=${firstYear}0101`,
    `end=${lastYear}1231`,
  ].join('&');
  return `https://push2his.eastmoney.com/api/qt/stock/kline/get?${params}`;
}

function quoteNumber(
  data: EastmoneyQuoteResponse['data'],
  key: string,
  divisor = 1,
) {
  const raw = data?.[key];
  const value = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(value) && value > -1e9 ? value / divisor : undefined;
}

export async function fetchCurrentMarket(
  security: SecurityIdentity,
): Promise<CurrentMarketSnapshot> {
  const url = `https://push2.eastmoney.com/api/qt/stock/get?secid=${eastmoneySecurityId(security)}&fields=f43,f57,f58,f86,f116,f162,f164,f167`;
  const payload = await fetchJson<EastmoneyQuoteResponse>(
    url,
    'https://quote.eastmoney.com/',
  );
  const price = quoteNumber(
    payload.data,
    'f43',
    security.market === 'HK' ? 1_000 : 100,
  );
  if (!price || price <= 0) throw new Error('最新行情没有返回有效价格');
  const timestamp = quoteNumber(payload.data, 'f86');
  const date = timestamp
    ? new Date(timestamp * 1000).toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);
  const peTtm =
    quoteNumber(payload.data, 'f162', 100) ||
    quoteNumber(payload.data, 'f164', 100);
  const pb = quoteNumber(payload.data, 'f167', 100);
  const marketCap = quoteNumber(payload.data, 'f116');
  return {
    price,
    date,
    currency: security.currency,
    peTtm: peTtm && peTtm > 0 ? peTtm : undefined,
    pb: pb && pb > 0 ? pb : undefined,
    marketCap: marketCap && marketCap > 0 ? marketCap : undefined,
    sourceName: '东方财富实时行情',
    sourceUrl: url,
    retrievedAt: new Date().toISOString(),
  };
}

async function fetchJson<T>(url: string, referer: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json,text/plain,*/*',
      Referer: referer,
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`行情请求失败：${response.status}`);
  return (await response.json()) as T;
}

function parseEastmoney(payload: EastmoneyResponse) {
  return (payload.data?.klines ?? [])
    .map((line): DailyPrice | null => {
      const [date, , closeText] = line.split(',');
      const close = Number(closeText);
      return /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(close)
        ? { date, close }
        : null;
    })
    .filter((item): item is DailyPrice => item !== null);
}

function lastPriceByYear(prices: DailyPrice[]) {
  const latest = new Map<number, DailyPrice>();
  for (const price of prices) {
    const year = Number(price.date.slice(0, 4));
    const current = latest.get(year);
    if (!current || price.date > current.date) latest.set(year, price);
  }
  return latest;
}

async function crossCheckLatestRawClose(
  security: SecurityIdentity,
  year: number,
  primary: DailyPrice | undefined,
) {
  if (!primary) return undefined;
  const symbol = tencentSymbol(security);
  const query = encodeURIComponent(
    `${symbol},day,${year}-01-01,${year}-12-31,400`,
  );
  const url = `https://web.ifzq.gtimg.cn/appstock/app/kline/kline?param=${query}`;
  const payload = await fetchJson<TencentResponse>(url, 'https://gu.qq.com/');
  const rows = payload.data?.[symbol]?.day ?? [];
  const row = rows.find((item) => item[0] === primary.date);
  const checkedRawClose = Number(row?.[2]);
  if (!Number.isFinite(checkedRawClose)) return undefined;
  const differencePercent =
    (Math.abs(primary.close - checkedRawClose) / primary.close) * 100;
  return {
    name: '腾讯行情',
    url,
    date: primary.date,
    primaryRawClose: primary.close,
    checkedRawClose,
    differencePercent,
    passed: differencePercent <= 0.01,
  };
}

export async function attachAnnualPrices(
  security: SecurityIdentity,
  annual: MetricPoint[],
) {
  const years = annual
    .map((point) => Number(point.period.slice(0, 4)))
    .filter(Number.isFinite);
  if (!years.length)
    return { priceSource: undefined, priceDate: '', warnings: ['没有可匹配的财务年度'] };

  const firstYear = Math.min(...years);
  const lastYear = Math.max(...years);
  const adjustedUrl = eastmoneyUrl(security, firstYear, lastYear, 1);
  const rawUrl = eastmoneyUrl(security, lastYear, lastYear, 0);
  const [adjustedPayload, rawPayload] = await Promise.all([
    fetchJson<EastmoneyResponse>(adjustedUrl, 'https://quote.eastmoney.com/'),
    fetchJson<EastmoneyResponse>(rawUrl, 'https://quote.eastmoney.com/'),
  ]);
  const adjustedByYear = lastPriceByYear(parseEastmoney(adjustedPayload));
  const rawByYear = lastPriceByYear(parseEastmoney(rawPayload));
  const warnings: string[] = [];

  for (const point of annual) {
    const year = Number(point.period.slice(0, 4));
    const price = adjustedByYear.get(year);
    if (!price) {
      warnings.push(`${year}年缺少前复权年末收盘价`);
      continue;
    }
    point.adjustedPrice = price.close;
    point.metricSources ??= {};
    point.metricSources.adjustedPrice = {
      label: '该日历年度最后交易日前复权收盘价',
      unit: `${security.currency}/股`,
      date: price.date,
      sourceName: '东方财富行情',
      sourceUrl: adjustedUrl,
      formula: '日线前复权（fqt=1），取该日历年度最后一个交易日收盘价',
    };
  }

  const latestRaw = rawByYear.get(lastYear);
  let crossCheck: PriceSource['crossCheck'];
  try {
    crossCheck = await crossCheckLatestRawClose(security, lastYear, latestRaw);
    if (!crossCheck)
      warnings.push(`${lastYear}年末原始收盘价未能完成第二行情源核对`);
    else if (!crossCheck.passed)
      warnings.push(
        `${lastYear}年末原始收盘价交叉核对差异${crossCheck.differencePercent.toFixed(3)}%`,
      );
  } catch {
    warnings.push(`${lastYear}年末原始收盘价未能完成第二行情源核对`);
  }

  const latestAdjusted = adjustedByYear.get(lastYear);
  const priceSource: PriceSource = {
    name: '东方财富行情',
    url: adjustedUrl,
    retrievedAt: new Date().toISOString(),
    currency: security.currency,
    adjustment: 'forward',
    sampling: 'calendar_year_end',
    crossCheck,
  };
  return {
    priceSource,
    priceDate: latestAdjusted?.date ?? '',
    warnings,
  };
}
