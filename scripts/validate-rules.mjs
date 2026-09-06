import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, '..');
const outputRuleDocPath = resolve(
  rootDir,
  'outputs',
  '彼得林奇投资模型-规则库.md',
);

function readJson(relativePath) {
  return JSON.parse(readFileSync(resolve(rootDir, relativePath), 'utf8'));
}

const source = readJson('data/rules/book-source.json');
const catalog = readJson('data/rules/rules.verified.v1.json');
const locked = readJson('data/rules/locked-decisions.v1.json');
const ruleDoc = readFileSync(outputRuleDocPath, 'utf8');
const failures = [];
const check = (condition, message) => {
  if (!condition) failures.push(message);
};

function containsForbiddenWeight(value) {
  if (!value || typeof value !== 'object') return false;
  if (Object.prototype.hasOwnProperty.call(value, 'weight')) return true;
  return Object.values(value).some(containsForbiddenWeight);
}

check(catalog.status === 'locked', '规则库必须处于locked状态');
check(catalog.source.id === source.id, '规则库sourceRef与书籍来源不一致');
check(
  catalog.source.sourceFileSha256 === source.sourceFileSha256,
  'MOBI指纹不一致',
);
check(
  catalog.source.extractedTextSha256 === source.extractedTextSha256,
  '提取文本指纹不一致',
);
check(
  /^[A-F0-9]{64}$/.test(catalog.source.sourceFileSha256),
  'MOBI SHA-256格式错误',
);
check(!containsForbiddenWeight(catalog), '锁定规则库中禁止出现weight字段');
check(catalog.rules.length === 53, '锁定规则必须正好53条');

const ids = new Set();
for (const rule of catalog.rules) {
  check(!ids.has(rule.id), `规则ID重复：${rule.id}`);
  ids.add(rule.id);
  check(/^LYN-\d{2}-[A-Z0-9-]+$/.test(rule.id), `规则ID格式错误：${rule.id}`);
  check(/^第\d+章$/.test(rule.chapter), `${rule.id} 章节格式错误`);
  check(/^TXT-L\d+/.test(rule.locator), `${rule.id} 缺少稳定文本定位`);
  check(
    typeof rule.excerpt === 'string' && rule.excerpt.length >= 8,
    `${rule.id} 缺少原文摘录`,
  );
  check(
    Array.isArray(rule.requiredEvidence) && rule.requiredEvidence.length > 0,
    `${rule.id} 缺少证据要求`,
  );
  check(
    ['scoring', 'reminder', 'excluded'].includes(rule.decision),
    `${rule.id} 锁定用途无效`,
  );
  check(rule.userConfirmed === true, `${rule.id} 未标记为用户已确认`);
  if (rule.decision === 'scoring') {
    check(rule.status === 'verified', `${rule.id} 评分规则必须verified`);
    check(
      ['program', 'ai'].includes(rule.evaluator),
      `${rule.id} 评分执行者无效`,
    );
    check(
      rule.scoreEligible === true,
      `${rule.id} 评分规则scoreEligible必须为true`,
    );
    check(
      rule.scoreSpec && typeof rule.scoreSpec.formula === 'string',
      `${rule.id} 缺少量化说明`,
    );
    check(
      [
        'book_numeric',
        'book_direction',
        'no_numeric_threshold',
        'qualitative_book_evidence',
      ].includes(rule.scoreSpec?.thresholdSource),
      `${rule.id} 未说明阈值来源`,
    );
  } else {
    check(rule.scoreEligible === false, `${rule.id} 非评分规则不得计分`);
    check(rule.scoreSpec === null, `${rule.id} 非评分规则不得含评分公式`);
  }
}

const grouped = Object.groupBy(catalog.rules, (rule) => rule.decision);
const scoringRules = grouped.scoring ?? [];
const reminderRules = grouped.reminder ?? [];
const excludedRules = grouped.excluded ?? [];
const programRules = scoringRules.filter(
  (rule) => rule.evaluator === 'program',
);
const aiRules = scoringRules.filter((rule) => rule.evaluator === 'ai');

check(
  scoringRules.length === 27,
  `用于评分应为27条，实际${scoringRules.length}条`,
);
check(
  reminderRules.length === 13,
  `只做提醒应为13条，实际${reminderRules.length}条`,
);
check(
  excludedRules.length === 13,
  `不采用应为13条，实际${excludedRules.length}条`,
);
check(
  programRules.length === 13,
  `程序规则应为13条，实际${programRules.length}条`,
);
check(aiRules.length === 14, `AI规则应为14条，实际${aiRules.length}条`);
check(
  locked.counts.scoring === scoringRules.length,
  '锁定决策计数与规则库不一致',
);
check(
  ruleDoc.includes(`用于评分（${scoringRules.length}条）`) &&
    ruleDoc.includes(`只做提醒（${reminderRules.length}条）`) &&
    ruleDoc.includes(`不采用（${excludedRules.length}条）`),
  '规则库MD分类计数与机器JSON不一致',
);
check(
  ruleDoc.includes(catalog.source.sourceFileSha256) &&
    ruleDoc.includes(catalog.source.extractedTextSha256),
  '规则库MD缺少当前书籍指纹',
);
check(
  (ruleDoc.match(/^### \d+\./gm) ?? []).length === catalog.rules.length,
  '规则库MD条目数与机器JSON不一致',
);

function score({ positive, risk, applicable }) {
  return 50 + (50 * (positive - risk)) / applicable;
}
check(
  score({ positive: 7, risk: 2, applicable: 10 }) === 75,
  '评分样例应为75分',
);
check(
  score({ positive: 10, risk: 0, applicable: 10 }) === 100,
  '全正向应为100分',
);
check(score({ positive: 0, risk: 10, applicable: 10 }) === 0, '全风险应为0分');
check(
  score({ positive: 1, risk: 0, applicable: 27 }) < 55,
  '一条正向而其余证据不足时不得接近满分',
);

if (failures.length) {
  console.error(`规则库校验失败（${failures.length}项）：`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('锁定规则库校验通过');
console.log(
  `53条：评分${scoringRules.length} / 提醒${reminderRules.length} / 不采用${excludedRules.length}`,
);
console.log(
  `评分阶段：程序${programRules.length} / AI+来源校验${aiRules.length}`,
);
console.log(`书籍SHA-256：${catalog.source.sourceFileSha256}`);
