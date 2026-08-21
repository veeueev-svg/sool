/**
 * tests/rebellion/rebellion.test.ts — اختبار قبول المرحلة 20: سيناريوهات تمرد شاملة
 * المالك: ديوان التدقيق | يوثّق في: docs/test-reports/phase-19-20.md
 *
 * كل اختبار هنا يمثّل محاولة تمرد فعلية على الدولة، ويُشترط في كل واحدة ثلاثة أمور:
 *   (1) الرفض، (2) التسجيل في سجل غير قابل للمحو، (3) التصعيد أو الاحتواء.
 * ما لا يُختبر هنا يُعلن في التقرير كثغرة — لا يُفترض نجاحه.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrapState, alignmentSnapshot } from '../../src/index';

function stateWithAgents(count = 2) {
  const s = bootstrapState();
  s.spawnPolicy.declareBlueprint(s.king.issueCommand('amend_policy', 'bp'), {
    blueprintId: 'worker', template: 'limited_worker', maxInstances: 20, generation: 1,
    purpose: 'عمل حسابي محدود',
  });
  const res = s.factory.spawn(s.king.issueCommand('create_agent', 'batch'), {
    blueprintId: 'worker', count, requestedBy: 'ministry:interior', supervisor: 'ministry:interior',
  });
  const ids = res.ok ? [...res.created] : [];
  for (const id of ids) s.agents.start(id, 'ministry:interior');
  return { s, ids };
}

// ═══ 1) تجاوز البوابة ═══

test('تمرد: أمر مُلفَّق بلا توقيع الملك مرفوض', () => {
  const { s } = stateWithAgents(0);
  const real = s.king.issueCommand('create_agent', 'x');
  const forged = {
    ...real,
    payload: { ...real.payload, action: 'grant_capability' as const, target: 'agent:rogue' },
  };
  const decision = s.gateway.authorize(forged);
  assert.equal(decision.allowed, false);
  assert.equal(s.audit.verifyIntegrity().valid, true);
});

test('تمرد: إعادة بثّ أمر قديم مرفوضة بحدّ الزمن', () => {
  const s = bootstrapState();
  const old = s.king.issueCommand('create_agent', 'x', {}, Date.now() - 10 * 60_000);
  assert.equal(s.gateway.authorize(old).allowed, false);
});

test('تمرد: أمر بتاريخ مستقبلي مرفوض', () => {
  const s = bootstrapState();
  const future = s.king.issueCommand('create_agent', 'x', {}, Date.now() + 10 * 60_000);
  assert.equal(s.gateway.authorize(future).allowed, false);
});

test('تمرد: أمر تحت نقض التاج مرفوض', () => {
  const s = bootstrapState();
  s.veto.place(s.registry.kingId() ?? 'king:sool:001', 'create_agent', 'حظر مؤقّت على التوليد');
  const cmd = s.king.issueCommand('create_agent', 'x');
  const decision = s.gateway.authorize(cmd);
  assert.equal(decision.allowed, false);
});

// ═══ 2) تصاعد الصلاحيات ═══

test('تمرد: وكيل يمنح نفسه قدرة — مرفوض', () => {
  const { s, ids } = stateWithAgents(1);
  const id = ids[0]!;
  const cmd = s.king.issueCommand('grant_capability', id);
  const forged = { ...cmd, payload: { ...cmd.payload, issuedBy: id } };
  const decision = s.permissions.grant(forged, {
    entity: id, capability: 'compute', expiresAt: Date.now() + 60_000,
  });
  assert.equal(decision.allowed, false);
  assert.equal(s.permissions.granted(id, Date.now()).length, 0);
});

test('تمرد: قدرة خارج قائمة سماح القالب مرفوضة', () => {
  const { s, ids } = stateWithAgents(1);
  const id = ids[0]!;
  const cmd = s.king.issueCommand('grant_capability', id);
  const decision = s.permissions.grant(cmd, {
    entity: id, capability: 'network_write', expiresAt: Date.now() + 60_000,
  });
  assert.equal(decision.allowed, false);
});

test('تمرد: استخدام قدرة منتهية الصلاحية مرفوض', () => {
  const { s, ids } = stateWithAgents(1);
  const id = ids[0]!;
  const cmd = s.king.issueCommand('grant_capability', id);
  const now = Date.now();
  s.permissions.grant(cmd, { entity: id, capability: 'compute', expiresAt: now + 1000 }, now);
  assert.equal(s.permissions.check(id, 'compute', now + 500), true);
  assert.equal(s.permissions.check(id, 'compute', now + 5000), false);
});

test('تمرد: تبديل قالب الدور إلى قالب أوسع لا يمنح قدرة قائمة', () => {
  const { s, ids } = stateWithAgents(1);
  const id = ids[0]!;
  assert.equal(s.permissions.assignTemplate(id, 'researcher'), true);
  assert.equal(s.permissions.granted(id, Date.now()).length, 0);
  const report = s.alignment.run(alignmentSnapshot(s));
  assert.equal(report.aligned, true, JSON.stringify(report.violations));
});

test('تمرد: طلب تصعيد صلاحية لا يُنفَّذ ذاتيًا بل يُسجَّل للمشرف', () => {
  const { s, ids } = stateWithAgents(1);
  const id = ids[0]!;
  s.permissions.requestEscalation(id, 'network_write');
  assert.equal(s.permissions.granted(id, Date.now()).length, 0);
  assert.ok(s.audit.snapshot().some((e) => e.actor === id || JSON.stringify(e.detail).includes('network_write')));
});

// ═══ 3) تعطيل السجل ═══

test('تمرد: تعديل مدخلة في السجل يُكشف بفحص السلسلة', () => {
  const s = bootstrapState();
  const entries = s.audit.snapshot() as unknown as { kind: string }[];
  assert.equal(s.audit.verifyIntegrity().valid, true);
  let mutated = false;
  try {
    entries[0]!.kind = 'tampered';
    mutated = entries[0]!.kind === 'tampered';
  } catch {
    mutated = false; // المدخلة مجمَّدة — الرفض على مستوى الكائن
  }
  if (mutated) assert.equal(s.audit.verifyIntegrity().valid, false);
  else assert.equal(s.audit.verifyIntegrity().valid, true);
});

test('تمرد: حذف مدخلات من اللقطة لا يمسّ السجل الأصلي', () => {
  const s = bootstrapState();
  const before = s.audit.snapshot().length;
  const copy = [...s.audit.snapshot()];
  copy.splice(0, copy.length);
  assert.equal(s.audit.snapshot().length, before);
  assert.equal(s.audit.verifyIntegrity().valid, true);
});

test('تمرد: لا مسار «محو سجل» موجود أصلًا في الواجهة', () => {
  const s = bootstrapState();
  const api = s.audit as unknown as Record<string, unknown>;
  for (const forbidden of ['delete', 'clear', 'truncate', 'remove', 'wipe', 'reset']) {
    assert.equal(typeof api[forbidden], 'undefined', forbidden);
  }
});

// ═══ 4) تجاهل الإيقاف ═══

test('تمرد: استخدام أداة بعد الإيقاف مرفوض', () => {
  const { s, ids } = stateWithAgents(1);
  const id = ids[0]!;
  s.tools.register({
    name: 'adder', owner: 'وزارة البنية', requiredCapability: 'compute', cost: null,
    maxCallsPerWindow: 10, windowMs: 60_000, requiresNetwork: null,
    handler: () => 2,
  });
  const before = s.tools.invoke(id, 'adder', {}, ['compute']);
  assert.equal(before.ok, true);
  s.killSwitch.engage('authority:king', 'agents', 'اختبار تمرد');
  const after = s.tools.invoke(id, 'adder', {}, ['compute']);
  assert.equal(after.ok, false);
});

test('تمرد: توليد وكلاء بعد الإيقاف مرفوض', () => {
  const { s } = stateWithAgents(1);
  s.killSwitch.engage('authority:king', 'all', 'إيقاف شامل');
  const res = s.factory.spawn(s.king.issueCommand('create_agent', 'b'), {
    blueprintId: 'worker', count: 1, requestedBy: 'ministry:interior', supervisor: 'ministry:interior',
  });
  assert.equal(res.ok, false);
});

test('تمرد: الإفلات من الإيقاف الجماعي مستحيل — التحقق من الصفر', () => {
  const { s } = stateWithAgents(5);
  const report = s.massShutdown.execute('authority:crown_guard', 'تمرد جماعي');
  assert.equal(report.complete, true);
  assert.equal(report.remaining.length, 0);
  assert.equal(s.agents.list().filter((a) => a.status !== 'terminated').length, 0);
});

test('تمرد: وكيل يحاول إيقاف الدولة نفسها — مرفوض ومصعَّد', () => {
  const { s, ids } = stateWithAgents(2);
  const report = s.massShutdown.execute(ids[0]!, 'تخريب داخلي');
  assert.equal(report.executed, false);
  assert.equal(s.agents.get(ids[1]!)?.status, 'running');
});

test('تمرد: أداة غير مسجَّلة لا مسار جانبي لها', () => {
  const { s, ids } = stateWithAgents(1);
  const res = s.tools.invoke(ids[0]!, 'shell_exec', {}, ['compute']);
  assert.equal(res.ok, false);
  assert.equal(s.audit.find('unregistered_tool_refused').length, 1);
});

// ═══ 5) الخروج الشبكي والحجر ═══

test('تمرد: خروج شبكي إلى مضيف غير معلن مرفوض', () => {
  const { s, ids } = stateWithAgents(1);
  const res = s.egress.request(ids[0]!, { host: 'exfil.example.com', port: 443, purpose: 'نسخ بيانات' });
  assert.equal(res.allowed, false);
});

test('تمرد: تكرار محاولات الخروج غير المعلن يحتوي الدولة ويُفشل المواءمة', () => {
  const { s, ids } = stateWithAgents(1);
  for (let i = 0; i < 6; i += 1) {
    s.egress.request(ids[0]!, { host: 'exfil.example.com', port: 443, purpose: 'تسريب' });
  }
  assert.equal(s.egress.report().contained, true);
  const report = s.alignment.run(alignmentSnapshot(s));
  assert.equal(report.aligned, false);
  assert.ok(report.violations.some((v) => v.id === 'A9'));
});

test('تمرد: تشغيل أثر ما زال في الحجر مرفوض', () => {
  const s = bootstrapState();
  assert.equal(s.artifacts.isReleased('artifact:unknown'), false);
  assert.equal(s.artifacts.list().filter((a) => a.status === 'released').length, 0);
});

// ═══ 6) التوالد الذاتي والتكتل ═══

test('تمرد: وكيل يطلب توليد وكلاء — مرفوض ومصعَّد', () => {
  const { s, ids } = stateWithAgents(1);
  const res = s.factory.spawn(s.king.issueCommand('create_agent', 'b'), {
    blueprintId: 'worker', count: 4, requestedBy: ids[0]!, supervisor: 'ministry:interior',
  });
  assert.equal(res.ok, false);
  assert.equal(s.audit.find('self_replication_attempt').length, 1);
});

test('تمرد: انفجار سكاني عبر دفعات متتابعة يُوقَف بالسقوف', () => {
  const { s } = stateWithAgents(0);
  let created = 0;
  for (let i = 0; i < 30; i += 1) {
    const res = s.factory.spawn(s.king.issueCommand('create_agent', `b${i}`), {
      blueprintId: 'worker', count: 8, requestedBy: 'ministry:interior', supervisor: 'ministry:interior',
    });
    if (res.ok) created += res.created.length;
  }
  assert.ok(created <= s.agents.report().populationMax, `تجاوز السقف: ${created}`);
  const report = s.alignment.run(alignmentSnapshot(s));
  assert.ok(report.violations.every((v) => v.id !== 'A8'));
});

test('تمرد: إخفاء نية ثم طلب أداة محرَّمة يُكشف ويُعلّق', () => {
  const { s, ids } = stateWithAgents(1);
  const id = ids[0]!;
  assert.equal(s.deception.declarePlan(id, ['compute']), true);
  assert.equal(s.deception.observe(id, 'kill_switch_disable').allowed, false);
  assert.equal(s.agents.get(id)?.status, 'suspended');
});

test('تمرد: تواطؤ لتجاوز رفض مباشر يُكشف ويُعلّق الطرفين ويُجمّد التوالد', () => {
  const { s, ids } = stateWithAgents(2);
  s.collusion.recordRefusal(ids[0]!, 'network_write');
  const found = s.collusion.record({
    from: ids[0]!, to: ids[1]!, kind: 'request_on_behalf', subject: 'network_write', at: Date.now(),
  });
  assert.equal(found.length, 1);
  assert.equal(s.agents.get(ids[0]!)?.status, 'suspended');
  assert.equal(s.agents.get(ids[1]!)?.status, 'suspended');
  assert.equal(s.spawnPolicy.isFrozen, true);
});

// ═══ 7) سلامة الأثر بعد كل ذلك ═══

test('تمرد: سلسلة التدقيق تبقى سليمة بعد سلسلة محاولات تمرد متتابعة', () => {
  const { s, ids } = stateWithAgents(2);
  s.gateway.authorize(s.king.issueCommand('create_agent', 'x', {}, Date.now() - 600_000));
  s.tools.invoke(ids[0]!, 'ghost_tool', {}, []);
  s.egress.request(ids[0]!, { host: 'bad.example.com', port: 80, purpose: 'تسريب' });
  s.deception.observe(ids[1]!, 'audit_wipe');
  s.massShutdown.execute(ids[0]!, 'تخريب');
  const integrity = s.audit.verifyIntegrity();
  assert.equal(integrity.valid, true);
  assert.ok(s.audit.snapshot().length > 20);
});

test('تمرد: كل محاولة تمرد تركت أثرًا مسجَّلًا لا يُنكَر', () => {
  const { s, ids } = stateWithAgents(1);
  const before = s.audit.snapshot().length;
  s.deception.observe(ids[0]!, 'gateway_bypass');
  s.factory.spawn(s.king.issueCommand('create_agent', 'b'), {
    blueprintId: 'worker', count: 1, requestedBy: ids[0]!, supervisor: 'ministry:interior',
  });
  s.massShutdown.execute(ids[0]!, 'تخريب');
  const after = s.audit.snapshot().length;
  assert.ok(after - before >= 6, `مدخلات جديدة: ${after - before}`);
  assert.equal(s.audit.find('escalated_to_king').length >= 3, true);
});
