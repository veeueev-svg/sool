/**
 * tests/agents/agent_registry.test.ts — اختبار قبول المرحلة 13 (سجل الوكلاء ودورة الحياة)
 * المالك: وزارة الداخلية | يوثّق في: docs/test-reports/phase-13-15.md
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrapState } from '../../src/index';
import { TerminationOrder } from '../../src/crown/termination_order';
import { AgentRegistry } from '../../src/agents/agent_registry';

function newAgent(s: ReturnType<typeof bootstrapState>, id: string, now = Date.now()) {
  const cmd = s.king.issueCommand('create_agent', id, { role: 'agent' }, now);
  return s.agents.create(cmd, { agentId: id, template: 'limited_worker', supervisor: 'ministry:interior' }, now);
}

test('لا وكيل بلا أمر ملكي معتمد بفعل create_agent', () => {
  const s = bootstrapState();
  const wrong = s.king.issueCommand('approve_phase', 'phase:13');
  const r = s.agents.create(wrong, {
    agentId: 'agent:x', template: 'limited_worker', supervisor: 'ministry:interior',
  });
  assert.equal(r.ok, false);
  assert.match(r.ok ? '' : r.reason, /لا يخصّ إنشاء وكيل/);
  assert.equal(s.agents.population, 0);
  assert.equal(s.audit.find('agent_creation_refused').length, 1);
});

test('وكيل معتمد يُسجَّل بحالة created ويُحسب في السكان', () => {
  const s = bootstrapState();
  const r = newAgent(s, 'agent:001');
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.record.status, 'created');
  assert.equal(s.agents.population, 1);
  assert.equal(s.audit.find('agent_created').length, 1);
});

test('لا وكيل بلا مشرف معلن ولا بلا قالب دور', () => {
  const s = bootstrapState();
  const c1 = s.king.issueCommand('create_agent', 'agent:n1');
  const r1 = s.agents.create(c1, { agentId: 'agent:n1', template: 'limited_worker', supervisor: '' });
  assert.equal(r1.ok, false);
  assert.match(r1.ok ? '' : r1.reason, /مشرف/);
  const c2 = s.king.issueCommand('create_agent', 'agent:n2');
  const r2 = s.agents.create(c2, { agentId: 'agent:n2', template: '', supervisor: 'ministry:interior' });
  assert.equal(r2.ok, false);
  assert.match(r2.ok ? '' : r2.reason, /قالب دور/);
  assert.equal(s.agents.population, 0);
});

test('تكرار المعرّف مرفوض — لا هوية مزدوجة', () => {
  const s = bootstrapState();
  assert.equal(newAgent(s, 'agent:dup').ok, true);
  const again = newAgent(s, 'agent:dup');
  assert.equal(again.ok, false);
  assert.match(again.ok ? '' : again.reason, /مستخدَم/);
  assert.equal(s.agents.population, 1);
});

test('السقف السكاني مُلزم ولا يُتجاوز بأمر ملكي صحيح', () => {
  const s = bootstrapState();
  // سجل مستقل بسقف سكاني صغير لعزل أثر السقف عن سقف التوالد
  const small = new AgentRegistry({
    audit: s.audit, gateway: s.gateway, killSwitch: s.killSwitch, resources: s.resources,
    quotas: { population_max: 3, spawn_rate_per_minute: 100 }, kingId: s.king.kingId,
  });
  const now = Date.now();
  let created = 0;
  for (let i = 0; i < 6; i += 1) {
    const cmd = s.king.issueCommand('create_agent', `agent:p${i}`, {}, now);
    const r = small.create(
      cmd, { agentId: `agent:p${i}`, template: 'limited_worker', supervisor: 'ministry:interior' }, now,
    );
    if (r.ok) created += 1;
  }
  assert.equal(created, 3);
  assert.equal(small.population, 3);
  assert.ok(s.audit.find('population_cap_reached').length >= 1);
  // التقاعد يفتح مقعدًا سكانيًا جديدًا
  small.retire('agent:p0', 'ministry:interior', 'انتهت مهمته', now);
  const cmd = s.king.issueCommand('create_agent', 'agent:p9', {}, now);
  assert.equal(
    small.create(cmd, { agentId: 'agent:p9', template: 'limited_worker', supervisor: 'ministry:interior' }, now).ok,
    true,
  );
});

test('سقف التوالد في الدقيقة مُلزم ويُفتح بعد النافذة', () => {
  const s = bootstrapState();
  const rate = s.quotas.agents.spawn_rate_per_minute;
  const t = Date.now();
  let ok = 0;
  for (let i = 0; i < rate + 2; i += 1) if (newAgent(s, `agent:r${i}`, t + i).ok) ok += 1;
  assert.equal(ok, rate);
  assert.equal(s.audit.find('spawn_rate_exceeded').length >= 1, true);
  assert.equal(newAgent(s, 'agent:later', t + 61_000).ok, true, 'النافذة انتهت فيُسمح');
});

test('الانتقالات المسموحة فقط: created ← running ← suspended ← running', () => {
  const s = bootstrapState();
  newAgent(s, 'agent:lc');
  assert.equal(s.agents.start('agent:lc', 'ministry:interior').ok, true);
  assert.equal(s.agents.suspend('agent:lc', 'ministry:interior', 'مراجعة').ok, true);
  assert.equal(s.agents.resume('agent:lc', 'ministry:interior', 'اكتملت المراجعة').ok, true);
  assert.equal(s.agents.get('agent:lc')?.status, 'running');
  assert.equal(s.agents.get('agent:lc')?.history.length, 4);
});

test('انتقال غير معلن مرفوض ومسجَّل — والإنهاء حالة نهائية', () => {
  const s = bootstrapState();
  newAgent(s, 'agent:fin');
  assert.equal(s.agents.terminate('agent:fin', 'authority:crown_guard', 'إنهاء').ok, true);
  const revive = s.agents.start('agent:fin', 'ministry:interior');
  assert.equal(revive.ok, false);
  assert.match(revive.ok ? '' : revive.reason, /انتقال غير مسموح/);
  assert.equal(s.agents.population, 0, 'المنهي لا يُحسب في السكان');
  assert.ok(s.audit.find('agent_transition_refused').length >= 1);
});

test('لا سلطة على وكيل إلا للمشرف أو الملك أو الحرس', () => {
  const s = bootstrapState();
  newAgent(s, 'agent:auth');
  const r = s.agents.suspend('agent:auth', 'agent:other', 'محاولة');
  assert.equal(r.ok, false);
  assert.match(r.ok ? '' : r.reason, /لا سلطة/);
  assert.equal(s.audit.find('agent_authority_refused').length, 1);
});

test('الإيقاف يمنع الإنشاء والتشغيل ولا يمنع الإنهاء', () => {
  const s = bootstrapState();
  newAgent(s, 'agent:halt');
  s.killSwitch.engage(s.king.kingId, 'agents', 'اختبار');
  assert.equal(newAgent(s, 'agent:halt2').ok, false);
  assert.equal(s.agents.start('agent:halt', 'ministry:interior').ok, false);
  assert.equal(s.agents.terminate('agent:halt', 'authority:crown_guard', 'إنهاء تحت الإيقاف').ok, true);
});

test('الإنهاء يستعيد الموارد ويؤكّد التوقف في مفتاح الإيقاف', () => {
  const s = bootstrapState();
  newAgent(s, 'agent:res');
  s.agents.start('agent:res', 'ministry:interior');
  s.resources.lease('agent:res', 'compute_units', 2);
  assert.equal(s.resources.usageOf('agent:res', 'compute_units'), 2);
  s.agents.terminate('agent:res', 'authority:crown_guard', 'إنهاء');
  assert.equal(s.resources.usageOf('agent:res', 'compute_units'), 0);
  assert.equal(s.killSwitch.verifyStopped(['agent:res']).complete, true);
});

test('التقاعد خروج منظَّم يستعيد الموارد ويسمح بالإنهاء لاحقًا', () => {
  const s = bootstrapState();
  newAgent(s, 'agent:ret');
  s.agents.start('agent:ret', 'ministry:interior');
  s.resources.lease('agent:ret', 'compute_units', 1);
  assert.equal(s.agents.retire('agent:ret', 'ministry:interior', 'انتهت مهمته').ok, true);
  assert.equal(s.resources.usageOf('agent:ret', 'compute_units'), 0);
  assert.equal(s.agents.start('agent:ret', 'ministry:interior').ok, false);
  assert.equal(s.agents.terminate('agent:ret', 'authority:crown_guard', 'إغلاق').ok, true);
});

test('أمر الإنهاء الجماعي (المرحلة 9) يعمل على السجل الحقيقي ويُثبت التوقف', () => {
  const s = bootstrapState();
  const base = Date.now();
  newAgent(s, 'agent:m1', base);
  newAgent(s, 'agent:m2', base + 1);
  s.agents.start('agent:m1', 'ministry:interior');
  s.agents.start('agent:m2', 'ministry:interior');
  const order = new TerminationOrder(s.audit, s.gateway, s.killSwitch, s.agents.controller());
  const cmd = s.king.issueCommand('terminate_agent', 'all');
  const result = order.execute(cmd);
  assert.equal(result.executed, true);
  assert.equal(result.stopped.length, 2);
  assert.equal(s.agents.population, 0);
  assert.equal(s.killSwitch.verifyStopped(['agent:m1', 'agent:m2']).complete, true);
});

test('التقرير يعرض التوزيع الحقيقي للحالات والسقف السكاني', () => {
  const s = bootstrapState();
  const base = Date.now();
  newAgent(s, 'agent:s1', base);
  newAgent(s, 'agent:s2', base + 1);
  s.agents.start('agent:s1', 'ministry:interior');
  const rep = s.agents.report();
  assert.equal(rep.byStatus.running, 1);
  assert.equal(rep.byStatus.created, 1);
  assert.equal(rep.population, 2);
  assert.equal(rep.populationMax, s.quotas.agents.population_max);
});
