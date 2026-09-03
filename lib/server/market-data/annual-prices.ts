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

async function fetchEastmoneyCurrent(
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

function normalizeTencentDate(value: string | undefined) {
  if (!value) return new Date().toISOString().slice(0, 10);
  const compact = value.match(/^(\d{4})(\d{2})(\d{2})/);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
  const separated = value.match(/^(\d{4})\/(\d{2})\/(\d{2})/);
  return separated
    ? `${separated[1]}-${separated[2]}-${separated[3]}`
    : new Date().toISOString().slice(0, 10);
}

async function fetchTencentCurrent(
  security: SecurityIdentity,
): Promise<CurrentMarketSnapshot> {
  const url = `https://qt.gtimg.cn/q=${tencentSymbol(security)}`;
  const payload = await fetchText(url, 'https://gu.qq.com/');
  const quoted = payload.match(/="([\s\S]*)";?\s*$/)?.[1];
  const fields = quoted?.split('~') ?? [];
  const price = Number(fields[3]);
  const peTtm = Number(fields[39]);
  const pb = security.market === 'A_SHARE' ? Number(fields[46]) : undefined;
  const marketCapYi = Number(fields[45]);
  const dateField = fields.find((field) =>
    /^(?:\d{14}|\d{4}\/\d{2}\/\d{2})/.test(field),
  );
  if (!Number.isFinite(price) || price <= 0)
    throw new Error('备用行情没有返回有效价格');
  return {
    price,
    date: normalizeTencentDate(dateField),
    currency: security.currency,
    peTtm: Number.isFinite(peTtm) && peTtm > 0 ? peTtm : undefined,
    pb:
      typeof pb === 'number' && Number.isFinite(pb) && pb > 0 ? pb : undefined,
    marketCap:
      Number.isFinite(marketCapYi) && marketCapYi > 0
        ? Math.round(marketCapYi * 100_000_000)
        : undefined,
    sourceName: '腾讯行情',
    sourceUrl: url,
    retrievedAt: new Date().toISOString(),
  };
}

export async function fetchCurrentMarket(
  security: SecurityIdentity,
): Promise<CurrentMarketSnapshot> {
  try {
    return await fetchEastmoneyCurrent(security);
  } catch {
    return fetchTencentCurrent(security);
  }
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

async function fetchText(url: string, referer: string) {
  const response = await fetch(url, {
    headers: {
      Accept: 'text/plain,*/*',
      Referer: referer,
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`行情请求失败：${response.status}`);
  return response.text();
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

function parseTencentDay(payload: TencentResponse, symbol: string) {
  return (payload.data?.[symbol]?.day ?? [])
    .map((row): DailyPrice | null => {
      const date = typeof row[0] === 'string' ? row[0] : '';
      const close = Number(row[2]);
      return /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(close)
        ? { date, close }
        : null;
    })
    .filter((item): item is DailyPrice => item !== null);
}

async function fetchTencentAnnualRaw(
  security: SecurityIdentity,
  years: number[],
) {
  const symbol = tencentSymbol(security);
  const results = await Promise.allSettled(
    years.map(async (year) => {
      const query = encodeURIComponent(
        `${symbol},day,${year}-01-01,${year}-12-31,400`,
      );
      const url = `https://web.ifzq.gtimg.cn/appstock/app/kline/kline?param=${query}`;
      const payload = await fetchJson<TencentResponse>(
        url,
        'https://gu.qq.com/',
      );
      return { year, url, prices: parseTencentDay(payload, symbol) };
    }),
  );
  const byYear = new Map<number, DailyPrice>();
  const urls = new Map<number, string>();
  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    const latest = lastPriceByYear(result.value.prices).get(result.value.year);
    if (!latest) continue;
    byYear.set(result.value.year, latest);
    urls.set(result.value.year, result.value.url);
  }
  return { byYear, urls };
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
    return {
      priceSource: undefined,
      priceAdjustment: 'none' as const,
      priceDate: '',
      warnings: ['没有可匹配的财务年度'],
    };

  const firstYear = Math.min(...years);
  const lastYear = Math.max(...years);
  const adjustedUrl = eastmoneyUrl(security, firstYear, lastYear, 1);
  const rawUrl = eastmoneyUrl(security, lastYear, lastYear, 0);
  const [adjustedResult, rawResult] = await Promise.allSettled([
    fetchJson<EastmoneyResponse>(adjustedUrl, 'https://quote.eastmoney.com/'),
    fetchJson<EastmoneyResponse>(rawUrl, 'https://quote.eastmoney.com/'),
  ]);
  const warnings: string[] = [];
  let priceByYear =
    adjustedResult.status === 'fulfilled'
      ? lastPriceByYear(parseEastmoney(adjustedResult.value))
      : new Map<number, DailyPrice>();
  let sourceName = '东方财富行情';
  let sourceUrlByYear = new Map(years.map((year) => [year, adjustedUrl]));
  let priceAdjustment: PriceSource['adjustment'] = 'forward';

  if (years.some((year) => !priceByYear.has(year))) {
    const fallback = await fetchTencentAnnualRaw(security, years);
    if (fallback.byYear.size > priceByYear.size) {
      priceByYear = fallback.byYear;
      sourceUrlByYear = fallback.urls;
      sourceName = '腾讯行情';
      priceAdjustment = 'none';
      warnings.push('前复权行情不可用，已改用各年最后交易日未复权收盘价。');
    }
  }
  if (priceByYear.size === 0)
    throw new Error('两个行情源都没有返回可用的年末收盘价');

  for (const point of annual) {
    const year = Number(point.period.slice(0, 4));
    const price = priceByYear.get(year);
    if (!price) {
      warnings.push(`${year}年缺少年末收盘价`);
      continue;
    }
    point.adjustedPrice = price.close;
    point.metricSources ??= {};
    point.metricSources.adjustedPrice = {
      label:
        priceAdjustment === 'forward'
          ? '该日历年度最后交易日前复权收盘价'
          : '该日历年度最后交易日未复权收盘价',
      unit: `${security.currency}/股`,
      date: price.date,
      sourceName,
      sourceUrl: sourceUrlByYear.get(year),
      formula:
        priceAdjustment === 'forward'
          ? '日线前复权（fqt=1），取该日历年度最后一个交易日收盘价'
          : '日线未复权，取该日历年度最后一个交易日收盘价',
    };
  }

  const rawByYear =
    rawResult.status === 'fulfilled'
      ? lastPriceByYear(parseEastmoney(rawResult.value))
      : new Map<number, DailyPrice>();
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

  const latestPrice = priceByYear.get(lastYear);
  const priceSource: PriceSource = {
    name: sourceName,
    url: sourceUrlByYear.get(lastYear) ?? adjustedUrl,
    retrievedAt: new Date().toISOString(),
    currency: security.currency,
    adjustment: priceAdjustment,
    sampling: 'calendar_year_end',
    crossCheck,
  };
  return {
    priceSource,
    priceAdjustment,
    priceDate: latestPrice?.date ?? '',
    warnings,
  };
}
