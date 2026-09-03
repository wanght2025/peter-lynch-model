const baseUrl = (process.env.BASE_URL || 'http://localhost:3000').replace(
  /\/$/,
  '',
);
const annualMinimum = 10;

function fail(message) {
  throw new Error(message);
}

async function getJson(path) {
  const url = `${baseUrl}${path}`;
  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
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

  for (const code of ['600519', '00700']) {
    console.log(`检查 /api/official-reports?code=${code} …`);
    checkOfficialReports(
      code,
      await getJson(`/api/official-reports?code=${code}`),
    );
  }

  console.log('检查 /api/fundamentals?code=600519 …');
  const fundamentals = await getJson('/api/fundamentals?code=600519');
  const dataset = fundamentals?.dataset;
  const annual = dataset?.annual;
  const quarterly = dataset?.quarterly;
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
    `✓ 600519 基本面：${annual.length} 年度、${quarterly.length} 季度、${yearEndPriceCount} 个年末价格、最新价 ${dataset.currentMarket.price}（${dataset.currentMarket.date}），解析 ${fundamentals.extraction.requestedReports} 份报告，analysis 已生成`,
  );
  console.log('真实数据冒烟测试通过');
}

main().catch((error) => {
  console.error(
    `真实数据冒烟测试失败：${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
