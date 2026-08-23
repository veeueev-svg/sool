/**
 * tests/production/confinement_scanner.test.ts — قياسُ ماسح الحصر (المرحلة 39، T-16)
 * المالك: ديوان التدقيق
 * المدخلات: شواهدُ حصرٍ مصطنعة (محصور · غير محصور · غائب · غيرُ مقروء)
 * المخرجات: حادثُ `process_not_confined` حيث يجب، وصمتٌ حيث يجب
 * التبعيات: confinementProbe + PRODUCTION_MUST_BE_CRITICAL + repoPolicy
 * الصلاحيات: القياسُ وحده — لا يُخفّف هذا الملف شدّةً ولا يحذف ماسحًا
 * السجلات: لا شيء | حالات الفشل: تُقرأ برمزها وبنوع الحادث لا بنصّه
 * اختبار القبول: tests/production/production_lifecycle.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0026-kernel-confinement.md
 * ثوابتُ هذا الملف:
 *   1) **الغيابُ خرقٌ لا تفصيل**: `null` شاهدًا يُرفع حادثًا، فمن لا يُثبت حصره غيرُ محصور.
 *   2) **الشدّةُ من التهيئة**: الماسحُ يرفع نوعًا، و`config/production.yaml` يُصنّفه حرجًا.
 *   3) **ثابت 4 (التقرير اللاصق)**: الخرقُ نفسه يُرفع مرةً واحدة، وتبدُّلُه يُرفع من جديد.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { AppendOnlyLog } from '../../src/audit/append_only_log';
import {
  confinementProbe, ProductionScannerDeps, PRODUCTION_MUST_BE_CRITICAL,
  PRODUCTION_REQUIRED_SCANNERS, PRODUCTION_KNOWN_SCANNERS,
  confinementWitness, loadConfinement,
} from '../../src/index';
import { OBSERVER, repoPolicy } from './helpers';
import { writeFakeProc, CONFINED, UNCONFINED } from '../security/proc_fixture';

const POLICY = repoPolicy();
const NOW = 1_700_000_000_000;

function deps(confinement: ProductionScannerDeps['confinement']): ProductionScannerDeps {
  return {
    audit: new AppendOnlyLog(),
    loads: { overdue: () => [] },
    unit: { reconcile: () => ({ consistent: true, counter: 1, ledger: 1 }) },
    factories: { sweep: () => [] },
    hospitals: { report: () => ({ expired: 0, halted: 0 }) },
    retention: { sweep: () => ({ purged: [] }) },
    passage: { active: true, wasOpenAt: () => true },
    policy: POLICY,
    retentionAuthority: OBSERVER,
    durable: { file: '/tmp/x', verify: () => ({ valid: true, length: 1, reason: null }) },
    confinement,
  };
}

/** شاهدٌ على جذرٍ مُصطنع — يُحذف بعد القياس */
function witnessOn(facts: typeof CONFINED): { root: string; witness: ProductionScannerDeps['confinement'] } {
  const root = writeFakeProc(facts);
  return { root, witness: confinementWitness({ ...loadConfinement().policy, witness_root: root }) };
}

test('الحصرُ مشترطٌ ومعروفٌ في سياسة الإنتاج، وحادثُه حرجٌ لا جسيم', () => {
  assert.ok(PRODUCTION_KNOWN_SCANNERS.includes('confinement'));
  assert.ok(PRODUCTION_REQUIRED_SCANNERS.includes('confinement'));
  assert.ok(PRODUCTION_MUST_BE_CRITICAL.includes('process_not_confined'));
  assert.ok(POLICY.severity.critical.includes('process_not_confined'));
  assert.ok(POLICY.scanners.includes('confinement'));
});

test('لا شاهدَ أصلًا: حادثٌ يُرفع — ومن لا يُثبت حصره فهو غير محصور', () => {
  const probe = confinementProbe(deps(null));
  const first = probe(NOW);
  assert.equal(first.length, 1);
  assert.equal(first[0]?.kind, 'process_not_confined');
  // ثابت 4: الغيابُ نفسه لا يُرفع مرتين
  assert.equal(probe(NOW + 1000).length, 0);
});

test('شاهدٌ غيرُ محصور: حادثٌ يُرفع ويحمل الشروطَ الساقطة بقياسها', () => {
  const { root, witness } = witnessOn(UNCONFINED);
  try {
    const probe = confinementProbe(deps(witness));
    const findings = probe(NOW);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.kind, 'process_not_confined');
    assert.match(findings[0]!.detail, /read_only_root=/);
    assert.match(findings[0]!.detail, /default_deny_egress=/);
    assert.equal(probe(NOW + 1000).length, 0); // ثابت 4
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('شاهدٌ محصور: لا حادثَ — والمسحُ لا يخترع خرقًا ليُظهر عملًا', () => {
  const { root, witness } = witnessOn(CONFINED);
  try {
    const probe = confinementProbe(deps(witness));
    assert.equal(probe(NOW).length, 0);
    assert.equal(probe(NOW + 1000).length, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('شاهدٌ غيرُ مقروء: العجزُ يُرفع حادثًا ولا يُفسَّر حصرًا (RULE-007)', () => {
  const { root, witness } = witnessOn(CONFINED);
  const probe = confinementProbe(deps(witness));
  assert.equal(probe(NOW).length, 0);
  rmSync(root, { recursive: true, force: true }); // اختفى الشاهدُ في زمن التشغيل
  const findings = probe(NOW + 1000);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.kind, 'process_not_confined');
  assert.match(findings[0]!.detail, /CONFINEMENT|غير مقروء/);
});

test('عودةُ الحصر تُنهي التقرير اللاصق: خرقٌ لاحق يُرفع من جديد لا يُكتم', () => {
  const bad = writeFakeProc(UNCONFINED);
  const good = writeFakeProc(CONFINED);
  try {
    let root = bad;
    const witness = { witnessRoot: 'مُصطنع', verify: () => confinementWitness({
      ...loadConfinement().policy, witness_root: root,
    }).verify() };
    const probe = confinementProbe(deps(witness));
    assert.equal(probe(NOW).length, 1);
    assert.equal(probe(NOW + 1).length, 0);
    root = good;
    assert.equal(probe(NOW + 2).length, 0);
    root = bad;
    assert.equal(probe(NOW + 3).length, 1, 'الخرقُ بعد استواءٍ يُرفع من جديد');
  } finally {
    rmSync(bad, { recursive: true, force: true });
    rmSync(good, { recursive: true, force: true });
  }
});
