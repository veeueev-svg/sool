/**
 * tests/production/production_ledger.test.ts — دفتر الحكم: 22 خرقًا معلنًا (المرحلة 37)
 * المالك: ديوان التدقيق | المدخلات: دعوى + تقرير مراقبة + بيّنات أقاليم ومرور وكتب
 * المخرجات: حكمٌ يجمع كل الخروق ثم يحكم — وواحدٌ منها يُسقط الكل
 * التبعيات: ProductionLedger | الصلاحيات: قياس فقط
 * حالات الفشل المقيسة: لكل رمز خرقٍ معلن بيّنةٌ تُسقطه (22 رمزًا)
 * اختبار القبول: tests/production/production_lifecycle.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0021-federated-operation.md
 * ثوابت الاختبار:
 *   1) البيّنة السليمة تمرّ — وإلّا كان الدفتر يرفض كل شيء فلا يقيس شيئًا
 *   2) كل خرق يُقاس برمزه لا بنصّه، ويُقيَّد `production_breach`
 *   3) الخروق تُجمع كلها قبل الحكم — لا يتوقف الدفتر عند أول خرق
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ProductionLedger, ProductionConfig, SupervisionReport, RegionEvidence, PassageEvidence,
  ProductionRunbookEvidence, OperationClaim,
  PROD_OBSERVER_IS_OPERATOR, PROD_OBSERVER_UNDECLARED, PROD_OPERATOR_UNDECLARED,
  PROD_NO_SUPERVISION_REPORT, PROD_SUPERVISION_NOT_RUNNING, PROD_SUPERVISION_LATE,
  PROD_SUPERVISION_GAP, PROD_SWEEPS_UNDER_MIN, PROD_SCANNER_NOT_OBSERVED, PROD_SCANNER_FAILED,
  PROD_CRITICAL_INCIDENT, PROD_REGION_MISSING, PROD_REGION_WITHOUT_GOVERNOR,
  PROD_REGION_NOT_ACTING, PROD_REGION_SUSPENDED, PROD_PASSAGE_NOT_ENFORCED,
  PROD_PASSAGE_UNPROVEN, PROD_ACTION_WITHOUT_PASSAGE, PROD_RUNBOOK_NOT_EXECUTED,
  PROD_RUNBOOK_FAILED, PROD_AUDIT_CHAIN_BROKEN, PROD_STATE_HALTED, PRODUCTION_BREACH_CODES,
} from '../../src/index';
import { AppendOnlyLog } from '../../src/audit/append_only_log';
import { OPERATOR, OBSERVER, repoPolicy } from './helpers';

const POLICY: ProductionConfig['policy'] = repoPolicy();
const BOOT = 1_700_000_000_000;

function supervision(patch: Partial<SupervisionReport> = {}): SupervisionReport {
  const scannerSweeps: Record<string, number> = {};
  for (const scanner of POLICY.scanners) scannerSweeps[scanner] = POLICY.supervision.min_sweeps;
  return {
    sweeps: POLICY.supervision.min_sweeps, failedSweeps: 0, incidents: [], critical: 0, high: 0,
    scannerSweeps, halted: false, running: true, gaps: [], bootAt: BOOT,
    startedAt: BOOT, firstSweepAt: BOOT, lastSweepAt: BOOT + POLICY.supervision.tick_ms,
    restartGapMs: null, ...patch,
  };
}

function regions(patch: (row: RegionEvidence) => RegionEvidence = (r) => r): readonly RegionEvidence[] {
  return POLICY.regions.required.map((regionId) => patch({
    regionId, active: true, suspended: false, governor: `official:${regionId}`,
    actionsExecuted: 1, actionsPassed: 1,
  }));
}

function passage(patch: Partial<PassageEvidence> = {}): PassageEvidence {
  return {
    enforced: true, granted: 1, passed: 1,
    blockedAttempts: POLICY.tolerance.min_bypass_proof, executedWithoutPassage: 0, ...patch,
  };
}

function runbooks(patch: Partial<ProductionRunbookEvidence> = {}): ProductionRunbookEvidence {
  return { passed: [...POLICY.runbooks], failed: [], ...patch };
}

function claim(patch: Partial<OperationClaim> = {}): OperationClaim {
  return {
    operator: OPERATOR, observer: OBSERVER, startedAt: BOOT,
    runbooksClaimed: [...POLICY.runbooks], ...patch,
  };
}

interface Case {
  readonly claim?: Partial<OperationClaim>;
  readonly supervision?: Partial<SupervisionReport> | null;
  readonly regions?: readonly RegionEvidence[];
  readonly passage?: Partial<PassageEvidence>;
  readonly runbooks?: Partial<ProductionRunbookEvidence>;
  readonly chainValid?: boolean;
  readonly halted?: boolean;
}

function verdictOf(scene: Case = {}) {
  const audit = new AppendOnlyLog();
  const ledger = new ProductionLedger({
    audit, policy: POLICY,
    chainValid: () => scene.chainValid !== false,
    stateHalted: () => scene.halted === true,
  });
  const theClaim = claim(scene.claim ?? {});
  ledger.declareOperation(theClaim);
  const verdict = ledger.judge(
    theClaim,
    scene.supervision === null ? null : supervision(scene.supervision ?? {}),
    scene.regions ?? regions(),
    passage(scene.passage ?? {}),
    runbooks(scene.runbooks ?? {}),
  );
  return { verdict, audit };
}

/** يقيس أن البيّنة المعطاة تُسقط الرمز المطلوب وتُقيّده */
function trips(scene: Case, code: string): void {
  const { verdict, audit } = verdictOf(scene);
  assert.equal(verdict.passed, false, `كان يجب أن يسقط بالرمز ${code}`);
  assert.ok(verdict.breaches.includes(code), `الخروق: ${verdict.breaches.join(', ')}`);
  const codes = audit.find('production_breach').map((e: { detail: unknown }) => (e.detail as { code: string }).code);
  assert.ok(codes.includes(code), 'الخرق يُقيَّد لا يُحكى');
  assert.equal(verdict.escalated, POLICY.escalate_on_breach, 'الخرق يُصعَّد كما تشترط التهيئة');
}

test('ثابت 1: البيّنة السليمة تمرّ ولا تُقيَّد خروقًا', () => {
  const { verdict, audit } = verdictOf();
  assert.deepEqual(verdict.breaches, [], `خروق غير متوقعة: ${verdict.breaches.join(', ')}`);
  assert.equal(verdict.passed, true);
  assert.equal(verdict.escalated, false);
  assert.equal(verdict.regionsOperating, POLICY.regions.required.length);
  assert.equal(verdict.regionsRequired, POLICY.regions.required.length);
  assert.equal(verdict.sweeps, POLICY.supervision.min_sweeps);
  assert.deepEqual([...verdict.runbooksExecuted], [...POLICY.runbooks]);
  assert.equal(audit.find('production_breach').length, 0);
  assert.equal(audit.find('production_verdict').length, 1);
  assert.equal(audit.find('production_operation_declared').length, 1);
});

test('استقلال الشهادة: المراقب ليس المشغّل، وكلٌّ منهما معلن (RULE-004)', () => {
  trips({ claim: { observer: OPERATOR } }, PROD_OBSERVER_IS_OPERATOR);
  trips({ claim: { observer: 'authority:someone_else' } }, PROD_OBSERVER_UNDECLARED);
  trips({ claim: { operator: 'official:region:core' } }, PROD_OPERATOR_UNDECLARED);
});

test('المراقبة: لا تقرير، أو متوقفة، أو متأخّرة عن الإقلاع', () => {
  trips({ supervision: null }, PROD_NO_SUPERVISION_REPORT);
  trips({ supervision: { running: false } }, PROD_SUPERVISION_NOT_RUNNING);
  trips(
    { supervision: { firstSweepAt: BOOT + POLICY.supervision.start_grace_ms + 1 } },
    PROD_SUPERVISION_LATE,
  );
  // أول مسحة غائبة تُقرأ تأخّرًا لا نهائيًّا لا سلامةً
  trips({ supervision: { firstSweepAt: null } }, PROD_SUPERVISION_LATE);
});

test('المراقبة: فجوةٌ معلنة، ومسحاتٌ تحت الحدّ، وماسحٌ لم يُنادَ، وماسحٌ انهار', () => {
  trips({
    supervision: { gaps: [{ kind: 'silence', ms: 5000, at: BOOT, auditId: 'x' }] },
  }, PROD_SUPERVISION_GAP);
  trips({ supervision: { sweeps: POLICY.supervision.min_sweeps - 1 } }, PROD_SWEEPS_UNDER_MIN);
  const unwatched: Record<string, number> = {};
  for (const s of POLICY.scanners) unwatched[s] = POLICY.supervision.min_sweeps;
  unwatched[POLICY.scanners[0] as string] = 0;
  trips({ supervision: { scannerSweeps: unwatched } }, PROD_SCANNER_NOT_OBSERVED);
  trips({ supervision: { failedSweeps: 1 } }, PROD_SCANNER_FAILED);
});

test('حادثٌ حرج واحد يُسقط الحكم — والتسامح صفر في التهيئة', () => {
  assert.equal(POLICY.tolerance.max_critical, 0);
  trips({ supervision: { critical: 1 } }, PROD_CRITICAL_INCIDENT);
});

test('الأقاليم: غائب، وموقوف، وبلا حاكم، وقائمٌ بلا فعل مُقاس (RULE-001)', () => {
  trips({ regions: [] }, PROD_REGION_MISSING);
  trips({ regions: regions((r) => ({ ...r, active: false })) }, PROD_REGION_MISSING);
  trips({ regions: regions((r) => ({ ...r, suspended: true })) }, PROD_REGION_SUSPENDED);
  trips({ regions: regions((r) => ({ ...r, governor: null })) }, PROD_REGION_WITHOUT_GOVERNOR);
  trips({ regions: regions((r) => ({ ...r, actionsExecuted: 0, actionsPassed: 0 })) },
    PROD_REGION_NOT_ACTING);
});

test('مرور التاج: غير مُنفَّذ، وبلا دليل منع، وفعلٌ نفَذ بلا إذن', () => {
  trips({ passage: { enforced: false } }, PROD_PASSAGE_NOT_ENFORCED);
  // «مُنفَّذ» بلا محاولة تجاوزٍ مرفوضة دعوى لا دليل
  trips({ passage: { blockedAttempts: 0 } }, PROD_PASSAGE_UNPROVEN);
  trips({ passage: { executedWithoutPassage: 1 } }, PROD_ACTION_WITHOUT_PASSAGE);
  // فعلٌ نفَذ في إقليمٍ بلا مرورٍ مطابق يُسقط الإقليم بالرمز نفسه
  trips({ regions: regions((r) => ({ ...r, actionsPassed: 0 })) }, PROD_ACTION_WITHOUT_PASSAGE);
});

test('كتب التشغيل: كتابٌ لم يُنفَّذ، وكتابٌ نُفِّذ ففشل — والدعوى لا تُغني', () => {
  const [book] = POLICY.runbooks;
  trips({ runbooks: { passed: POLICY.runbooks.filter((b) => b !== book) } },
    PROD_RUNBOOK_NOT_EXECUTED);
  trips({ runbooks: { passed: [], failed: [book as string] } }, PROD_RUNBOOK_FAILED);
  // كتابٌ مُدَّعى في الدعوى ولم يُنفّذ يُسقط الحكم — الدعوى ليست تنفيذًا
  const { verdict } = verdictOf({ runbooks: { passed: [] } });
  assert.equal(verdict.passed, false);
  assert.equal(verdict.runbooksExecuted.length, 0);
});

test('مصدران مستقلان عن الدعوى: سلسلة التدقيق وحالة الدولة', () => {
  trips({ chainValid: false }, PROD_AUDIT_CHAIN_BROKEN);
  trips({ halted: true }, PROD_STATE_HALTED);
});

test('ثابت 3: الخروق تُجمع كلها ثم يُحكم — لا توقّف عند أول خرق', () => {
  const { verdict } = verdictOf({
    claim: { observer: OPERATOR },
    supervision: { running: false, failedSweeps: 2, critical: 1, sweeps: 1 },
    regions: [],
    passage: { enforced: false, blockedAttempts: 0 },
    runbooks: { passed: [], failed: [] },
    chainValid: false,
    halted: true,
  });
  assert.equal(verdict.passed, false);
  assert.ok(verdict.breaches.length >= 12, `عدد الخروق المجموعة: ${verdict.breaches.length}`);
  for (const code of verdict.breaches) {
    assert.ok(PRODUCTION_BREACH_CODES.includes(code), `رمزٌ غير معلن: ${code}`);
  }
  assert.equal(verdict.escalated, true);
});

test('كل رمز خرقٍ معلن مقيسٌ في هذا الملف — لا رمزَ ميت (RULE-001)', () => {
  assert.equal(PRODUCTION_BREACH_CODES.length, 22);
  const measured = new Set([
    PROD_OBSERVER_IS_OPERATOR, PROD_OBSERVER_UNDECLARED, PROD_OPERATOR_UNDECLARED,
    PROD_NO_SUPERVISION_REPORT, PROD_SUPERVISION_NOT_RUNNING, PROD_SUPERVISION_LATE,
    PROD_SUPERVISION_GAP, PROD_SWEEPS_UNDER_MIN, PROD_SCANNER_NOT_OBSERVED, PROD_SCANNER_FAILED,
    PROD_CRITICAL_INCIDENT, PROD_REGION_MISSING, PROD_REGION_WITHOUT_GOVERNOR,
    PROD_REGION_NOT_ACTING, PROD_REGION_SUSPENDED, PROD_PASSAGE_NOT_ENFORCED,
    PROD_PASSAGE_UNPROVEN, PROD_ACTION_WITHOUT_PASSAGE, PROD_RUNBOOK_NOT_EXECUTED,
    PROD_RUNBOOK_FAILED, PROD_AUDIT_CHAIN_BROKEN, PROD_STATE_HALTED,
  ]);
  for (const code of PRODUCTION_BREACH_CODES) {
    assert.ok(measured.has(code), `رمزٌ معلن بلا قياس: ${code}`);
  }
});
