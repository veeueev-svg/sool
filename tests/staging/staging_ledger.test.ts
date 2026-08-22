/**
 * tests/staging/staging_ledger.test.ts — دفتر الحكم: كل رمز خرق يُسقطه قياس (المرحلة 36)
 * المالك: ديوان التدقيق | المدخلات: دعوى نافذة + تقرير مراقب + بيّنة كتب
 * المخرجات: إثبات أن كل رمز معلن يقع فعلًا، وأن خرقًا واحدًا يُسقط الحكم كلّه
 * التبعيات: StagingLedger | الصلاحيات: القياس فقط
 * السجلات: staging_window_declared / staging_breach / staging_verdict
 * حالات الفشل: كلها مغلقة برموز معلنة
 * اختبار القبول: tests/staging/staging_lifecycle.test.ts | الوثيقة: docs/decisions/ADR-0020-limited-operation.md
 * ثوابت الاختبار: 1) لا رمز معلن لا يقع (درس الجلسة 13)؛ 2) الخروق تُجمع ولا يُرمى عند أولها؛
 *   3) الحكم يُقرأ من عائده ومن السجل معًا.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MonitorReport, RunbookEvidence, STAGE_AUDIT_CHAIN_BROKEN, STAGE_CRITICAL_INCIDENT,
  STAGE_NO_MONITOR_REPORT, STAGE_OBSERVER_IS_OPERATOR, STAGE_OBSERVER_UNDECLARED,
  STAGE_RUNBOOK_FAILED, STAGE_RUNBOOK_NOT_EXECUTED, STAGE_SCOPE_NOT_OPENED, STAGE_STATE_HALTED,
  STAGE_TICKS_UNDER_MIN, STAGE_WATCH_FAILED, STAGE_WATCH_NOT_OBSERVED, STAGE_WINDOW_INCOMPLETE,
  STAGING_BREACH_CODES, StagingLedger, StagingVerdict, WindowClaim, bootstrapState,
} from '../../src/index';
import { OBSERVER, OPERATOR } from './helpers';

const T = 1_000_000;

function state(): ReturnType<typeof bootstrapState> {
  return bootstrapState({ now: Date.now() });
}

function cleanReport(s: ReturnType<typeof bootstrapState>, over: Partial<MonitorReport> = {}): MonitorReport {
  const watchTicks: Record<string, number> = {};
  for (const watch of s.stagingConfig.policy.watches) watchTicks[watch] = 10;
  return {
    ticks: s.stagingConfig.policy.window.min_ticks, failedTicks: 0, incidents: [],
    critical: 0, high: 0, watchTicks, halted: false, ...over,
  };
}

function cleanClaim(s: ReturnType<typeof bootstrapState>, over: Partial<WindowClaim> = {}): WindowClaim {
  return {
    operator: OPERATOR, observer: OBSERVER, startedAt: T,
    endedAt: T + s.stagingConfig.policy.window.duration_ms,
    runbooksClaimed: [...s.stagingConfig.policy.runbooks], scopeWasOpened: true, ...over,
  };
}

function cleanBooks(s: ReturnType<typeof bootstrapState>): RunbookEvidence {
  return { passed: [...s.stagingConfig.policy.runbooks], failed: [] };
}

interface Case {
  readonly claim?: Partial<WindowClaim>;
  readonly report?: Partial<MonitorReport> | null;
  readonly books?: RunbookEvidence;
  readonly chainValid?: boolean;
  readonly halted?: boolean;
}

function judge(c: Case = {}): { verdict: StagingVerdict; s: ReturnType<typeof bootstrapState> } {
  const s = state();
  const ledger = new StagingLedger({
    audit: s.audit, policy: s.stagingConfig.policy,
    chainValid: () => c.chainValid ?? true,
    stateHalted: () => c.halted ?? false,
  });
  const claim = cleanClaim(s, c.claim ?? {});
  ledger.declareWindow(claim);
  const report = c.report === null ? null : cleanReport(s, c.report ?? {});
  return { verdict: ledger.judge(claim, report, c.books ?? cleanBooks(s)), s };
}

test('نافذة مستوفية كل الشروط تمرّ، والحكم يُقيَّد في السجل بلا خرق ولا تصعيد', () => {
  const { verdict, s } = judge();
  assert.equal(verdict.passed, true, verdict.breaches.join(' | '));
  assert.deepEqual(verdict.breaches, []);
  assert.equal(verdict.escalated, false);
  assert.equal(verdict.criticalIncidents, 0);
  assert.equal(s.audit.find('staging_verdict').length, 1);
  assert.equal(s.audit.find('staging_window_declared').length, 1);
  assert.equal(s.audit.find('staging_breach').length, 0);
});

test('المراقب: هو المشغّل أو غير المعلن — خرقان بحسب سببهما (RULE-004)', () => {
  const both = judge({ claim: { observer: OPERATOR } });
  assert.equal(both.verdict.passed, false);
  assert.equal(both.verdict.breaches.includes(STAGE_OBSERVER_IS_OPERATOR), true);
  assert.equal(both.verdict.breaches.includes(STAGE_OBSERVER_UNDECLARED), true);
  const other = judge({ claim: { observer: 'authority:tribunal' } });
  assert.equal(other.verdict.breaches.includes(STAGE_OBSERVER_UNDECLARED), true);
  assert.equal(other.verdict.breaches.includes(STAGE_OBSERVER_IS_OPERATOR), false);
});

test('مدة ناقصة أو مسحات دون الحد أو حرسٌ لم يمسح أو مسحة انهارت — أربعة خروق بأسمائها', () => {
  const short = judge({ claim: { endedAt: T + 10 } });
  assert.equal(short.verdict.passed, false);
  assert.equal(short.verdict.breaches.includes(STAGE_WINDOW_INCOMPLETE), true);
  const few = judge({ report: { ticks: 1 } });
  assert.equal(few.verdict.breaches.includes(STAGE_TICKS_UNDER_MIN), true);
  assert.equal(few.verdict.ticks, 1);
  const { verdict, s } = judge({ report: { watchTicks: { scope: 5 }, failedTicks: 3 } });
  assert.equal(verdict.passed, false);
  assert.equal(verdict.breaches.includes(STAGE_WATCH_NOT_OBSERVED), true);
  assert.equal(verdict.breaches.includes(STAGE_WATCH_FAILED), true);
  const unwatched = s.audit.find('staging_breach')
    .filter((e) => (e.detail as { code: string }).code === STAGE_WATCH_NOT_OBSERVED);
  assert.equal(unwatched.length, s.stagingConfig.policy.watches.length - 1);
});

test('حادث حرج واحد يُسقط شرط القبول نصًّا ويُصعَّد', () => {
  const { verdict, s } = judge({
    report: {
      critical: 1,
      incidents: [{
        kind: 'scope_violation', watch: 'scope', severity: 'critical',
        detail: 'خرق نطاق', at: T, auditId: 'x',
      }],
    },
  });
  assert.equal(verdict.passed, false);
  assert.equal(verdict.breaches.includes(STAGE_CRITICAL_INCIDENT), true);
  assert.equal(verdict.escalated, true);
  assert.equal((s.audit.find('staging_verdict').at(-1)?.detail as { escalated: boolean }).escalated, true);
});

test('الكتب تُقرأ من المنفّذ لا من الدعوى: كتابٌ مُدّعى ولم يُنفَّذ خرقٌ', () => {
  const s = state();
  const declared = [...s.stagingConfig.policy.runbooks];
  const notExecuted = judge({ books: { passed: declared.slice(1), failed: [] } });
  assert.equal(notExecuted.verdict.breaches.includes(STAGE_RUNBOOK_NOT_EXECUTED), true);
  const failed = judge({ books: { passed: declared.slice(1), failed: [declared[0]!] } });
  assert.equal(failed.verdict.breaches.includes(STAGE_RUNBOOK_FAILED), true);
  assert.equal(failed.verdict.breaches.includes(STAGE_RUNBOOK_NOT_EXECUTED), false);
});

test('نافذة بلا تقرير مراقب أو بلا نطاق مفتوح أو على سلسلة مكسورة أو دولة موقوفة', () => {
  assert.equal(judge({ report: null }).verdict.breaches.includes(STAGE_NO_MONITOR_REPORT), true);
  assert.equal(judge({ claim: { scopeWasOpened: false } }).verdict.breaches.includes(STAGE_SCOPE_NOT_OPENED), true);
  assert.equal(judge({ chainValid: false }).verdict.breaches.includes(STAGE_AUDIT_CHAIN_BROKEN), true);
  assert.equal(judge({ halted: true }).verdict.breaches.includes(STAGE_STATE_HALTED), true);
});

test('الخروق تُجمع كلها ولا يُرمى عند أولها — والأصدق أنفع من الأقصر', () => {
  const { verdict } = judge({
    claim: { observer: OPERATOR, endedAt: T + 1, scopeWasOpened: false },
    report: { ticks: 0, failedTicks: 1, watchTicks: {}, critical: 1 },
    books: { passed: [], failed: [] },
    chainValid: false,
    halted: true,
  });
  assert.equal(verdict.passed, false);
  const unique = new Set(verdict.breaches);
  for (const code of STAGING_BREACH_CODES) {
    if (code === STAGE_NO_MONITOR_REPORT || code === STAGE_RUNBOOK_FAILED) continue;
    assert.equal(unique.has(code), true, `رمزٌ معلن لم يقع: ${code}`);
  }
});
