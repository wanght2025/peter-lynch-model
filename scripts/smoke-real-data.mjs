const baseUrl = (process.env.BASE_URL || 'http://localhost:3000').replace(
  /\/$/,
  '',
);
const annualMinimum = 10;

function fail(message) {
  throw new Error(message);
}

async function getJson(path, { timeout = 30_000, ...init } = {}) {
  const url = `${baseUrl}${path}`;
  let response;
  try {
    response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(timeout),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    fail(`请求失败 ${url}：${reason}`);
  }

  let body;
  try {
    body = await response.json();
  } catch {
    fail(`接口返回的不是合法 JSON（HTTP ${response.status}）：${url}`);
  }

  if (response.status !== 200) {
    const detail =
      body && typeof body.error === 'string' ? `：${body.error}` : '';
    fail(`HTTP ${response.status}（期望 200）${detail}`);
  }
  return body;
}

function checkOfficialReports(code, body) {
  const companyName = body?.company?.companyName;
  const reports = body?.reports;
  const annual = body?.coverage?.annual;

  if (typeof companyName !== 'string' || !companyName.trim()) {
    fail(`${code} 公司名称为空`);
  }
  if (!Array.isArray(reports) || reports.length === 0) {
    fail(`${code} reports 为空`);
  }
  if (!Number.isInteger(annual) || annual < annualMinimum) {
    fail(
      `${code} 年报数量不足：coverage.annual=${annual}（至少 ${annualMinimum}）`,
    );
  }
  if (annual > reports.length) {
    fail(
      `${code} coverage.annual 大于 reports 总数：${annual} > ${reports.length}`,
    );
  }

  console.log(
    `✓ ${code} ${companyName.trim()}：${reports.length} 份报告，${annual} 份年报`,
  );
}

async function main() {
  console.log(`开始真实数据冒烟测试：${baseUrl}`);

  const lookups = new Map();
  for (const code of ['600519', '00700']) {
    console.log(`检查 /api/official-reports?code=${code} …`);
    const lookup = await getJson(`/api/official-reports?code=${code}`);
    checkOfficialReports(code, lookup);
    lookups.set(code, lookup);
  }

  console.log('检查 /api/fundamentals POST（复用已确认报告）…');
  const fundamentals = await getJson('/api/fundamentals', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: '600519', lookup: lookups.get('600519') }),
    timeout: 240_000,
  });
  const dataset = fundamentals?.dataset;
  const annual = dataset?.annual;
  const quarterly = dataset?.quarterly;
  const halfYear = dataset?.halfYear;
  if (!dataset || !Array.isArray(annual) || annual.length < annualMinimum) {
    fail(
      `fundamentals dataset 年度数据不足：annual=${annual?.length ?? 0}（至少 ${annualMinimum}）`,
    );
  }
  if (!Array.isArray(quarterly) || quarterly.length < 12) {
    fail(
      `fundamentals dataset 季度数据不足：quarterly=${quarterly?.length ?? 0}（至少 12）`,
    );
  }
  if (!Array.isArray(halfYear) || halfYear.length < 4) {
    fail(`fundamentals 上半年数据不足：halfYear=${halfYear?.length ?? 0}（至少4）`);
  }
  for (const point of annual) {
    if (!Number.isFinite(point.revenue) || point.revenue <= 1e9) {
      fail(`600519 ${point.period} 营收缺失或数量级异常：${point.revenue}`);
    }
    if (!Number.isFinite(point.netProfit) || point.netProfit <= 1e9) {
      fail(
        `600519 ${point.period} 归母净利润缺失或数量级异常：${point.netProfit}`,
      );
    }
    const margin = point.netProfit / point.revenue;
    if (!Number.isFinite(margin) || margin <= 0.01 || margin >= 0.95) {
      fail(`600519 ${point.period} 净利率异常：${margin}`);
    }
  }
  const halfYearPriceCount = halfYear.filter(
    (point) => Number.isFinite(point.adjustedPrice) && point.adjustedPrice > 0,
  ).length;
  if (halfYearPriceCount !== halfYear.length) {
    fail(
      `fundamentals 6月末股价不完整：${halfYearPriceCount}/${halfYear.length}`,
    );
  }
  if (!fundamentals.analysis || typeof fundamentals.analysis !== 'object') {
    fail('fundamentals analysis 为空');
  }
  const yearEndPriceCount = annual.filter(
    (point) => Number.isFinite(point.adjustedPrice) && point.adjustedPrice > 0,
  ).length;
  if (yearEndPriceCount !== annual.length) {
    fail(`fundamentals 年末股价不完整：${yearEndPriceCount}/${annual.length}`);
  }
  if (
    !Number.isFinite(dataset?.currentMarket?.price) ||
    dataset.currentMarket.price <= 0 ||
    !/^\d{4}-\d{2}-\d{2}$/.test(dataset.currentMarket.date ?? '')
  ) {
    fail('fundamentals 最新价格或行情日期缺失');
  }
  if (
    !Number.isFinite(dataset.currentMarket.peTtm) ||
    dataset.currentMarket.peTtm <= 0
  ) {
    fail('fundamentals 最新PE·TTM缺失');
  }
  if (fundamentals?.extraction?.requestedReports > 11) {
    fail(
      `fundamentals 下载报告过多：requestedReports=${fundamentals.extraction.requestedReports}（最多 11）`,
    );
  }
  if (fundamentals?.extraction?.complete !== true) {
    fail('fundamentals 抽取结果不完整');
  }
  console.log(
    `✓ 600519 基本面：${annual.length} 年度、${halfYear.length} 上半年、${quarterly.length} 季度、${yearEndPriceCount} 个年末价格、${halfYearPriceCount} 个6月末价格、最新价 ${dataset.currentMarket.price}（${dataset.currentMarket.date}），解析 ${fundamentals.extraction.requestedReports} 份报告，analysis 已生成`,
  );
  if (process.env.FAST_SMOKE === '1') {
    console.log('快速真实数据冒烟测试通过');
    return;
  }

  console.log('检查 06181 老铺黄金基本面…');
  const laopuLookup = await getJson('/api/official-reports?code=06181');
  const laopuFundamentals = await getJson('/api/fundamentals', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: '06181', lookup: laopuLookup }),
    timeout: 240_000,
  });
  const laopuDataset = laopuFundamentals?.dataset;
  const latestAnnual = laopuDataset?.annual?.at(-1);
  const latestHalfYear = laopuDataset?.halfYear?.at(-1);
  if (!laopuDataset || !latestAnnual || !latestHalfYear) {
    fail('06181 fundamentals 缺少最新年度或半年期');
  }
  for (const [label, point] of [
    ['最新年度', latestAnnual],
    ['最新半年期', latestHalfYear],
  ]) {
    for (const key of [
      'revenue',
      'netProfit',
      'eps',
      'cash',
      'totalAssets',
      'totalLiabilities',
      'interestBearingDebt',
    ]) {
      if (!Number.isFinite(point[key]) || Math.abs(point[key]) >= 1e14)
        fail(`06181 ${label} ${key} 缺失或数量级异常：${point[key]}`);
    }
    if (label === '最新年度') {
      for (const key of ['operatingCashFlow', 'capitalExpenditure']) {
        if (!Number.isFinite(point[key]) || Math.abs(point[key]) >= 1e14)
          fail(`06181 ${label} ${key} 缺失或数量级异常：${point[key]}`);
      }
    }
    if (point.revenue <= 1e9)
      fail(`06181 ${label} revenue 数量级异常：${point.revenue}`);
    if (point.interestBearingDebt <= 1e9)
      fail(
        `06181 ${label} interestBearingDebt 数量级异常：${point.interestBearingDebt}`,
      );
  }
  if (laopuDataset.currency !== 'CNY')
    fail(`06181 fundamentals 币种异常：${laopuDataset.currency}`);
  if (
    !Number.isFinite(laopuDataset.currentMarket?.price) ||
    laopuDataset.currentMarket.price <= 0
  )
    fail('06181 fundamentals 当前行情缺失');
  const annualYear = Number.parseInt(latestAnnual.period, 10);
  const halfYearYear = Number.parseInt(latestHalfYear.period, 10);
  if (
    annualYear >= halfYearYear &&
    (laopuDataset.latestReportPeriod !== latestAnnual.period ||
      laopuFundamentals.extraction?.latestReportPeriod !== latestAnnual.period)
  )
    fail(
      `06181 最新报告期未优先年报：dataset=${laopuDataset.latestReportPeriod} extraction=${laopuFundamentals.extraction?.latestReportPeriod}`,
    );
  console.log(
    `✓ 06181 老铺黄金：${laopuDataset.annual.length} 年度、${laopuDataset.halfYear.length} 半年期，最新年报 ${latestAnnual.period}，当前价 ${laopuDataset.currentMarket.price}`,
  );
  console.log('真实数据冒烟测试通过');
}

main().catch((error) => {
  console.error(
    `真实数据冒烟测试失败：${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
