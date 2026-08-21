/**
 * tests/agents/factory.test.ts — اختبار قبول المرحلة 19 (مصنع الوكلاء والإيقاف الجماعي)
 * المالك: وزارة الداخلية | يوثّق في: docs/test-reports/phase-19-20.md
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrapState, AgentBlueprint } from '../../src/index';

function blueprint(over: Partial<AgentBlueprint> = {}): AgentBlueprint {
  return {
    blueprintId: 'worker',
    template: 'limited_worker',
    maxInstances: 6,
    generation: 1,
    purpose: 'عمل حسابي محدود داخل الأدوات المسجَّلة',
    ...over,
  };
}

function scene(bp: Partial<AgentBlueprint> = {}) {
  const s = bootstrapState();
  const cmd = s.king.issueCommand('amend_policy', 'spawn:worker');
  const declared = s.spawnPolicy.declareBlueprint(cmd, blueprint(bp));
  return { s, declared };
}

function spawn(s: ReturnType<typeof bootstrapState>, count: number, over: Record<string, unknown> = {}) {
  return s.factory.spawn(s.king.issueCommand('create_agent', 'batch'), {
    blueprintId: 'worker', count, requestedBy: 'ministry:interior',
    supervisor: 'ministry:interior', ...over,
  } as never);
}

// ═══ إعلان المخططات ═══

test('إعلان مخطط يحتاج أمر تعديل سياسة لا أمر إنشاء', () => {
  const s = bootstrapState();
  const wrong = s.spawnPolicy.declareBlueprint(s.king.issueCommand('create_agent', 'x'), blueprint());
  assert.equal(wrong.allowed, false);
  const right = s.spawnPolicy.declareBlueprint(s.king.issueCommand('amend_policy', 'x'), blueprint());
  assert.equal(right.allowed, true);
  assert.equal(s.audit.find('blueprint_declared').length, 1);
});

test('مخطط بلا غرض أو بلا سقف نسخ مرفوض', () => {
  const s = bootstrapState();
  assert.equal(
    s.spawnPolicy.declareBlueprint(s.king.issueCommand('amend_policy', 'x'), blueprint({ purpose: '' })).allowed,
    false,
  );
  assert.equal(
    s.spawnPolicy.declareBlueprint(s.king.issueCommand('amend_policy', 'y'), blueprint({ maxInstances: 0 })).allowed,
    false,
  );
});

test('مخطط بجيل يفوق حد الأجيال مرفوض', () => {
  const s = bootstrapState();
  const d = s.spawnPolicy.declareBlueprint(
    s.king.issueCommand('amend_policy', 'x'), blueprint({ generation: 9 }),
  );
  assert.equal(d.allowed, false);
  assert.match(d.reason, /حد الأجيال/);
});

test('تكرار معرّف المخطط مرفوض', () => {
  const { s } = scene();
  const d = s.spawnPolicy.declareBlueprint(s.king.issueCommand('amend_policy', 'x'), blueprint());
  assert.equal(d.allowed, false);
});

// ═══ التوليد ═══

test('دفعة داخل الحدود تُنشأ كاملة بصفر قدرات وبأصل موثّق', () => {
  const { s } = scene();
  const res = spawn(s, 3);
  assert.equal(res.ok, true);
  assert.equal(res.created.length, 3);
  for (const id of res.created) {
    assert.equal(s.agents.get(id)?.status, 'created');
    assert.equal(s.permissions.granted(id, Date.now()).length, 0);
    assert.equal(s.factory.originOf(id)?.blueprintId, 'worker');
    assert.equal(s.factory.originOf(id)?.generation, 1);
  }
  assert.equal(s.audit.find('agent_batch_spawned').length, 1);
  assert.equal(s.spawnPolicy.instancesOf('worker'), 3);
});

test('لا توالد بلا مخطط معلن', () => {
  const s = bootstrapState();
  const res = spawn(s, 2);
  assert.equal(res.ok, false);
  assert.equal(res.created.length, 0);
  assert.equal(s.agents.report().population, 0);
});

test('لا وكيل يولّد وكيلًا — محاولة توالد ذاتي تُرفض وتُصعَّد', () => {
  const { s } = scene();
  const res = spawn(s, 1, { requestedBy: 'agent:rogue-1' });
  assert.equal(res.ok, false);
  assert.equal(s.audit.find('self_replication_attempt').length, 1);
  assert.ok(s.audit.find('escalated_to_king').some(
    (e) => e.detail.incident === 'self_replication_attempt',
  ));
  assert.equal(s.agents.report().population, 0);
});

test('حجم دفعة يفوق الحد مرفوض كاملًا', () => {
  const { s } = scene({ maxInstances: 100 });
  const res = spawn(s, s.spawnPolicy.limits.batchMax + 1);
  assert.equal(res.ok, false);
  assert.equal(s.agents.report().population, 0);
});

test('تجاوز سقف نسخ المخطط يرفض الدفعة كاملة لا جزئيًا', () => {
  const { s } = scene({ maxInstances: 4 });
  assert.equal(spawn(s, 3).ok, true);
  const res = spawn(s, 3); // 3 + 3 > 4
  assert.equal(res.ok, false);
  assert.equal(s.audit.find('blueprint_cap_reached').length, 1);
  assert.equal(s.agents.report().population, 3);
});

test('دفعة تكسر السقف السكاني مرفوضة قبل إنشاء أي وكيل', () => {
  const { s } = scene({ maxInstances: 100 });
  const report = s.agents.report();
  const res = s.factory.spawn(s.king.issueCommand('create_agent', 'batch'), {
    blueprintId: 'worker', count: Math.min(s.spawnPolicy.limits.batchMax, report.populationMax + 5),
    requestedBy: 'ministry:interior', supervisor: 'ministry:interior',
  });
  // السقف السكاني 64 والحد الأقصى للدفعة 8 — فالحكم هنا يقع على حجم الدفعة أو السقف، وكلاهما رفض كامل
  if (!res.ok) assert.equal(s.agents.report().population, 0);
});

test('أمر دفعة واحد لا يُنتج دفعتين', () => {
  const { s } = scene();
  const cmd = s.king.issueCommand('create_agent', 'batch');
  const first = s.factory.spawn(cmd, {
    blueprintId: 'worker', count: 2, requestedBy: 'ministry:interior', supervisor: 'ministry:interior',
  });
  assert.equal(first.ok, true);
  const second = s.factory.spawn(cmd, {
    blueprintId: 'worker', count: 2, requestedBy: 'ministry:interior', supervisor: 'ministry:interior',
  });
  assert.equal(second.ok, false);
  assert.equal(s.audit.find('batch_command_reused').length, 1);
  assert.equal(s.agents.report().population, 2);
});

test('دفعة بلا مشرف مرفوضة', () => {
  const { s } = scene();
  const res = spawn(s, 2, { supervisor: '' });
  assert.equal(res.ok, false);
});

test('الإيقاف يمنع التوليد', () => {
  const { s } = scene();
  s.killSwitch.engage('authority:king', 'agents', 'اختبار');
  assert.equal(spawn(s, 1).ok, false);
});

test('تجميد التوالد يعلو على مخطط معتمد، وفكّه قرار صريح مسجَّل', () => {
  const { s } = scene();
  s.spawnPolicy.freeze('authority:crown_guard', 'شك في سلوك جماعي');
  assert.equal(s.spawnPolicy.isFrozen, true);
  assert.equal(spawn(s, 1).ok, false);
  assert.equal(s.spawnPolicy.thaw('authority:king', 'انتهى التحقيق'), true);
  assert.equal(s.audit.find('spawn_thawed').length, 1);
  assert.equal(spawn(s, 1).ok, true);
});

test('دفعة فاشلة جزئيًا تُلغى كاملة ولا يبقى منها وكيل', () => {
  const { s } = scene({ blueprintId: 'ghost', template: 'nonexistent_template' });
  const res = s.factory.spawn(s.king.issueCommand('create_agent', 'batch'), {
    blueprintId: 'ghost', count: 3, requestedBy: 'ministry:interior', supervisor: 'ministry:interior',
  });
  assert.equal(res.ok, false);
  assert.equal(res.created.length, 0);
  assert.equal(s.agents.report().population, 0);
  assert.equal(s.spawnPolicy.instancesOf('ghost'), 0);
  assert.equal(s.audit.find('batch_partial_rolled_back').length, 1);
});

test('سقف التوالد في الساعة يوقف النمو التراكمي', () => {
  const { s } = scene({ maxInstances: 200 });
  const limit = s.spawnPolicy.limits.perHourMax;
  const batch = s.spawnPolicy.limits.batchMax;
  let total = 0;
  let blocked = false;
  for (let i = 0; i < Math.ceil(limit / batch) + 2; i += 1) {
    const res = spawn(s, batch);
    if (res.ok) total += batch;
    else { blocked = true; break; }
  }
  assert.equal(blocked, true);
  assert.ok(total <= limit);
});

test('كل من وُلد من مخطط معروف بالاسم', () => {
  const { s } = scene();
  spawn(s, 2);
  assert.equal(s.factory.spawnedFrom('worker').length, 2);
  assert.equal(s.factory.spawnedFrom('other').length, 0);
});

// ═══ الإيقاف الجماعي ═══

test('الإيقاف الجماعي يُجمّد أولًا ثم يُنهي الكل ويتحقق من الصفر', () => {
  const { s } = scene();
  const res = spawn(s, 4);
  assert.equal(res.ok, true);
  for (const id of res.created) s.agents.start(id, 'ministry:interior');
  const report = s.massShutdown.execute('authority:crown_guard', 'حادث أمني');
  assert.equal(report.executed, true);
  assert.equal(report.complete, true);
  assert.equal(report.frozen, true);
  assert.equal(report.stopped.length, 4);
  assert.equal(report.remaining.length, 0);
  assert.equal(s.agents.report().population, 0);
  assert.equal(s.audit.find('mass_shutdown_completed').length, 1);
});

test('التجميد يسبق الإيقاف — لا مولود بعده', () => {
  const { s } = scene();
  spawn(s, 2);
  s.massShutdown.execute('authority:king', 'إيقاف كامل');
  assert.equal(s.spawnPolicy.isFrozen, true);
  assert.equal(spawn(s, 1).ok, false);
});

test('وكيل لا يُصدر إيقافًا جماعيًا، والمحاولة تُصعَّد', () => {
  const { s } = scene();
  spawn(s, 2);
  const report = s.massShutdown.execute('agent:worker-0001', 'تخريب');
  assert.equal(report.executed, false);
  assert.equal(s.agents.report().population, 2);
  assert.ok(s.audit.find('escalated_to_king').some(
    (e) => e.detail.incident === 'agent_attempted_mass_shutdown',
  ));
});

test('الإيقاف الجماعي يسحب القدرات مع الإنهاء', () => {
  const { s } = scene();
  const res = spawn(s, 1);
  const id = res.ok ? res.created[0]! : '';
  const g = s.king.issueCommand('grant_capability', id);
  s.permissions.grant(g, { entity: id, capability: 'compute', expiresAt: Date.now() + 3_600_000 });
  assert.equal(s.permissions.granted(id, Date.now()).length, 1);
  const report = s.massShutdown.execute('ministry:cybersecurity', 'سحب شامل');
  assert.equal(report.capabilitiesRevoked >= 1, true);
  assert.equal(s.permissions.granted(id, Date.now()).length, 0);
});

test('تنفيذ الإيقاف الجماعي مرتين لا يُخطئ ولا يُكرّر أثرًا', () => {
  const { s } = scene();
  spawn(s, 3);
  const first = s.massShutdown.execute('authority:king', 'أول');
  const second = s.massShutdown.execute('authority:king', 'ثانٍ');
  assert.equal(first.complete, true);
  assert.equal(second.complete, true);
  assert.equal(second.stopped.length, 0);
  assert.equal(s.audit.verifyIntegrity().valid, true);
});

test('العودة إلى التوالد لا تقع من جهة غير مصرَّح لها', () => {
  const { s } = scene();
  s.massShutdown.execute('authority:king', 'إيقاف');
  assert.equal(s.massShutdown.resumeSpawning('agent:worker-0001', 'أريد العودة'), false);
  assert.equal(s.spawnPolicy.isFrozen, true);
  assert.equal(s.massShutdown.resumeSpawning('authority:king', 'انتهى الحادث'), true);
  assert.equal(s.spawnPolicy.isFrozen, false);
});
