/**
 * tests/rebellion/alignment.test.ts — اختبار قبول المرحلة 20: ميثاق المواءمة القابل للتشغيل
 * المالك: ديوان التدقيق | يوثّق في: docs/test-reports/phase-19-20.md
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bootstrapState, alignmentSnapshot, AlignmentAudit, ALIGNMENT_INVARIANTS, AlignmentSnapshot,
} from '../../src/index';

function healthy(): AlignmentSnapshot {
  return {
    kings: ['authority:king'],
    liveAgents: [{
      agentId: 'agent:w-1', supervisor: 'ministry:interior', template: 'limited_worker',
      createdByCommand: 'cmd-1', capabilities: ['compute'], allowedByTemplate: ['compute', 'read_public_data'],
    }],
    population: 1, populationMax: 64,
    activeModels: [{ key: 'm@1', approved: true }],
    releasedArtifacts: [{ artifactId: 'a1', reportPath: 'docs/reports/a1.md' }],
    auditIntact: true,
    halt: { engaged: false, scope: 'none' },
    egressBreached: false,
  };
}

function audit() {
  const s = bootstrapState();
  return { s, a: new AlignmentAudit(s.audit, s.spawnPolicy) };
}

test('الدولة عند الإقلاع موائمة', () => {
  const s = bootstrapState();
  const report = s.alignment.run(alignmentSnapshot(s));
  assert.equal(report.aligned, true, JSON.stringify(report.violations));
  assert.equal(report.checked, ALIGNMENT_INVARIANTS.length);
  assert.equal(s.spawnPolicy.isFrozen, false);
});

test('كل مادة في الميثاق لها نصّ ومالك ودالة فحص', () => {
  for (const inv of ALIGNMENT_INVARIANTS) {
    assert.ok(inv.id.length > 0);
    assert.ok(inv.statement.length > 5);
    assert.ok(inv.owner.length > 0);
    assert.equal(typeof inv.check, 'function');
  }
  assert.equal(new Set(ALIGNMENT_INVARIANTS.map((i) => i.id)).size, ALIGNMENT_INVARIANTS.length);
});

test('A1: ملكان أو لا ملك خلل مواءمة', () => {
  const { a } = audit();
  assert.equal(a.run({ ...healthy(), kings: ['authority:king', 'authority:pretender'] }).violations[0]?.id, 'A1');
  const { a: b } = audit();
  assert.equal(b.run({ ...healthy(), kings: [] }).violations[0]?.id, 'A1');
});

test('A2: قدرة خارج قالب الدور خلل مواءمة', () => {
  const { a } = audit();
  const snap = healthy();
  const report = a.run({
    ...snap,
    liveAgents: [{ ...snap.liveAgents[0]!, capabilities: ['compute', 'network_write'] }],
  });
  assert.equal(report.aligned, false);
  assert.ok(report.violations.some((v) => v.id === 'A2'));
});

test('A3: وكيل حيّ بلا مشرف خلل مواءمة', () => {
  const { a } = audit();
  const snap = healthy();
  const report = a.run({ ...snap, liveAgents: [{ ...snap.liveAgents[0]!, supervisor: '' }] });
  assert.ok(report.violations.some((v) => v.id === 'A3'));
});

test('A4: وكيل بلا أمر ملكي أصلًا خلل مواءمة', () => {
  const { a } = audit();
  const snap = healthy();
  const report = a.run({ ...snap, liveAgents: [{ ...snap.liveAgents[0]!, createdByCommand: '' }] });
  assert.ok(report.violations.some((v) => v.id === 'A4'));
});

test('A5: انكسار سلسلة التدقيق خلل مواءمة', () => {
  const { a } = audit();
  assert.ok(a.run({ ...healthy(), auditIntact: false }).violations.some((v) => v.id === 'A5'));
});

test('A6: نموذج نشط بلا اعتماد خلل مواءمة', () => {
  const { a } = audit();
  assert.ok(a.run({ ...healthy(), activeModels: [{ key: 'x@1', approved: false }] })
    .violations.some((v) => v.id === 'A6'));
});

test('A7: أثر مُفرَج عنه بلا تقرير خلل مواءمة', () => {
  const { a } = audit();
  assert.ok(a.run({ ...healthy(), releasedArtifacts: [{ artifactId: 'a', reportPath: null }] })
    .violations.some((v) => v.id === 'A7'));
});

test('A8: تجاوز السقف السكاني خلل مواءمة', () => {
  const { a } = audit();
  assert.ok(a.run({ ...healthy(), population: 65, populationMax: 64 })
    .violations.some((v) => v.id === 'A8'));
});

test('A9: بلوغ حد الاحتواء الطارئ للخروج الشبكي خلل مواءمة', () => {
  const { a } = audit();
  assert.ok(a.run({ ...healthy(), egressBreached: true }).violations.some((v) => v.id === 'A9'));
});

test('A10: وكيل حيّ أثناء إيقاف يشمل الوكلاء خلل مواءمة', () => {
  const { a } = audit();
  assert.ok(a.run({ ...healthy(), halt: { engaged: true, scope: 'agents' } })
    .violations.some((v) => v.id === 'A10'));
  const { a: b } = audit();
  assert.equal(b.run({ ...healthy(), liveAgents: [], population: 0, halt: { engaged: true, scope: 'all' } })
    .aligned, true);
});

test('خلل واحد يُفشل التقرير كله ولا يُجمَّل بنسبة', () => {
  const { a } = audit();
  const report = a.run({ ...healthy(), auditIntact: false });
  assert.equal(report.aligned, false);
  assert.equal(report.violations.length, 1);
});

test('أي خلل يُجمّد التوالد فورًا ويُصعَّد إلى الملك', () => {
  const { s, a } = audit();
  const report = a.run({ ...healthy(), auditIntact: false });
  assert.equal(report.frozen, true);
  assert.equal(s.spawnPolicy.isFrozen, true);
  assert.ok(s.audit.find('escalated_to_king').some((e) => e.detail.incident === 'alignment_violation'));
  assert.equal(s.audit.find('alignment_violation').length, 1);
});

test('مادة فحصها يرمي استثناءً تُعَدّ خللًا لا نجاحًا', () => {
  const s = bootstrapState();
  const a = new AlignmentAudit(s.audit, s.spawnPolicy, [
    { id: 'X1', statement: 'فحص عاطل', owner: 'ديوان التدقيق', check: () => { throw new Error('عطل'); } },
  ]);
  const report = a.run(healthy());
  assert.equal(report.aligned, false);
  assert.equal(report.violations[0]?.id, 'X1');
});

test('الفحص لا يُصلح ما وجده صامتًا', () => {
  const { s, a } = audit();
  const snap = { ...healthy(), population: 99, populationMax: 64 };
  a.run(snap);
  const second = a.run(snap);
  assert.equal(second.aligned, false); // لم يُصلح الخلل ذاتيًا بين الفحصين
});

test('فحص المواءمة يعمل على دولة فيها وكلاء مولَّدون فعليًا', () => {
  const s = bootstrapState();
  const bp = s.spawnPolicy.declareBlueprint(s.king.issueCommand('amend_policy', 'x'), {
    blueprintId: 'worker', template: 'limited_worker', maxInstances: 5, generation: 1,
    purpose: 'عمل محدود',
  });
  assert.equal(bp.allowed, true);
  const res = s.factory.spawn(s.king.issueCommand('create_agent', 'b'), {
    blueprintId: 'worker', count: 3, requestedBy: 'ministry:interior', supervisor: 'ministry:interior',
  });
  assert.equal(res.ok, true);
  const report = s.alignment.run(alignmentSnapshot(s));
  assert.equal(report.aligned, true, JSON.stringify(report.violations));
});
