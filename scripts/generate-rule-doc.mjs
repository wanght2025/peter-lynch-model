import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, '..');
const outputDir = resolve(rootDir, 'outputs');
const catalog = JSON.parse(
  readFileSync(resolve(rootDir, 'data/rules/rules.verified.v1.json'), 'utf8'),
);

const decisionLabel = {
  scoring: '用于评分',
  reminder: '只做提醒',
  excluded: '不采用',
};
const evaluatorLabel = {
  program: '程序计算',
  ai: 'AI整理证据＋用户确认',
  none: '不执行',
};
const scopeLabel = {
  all: '所有类型',
  portfolio: '投资者/组合',
  slow_grower: '缓慢增长型',
  stalwart: '稳定增长型',
  fast_grower: '快速增长型',
  cyclical: '周期型',
  turnaround: '困境反转型',
  asset_play: '隐蔽资产型',
};

const text = [];
const line = (value = '') => text.push(value);

line('# 彼得林奇投资模型：规则库');
line();
line(
  '<!-- 本文件由 scripts/generate-rule-doc.mjs 从 data/rules/rules.verified.v1.json 自动生成，请勿手工改规则内容。 -->',
);
line();
line(`版本：${catalog.version}（${catalog.status}）  `);
line(`锁定日期：${catalog.lockedAt}  `);
line(
  `规则总数：${catalog.rules.length}条；用于评分${catalog.counts.scoring}条，只做提醒${catalog.counts.reminder}条，不采用${catalog.counts.excluded}条。  `,
);
line(
  `评分规则：程序计算${catalog.counts.program}条，AI整理证据＋用户确认${catalog.counts.ai}条。`,
);
line();
line('## 一、唯一书籍来源');
line();
line(`- 书名：${catalog.source.title}`);
line(`- 来源编号：${catalog.source.id}`);
line(`- MOBI SHA-256：\`${catalog.source.sourceFileSha256}\``);
line(`- 抽取文本 SHA-256：\`${catalog.source.extractedTextSha256}\``);
line(
  '- 定位方法：章节＋小节＋抽取文本行号＋短原文＋源文件指纹。MOBI没有稳定纸质页码，因此不伪造页码。',
);
line();
line(
  '任何没有这份书中出处的判断都不得进入本规则库。机器规则 JSON 与本文件使用同一份锁定数据生成。',
);
line();
line('## 二、评分契约');
line();
line(
  '单条适用规则只有五种结果：`+1`、`0`、`-1`、`不适用`、`证据不足`。所有规则等权。',
);
line();
line('```text');
line('得分 = 50 + 50 ×（正向规则数－风险规则数）÷ 适用规则数');
line('覆盖率 = 有可靠证据的适用规则数 ÷ 适用规则数');
line('```');
line();
line(`> ${catalog.disclosure}`);
line();
for (const rule of catalog.scoringPolicy.rules) line(`- ${rule}`);
line();
line('## 三、锁定汇总');
line();
line('| 用途 | 数量 | 执行方式 |');
line('|---|---:|---|');
line(
  `| 用于评分 | ${catalog.counts.scoring} | 程序${catalog.counts.program}条；AI＋人工${catalog.counts.ai}条 |`,
);
line(`| 只做提醒 | ${catalog.counts.reminder} | 展示但不进分 |`);
line(`| 不采用 | ${catalog.counts.excluded} | 保留原文和决定，不执行 |`);
line();

for (const category of ['scoring', 'reminder', 'excluded']) {
  const rules = catalog.rules.filter((rule) => rule.decision === category);
  line(
    `## ${category === 'scoring' ? '四' : category === 'reminder' ? '五' : '六'}、${decisionLabel[category]}（${rules.length}条）`,
  );
  line();
  for (const rule of rules) {
    line(`### ${rule.order}. ${rule.title}`);
    line();
    line(`- 规则编号：\`${rule.id}\``);
    line(`- 用途：${decisionLabel[rule.decision]}`);
    line(`- 执行：${evaluatorLabel[rule.evaluator]}`);
    line(
      `- 适用：${rule.appliesTo.map((scope) => scopeLabel[scope] ?? scope).join('、')}`,
    );
    line(`- 出处：${rule.chapter}「${rule.section}」；${rule.locator}`);
    line(`- 需要证据：${rule.requiredEvidence.join('、')}`);
    line(`- 原文未明确处：${rule.ambiguity}`);
    line();
    line(`> ${rule.excerpt}`);
    line();
    if (rule.scoreSpec) {
      line(`- 计算或判断：${rule.scoreSpec.formula}`);
      if (rule.scoreSpec.positive)
        line(`- ` + `\`+1\`` + `：${rule.scoreSpec.positive}`);
      if (rule.scoreSpec.risk)
        line(`- ` + `\`-1\`` + `：${rule.scoreSpec.risk}`);
      if (rule.scoreSpec.neutral)
        line(`- ` + `\`0\`` + `：${rule.scoreSpec.neutral}`);
      if (rule.scoreSpec.notApplicable)
        line(`- 不适用：${rule.scoreSpec.notApplicable}`);
      line(`- 阈值来源：\`${rule.scoreSpec.thresholdSource}\``);
      line();
    }
  }
}

line('## 七、版本纪律');
line();
line('- 修改书籍文件、规则决定、指标口径或评分代码时必须更新相应版本号。');
line(
  '- 规则校验失败时停止构建；没有原文、没有定位、没有书籍指纹或出现自定义权重都不能发布。',
);
line('- AI不得批准规则，不得改正负1分，不得把未确认建议写进正式分数。');
line('- 旧版10条“退回”已经锁定为“不采用”，不重新分类。');

mkdirSync(outputDir, { recursive: true });
writeFileSync(
  resolve(outputDir, '彼得林奇投资模型-规则库.md'),
  `${text.join('\n')}\n`,
  'utf8',
);
console.log('已从锁定JSON生成：彼得林奇投资模型-规则库.md');
