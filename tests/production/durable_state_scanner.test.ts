/**
 * tests/production/durable_state_scanner.test.ts — ماسحُ الثبات (المرحلة 39، البند T-120)
 * المالك: ديوان التدقيق | المدخلات: شاهدُ ثباتٍ مُبدَل + تهيئة التشغيل الاتحادي المعلنة
 * المخرجات: حادثٌ يُرفع عند غياب الوسيط أو تحريفه، ولا يتكرر بين مسحتين
 * التبعيات: durableStateProbe, PRODUCTION_REQUIRED_SCANNERS, loadProduction
 * الصلاحيات: القياس فقط — والماسح لا يُصلح ما يجده
 * حالات الفشل المقيسة: لا وسيط، وسيطٌ سلسلته مكسورة، تكرار الحادث نفسه
 * اختبار القبول: tests/production/production_lifecycle.test.ts (الدولة تُقام بيوميّة)
 * الوثيقة المرتبطة: docs/test-reports/phase-39.md §32
 * ثوابت هذا الاختبار: 1) الشدّة تُقرأ من التهيئة لا من الشفرة؛ 2) لا تأكيد على نصٍّ مشكول.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  durableStateProbe, ProductionScannerDeps, PRODUCTION_REQUIRED_SCANNERS,
  PRODUCTION_MUST_BE_CRITICAL, PRODUCTION_KNOWN_SCANNERS, loadProduction,
} from '../../src/index';
import { AppendOnlyLog } from '../../src/audit/append_only_log';
import { OBSERVER, repoPolicy } from './helpers';

const POLICY = repoPolicy();
const NOW = 1_700_000_000_000;

function deps(durable: ProductionScannerDeps['durable']): ProductionScannerDeps {
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
    durable,
  };
}

test('لا وسيط دائم ⇒ حادث ثبات يُرفع مرة واحدة لا في كل مسحة', () => {
  const probe = durableStateProbe(deps(null));
  const first = probe(NOW);
  assert.equal(first.length, 1);
  assert.equal(first[0]!.kind, 'state_not_durable');
  assert.equal(probe(NOW + 1).length, 0);
  assert.equal(probe(NOW + 2).length, 0);
});

test('يوميّة مُتحقَّقة ⇒ لا حادث؛ وانكسار سلسلتها يُرفع حادثًا باسم الملف', () => {
  let valid = true;
  const witness = {
    file: '/tmp/sool-test/state.jsonl',
    verify: () => ({ valid, length: 7, reason: valid ? null : 'PERSISTENCE_JOURNAL_TAMPERED' }),
  };
  const probe = durableStateProbe(deps(witness));
  assert.equal(probe(NOW).length, 0);
  valid = false;
  const raised = probe(NOW + 1);
  assert.equal(raised.length, 1);
  assert.equal(raised[0]!.kind, 'state_not_durable');
  assert.equal(raised[0]!.detail.includes(witness.file), true);
  assert.equal(probe(NOW + 2).length, 0);
});

test('الحادث يُرفع مرةً أخرى بعد إصلاحٍ ثم انكسارٍ جديد: العدّاد لا يُقفل على الأبد', () => {
  let valid = false;
  const probe = durableStateProbe(deps({
    file: '/tmp/sool-test/state.jsonl',
    verify: () => ({ valid, length: 3, reason: valid ? null : 'PERSISTENCE_JOURNAL_CORRUPT' }),
  }));
  assert.equal(probe(NOW).length, 1);
  valid = true;
  assert.equal(probe(NOW + 1).length, 0);
  valid = false;
  assert.equal(probe(NOW + 2).length, 1);
});

test('الثبات مشترطٌ ومعلنٌ وحرج في التهيئة نفسها لا في الشفرة', () => {
  assert.equal(PRODUCTION_REQUIRED_SCANNERS.includes('durable_state'), true);
  assert.equal(PRODUCTION_KNOWN_SCANNERS.includes('durable_state'), true);
  assert.equal(PRODUCTION_MUST_BE_CRITICAL.includes('state_not_durable'), true);
  const repo = loadProduction().policy;
  assert.equal(repo.scanners.includes('durable_state'), true);
  assert.equal(repo.severity.critical.includes('state_not_durable'), true);
});
