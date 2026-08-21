/**
 * tests/federation/dispute_resolution.test.ts — اختبار فضّ النزاع الإقليمي (المرحلة 24)
 * المالك: الديوان الملكي محكّمًا | يوثّق في: docs/test-reports/phase-24.md
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrapState, REGIONAL_ARBITER, ROYAL_COURT } from '../../src/index';

const T0 = Date.now();
const WINDOW = 60_000;

function disputeState() {
  const s = bootstrapState({ now: T0, federation: { responseWindowMs: WINDOW } });
  const structural = (target: string, at = T0) =>
    s.king.issueCommand('amend_policy', target, { kind: 'federation' }, at);
  const setup: readonly [string, string, readonly string[]][] = [
    ['region:research', 'إقليم البحث', ['research']],
    ['region:industry', 'إقليم الصناعة', ['manufacturing']],
  ];
  for (const [regionId, name, domains] of setup) {
    s.regions.establish(structural(regionId), { regionId, name, proposedBy: ROYAL_COURT }, T0);
    s.regions.delegate(structural(regionId), regionId, [...domains], T0);
  }
  /** دليل مقبول: هاش سجل تدقيق قائم فعلًا */
  const evidence = s.audit.find('delegation_granted')[0]?.hash ?? '';
  const raise = (at = T0) => s.tribunal.raise('region:research', {
    disputeId: 'dis:1', respondent: 'region:industry', subject: 'تنازع على مخرجات مخبر',
    domain: 'research', evidence: [evidence],
  }, at);
  return { s, structural, evidence, raise };
}

test('الدعوى بدليل موجود تُقبل وتُسجَّل', () => {
  const { s, raise } = disputeState();
  const r = raise();
  assert.equal(r.ok, true);
  assert.equal(s.audit.find('dispute_raised').length, 1);
  assert.equal(s.tribunal.open().length, 1);
});

test('لا دعوى بلا دليل، ولا دعوى بدليل غير موجود', () => {
  const { s } = disputeState();
  const base = {
    respondent: 'region:industry', subject: 'موضوع معلن', domain: 'research',
  };
  assert.equal(s.tribunal.raise('region:research', {
    disputeId: 'dis:a', ...base, evidence: [],
  }, T0).ok, false);
  const fake = s.tribunal.raise('region:research', {
    disputeId: 'dis:b', ...base, evidence: ['0'.repeat(64)],
  }, T0);
  assert.equal(fake.ok, false);
  assert.match(fake.ok ? '' : fake.reason, /غير موجود/);
});

test('لا نزاع لإقليم مع نفسه، ولا مع إقليم غير قائم', () => {
  const { s, evidence } = disputeState();
  assert.equal(s.tribunal.raise('region:research', {
    disputeId: 'dis:self', respondent: 'region:research', subject: 'موضوع معلن',
    domain: 'research', evidence: [evidence],
  }, T0).ok, false);
  assert.equal(s.tribunal.raise('region:research', {
    disputeId: 'dis:ghost', respondent: 'region:services', subject: 'موضوع معلن',
    domain: 'research', evidence: [evidence],
  }, T0).ok, false);
});

test('نزاع قائم بين الطرفين في النطاق نفسه يمنع نزاعًا ثانيًا', () => {
  const { s, evidence, raise } = disputeState();
  raise();
  const again = s.tribunal.raise('region:industry', {
    disputeId: 'dis:2', respondent: 'region:research', subject: 'الموضوع ذاته',
    domain: 'research', evidence: [evidence],
  }, T0);
  assert.equal(again.ok, false);
  assert.match(again.ok ? '' : again.reason, /نزاع قائم/);
});

test('الردّ للمدّعى عليه وحده وداخل المدة', () => {
  const { s, raise } = disputeState();
  raise();
  assert.equal(s.tribunal.respond('region:research', 'dis:1', 'بيان', T0).ok, false, 'المدّعي لا يردّ');
  assert.equal(s.tribunal.respond('region:industry', 'dis:1', 'بيان معلن', T0 + WINDOW * 2).ok, false,
    'بعد انقضاء المدة');
  const r = s.tribunal.respond('region:industry', 'dis:1', 'المخرجات مشتركة بحكم التفويض', T0 + 100);
  assert.equal(r.ok, true);
  assert.equal(s.tribunal.dispute('dis:1')?.status, 'answered');
  assert.equal(s.audit.find('dispute_answered').length, 1);
});

test('الفضّ للمحكّم المعلن وحده', () => {
  const { s, raise } = disputeState();
  raise();
  s.tribunal.respond('region:industry', 'dis:1', 'بيان معلن', T0 + 100);
  const byParty = s.tribunal.resolve('region:research', 'dis:1', {
    inFavorOf: 'region:research', remedy: 'domain_stays', note: 'حكمت لنفسي',
  }, T0 + 200);
  assert.equal(byParty.ok, false, 'لا يفضّ أحد نزاعًا هو طرف فيه');
  assert.equal(s.tribunal.resolve('official:noor', 'dis:1', {
    inFavorOf: 'region:research', remedy: 'domain_stays', note: 'تسبيب',
  }, T0 + 200).ok, false, 'من ليس محكّمًا لا يفضّ');
});

test('لا فضّ قبل سماع المدّعى عليه أو انقضاء المدة', () => {
  const { s, raise } = disputeState();
  raise();
  const early = s.tribunal.resolve(REGIONAL_ARBITER, 'dis:1', {
    inFavorOf: 'region:research', remedy: 'domain_stays', note: 'تسبيب معلن',
  }, T0 + 100);
  assert.equal(early.ok, false);
  assert.match(early.ok ? '' : early.reason, /سماع المدّعى عليه/);
});

test('سكوت المدّعى عليه بعد المدة يُسجَّل ولا يُخفى، والفضّ يجوز', () => {
  const { s, raise } = disputeState();
  raise();
  const r = s.tribunal.resolve(REGIONAL_ARBITER, 'dis:1', {
    inFavorOf: 'region:research', remedy: 'domain_stays', note: 'سكوت المدّعى عليه',
  }, T0 + WINDOW * 2);
  assert.equal(r.ok, true);
  assert.equal(s.audit.find('response_window_elapsed').length, 1);
  assert.equal(s.tribunal.dispute('dis:1')?.ruling?.bySilence, true);
  assert.equal(s.tribunal.report().bySilence, 1);
});

test('الفضّ مسجَّل ولا ينقل نطاقًا بنفسه', () => {
  const { s, raise } = disputeState();
  raise();
  s.tribunal.respond('region:industry', 'dis:1', 'بيان معلن', T0 + 100);
  const r = s.tribunal.resolve(REGIONAL_ARBITER, 'dis:1', {
    inFavorOf: 'region:industry', remedy: 'domain_transfer_recommended', note: 'توصية بنقل النطاق',
  }, T0 + 200);
  assert.equal(r.ok, true);
  const entry = s.audit.find('dispute_resolved')[0];
  assert.equal(entry?.detail['transfersDomain'], false);
  // النطاق لم ينتقل: النقل أمر ملكي بسجل الأقاليم لا حكم محكّم
  assert.equal(s.regions.competentFor('research')?.regionId, 'region:research');
});

test('الحكم لغير طرفي النزاع مرفوض، والفضّ بلا تسبيب مرفوض', () => {
  const { s, raise } = disputeState();
  raise();
  s.tribunal.respond('region:industry', 'dis:1', 'بيان معلن', T0 + 100);
  assert.equal(s.tribunal.resolve(REGIONAL_ARBITER, 'dis:1', {
    inFavorOf: 'region:core', remedy: 'no_merit', note: 'تسبيب معلن',
  }, T0 + 200).ok, false);
  assert.equal(s.tribunal.resolve(REGIONAL_ARBITER, 'dis:1', {
    inFavorOf: 'region:research', remedy: 'no_merit', note: '',
  }, T0 + 200).ok, false);
});

test('التصعيد لطرفي النزاع وحدهما وبعد حكم المحكّم', () => {
  const { s, raise } = disputeState();
  raise();
  s.tribunal.respond('region:industry', 'dis:1', 'بيان معلن', T0 + 100);
  assert.equal(s.tribunal.escalate('region:industry', 'dis:1', 'اعتراض', T0 + 150).ok, false,
    'لا تصعيد قبل الحكم');
  s.tribunal.resolve(REGIONAL_ARBITER, 'dis:1', {
    inFavorOf: 'region:research', remedy: 'domain_stays', note: 'تسبيب معلن',
  }, T0 + 200);
  assert.equal(s.tribunal.escalate('official:noor', 'dis:1', 'اعتراض', T0 + 300).ok, false,
    'التصعيد لطرفي النزاع وحدهما');
  const r = s.tribunal.escalate('region:industry', 'dis:1', 'تسبيب ناقص', T0 + 300);
  assert.equal(r.ok, true);
  assert.equal(s.audit.find('dispute_escalated').length, 1);
});

test('الحكم الملكي بمراجعة قضائية معتمدة، وينقض حكم المحكّم', () => {
  const { s, raise } = disputeState();
  raise();
  s.tribunal.respond('region:industry', 'dis:1', 'بيان معلن', T0 + 100);
  s.tribunal.resolve(REGIONAL_ARBITER, 'dis:1', {
    inFavorOf: 'region:research', remedy: 'domain_stays', note: 'تسبيب معلن',
  }, T0 + 200);
  s.tribunal.escalate('region:industry', 'dis:1', 'تسبيب ناقص', T0 + 300);
  const wrongAction = s.king.issueCommand('amend_policy', 'region:industry', {}, T0 + 400);
  assert.equal(s.tribunal.royalSettlement(wrongAction, 'dis:1', 'region:industry', T0 + 400).ok, false,
    'الحكم الملكي بفعل judicial_review وحده');
  const cmd = s.king.issueCommand('judicial_review', 'region:industry', {}, T0 + 400);
  const r = s.tribunal.royalSettlement(cmd, 'dis:1', 'region:industry', T0 + 400);
  assert.equal(r.ok, true);
  const entry = s.audit.find('royal_settlement')[0];
  assert.equal(entry?.detail['overturned'], true);
  assert.equal(entry?.detail['final'], true);
});

test('الحكم الملكي نهائي: لا تصعيد بعده', () => {
  const { s, raise } = disputeState();
  raise();
  s.tribunal.respond('region:industry', 'dis:1', 'بيان معلن', T0 + 100);
  s.tribunal.resolve(REGIONAL_ARBITER, 'dis:1', {
    inFavorOf: 'region:research', remedy: 'domain_stays', note: 'تسبيب معلن',
  }, T0 + 200);
  s.tribunal.escalate('region:industry', 'dis:1', 'تسبيب ناقص', T0 + 300);
  s.tribunal.royalSettlement(
    s.king.issueCommand('judicial_review', 'region:research', {}, T0 + 400),
    'dis:1', 'region:research', T0 + 400,
  );
  const again = s.tribunal.escalate('region:industry', 'dis:1', 'اعتراض ثانٍ', T0 + 500);
  assert.equal(again.ok, false);
  assert.match(again.ok ? '' : again.reason, /نهائي/);
});

test('لا حكم ملكي بلا تصعيد مسجَّل', () => {
  const { s, raise } = disputeState();
  raise();
  s.tribunal.respond('region:industry', 'dis:1', 'بيان معلن', T0 + 100);
  s.tribunal.resolve(REGIONAL_ARBITER, 'dis:1', {
    inFavorOf: 'region:research', remedy: 'domain_stays', note: 'تسبيب معلن',
  }, T0 + 200);
  const cmd = s.king.issueCommand('judicial_review', 'region:research', {}, T0 + 300);
  assert.equal(s.tribunal.royalSettlement(cmd, 'dis:1', 'region:research', T0 + 300).ok, false);
});

test('تقرير المحكمة يعدّ المفتوح والمحسوم والمُصعَّد', () => {
  const { s, raise } = disputeState();
  raise();
  s.tribunal.respond('region:industry', 'dis:1', 'بيان معلن', T0 + 100);
  s.tribunal.resolve(REGIONAL_ARBITER, 'dis:1', {
    inFavorOf: 'region:research', remedy: 'compensation', note: 'تسبيب معلن',
  }, T0 + 200);
  const rep = s.tribunal.report();
  assert.equal(rep.total, 1);
  assert.equal(rep.resolved, 1);
  assert.equal(rep.open, 0);
});
