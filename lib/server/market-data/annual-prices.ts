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
  data?: Record<string, { day?: Array<Array<string | object>> }>;
};

type EastmoneyIndicatorResponse = {
  result?: {
    data?: Array<Record<string, string | number | null>>;
  };
};

type HkmaRateResponse = {
  result?: {
    records?: Array<{ end_of_day?: string; cny?: number | string | null }>;
  };
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
    'ut=bd1d9ddb04089700cf9c27f6f7426281',
    'invt=2',
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
  if (raw == null || raw === '' || raw === '-') return undefined;
  const value = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(value) && value > -1e9 ? value / divisor : undefined;
}

async function fetchEastmoneyCurrent(
  security: SecurityIdentity,
): Promise<CurrentMarketSnapshot> {
  const url = `https://push2delay.eastmoney.com/api/qt/stock/get?secid=${eastmoneySecurityId(security)}&fields=f43,f57,f58,f84,f85,f86,f116,f164,f167`;
  const payload = await fetchJson<EastmoneyQuoteResponse>(
    url,
    'https://quote.eastmoney.com/',
  );
  if (String(payload.data?.f57 ?? '') !== security.code)
    throw new Error('东方财富返回的证券代码与请求不一致');
  const price = quoteNumber(
    payload.data,
    'f43',
    security.market === 'HK' ? 1_000 : 100,
  );
  if (!price || price <= 0) throw new Error('最新行情没有返回有效价格');
  const timestamp = quoteNumber(payload.data, 'f86');
  if (!timestamp) throw new Error('东方财富最新行情缺少行情时间');
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  // Eastmoney f164 is PE(TTM). f162 is its dynamic/forecast PE and must not
  // be silently substituted under a PE(TTM) label.
  const peTtm = quoteNumber(payload.data, 'f164', 100);
  const pb = quoteNumber(payload.data, 'f167', 100);
  const marketCap = quoteNumber(payload.data, 'f116');
  const totalShares = quoteNumber(payload.data, 'f84');
  const floatShares = quoteNumber(payload.data, 'f85');
  const expectedMarketCap =
    price && totalShares ? price * totalShares : undefined;
  const marketCapIsConsistent =
    !marketCap ||
    !expectedMarketCap ||
    Math.abs(marketCap - expectedMarketCap) / expectedMarketCap <= 0.005;
  return {
    price,
    date,
    currency: security.currency,
    peTtm: peTtm && peTtm > 0 ? peTtm : undefined,
    pb: pb && pb > 0 ? pb : undefined,
    marketCap:
      marketCap && marketCap > 0 && marketCapIsConsistent
        ? marketCap
        : undefined,
    totalShares: totalShares && totalShares > 0 ? totalShares : undefined,
    floatShares: floatShares && floatShares > 0 ? floatShares : undefined,
    sourceName: '东方财富延时行情',
    sourceUrl: url,
    retrievedAt: new Date().toISOString(),
  };
}

export async function fetchCurrentMarket(
  security: SecurityIdentity,
): Promise<CurrentMarketSnapshot> {
  return fetchEastmoneyCurrent(security);
}

async function fetchJson<T>(url: string, referer: string): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
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
    } catch (error) {
      lastError = error;
      if (attempt < 2)
        await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
  throw lastError;
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
      const payload = await fetchJson<TencentResponse>(url, 'https://gu.qq.com/');
      return { year, url, prices: parseTencentDay(payload, symbol) };
    }),
  );
  const byYear = new Map<number, DailyPrice>();
  const urls = new Map<number, string>();
  const prices: DailyPrice[] = [];
  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    prices.push(...result.value.prices);
    const latest = lastPriceByYear(result.value.prices).get(result.value.year);
    if (!latest) continue;
    byYear.set(result.value.year, latest);
    urls.set(result.value.year, result.value.url);
  }
  return { byYear, urls, prices };
}

function reportDate(period: string) {
  const match = period.match(/^(\d{4})(H1)?$/);
  if (!match) return null;
  return `${match[1]}-${match[2] ? '06-30' : '12-31'}`;
}

function lastPriceOnOrBefore(prices: DailyPrice[], date: string) {
  const price = prices.findLast((item) => item.date <= date);
  if (!price) return undefined;
  const age =
    (Date.parse(date) - Date.parse(price.date)) / (24 * 60 * 60 * 1000);
  return age <= 14 ? price : undefined;
}

async function fetchHkIndicators(security: SecurityIdentity) {
  if (security.market !== 'HK') return new Map<string, number>();
  const url =
    'https://datacenter.eastmoney.com/securities/api/data/v1/get?' +
    new URLSearchParams({
      reportName: 'RPT_HKF10_FN_MAININDICATOR',
      columns: 'SECURITY_CODE,REPORT_DATE,EPS_TTM',
      filter: `(SECURITY_CODE="${security.code}")`,
      pageNumber: '1',
      pageSize: '50',
      sortColumns: 'REPORT_DATE',
      sortTypes: '-1',
      source: 'F10',
      client: 'PC',
    });
  const payload = await fetchJson<EastmoneyIndicatorResponse>(
    url,
    'https://emweb.securities.eastmoney.com/',
  );
  return new Map(
    (payload.result?.data ?? []).flatMap((row) => {
      const date = String(row.REPORT_DATE ?? '').slice(0, 10);
      const epsTtm = Number(row.EPS_TTM);
      return /^\d{4}-\d{2}-\d{2}$/.test(date) && epsTtm > 0
        ? [[date, epsTtm] as const]
        : [];
    }),
  );
}

async function fetchHkmaCnyRates() {
  const url =
    'https://api.hkma.gov.hk/public/market-data-and-statistics/monthly-statistical-bulletin/er-ir/er-eeri-daily?pagesize=1000';
  const payload = await fetchJson<HkmaRateResponse>(url, 'https://www.hkma.gov.hk/');
  return new Map(
    (payload.result?.records ?? []).flatMap((row) => {
      const rate = Number(row.cny);
      return row.end_of_day && rate > 0
        ? [[row.end_of_day, rate] as const]
        : [];
    }),
  );
}

function lastRateOnOrBefore(rates: Map<string, number>, date: string) {
  return [...rates]
    .filter(([rateDate]) => rateDate <= date)
    .sort(([left], [right]) => right.localeCompare(left))[0];
}

export async function attachAnnualPrices(
  security: SecurityIdentity,
  annual: MetricPoint[],
  halfYear: MetricPoint[] = [],
  financialCurrency = security.currency,
) {
  const points = [...annual, ...halfYear];
  const years = points
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
  const rawUrl = eastmoneyUrl(security, firstYear, lastYear, 0);
  const [rawResult] = await Promise.allSettled([
    fetchJson<EastmoneyResponse>(rawUrl, 'https://quote.eastmoney.com/'),
  ]);
  const warnings: string[] = [];
  const priceByYear =
    rawResult.status === 'fulfilled'
      ? lastPriceByYear(parseEastmoney(rawResult.value))
      : new Map<number, DailyPrice>();
  let rawPrices =
    rawResult.status === 'fulfilled'
      ? parseEastmoney(rawResult.value)
      : [];
  const hasEastmoneyDaily = rawPrices.length > 0;
  const sourceNameByYear = new Map(
    years.map((year) => [year, '东方财富行情']),
  );
  const sourceUrlByYear = new Map(years.map((year) => [year, rawUrl]));
  const priceAdjustment: PriceSource['adjustment'] = 'none';

  const missingYears = [...new Set(years)].filter(
    (year) => !priceByYear.has(year),
  );
  if (missingYears.length) {
    const fallback = await fetchTencentAnnualRaw(security, missingYears);
    for (const year of missingYears) {
      const price = fallback.byYear.get(year);
      const url = fallback.urls.get(year);
      if (!price || !url) continue;
      priceByYear.set(year, price);
      sourceNameByYear.set(year, '腾讯行情');
      sourceUrlByYear.set(year, url);
    }
    if (fallback.byYear.size)
      warnings.push('东方财富部分历史行情缺失，已按年使用腾讯未复权日线补齐。');
    if (!rawPrices.length) rawPrices = fallback.prices;
  }
  if (priceByYear.size === 0) throw new Error('两个行情源都没有返回可用的年末收盘价');

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
      label: '该日历年度最后交易日未复权收盘价',
      unit: `${security.currency}/股`,
      date: price.date,
      sourceName: sourceNameByYear.get(year),
      sourceUrl: sourceUrlByYear.get(year),
      formula: '日线未复权，取该日历年度最后一个交易日收盘价',
    };
  }


  let epsTtmByDate = new Map<string, number>();
  let cnyRateByDate = new Map<string, number>();
  if (security.market === 'HK') {
    const [indicatorResult, rateResult] = await Promise.allSettled([
      fetchHkIndicators(security),
      financialCurrency === 'CNY'
        ? fetchHkmaCnyRates()
        : Promise.resolve(new Map<string, number>()),
    ]);
    if (indicatorResult.status === 'fulfilled')
      epsTtmByDate = indicatorResult.value;
    else
      warnings.push(`历史PE的东财TTM EPS获取失败：${indicatorResult.reason}`);
    if (rateResult.status === 'fulfilled') cnyRateByDate = rateResult.value;
    else warnings.push(`历史PE的金管局汇率获取失败：${rateResult.reason}`);
  }

  for (const point of points) {
    const date = reportDate(point.period);
    if (!date) continue;
    const price = lastPriceOnOrBefore(rawPrices, date);
    if (!price) continue;
    point.adjustedPrice = price.close;
    point.metricSources ??= {};
    point.metricSources.adjustedPrice = {
      label: '报告期末前最后交易日未复权收盘价',
      unit: `${security.currency}/股`,
      date: price.date,
      sourceName: hasEastmoneyDaily ? '东方财富行情' : '腾讯行情',
      sourceUrl:
        hasEastmoneyDaily
          ? rawUrl
          : sourceUrlByYear.get(Number(point.period.slice(0, 4))),
      formula: '行情日线未复权，取报告期末前最后交易日收盘价',
    };

    const epsTtm = epsTtmByDate.get(date);
    const rateEntry =
      financialCurrency === security.currency
        ? ([date, 1] as const)
        : financialCurrency === 'CNY' && security.currency === 'HKD'
          ? lastRateOnOrBefore(cnyRateByDate, date)
          : undefined;
    if (!epsTtm || !rateEntry) continue;
    point.pe = price.close / (epsTtm * rateEntry[1]);
    point.metricSources.pe = {
      label: '报告期末PE-TTM（计算值）',
      unit: '倍',
      date: price.date,
      sourceName: '东方财富＋香港金融管理局',
      sourceUrl: rawUrl,
      formula:
        financialCurrency === security.currency
          ? '东财期末未复权收盘价 ÷ 东财对应报告期EPS-TTM'
          : `东财期末未复权收盘价 ÷（东财对应报告期EPS-TTM × 金管局${rateEntry[0]}人民币兑港元收市汇率）`,
    };
  }

  const latestPrice = priceByYear.get(lastYear);
  const priceSource: PriceSource = {
    name: sourceNameByYear.get(lastYear) ?? '东方财富行情',
    url: sourceUrlByYear.get(lastYear) ?? rawUrl,
    retrievedAt: new Date().toISOString(),
    currency: security.currency,
    adjustment: priceAdjustment,
    sampling: 'calendar_year_end',
  };
  return {
    priceSource,
    priceAdjustment,
    priceDate: latestPrice?.date ?? '',
    warnings,
  };
}
