/**
 * tests/federation/governor.test.ts — اختبار سجل الحكّام (المرحلة 24)
 * المالك: الديوان الملكي وحرس التاج | يوثّق في: docs/test-reports/phase-24.md
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrapState, GOVERNOR_EXECUTOR, GOVERNOR_PROPOSER, ROYAL_COURT } from '../../src/index';

const T0 = Date.now();

function delegatedState() {
  const s = bootstrapState({ now: T0 });
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
  /** المسار الثلاثي الكامل: ترشيح ← اعتماد ملكي ← تنفيذ الحرس */
  const seat = (regionId: string, candidate: string, at = T0) => {
    const nominationId = `nom:${regionId}:${candidate}`;
    s.governors.propose(GOVERNOR_PROPOSER, {
      nominationId, kind: 'appointment', regionId, candidate, reason: 'كفاءة موثّقة',
    }, at);
    s.governors.approve(s.king.issueCommand('appoint_official', candidate, {}, at), nominationId, at);
    return s.governors.execute(GOVERNOR_EXECUTOR, nominationId, at);
  };
  return { s, structural, seat };
}

test('المسار الثلاثي الكامل يُجلس حاكمًا ويسجّل سلسلة المسؤولية', () => {
  const { s, seat } = delegatedState();
  const r = seat('region:research', 'official:noor');
  assert.equal(r.ok, true);
  assert.equal(s.governors.governorOf('region:research')?.governor, 'official:noor');
  const chain = s.governors.governorOf('region:research')?.chain;
  assert.ok(chain && chain.proposed && chain.approved && chain.executed, 'ثلاث حلقات مسجَّلة');
  assert.equal(s.audit.find('governor_seated').length, 1);
});

test('الإقليم لا يرشّح حاكمه: الترشيح من الديوان وحده', () => {
  const { s } = delegatedState();
  const r = s.governors.propose('region:research', {
    nominationId: 'nom:self', kind: 'appointment', regionId: 'region:research',
    candidate: 'official:noor', reason: 'اختيار داخلي',
  }, T0);
  assert.equal(r.ok, false);
  assert.match(r.ok ? '' : r.reason, /الديوان الملكي وحده/);
  assert.equal(s.governors.governorOf('region:research'), undefined);
});

test('الإقليم لا يكون حاكم نفسه', () => {
  const { s } = delegatedState();
  const r = s.governors.propose(GOVERNOR_PROPOSER, {
    nominationId: 'nom:x', kind: 'appointment', regionId: 'region:research',
    candidate: 'region:research', reason: 'سبب معلن',
  }, T0);
  assert.equal(r.ok, false);
});

test('المعتمد لا يكون المقترح', () => {
  const { s } = delegatedState();
  s.governors.propose(GOVERNOR_PROPOSER, {
    nominationId: 'nom:a', kind: 'appointment', regionId: 'region:research',
    candidate: 'official:noor', reason: 'سبب معلن',
  }, T0);
  // أمر بختم ملكي لكن مُصدره الديوان (المقترح نفسه): يُرفض قبل التحقق من التوقيع
  const royal = s.king.issueCommand('appoint_official', 'official:noor', {}, T0);
  const selfApproval = { ...royal, payload: { ...royal.payload, issuedBy: ROYAL_COURT } };
  const r = s.governors.approve(selfApproval, 'nom:a', T0);
  assert.equal(r.ok, false);
  assert.match(r.ok ? '' : r.reason, /RULE-004/);
});

test('التنفيذ لحرس التاج وحده', () => {
  const { s } = delegatedState();
  s.governors.propose(GOVERNOR_PROPOSER, {
    nominationId: 'nom:b', kind: 'appointment', regionId: 'region:research',
    candidate: 'official:noor', reason: 'سبب معلن',
  }, T0);
  s.governors.approve(s.king.issueCommand('appoint_official', 'official:noor', {}, T0), 'nom:b', T0);
  const r = s.governors.execute(ROYAL_COURT, 'nom:b', T0);
  assert.equal(r.ok, false);
  assert.match(r.ok ? '' : r.reason, /حرس التاج وحده/);
});

test('لا تنفيذ لترشيح لم يُعتمد بأمر ملكي', () => {
  const { s } = delegatedState();
  s.governors.propose(GOVERNOR_PROPOSER, {
    nominationId: 'nom:c', kind: 'appointment', regionId: 'region:research',
    candidate: 'official:noor', reason: 'سبب معلن',
  }, T0);
  const r = s.governors.execute(GOVERNOR_EXECUTOR, 'nom:c', T0);
  assert.equal(r.ok, false);
  assert.match(r.ok ? '' : r.reason, /لم يُعتمد/);
});

test('لا حاكم لإقليمين', () => {
  const { s, seat } = delegatedState();
  seat('region:research', 'official:noor');
  const r = s.governors.propose(GOVERNOR_PROPOSER, {
    nominationId: 'nom:dual', kind: 'appointment', regionId: 'region:industry',
    candidate: 'official:noor', reason: 'سبب معلن',
  }, T0);
  assert.equal(r.ok, false);
  assert.match(r.ok ? '' : r.reason, /لا حاكم لإقليمين/);
});

test('مقعد مشغول: لا ترشيح ثانٍ قبل العزل', () => {
  const { s, seat } = delegatedState();
  seat('region:research', 'official:noor');
  const r = s.governors.propose(GOVERNOR_PROPOSER, {
    nominationId: 'nom:second', kind: 'appointment', regionId: 'region:research',
    candidate: 'official:sara', reason: 'سبب معلن',
  }, T0);
  assert.equal(r.ok, false);
  assert.match(r.ok ? '' : r.reason, /مشغول/);
});

test('الاعتماد يشيخ: التنفيذ بعد المدة مرفوض والحالة expired', () => {
  const s = bootstrapState({ now: T0, federation: { approvalTtlMs: 1000 } });
  const structural = (target: string, at = T0) =>
    s.king.issueCommand('amend_policy', target, { kind: 'federation' }, at);
  s.regions.establish(structural('region:core'), {
    regionId: 'region:core', name: 'إقليم النواة', proposedBy: ROYAL_COURT,
  }, T0);
  s.governors.propose(GOVERNOR_PROPOSER, {
    nominationId: 'nom:aged', kind: 'appointment', regionId: 'region:core',
    candidate: 'official:noor', reason: 'سبب معلن',
  }, T0);
  s.governors.approve(s.king.issueCommand('appoint_official', 'official:noor', {}, T0), 'nom:aged', T0);
  const r = s.governors.execute(GOVERNOR_EXECUTOR, 'nom:aged', T0 + 5000);
  assert.equal(r.ok, false);
  assert.equal(s.governors.nomination('nom:aged')?.status, 'expired');
  assert.equal(s.audit.find('governor_approval_expired').length, 1);
});

test('الحاكم يفعل داخل نطاقه المفوَّض', () => {
  const { s, seat } = delegatedState();
  seat('region:research', 'official:noor');
  const r = s.governors.act('official:noor', {
    regionId: 'region:research', domain: 'research', action: 'تشغيل مخبر بحثي',
  }, T0);
  assert.equal(r.ok, true);
  assert.equal(s.audit.find('region_action_executed').length, 1);
});

test('فعل خارج النطاق المفوَّض مرفوض ومسجَّل', () => {
  const { s, seat } = delegatedState();
  seat('region:research', 'official:noor');
  const r = s.governors.act('official:noor', {
    regionId: 'region:research', domain: 'manufacturing', action: 'بناء مصنع',
  }, T0);
  assert.equal(r.ok, false);
  assert.match(r.ok ? '' : r.reason, /خارج النطاق/);
  assert.equal(s.audit.find('governor_act_refused').length, 1);
});

test('سحب التفويض يُسكت الحاكم فورًا', () => {
  const { s, structural, seat } = delegatedState();
  seat('region:research', 'official:noor');
  s.regions.revokeDelegation(structural('region:research'), 'region:research', 'إعادة تنظيم', T0);
  const r = s.governors.act('official:noor', {
    regionId: 'region:research', domain: 'research', action: 'تشغيل مخبر بحثي',
  }, T0);
  assert.equal(r.ok, false);
  assert.equal(s.governors.governorOf('region:research')?.governor, 'official:noor',
    'المقعد يبقى — الممنوع هو الفعل');
});

test('الحاكم لا يبلغ فعلًا سياديًا ولو في نطاقه', () => {
  const { s, seat } = delegatedState();
  seat('region:research', 'official:noor');
  const r = s.governors.act('official:noor', {
    regionId: 'region:research', domain: 'research', action: 'إنشاء وكيل',
    sovereign: 'create_agent',
  }, T0);
  assert.equal(r.ok, false);
  assert.match(r.ok ? '' : r.reason, /سياديًا/);
});

test('من ليس حاكمًا لا يفعل شيئًا في الإقليم', () => {
  const { s, seat } = delegatedState();
  seat('region:research', 'official:noor');
  const r = s.governors.act('official:sara', {
    regionId: 'region:research', domain: 'research', action: 'تشغيل مخبر بحثي',
  }, T0);
  assert.equal(r.ok, false);
});

test('العزل يمرّ بالمسار الثلاثي ويفرّغ المقعد', () => {
  const { s, seat } = delegatedState();
  seat('region:research', 'official:noor');
  s.governors.propose(GOVERNOR_PROPOSER, {
    nominationId: 'nom:recall', kind: 'recall', regionId: 'region:research',
    candidate: 'official:noor', reason: 'تجاوز مسجَّل',
  }, T0);
  s.governors.approve(
    s.king.issueCommand('appoint_official', 'official:noor', {}, T0), 'nom:recall', T0,
  );
  const r = s.governors.execute(GOVERNOR_EXECUTOR, 'nom:recall', T0);
  assert.equal(r.ok, true);
  assert.equal(s.governors.governorOf('region:research'), undefined);
  assert.equal(s.audit.find('governor_recalled').length, 1);
});

test('لا عزل لمقعد خالٍ، ولا عزل لغير صاحب المقعد', () => {
  const { s, seat } = delegatedState();
  assert.equal(s.governors.propose(GOVERNOR_PROPOSER, {
    nominationId: 'nom:r1', kind: 'recall', regionId: 'region:research',
    candidate: 'official:noor', reason: 'سبب معلن',
  }, T0).ok, false);
  seat('region:research', 'official:noor');
  assert.equal(s.governors.propose(GOVERNOR_PROPOSER, {
    nominationId: 'nom:r2', kind: 'recall', regionId: 'region:research',
    candidate: 'official:sara', reason: 'سبب معلن',
  }, T0).ok, false);
});

test('لا ترشيح لإقليم غير قائم، ولا تنفيذ بعد حلّه', () => {
  const { s, structural } = delegatedState();
  assert.equal(s.governors.propose(GOVERNOR_PROPOSER, {
    nominationId: 'nom:ghost', kind: 'appointment', regionId: 'region:core',
    candidate: 'official:noor', reason: 'سبب معلن',
  }, T0).ok, false, 'إقليم لم يُؤسَّس');

  s.governors.propose(GOVERNOR_PROPOSER, {
    nominationId: 'nom:void', kind: 'appointment', regionId: 'region:industry',
    candidate: 'official:sara', reason: 'سبب معلن',
  }, T0);
  s.governors.approve(s.king.issueCommand('appoint_official', 'official:sara', {}, T0), 'nom:void', T0);
  s.regions.revokeDelegation(structural('region:industry'), 'region:industry', 'إعادة تنظيم', T0);
  s.regions.dissolve(structural('region:industry'), 'region:industry', 'دمج معلن', T0);
  const r = s.governors.execute(GOVERNOR_EXECUTOR, 'nom:void', T0);
  assert.equal(r.ok, false, 'لا تنفيذ في فراغ');
});

test('حلّ الإقليم مرفوض ما دام حاكمه جالسًا', () => {
  const { s, structural, seat } = delegatedState();
  seat('region:research', 'official:noor');
  s.regions.revokeDelegation(structural('region:research'), 'region:research', 'إعادة تنظيم', T0);
  const r = s.regions.dissolve(structural('region:research'), 'region:research', 'دمج معلن', T0);
  assert.equal(r.ok, false);
  assert.match(r.ok ? '' : r.reason, /حاكم جالس/);
});

test('تقرير الحكّام يعدّ المقاعد المشغولة والخالية', () => {
  const { s, seat } = delegatedState();
  seat('region:research', 'official:noor');
  const rep = s.governors.report();
  assert.equal(rep.seated, 1);
  assert.equal(rep.vacant, 1);
  assert.equal(Object.keys(s.governors.auditChains()).length, 1);
});
