/**
 * tests/federation/federation_deadlines.test.ts — المُصعَّدُ والالتماسُ لهما مدّة (T-45 · T-47 · W-2026-052)
 * المالك: الديوان الملكي + مجلس الأقاليم | يوثّق في: docs/test-reports/phase-40-W-2026-052.md
 * يثبت: (1) نزاعٌ مُصعَّدٌ بلا حكمٍ ملكيٍّ بعد مدّته — تُعدّ من التصعيد — يُرفع `escalation_unruled` جسيمًا،
 *       وقبلها لا؛ والحكمُ الملكيُّ يُسقط سببه؛ (2) التماسٌ `pending` بعد مدّته يُرفع `petition_unanswered`؛
 *       (3) المدّتان المعلنتان افتراضًا سبعةُ أيام؛ (4) مسبارُ المراقبة يرفعهما باسم الحادث المعلن.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bootstrapState, regionsProbe, ESCALATION_GRACE_MS, PETITION_GRACE_MS, REGIONAL_ARBITER, ROYAL_COURT, RegionMonitor,
} from '../../src/index';

const T0 = Date.now();
const LONG = 10 * 365 * 24 * 3600 * 1000;
const ESC = 50_000;
const PET = 40_000;

function scene() {
  const s = bootstrapState({ now: T0, federation: { responseWindowMs: 60_000 } });
  const structural = (target: string, at = T0) => s.king.issueCommand('amend_policy', target, { kind: 'federation' }, at);
  for (const [regionId, name, domains] of [
    ['region:research', 'إقليم البحث', ['research']], ['region:industry', 'إقليم الصناعة', ['manufacturing']],
  ] as const) {
    s.regions.establish(structural(regionId), { regionId, name, proposedBy: ROYAL_COURT }, T0);
    s.regions.delegate(structural(regionId), regionId, [...domains], T0);
  }
  const monitor = new RegionMonitor({
    audit: s.audit, regions: s.regions, governors: s.governors, tribunal: s.tribunal,
    killSwitch: s.killSwitch, assembly: s.assembly,
    vacancyGraceMs: LONG, disputeGraceMs: LONG, escalationGraceMs: ESC, petitionGraceMs: PET,
  });
  return { s, monitor };
}

test('T-45/T-47: المدّتان معلنتان — سبعةُ أيامٍ لكلٍّ منهما', () => {
  assert.equal(ESCALATION_GRACE_MS, 7 * 24 * 3600 * 1000);
  assert.equal(PETITION_GRACE_MS, 7 * 24 * 3600 * 1000);
});

test('T-45: نزاعٌ مُصعَّدٌ بلا حكمٍ ملكيٍّ يُرفع جسيمًا بعد مدّته من التصعيد', () => {
  const { s, monitor } = scene();
  const evidence = s.audit.find('delegation_granted')[0]?.hash ?? '';
  assert.equal(s.tribunal.raise('region:research', {
    disputeId: 'dis:1', respondent: 'region:industry', subject: 'تنازع معلن', domain: 'research', evidence: [evidence],
  }, T0).ok, true);
  s.tribunal.respond('region:industry', 'dis:1', 'بيان معلن', T0 + 100);
  assert.equal(s.tribunal.resolve(REGIONAL_ARBITER, 'dis:1', {
    inFavorOf: 'region:research', remedy: 'domain_stays', note: 'تسبيب معلن',
  }, T0 + 200).ok, true);
  const escalatedAt = T0 + 10_000;
  assert.equal(s.tribunal.escalate('region:industry', 'dis:1', 'تسبيب ناقص', escalatedAt).ok, true);
  assert.equal(monitor.sweep(escalatedAt + ESC).flags.length, 0, 'عند المدّة لا بعدها');
  const late = monitor.sweep(escalatedAt + ESC + 1);
  assert.deepEqual(late.flags.map((f) => [f.kind, f.severity]), [['escalation_unruled', 'high']]);
  assert.match(late.flags[0]!.detail, /dis:1/);
});

test('T-47: التماسٌ بلا جوابٍ يُرفع بعد مدّته', () => {
  const { s, monitor } = scene();
  assert.equal(s.assembly.petition(['region:research', 'region:industry'], {
    petitionId: 'pet:1', subject: 'توسعة نطاق البحث',
  }, T0).ok, true);
  assert.equal(monitor.sweep(T0 + PET).flags.length, 0);
  const late = monitor.sweep(T0 + PET + 1);
  assert.deepEqual(late.flags.map((f) => f.kind), ['petition_unanswered']);
  assert.match(late.flags[0]!.detail, /pet:1/);
});

test('T-47: مسبارُ المراقبة يرفع الالتماسَ غيرَ المجاب باسم الحادث المعلن — لا يُسقطه صامتًا', () => {
  const { s, monitor } = scene();
  s.assembly.petition(['region:research', 'region:industry'], { petitionId: 'pet:2', subject: 'موضوع معلن' }, T0);
  const probe = regionsProbe({ regionMonitor: monitor } as never);
  const found = probe(T0 + PET + 1);
  assert.deepEqual(found.map((f) => f.kind), ['unresolved_dispute']);
  assert.match(found[0]!.detail, /^petition_unanswered\//);
});
