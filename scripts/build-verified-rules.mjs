import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, '..');

function readJson(relativePath) {
  return JSON.parse(readFileSync(resolve(rootDir, relativePath), 'utf8'));
}

const source = readJson('data/rules/book-source.json');
const candidates = readJson('data/rules/rules.candidate.v0.2.json');
const locked = readJson('data/rules/locked-decisions.v1.json');
const programById = new Map(locked.programRules.map((rule) => [rule.id, rule]));
const aiIds = new Set(locked.aiRules);
const reminderIds = new Set(locked.reminderRules);
const excludedIds = new Set(locked.excludedRules);

const rules = candidates.rules.map((candidate, index) => {
  const program = programById.get(candidate.id);
  let decision = 'excluded';
  let evaluator = 'none';
  let scoreSpec = null;

  if (program) {
    decision = 'scoring';
    evaluator = 'program';
    scoreSpec = program;
  } else if (aiIds.has(candidate.id)) {
    decision = 'scoring';
    evaluator = 'ai';
    scoreSpec = {
      formula:
        'AI只从法定披露中整理与原文方向相关的证据，给出+1/0/-1/不适用/证据不足建议；用户确认后才能计分',
      positive:
        candidate.signal === 'risk' || candidate.signal === 'critical'
          ? null
          : `证据明确支持“${candidate.title}”`,
      risk:
        candidate.signal === 'positive'
          ? null
          : `证据明确触发“${candidate.title}”所述风险`,
      neutral: '证据方向不明确或正反证据并存',
      thresholdSource: 'qualitative_book_evidence',
    };
  } else if (reminderIds.has(candidate.id)) {
    decision = 'reminder';
  } else if (!excludedIds.has(candidate.id)) {
    throw new Error(`规则 ${candidate.id} 未出现在任何锁定分类中`);
  }

  return {
    ...candidate,
    order: index + 1,
    status: decision === 'excluded' ? 'rejected' : 'verified',
    decision,
    evaluator,
    scoreEligible: decision === 'scoring',
    scoreSpec,
    userConfirmed: true,
  };
});

const result = {
  version: locked.version,
  status: locked.status,
  lockedAt: locked.lockedAt,
  source: {
    id: source.id,
    title: source.title,
    edition: source.edition,
    sourceFileName: source.sourceFileName,
    sourceFileSha256: source.sourceFileSha256,
    extractedTextSha256: source.extractedTextSha256,
  },
  disclosure: locked.disclosure,
  counts: locked.counts,
  scoringPolicy: locked.scoringPolicy,
  dataPolicy: locked.dataPolicy,
  rules,
};

writeFileSync(
  resolve(rootDir, 'data/rules/rules.verified.v1.json'),
  `${JSON.stringify(result, null, 2)}\n`,
  'utf8',
);

console.log(`已生成锁定规则库：${rules.length}条`);
