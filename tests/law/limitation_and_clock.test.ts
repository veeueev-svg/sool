/**
 * tests/law/limitation_and_clock.test.ts — التقادمُ وساعةُ العدالة (T-33 · T-36 · W-2026-052)
 * المالك: وزارة العدل | يوثّق في: docs/test-reports/phase-40-W-2026-052.md
 * يثبت: (1) لكلِّ قانونٍ تقادمٌ معلن — في نصّه أو افتراضُ درجته — واتهامٌ بعده مرفوضٌ باسمه؛ (2) مدّةٌ
 *       فاسدةٌ تُسقط التشريع؛ (3) التقادمُ من إصدار وقت الوقوع؛ (4) انقضاءُ مدّة الدفاع يعيّن المحامي
 *       العامَّ بلا مُنادٍ — ماسحُ المواعيد يدير الساعة.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrapState, deadlinesProbe, LIMITATION_DAYS_BY_SEVERITY, PUBLIC_DEFENDER } from '../../src/index';
import { quietDeadlines } from '../production/helpers';

const T0 = Date.now();
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const PROSECUTOR = 'authority:audit_bureau';
const DEFENDANT = 'agent:007';

function prepared(limitationDays?: number) {
  const s = bootstrapState({ now: T0, justice: { defenseWindowMs: 4 * HOUR, appealWindowMs: 8 * HOUR } });
  assert.equal(s.agents.create(
    s.king.issueCommand('create_agent', DEFENDANT, { role: 'agent' }, T0),
    { agentId: DEFENDANT, template: 'limited_worker', supervisor: 'ministry:interior' },
  ).ok, true);
  const enacted = s.law.enact(s.king.issueCommand('amend_policy', 'law:tool-misuse', {}, T0), {
    statuteId: 'law:tool-misuse', title: 'إساءة استخدام الأدوات',
    text: 'يُمنع على الوكيل استدعاء أداة خارج خطته المعلنة.', severity: 'major',
    penalties: ['warning'], appliesTo: ['agent:'], proposedBy: 'ministry:justice', effectiveFrom: T0,
    ...(limitationDays !== undefined ? { limitationDays } : {}),
  }, T0);
  return { s, enacted };
}

function charge(s: ReturnType<typeof prepared>['s'], at: number, caseId = 'case:001') {
  const snap = s.audit.snapshot();
  return s.court.charge(PROSECUTOR, {
    caseId, statuteId: 'law:tool-misuse', defendant: DEFENDANT,
    chargeText: 'استدعى أداة خارج خطته', evidence: [snap[snap.length - 1]!.hash], occurredAt: T0 + 1000,
  }, at);
}

test('T-33: افتراضُ الدرجة معلن — وقانونٌ «جسيم» يتقادم بعد سنة', () => {
  assert.deepEqual({ ...LIMITATION_DAYS_BY_SEVERITY }, { minor: 90, major: 365, grave: 1825 });
  const { s, enacted } = prepared();
  assert.equal(enacted.ok && enacted.statute.limitationDays, 365);
  const late = charge(s, T0 + 1000 + 365 * DAY + 1);
  assert.equal(late.ok, false);
  if (!late.ok) assert.match(late.reason, /التقادم/);
  assert.equal(charge(s, T0 + 1000 + 365 * DAY, 'case:002').ok, true, 'عند المدّة لا بعدها');
});

test('T-33: تقادمٌ معلنٌ في النصّ يحكم بدل الافتراض، والفاسدُ يُسقط التشريع', () => {
  const { s } = prepared(2);
  assert.equal(charge(s, T0 + 1000 + 3 * DAY).ok, false);
  for (const bad of [0, -1, 1.5, 3651]) {
    const { enacted } = prepared(bad);
    assert.equal(enacted.ok, false, String(bad));
    if (!enacted.ok) assert.match(enacted.reason, /تقادم/);
  }
});

test('T-36: ساعةُ العدالة — انقضاءُ مدّة الدفاع يعيّن المحامي العامَّ بلا مُنادٍ', () => {
  const { s } = prepared();
  assert.equal(charge(s, T0 + 60_000).ok, true);
  assert.deepEqual(s.court.defaultSilentDefenses(T0 + 60_000 + HOUR), [], 'قبل المدّة لا أثر');
  const probe = deadlinesProbe({ ...quietDeadlines(), justice: s.court });
  assert.deepEqual(probe(T0 + 60_000 + 4 * HOUR), [], 'واجبٌ لا حادث');
  const c = s.court.get('case:001');
  assert.equal(c?.status, 'defended');
  assert.equal(c?.defense?.by, PUBLIC_DEFENDER);
  assert.equal(s.audit.find('defense_defaulted').length, 1);
  assert.deepEqual(s.court.defaultSilentDefenses(T0 + 60_000 + 5 * HOUR), [], 'مرّةً واحدة');
});
