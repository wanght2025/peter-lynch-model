'use client';

import { type ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BookCheck,
  BookOpenText,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDashed,
  Download,
  FileCheck2,
  FileUp,
  LockKeyhole,
  MessageSquareWarning,
  Scale,
  ShieldCheck,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import {
  automationLabels,
  bookSource,
  companyTypeLabels,
  lockedRuleMetadata,
  ruleCatalog,
  type LynchRuleCandidate,
} from '@/lib/rule-catalog';

type UnderstandingDecision =
  | 'pending'
  | 'correct'
  | 'needs_change'
  | 'uncertain';
type PurposeDecision = 'pending' | 'scoring' | 'reminder' | 'exclude';

type RuleDecision = {
  understanding: UnderstandingDecision;
  purpose: PurposeDecision;
  note: string;
  updatedAt?: string;
  migratedFromOldReview?: boolean;
};

type SavedReviewState = {
  version: 1;
  bookSourceId: string;
  bookSha256: string;
  lockedAt: string | null;
  reviews: Record<string, RuleDecision>;
};

type Notice = { tone: 'good' | 'warn' | 'bad'; text: string } | null;

const REVIEW_STORAGE_KEY = 'lynch-rule-confirmation-v1';

const blankDecision: RuleDecision = {
  understanding: 'pending',
  purpose: 'pending',
  note: '',
};

function chapterNumber(chapter: string) {
  return Number(chapter.replace(/\D/g, ''));
}

function sortedRules() {
  return [...ruleCatalog].sort(
    (a, b) =>
      chapterNumber(a.chapter) - chapterNumber(b.chapter) ||
      a.id.localeCompare(b.id),
  );
}

function isComplete(decision: RuleDecision) {
  return decision.understanding !== 'pending' && decision.purpose !== 'pending';
}

function isBlocker(decision: RuleDecision) {
  return decision.understanding !== 'correct' || decision.purpose === 'pending';
}

function understandingLabel(value: UnderstandingDecision) {
  if (value === 'correct') return '理解正确';
  if (value === 'needs_change') return '需要修改';
  if (value === 'uncertain') return '暂时不确定';
  return '还没确认';
}

function purposeLabel(value: PurposeDecision) {
  if (value === 'scoring') return '用于评分';
  if (value === 'reminder') return '只做提醒';
  if (value === 'exclude') return '不采用';
  return '还没选择';
}

function metricExplanation(rule: LynchRuleCandidate) {
  const evidence = rule.requiredEvidence.join('、');

  if (rule.scoreSpec) {
    const parts = [`计算或判断：${rule.scoreSpec.formula}`];
    if (rule.scoreSpec.positive) parts.push(`正向：${rule.scoreSpec.positive}`);
    if (rule.scoreSpec.risk) parts.push(`风险：${rule.scoreSpec.risk}`);
    if (rule.scoreSpec.neutral) parts.push(`中性：${rule.scoreSpec.neutral}`);
    parts.push(`需要的数据：${evidence}`);
    return parts.join('。');
  }

  if (rule.kind === 'formula') {
    return `需要的数据：${evidence}。计算只采用上方原文给出的关系；当前不补充书外公式或权重。`;
  }
  if (rule.kind === 'threshold' || rule.kind === 'definition') {
    return `需要的数据：${evidence}。程序只采用上方原文明说的数字；没有写出的区间不会自行补齐。`;
  }
  if (rule.automation === 'hard') {
    return `程序读取：${evidence}。只判断原文明说的数字或方向，不自己增加门槛。`;
  }
  if (rule.automation === 'human') {
    return `需要查看：${evidence}。AI可以帮你找证据和整理文字，但不能替你做最终判断。`;
  }
  return `这条不转成计算指标。需要保留的资料：${evidence}。`;
}

function lockedReviews(): Record<string, RuleDecision> {
  return Object.fromEntries(
    ruleCatalog.map((rule) => [
      rule.id,
      {
        understanding: 'correct' as const,
        purpose:
          rule.decision === 'scoring'
            ? ('scoring' as const)
            : rule.decision === 'reminder'
              ? ('reminder' as const)
              : ('exclude' as const),
        note: rule.decision === 'excluded' ? '锁定为“不采用”' : '',
        updatedAt: lockedRuleMetadata.lockedAt,
      },
    ]),
  );
}

function matchesLockedCatalog(
  reviews: Record<string, RuleDecision>,
  lockedAt: string | null,
) {
  if (!lockedAt || Object.keys(reviews).length !== ruleCatalog.length) {
    return false;
  }
  const purposes = Object.values(reviews).map((item) => item.purpose);
  return (
    Object.values(reviews).every(isComplete) &&
    purposes.filter((item) => item === 'scoring').length ===
      lockedRuleMetadata.counts.scoring &&
    purposes.filter((item) => item === 'reminder').length ===
      lockedRuleMetadata.counts.reminder &&
    purposes.filter((item) => item === 'exclude').length ===
      lockedRuleMetadata.counts.excluded
  );
}

function migrateOldReviews(raw: unknown): Record<string, RuleDecision> {
  if (!raw || typeof raw !== 'object') return {};
  const old = raw as Record<string, unknown>;
  const migrated: Record<string, RuleDecision> = {};

  for (const rule of ruleCatalog) {
    const status = old[rule.id];
    if (status === 'accepted') {
      migrated[rule.id] = {
        understanding: 'correct',
        purpose: rule.scoreEligible ? 'scoring' : 'reminder',
        note: '',
        updatedAt: new Date().toISOString(),
        migratedFromOldReview: true,
      };
    } else if (status === 'rejected') {
      migrated[rule.id] = {
        understanding: 'correct',
        purpose: 'exclude',
        note: '从旧版“退回”结果迁移为“不采用”',
        updatedAt: new Date().toISOString(),
        migratedFromOldReview: true,
      };
    }
  }

  return migrated;
}

function normalizeImportedReviews(raw: unknown): Record<string, RuleDecision> {
  if (!raw || typeof raw !== 'object') return {};

  if (Array.isArray(raw)) {
    const oldMap: Record<string, unknown> = {};
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const record = item as Record<string, unknown>;
      if (typeof record.ruleId === 'string') {
        oldMap[record.ruleId] = record.decision;
      }
    }
    return migrateOldReviews(oldMap);
  }

  const result: Record<string, RuleDecision> = {};
  const knownIds = new Set(ruleCatalog.map((rule) => rule.id));
  for (const [ruleId, value] of Object.entries(
    raw as Record<string, unknown>,
  )) {
    if (!knownIds.has(ruleId) || !value || typeof value !== 'object') continue;
    const record = value as Record<string, unknown>;
    const understanding = record.understanding;
    const purpose = record.purpose;
    if (
      !['pending', 'correct', 'needs_change', 'uncertain'].includes(
        String(understanding),
      ) ||
      !['pending', 'scoring', 'reminder', 'exclude'].includes(String(purpose))
    ) {
      continue;
    }
    const note = typeof record.note === 'string' ? record.note : '';
    const migratedFromOldReview =
      record.migratedFromOldReview === true || note === '从旧版“退回”结果迁移';
    const oldRejected =
      migratedFromOldReview &&
      understanding === 'needs_change' &&
      purpose === 'exclude';
    result[ruleId] = {
      understanding: oldRejected
        ? 'correct'
        : (understanding as UnderstandingDecision),
      purpose: purpose as PurposeDecision,
      note: oldRejected ? '从旧版“退回”结果迁移为“不采用”' : note,
      updatedAt:
        typeof record.updatedAt === 'string' ? record.updatedAt : undefined,
      migratedFromOldReview,
    };
  }
  return result;
}

function decisionFor(reviews: Record<string, RuleDecision>, ruleId: string) {
  return reviews[ruleId] ?? blankDecision;
}

export function RuleWorkbench() {
  const rules = useMemo(() => sortedRules(), []);
  const chapters = useMemo(
    () => [...new Set(rules.map((rule) => rule.chapter))],
    [rules],
  );
  const [currentIndex, setCurrentIndex] = useState(0);
  const [reviews, setReviews] = useState<Record<string, RuleDecision>>({});
  const [lockedAt, setLockedAt] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const bookInputRef = useRef<HTMLInputElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let nextReviews: Record<string, RuleDecision> = lockedReviews();
    let nextLockedAt: string | null = lockedRuleMetadata.lockedAt;
    let nextNotice: Notice = null;
    try {
      const current = window.localStorage.getItem(REVIEW_STORAGE_KEY);
      if (current) {
        const parsed = JSON.parse(current) as Partial<SavedReviewState>;
        const sourceMatches = parsed.bookSha256 === bookSource.sourceFileSha256;
        if (!sourceMatches) {
          nextNotice = {
            tone: 'bad',
            text: '旧的本机记录对应另一份书籍，已改用当前锁定规则。请重新核对书籍文件。',
          };
        } else {
          const importedReviews = normalizeImportedReviews(parsed.reviews);
          const importedLockedAt =
            typeof parsed.lockedAt === 'string' ? parsed.lockedAt : null;
          if (matchesLockedCatalog(importedReviews, importedLockedAt)) {
            nextReviews = importedReviews;
            nextLockedAt = importedLockedAt;
          } else {
            nextNotice = {
              tone: 'good',
              text: '已用正式锁定版本替换旧的未完成本机记录。',
            };
          }
          const normalizedState: SavedReviewState = {
            version: 1,
            bookSourceId: bookSource.id,
            bookSha256: bookSource.sourceFileSha256,
            lockedAt: nextLockedAt,
            reviews: nextReviews,
          };
          window.localStorage.setItem(
            REVIEW_STORAGE_KEY,
            JSON.stringify(normalizedState),
          );
        }
      } else {
        const state: SavedReviewState = {
          version: 1,
          bookSourceId: bookSource.id,
          bookSha256: bookSource.sourceFileSha256,
          lockedAt: nextLockedAt,
          reviews: nextReviews,
        };
        window.localStorage.setItem(REVIEW_STORAGE_KEY, JSON.stringify(state));
      }
    } catch {
      nextNotice = {
        tone: 'warn',
        text: '本机保存记录无法读取，但规则原文没有受到影响。',
      };
    }
    queueMicrotask(() => {
      setReviews(nextReviews);
      setLockedAt(nextLockedAt);
      setNotice(nextNotice);
      setReady(true);
    });
  }, []);

  const currentRule = rules[currentIndex];
  const currentDecision = decisionFor(reviews, currentRule.id);
  const completedCount = rules.filter((rule) =>
    isComplete(decisionFor(reviews, rule.id)),
  ).length;
  const blockerCount = rules.filter((rule) =>
    isBlocker(decisionFor(reviews, rule.id)),
  ).length;
  const scoringCount = rules.filter(
    (rule) => decisionFor(reviews, rule.id).purpose === 'scoring',
  ).length;
  const reminderCount = rules.filter(
    (rule) => decisionFor(reviews, rule.id).purpose === 'reminder',
  ).length;
  const excludedCount = rules.filter(
    (rule) => decisionFor(reviews, rule.id).purpose === 'exclude',
  ).length;
  const remainingCount = rules.length - completedCount;
  const canLock = completedCount === rules.length && blockerCount === 0;

  function persist(
    nextReviews: Record<string, RuleDecision>,
    nextLockedAt: string | null,
  ) {
    const payload: SavedReviewState = {
      version: 1,
      bookSourceId: bookSource.id,
      bookSha256: bookSource.sourceFileSha256,
      lockedAt: nextLockedAt,
      reviews: nextReviews,
    };
    window.localStorage.setItem(REVIEW_STORAGE_KEY, JSON.stringify(payload));
  }

  function updateDecision(ruleId: string, patch: Partial<RuleDecision>) {
    if (lockedAt) return;
    setReviews((current) => {
      const next = {
        ...current,
        [ruleId]: {
          ...decisionFor(current, ruleId),
          ...patch,
          updatedAt: new Date().toISOString(),
          migratedFromOldReview: false,
        },
      };
      persist(next, null);
      return next;
    });
    setLockedAt(null);
    setNotice(null);
  }

  function chooseUnderstanding(value: UnderstandingDecision) {
    if (lockedAt) return;
    updateDecision(currentRule.id, {
      understanding: value,
      purpose:
        value === 'correct' ? currentDecision.purpose : ('pending' as const),
    });
  }

  function choosePurpose(value: PurposeDecision) {
    if (lockedAt) return;
    if (currentDecision.understanding !== 'correct') return;
    if (value === 'scoring' && !currentRule.scoreEligible) return;
    updateDecision(currentRule.id, { purpose: value });
  }

  function goTo(index: number) {
    const safeIndex = Math.max(0, Math.min(rules.length - 1, index));
    setCurrentIndex(safeIndex);
    window.requestAnimationFrame(() => {
      cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  function goToChapter(chapter: string) {
    const index = rules.findIndex((rule) => rule.chapter === chapter);
    if (index >= 0) goTo(index);
  }

  function exportReview() {
    const payload: SavedReviewState & { exportedAt: string } = {
      version: 1,
      bookSourceId: bookSource.id,
      bookSha256: bookSource.sourceFileSha256,
      exportedAt: new Date().toISOString(),
      lockedAt,
      reviews,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = '彼得林奇规则库-逐条确认结果.json';
    anchor.click();
    URL.revokeObjectURL(url);
    setNotice({ tone: 'good', text: '确认结果已导出。' });
  }

  async function importReview(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as Record<string, unknown>;
      if (
        parsed.bookSha256 !== bookSource.sourceFileSha256 ||
        parsed.bookSourceId !== bookSource.id
      ) {
        throw new Error('source-mismatch');
      }
      const next = normalizeImportedReviews(parsed.reviews);
      if (Object.keys(next).length === 0) throw new Error('empty');
      const nextLockedAt =
        typeof parsed.lockedAt === 'string' ? parsed.lockedAt : null;
      setReviews(next);
      setLockedAt(nextLockedAt);
      persist(next, nextLockedAt);
      setNotice({
        tone: 'good',
        text: `已导入 ${Object.keys(next).length} 条确认结果。`,
      });
    } catch (error) {
      setNotice({
        tone: 'bad',
        text:
          error instanceof Error && error.message === 'source-mismatch'
            ? '导入文件对应的书籍版本不同，已停止导入。'
            : '这个文件不是有效的确认结果，未做任何改动。',
      });
    }
  }

  async function verifyBook(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const digest = await window.crypto.subtle.digest(
      'SHA-256',
      await file.arrayBuffer(),
    );
    const hash = [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase();
    const matches = hash === bookSource.sourceFileSha256;
    setNotice({
      tone: matches ? 'good' : 'bad',
      text: matches
        ? '书籍文件一致，出处可以继续使用。'
        : `书籍文件不一致。当前文件指纹：${hash.slice(0, 16)}…，不要沿用现有确认结果。`,
    });
  }

  function lockCatalog() {
    if (!canLock) return;
    const time = new Date().toISOString();
    setLockedAt(time);
    persist(reviews, time);
    setNotice({
      tone: 'good',
      text: '规则库已在本机锁定。评分模块仍未接入，不会自动给股票打分。',
    });
  }

  const chapterProgress = (chapter: string) => {
    const chapterRules = rules.filter((rule) => rule.chapter === chapter);
    const done = chapterRules.filter((rule) =>
      isComplete(decisionFor(reviews, rule.id)),
    ).length;
    return `${done}/${chapterRules.length}`;
  };

  return (
    <main className="finance-shell min-h-screen bg-[var(--ds-canvas)] font-sans text-[var(--ds-text-primary)] tabular-nums">
      <header className="border-b border-[var(--ds-border-subtle)] bg-[var(--ds-app-chrome)] text-[var(--ds-text-primary)]">
        <div className="mx-auto flex min-h-12 max-w-[1500px] items-center justify-between gap-3 px-4 py-2 lg:px-6">
          <div className="flex items-center gap-3">
            <span className="grid size-8 place-items-center rounded-md border border-[var(--ds-border-strong)] bg-[var(--ds-surface-selected)] text-[var(--ds-accent)]">
              <BookOpenText className="size-4" />
            </span>
            <div>
              <p className="text-sm font-semibold tracking-[0.02em]">
                彼得林奇投资模型
              </p>
              <p className="hidden text-[10px] text-[var(--ds-text-tertiary)] sm:block">
                规则逐条确认 · 研究工作台
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/"
              className="hidden min-h-11 rounded-md px-3 py-2 text-sm text-[var(--ds-text-secondary)] hover:bg-[var(--ds-surface-selected)] hover:text-[var(--ds-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ds-accent)] md:inline-flex"
            >
              股票研究
            </Link>
            <input
              ref={importInputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={importReview}
            />
            <Button
              variant="outline"
              onClick={() => importInputRef.current?.click()}
              className="hidden min-h-11 border-[var(--ds-border-strong)] bg-transparent text-[var(--ds-text-secondary)] hover:bg-[var(--ds-surface-selected)] hover:text-[var(--ds-text-primary)] sm:inline-flex"
            >
              <Upload className="size-4" /> 导入
            </Button>
            <Button
              variant="outline"
              onClick={exportReview}
              className="min-h-11 border-[var(--ds-border-strong)] bg-transparent text-[var(--ds-text-secondary)] hover:bg-[var(--ds-surface-selected)] hover:text-[var(--ds-text-primary)]"
            >
              <Download className="size-4" /> 导出
            </Button>
          </div>
        </div>
      </header>

      <div className="border-b border-[var(--ds-border-subtle)] bg-[var(--ds-surface-subtle)]">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-x-5 gap-y-1 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--ds-text-tertiary)] lg:px-6">
          <span className="text-[var(--ds-accent)]">RULESET/53 LOCKED</span>
          <span className="text-[var(--ds-warning)]">
            EVIDENCE/OFFICIAL FILINGS
          </span>
          <span className="text-[var(--ds-accent)]">MODEL/PROGRAM ≠ AI</span>
          <span
            className={
              lockedAt ? 'text-[var(--ds-success)]' : 'text-[var(--ds-warning)]'
            }
          >
            STATE/{lockedAt ? 'LOCKED' : 'REVIEW'}
          </span>
        </div>
      </div>

      <section className="border-b border-[var(--ds-border-subtle)] bg-[var(--ds-surface)]">
        <div className="mx-auto max-w-[1500px] px-4 py-4 lg:px-6">
          <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
            <div>
              <div className="mb-3 flex flex-wrap gap-2">
                <Badge className="bg-[var(--ds-accent)] text-[var(--ds-app-chrome)] hover:bg-[var(--ds-accent-hover)]">
                  53 条 · 锁定版本 v{lockedRuleMetadata.version}
                </Badge>
                <Badge
                  variant="outline"
                  className={
                    lockedAt
                      ? 'border-[var(--ds-success)]/35 bg-[var(--ds-success-bg)] text-[var(--ds-success)]'
                      : 'border-[var(--ds-border-strong)] bg-[var(--ds-surface-subtle)] text-[var(--ds-text-secondary)]'
                  }
                >
                  {lockedAt ? '规则库已锁定' : '规则库待重新锁定'}
                </Badge>
              </div>
              <h1 className="text-2xl font-semibold tracking-[-0.02em] sm:text-3xl">
                一本书，一条一条确认
              </h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
                先看书里怎么说，再确认怎么使用。没有出处的不收，书里没给数字的也不会硬编数字。
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs text-[var(--ds-text-secondary)]">
              <ShieldCheck className="size-4 text-[var(--ds-success)]" />
              <span>结果自动保存在这台电脑</span>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              [
                '已确认',
                `${completedCount}/${rules.length}`,
                `${remainingCount} 条没完成`,
              ],
              [
                '仍有问题',
                blockerCount,
                blockerCount === 0 ? '可以锁定' : '处理完才能锁定',
              ],
              ['用于评分', scoringCount, '16条程序 + 14条AI确认'],
              ['只做提醒', reminderCount, `${excludedCount} 条不采用`],
            ].map(([label, value, note]) => (
              <Card
                key={String(label)}
                className="border border-[var(--ds-border-subtle)] bg-[var(--ds-surface-subtle)] shadow-none ring-0"
              >
                <CardContent className="p-3">
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="mt-1 text-xl font-semibold text-[var(--ds-text-primary)] sm:text-2xl">
                    {value}
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {note}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>

          <Progress
            value={(completedCount / rules.length) * 100}
            className="mt-4 [&_[data-slot=progress-indicator]]:bg-[var(--ds-accent)] [&_[data-slot=progress-track]]:h-1.5 [&_[data-slot=progress-track]]:bg-[var(--ds-surface-selected)]"
          />
        </div>
      </section>

      {notice && (
        <div className="mx-auto max-w-[1500px] px-4 pt-4 lg:px-6">
          <output
            className={`flex items-start justify-between gap-3 rounded-md border px-4 py-3 text-sm ${
              notice.tone === 'good'
                ? 'border-[var(--ds-success)]/35 bg-[var(--ds-success-bg)] text-[var(--ds-success)]'
                : notice.tone === 'bad'
                  ? 'border-[var(--ds-danger)]/35 bg-[var(--ds-danger-bg)] text-[var(--ds-danger)]'
                  : 'border-[var(--ds-warning)]/35 bg-[var(--ds-warning-bg)] text-[var(--ds-warning)]'
            }`}
          >
            <span>{notice.text}</span>
            <button
              type="button"
              onClick={() => setNotice(null)}
              className="grid min-h-11 min-w-11 place-items-center rounded-md opacity-70 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ds-accent)]"
              aria-label="关闭提示"
            >
              <X className="size-4" />
            </button>
          </output>
        </div>
      )}

      <div className="mx-auto grid max-w-[1500px] gap-3 px-4 py-4 lg:grid-cols-[190px_minmax(0,1fr)_280px] lg:px-6">
        <aside className="hidden lg:block">
          <div className="sticky top-5 rounded-md border border-[var(--ds-border-subtle)] bg-[var(--ds-surface)] p-2">
            <p className="px-2 pb-2 text-xs font-medium text-muted-foreground">
              按章节查看
            </p>
            <nav aria-label="章节">
              {chapters.map((chapter) => {
                const active = currentRule.chapter === chapter;
                return (
                  <button
                    key={chapter}
                    type="button"
                    onClick={() => goToChapter(chapter)}
                    className={`mb-1 flex min-h-11 w-full items-center justify-between rounded-md px-2.5 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ds-accent)] ${
                      active
                        ? 'bg-[var(--ds-surface-selected)] text-[var(--ds-accent)]'
                        : 'text-[var(--ds-text-secondary)] hover:bg-[var(--ds-surface-subtle)]'
                    }`}
                  >
                    <span>{chapter}</span>
                    <span
                      className={
                        active
                          ? 'text-[var(--ds-text-secondary)]'
                          : 'text-muted-foreground'
                      }
                    >
                      {chapterProgress(chapter)}
                    </span>
                  </button>
                );
              })}
            </nav>
          </div>
        </aside>

        <section className="min-w-0">
          <div className="mb-3 lg:hidden">
            <label className="text-xs font-medium text-muted-foreground">
              跳到章节
              <select
                value={currentRule.chapter}
                onChange={(event) => goToChapter(event.target.value)}
                className="mt-1.5 h-11 w-full rounded-md border border-[var(--ds-border-strong)] bg-[var(--ds-surface)] px-3 text-sm"
              >
                {chapters.map((chapter) => (
                  <option key={chapter} value={chapter}>
                    {chapter} · {chapterProgress(chapter)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <article
            ref={cardRef}
            className="scroll-mt-5 overflow-hidden rounded-md border border-[var(--ds-border-strong)] bg-[var(--ds-surface)] shadow-none"
          >
            <div className="border-b border-[var(--ds-border-subtle)] bg-[var(--ds-surface-subtle)] px-4 py-3 sm:px-5">
              <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge className="bg-[var(--ds-accent)] text-[var(--ds-app-chrome)] hover:bg-[var(--ds-accent-hover)]">
                      第 {currentIndex + 1} / {rules.length} 条
                    </Badge>
                    <Badge
                      variant="outline"
                      className="border-[var(--ds-border-strong)] bg-transparent text-[var(--ds-text-secondary)]"
                    >
                      {currentRule.chapter}
                    </Badge>
                    <Badge
                      variant="outline"
                      className="border-[var(--ds-border-strong)] bg-transparent text-[var(--ds-text-secondary)]"
                    >
                      {currentRule.evaluator === 'program'
                        ? '程序计算'
                        : currentRule.evaluator === 'ai'
                          ? 'AI整理 + 人工确认'
                          : automationLabels[currentRule.automation]}
                    </Badge>
                    {currentDecision.migratedFromOldReview && (
                      <Badge className="bg-[var(--ds-info-bg)] text-[var(--ds-info)] hover:bg-[var(--ds-info-bg)]">
                        已保留旧结果
                      </Badge>
                    )}
                  </div>
                  <h2 className="mt-3 text-xl font-semibold leading-8">
                    {currentRule.title}
                  </h2>
                  <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                    {currentRule.id}
                  </p>
                </div>
                <DecisionStatus decision={currentDecision} />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 border-b border-[var(--ds-border-subtle)] bg-[var(--ds-app-chrome)] px-4 py-2 font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--ds-text-tertiary)] sm:px-5">
              <span className="text-[var(--ds-warning)]">01 原文</span>
              <ChevronRight className="size-3" aria-hidden="true" />
              <span className="text-[var(--ds-accent)]">02 判断</span>
              <ChevronRight className="size-3" aria-hidden="true" />
              <span className="text-[var(--ds-warning)]">03 证据</span>
            </div>

            <div className="space-y-4 px-4 py-4 sm:px-5">
              <section>
                <SectionTitle icon={BookOpenText} text="书里怎么说" />
                <blockquote className="mt-3 rounded-r-md border-l-2 border-[var(--ds-warning)] bg-[var(--ds-warning-bg)] px-4 py-3 text-[15px] leading-7 text-[var(--ds-text-primary)]">
                  “{currentRule.excerpt}”
                </blockquote>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">
                  出处：{bookSource.title} · {currentRule.chapter}「
                  {currentRule.section}」· {currentRule.locator}
                </p>
              </section>

              <div className="grid gap-3 xl:grid-cols-2">
                <InfoBlock
                  title="我怎么理解"
                  icon={BookCheck}
                  text={currentRule.title}
                />
                <InfoBlock
                  title="怎么转成指标"
                  icon={Scale}
                  text={metricExplanation(currentRule)}
                />
                <InfoBlock
                  title="适合什么公司"
                  icon={FileCheck2}
                  text={currentRule.appliesTo
                    .map((scope) => companyTypeLabels[scope] ?? scope)
                    .join('、')}
                />
                <InfoBlock
                  title="有什么问题"
                  icon={MessageSquareWarning}
                  text={currentRule.ambiguity}
                  warning
                />
              </div>

              <section className="rounded-md border border-[var(--ds-border-subtle)] bg-[var(--ds-surface-subtle)] p-4">
                <div className="flex items-center gap-2">
                  <span className="grid size-7 place-items-center rounded-md bg-[var(--ds-accent)] text-sm font-semibold text-[var(--ds-app-chrome)]">
                    1
                  </span>
                  <h3 className="font-medium">这条是否准确照书整理？</h3>
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                  <ChoiceButton
                    active={currentDecision.understanding === 'correct'}
                    disabled={Boolean(lockedAt)}
                    onClick={() => chooseUnderstanding('correct')}
                    activeClass="border-[var(--ds-accent)]/50 bg-[var(--ds-info-bg)] text-[var(--ds-accent)]"
                    icon={Check}
                    label="理解正确"
                  />
                  <ChoiceButton
                    active={currentDecision.understanding === 'needs_change'}
                    disabled={Boolean(lockedAt)}
                    onClick={() => chooseUnderstanding('needs_change')}
                    activeClass="border-[var(--ds-danger)]/50 bg-[var(--ds-danger-bg)] text-[var(--ds-danger)]"
                    icon={X}
                    label="需要修改"
                  />
                  <ChoiceButton
                    active={currentDecision.understanding === 'uncertain'}
                    disabled={Boolean(lockedAt)}
                    onClick={() => chooseUnderstanding('uncertain')}
                    activeClass="border-[var(--ds-warning)]/50 bg-[var(--ds-warning-bg)] text-[var(--ds-warning)]"
                    icon={CircleDashed}
                    label="暂时不确定"
                  />
                </div>
                {(currentDecision.understanding === 'needs_change' ||
                  currentDecision.understanding === 'uncertain') && (
                  <div className="mt-4">
                    <label
                      htmlFor="review-note"
                      className="mb-1.5 block text-xs font-medium text-muted-foreground"
                    >
                      写下问题或修改意见
                    </label>
                    <Textarea
                      id="review-note"
                      value={currentDecision.note}
                      onChange={(event) =>
                        updateDecision(currentRule.id, {
                          note: event.target.value,
                        })
                      }
                      placeholder="例如：原文只讲方向，不应该直接设成 20% 门槛。"
                      className="min-h-24 border-[var(--ds-border-strong)] bg-[var(--ds-surface)]"
                    />
                  </div>
                )}
              </section>

              <section
                className={`rounded-md border p-4 ${
                  currentDecision.understanding === 'correct'
                    ? 'border-[var(--ds-border-subtle)] bg-[var(--ds-surface-subtle)]'
                    : 'border-dashed border-[var(--ds-border-subtle)] bg-[var(--ds-surface)]'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="grid size-7 place-items-center rounded-md bg-[var(--ds-surface-selected)] text-sm font-semibold text-[var(--ds-accent)]">
                    2
                  </span>
                  <div>
                    <h3 className="font-medium">这条怎么使用？</h3>
                    {currentDecision.understanding !== 'correct' && (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        先在上面选择“理解正确”。
                      </p>
                    )}
                  </div>
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                  <ChoiceButton
                    active={currentDecision.purpose === 'scoring'}
                    disabled={
                      Boolean(lockedAt) ||
                      currentDecision.understanding !== 'correct' ||
                      !currentRule.scoreEligible
                    }
                    onClick={() => choosePurpose('scoring')}
                    activeClass="border-[var(--ds-accent)]/50 bg-[var(--ds-info-bg)] text-[var(--ds-accent)]"
                    icon={Scale}
                    label="用于评分"
                  />
                  <ChoiceButton
                    active={currentDecision.purpose === 'reminder'}
                    disabled={
                      Boolean(lockedAt) ||
                      currentDecision.understanding !== 'correct'
                    }
                    onClick={() => choosePurpose('reminder')}
                    activeClass="border-[var(--ds-warning)]/50 bg-[var(--ds-warning-bg)] text-[var(--ds-warning)]"
                    icon={Sparkles}
                    label="只做提醒"
                  />
                  <ChoiceButton
                    active={currentDecision.purpose === 'exclude'}
                    disabled={
                      Boolean(lockedAt) ||
                      currentDecision.understanding !== 'correct'
                    }
                    onClick={() => choosePurpose('exclude')}
                    activeClass="border-[var(--ds-danger)]/50 bg-[var(--ds-danger-bg)] text-[var(--ds-danger)]"
                    icon={X}
                    label="不采用"
                  />
                </div>
                {!currentRule.scoreEligible && (
                  <p className="mt-3 text-xs leading-5 text-muted-foreground">
                    这条没有足够明确的评分依据，所以“用于评分”已关闭。你仍可选择只做提醒或不采用。
                  </p>
                )}
              </section>

              <div className="flex flex-col-reverse justify-between gap-3 border-t border-border pt-4 sm:flex-row sm:items-center">
                <Button
                  variant="outline"
                  disabled={currentIndex === 0}
                  onClick={() => goTo(currentIndex - 1)}
                >
                  <ArrowLeft className="size-4" /> 上一条
                </Button>
                <p className="text-center text-xs text-muted-foreground">
                  {lockedAt
                    ? '锁定版本不可直接改；需要修改时应生成新版本'
                    : '修改任何选择都会自动解除锁定'}
                </p>
                <Button
                  disabled={currentIndex === rules.length - 1}
                  onClick={() => goTo(currentIndex + 1)}
                  className="bg-[var(--ds-accent)] text-[var(--ds-app-chrome)] hover:bg-[var(--ds-accent-hover)]"
                >
                  下一条 <ArrowRight className="size-4" />
                </Button>
              </div>
            </div>
          </article>

          {completedCount === rules.length && (
            <section className="mt-5 rounded-md border border-[var(--ds-border-strong)] bg-[var(--ds-surface)] p-5 sm:p-6">
              <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
                <div>
                  <Badge className="bg-[var(--ds-accent)] text-[var(--ds-app-chrome)] hover:bg-[var(--ds-accent-hover)]">
                    53 条已走完
                  </Badge>
                  <h2 className="mt-3 font-serif text-2xl">确认结果汇总</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    有问题的规则会排在最前面。
                  </p>
                </div>
                <Button variant="outline" onClick={exportReview}>
                  <Download className="size-4" /> 导出完整结果
                </Button>
              </div>
              <div className="mt-5 max-h-[520px] overflow-auto rounded-md border border-[var(--ds-border-subtle)]">
                <Table>
                  <TableHeader>
                    <TableRow className="sticky top-0 z-10 bg-[var(--ds-surface-subtle)] hover:bg-[var(--ds-surface-subtle)]">
                      <TableHead>规则</TableHead>
                      <TableHead>理解</TableHead>
                      <TableHead>用途</TableHead>
                      <TableHead className="text-right">查看</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[...rules]
                      .sort((a, b) => {
                        const aBlocker = isBlocker(decisionFor(reviews, a.id));
                        const bBlocker = isBlocker(decisionFor(reviews, b.id));
                        return Number(bBlocker) - Number(aBlocker);
                      })
                      .map((rule) => {
                        const decision = decisionFor(reviews, rule.id);
                        const index = rules.findIndex(
                          (item) => item.id === rule.id,
                        );
                        return (
                          <TableRow key={rule.id}>
                            <TableCell className="max-w-[360px] whitespace-normal">
                              <p className="font-medium">{rule.title}</p>
                              <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                                {rule.id}
                              </p>
                            </TableCell>
                            <TableCell>
                              <span
                                className={
                                  decision.understanding === 'correct'
                                    ? 'text-[var(--ds-success)]'
                                    : 'text-[var(--ds-danger)]'
                                }
                              >
                                {understandingLabel(decision.understanding)}
                              </span>
                            </TableCell>
                            <TableCell>
                              {purposeLabel(decision.purpose)}
                            </TableCell>
                            <TableCell className="text-right">
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => goTo(index)}
                              >
                                打开 <ChevronRight className="size-4" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                  </TableBody>
                </Table>
              </div>
            </section>
          )}
        </section>

        <aside className="space-y-3">
          <Card className="border border-[var(--ds-border-strong)] bg-[var(--ds-surface-elevated)] text-[var(--ds-text-primary)] shadow-none ring-0 lg:sticky lg:top-5">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base font-semibold text-[var(--ds-text-primary)]">
                <LockKeyhole className="size-4 text-[var(--ds-accent)]" />{' '}
                最后锁定
              </CardTitle>
            </CardHeader>
            <CardContent>
              {lockedAt ? (
                <div>
                  <div className="flex items-center gap-2 text-[var(--ds-success)]">
                    <CheckCircle2 className="size-5" />
                    <span className="font-medium">规则库已锁定</span>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-[var(--ds-text-secondary)]">
                    30条评分规则已经固化。16条由程序计算，14条由AI整理证据并等你确认。
                  </p>
                </div>
              ) : (
                <div>
                  <p className="text-sm leading-6 text-[var(--ds-text-secondary)]">
                    {remainingCount > 0
                      ? `还有 ${remainingCount} 条没有完成两个选择。`
                      : blockerCount > 0
                        ? `还有 ${blockerCount} 条需要修改或仍不确定。`
                        : '全部完成，可以锁定正式规则库。'}
                  </p>
                  <Button
                    onClick={lockCatalog}
                    disabled={!canLock}
                    className="mt-4 w-full bg-[var(--ds-accent)] text-[var(--ds-app-chrome)] hover:bg-[var(--ds-accent-hover)] disabled:bg-[var(--ds-surface-selected)] disabled:text-[var(--ds-text-disabled)]"
                  >
                    <LockKeyhole className="size-4" /> 锁定规则库
                  </Button>
                </div>
              )}
              <div className="mt-4 border-t border-[var(--ds-border-subtle)] pt-4 text-xs leading-5 text-[var(--ds-text-tertiary)]">
                等权汇总与50分基准明确标成“本模型设置”，不会写成林奇原话。
              </div>
            </CardContent>
          </Card>

          <Card className="border border-[var(--ds-border-subtle)] bg-[var(--ds-surface)] shadow-none ring-0">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base font-semibold">
                <FileUp className="size-4 text-[var(--ds-accent)]" />{' '}
                核对书籍文件
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs leading-5 text-muted-foreground">
                换了书籍文件时先点这里。系统会比较文件指纹，不会上传书籍。
              </p>
              <input
                ref={bookInputRef}
                type="file"
                accept=".mobi,application/x-mobipocket-ebook"
                className="hidden"
                onChange={verifyBook}
              />
              <Button
                variant="outline"
                className="mt-3 w-full"
                onClick={() => bookInputRef.current?.click()}
              >
                <BookCheck className="size-4" /> 选择 MOBI 核对
              </Button>
              <p className="mt-3 break-all font-mono text-[9px] leading-4 text-muted-foreground">
                {bookSource.sourceFileSha256}
              </p>
            </CardContent>
          </Card>

          <Card className="border border-[var(--ds-warning)]/30 bg-[var(--ds-warning-bg)] shadow-none ring-0">
            <CardContent className="p-4">
              <div className="flex gap-3">
                <AlertTriangle className="mt-0.5 size-5 shrink-0 text-[var(--ds-warning)]" />
                <div>
                  <p className="font-medium text-[var(--ds-warning)]">
                    AI只做助手
                  </p>
                  <p className="mt-1 text-xs leading-5 text-[var(--ds-text-secondary)]">
                    AI可以找财报证据、解释文字和发现矛盾，但不能批准规则，也不能改最终分数。
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border border-[var(--ds-border-subtle)] bg-[var(--ds-surface)] shadow-none ring-0">
            <CardContent className="p-4 text-xs leading-5 text-muted-foreground">
              <p className="font-medium text-foreground">当前书籍</p>
              <p className="mt-1">{bookSource.title}</p>
              <p>
                {bookSource.publisher} · {bookSource.year}
              </p>
              <p>ISBN {bookSource.isbn}</p>
            </CardContent>
          </Card>
        </aside>
      </div>

      <footer className="border-t border-[var(--ds-border-subtle)] px-4 py-4 text-center text-xs text-[var(--ds-text-tertiary)] lg:px-6">
        本地使用 · 不构成投资建议 · AI建议未经确认不进入正式评分
      </footer>
      {!ready && <span className="sr-only">正在读取本机确认结果</span>}
    </main>
  );
}

function SectionTitle({
  icon: Icon,
  text,
}: {
  icon: typeof BookOpenText;
  text: string;
}) {
  return (
    <div className="flex items-center gap-2 text-[var(--ds-warning)]">
      <Icon className="size-4" />
      <h3 className="text-xs font-semibold tracking-[0.12em]">{text}</h3>
    </div>
  );
}

function InfoBlock({
  title,
  icon: Icon,
  text,
  warning = false,
}: {
  title: string;
  icon: typeof BookOpenText;
  text: string;
  warning?: boolean;
}) {
  return (
    <section
      className={`rounded-md border p-4 ${
        warning
          ? 'border-[var(--ds-warning)]/35 bg-[var(--ds-warning-bg)]'
          : 'border-[var(--ds-border-subtle)] bg-[var(--ds-surface-subtle)]'
      }`}
    >
      <div className="flex items-center gap-2">
        <Icon
          className={`size-4 ${warning ? 'text-[var(--ds-warning)]' : 'text-[var(--ds-accent)]'}`}
        />
        <h3 className="text-xs font-semibold text-muted-foreground">{title}</h3>
      </div>
      <p className="mt-2 text-sm leading-6">{text}</p>
    </section>
  );
}

function ChoiceButton({
  active,
  disabled = false,
  onClick,
  activeClass,
  icon: Icon,
  label,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  activeClass: string;
  icon: typeof BookOpenText;
  label: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={active}
      onClick={onClick}
      className={`flex min-h-11 items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ds-accent)] disabled:cursor-not-allowed disabled:opacity-35 ${
        active
          ? activeClass
          : 'border-[var(--ds-border-strong)] bg-[var(--ds-surface)] text-[var(--ds-text-secondary)] hover:bg-[var(--ds-surface-selected)]'
      }`}
    >
      <Icon className="size-4" /> {label}
    </button>
  );
}

function DecisionStatus({ decision }: { decision: RuleDecision }) {
  if (isBlocker(decision)) {
    return (
      <Badge
        variant="outline"
        className="shrink-0 border-[var(--ds-warning)]/40 bg-[var(--ds-warning-bg)] text-[var(--ds-warning)]"
      >
        <CircleDashed className="size-3" />
        {decision.understanding === 'pending'
          ? '还没确认'
          : understandingLabel(decision.understanding)}
      </Badge>
    );
  }
  return (
    <Badge className="shrink-0 bg-[var(--ds-info-bg)] text-[var(--ds-accent)] hover:bg-[var(--ds-info-bg)]">
      <Check className="size-3" /> 已确认 · {purposeLabel(decision.purpose)}
    </Badge>
  );
}
