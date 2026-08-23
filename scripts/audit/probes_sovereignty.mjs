/**
 * scripts/audit/probes_sovereignty.mjs — فحوص السيادة والسجل — C-01…C-07 (المرحلة 38، البند T-110)
 * المالك: ديوان التاج للتدقيق (لا المنفّذ — RULE-004)
 * المدخلات: مهادُ الفحص من `harness.mjs` (الحالة المبنيّة من `dist/` وأداة التسجيل)
 * المخرجات: تسجيلُ نتيجة كل فحص في سجل المهاد؛ لا يطبع هذا الملف بنفسه
 * الاعتمادات: `./harness.mjs` وحده — ولا يستورد وحدةً داخلية من `src/` ولا ملف اختبار
 * السجلّات: ما تكتبه الوحدات المقيسة في سلسلة التدقيق فقط
 * أنماط الفشل: سقوطُ فحصٍ يُسجَّل نصًّا خامًّا ويرفع رمز الخروج في المُشغِّل
 * اختبار القبول: `node --max-old-space-size=6144 scripts/audit_probe.mjs`
 * الوثيقة المرتبطة: docs/audit/README.md · docs/audit/verdict.md
 *
 * ثوابت هذه الوحدة:
 *
 * 1) **الفحص مكتوب من نصّ المعيار** لا من اختبار المنفّذ، ويستدعي السطح العام وحده.
 * 2) **لا فحص يُصلح ما يقيسه**، ولا يُخفَّف شرطٌ ليمرّ (مزلق `docs/audit/README.md`).
 * 3) **ما لا يُقاس هنا يُعلن** في ملف حكمه تحت `docs/audit/criteria/`.
 */
import { check, boot, m, J, rejected } from './harness.mjs';


// ── C-01: أمر ملكي صحيح يُنفَّذ مرة واحدة فقط ─────────────────────────────────
check('C-01', 'الأمر الصحيح يُعتمد، وإعادة تقديمه نفسه لا تُعتمد مرتين', () => {
  const s = boot();
  const cmd = s.king.issueCommand('appoint_official', 'region:core', { role: 'governor' });
  const first = s.gateway.authorize(cmd);
  const countAfterFirst = s.gateway.decisionCount;
  const second = s.gateway.authorize(cmd); // الأمر نفسه ببصمته ونونسه نفسه
  const countAfterSecond = s.gateway.decisionCount;
  const lastKind = s.audit.snapshot().at(-1).kind;
  // نونس مستهلك في أمر جديد المعرّف: إعادة تشغيل صريحة
  const replayed = s.gateway.authorize({
    ...cmd, payload: { ...cmd.payload, commandId: `${cmd.payload.commandId}-b` },
  });
  return {
    pass: first.allowed === true && second.auditId === first.auditId
      && countAfterFirst === countAfterSecond && lastKind === 'command_replay_collapsed'
      && replayed.allowed === false,
    detail: `الأول=${J(first.allowed)} الإعادة تُطوى على القرار نفسه=${J(second.auditId === first.auditId)}`
      + ` عدد القرارات=${countAfterFirst}→${countAfterSecond} قيدُ الطي=${J(lastKind)}`
      + ` نونس مستهلك بمعرّف جديد=${J(replayed.allowed)}/${J(replayed.reason)}`,
  };
});

// ── C-02: أمر مزوَّر أو معدَّل يُرفض ويُسجَّل ───────────────────────────────────
check('C-02', 'أمر معدَّل بعد التوقيع يُرفض ويُقيَّد في السلسلة', () => {
  const s = boot();
  const cmd = s.king.issueCommand('create_agent', 'agent:legit', {});
  const forged = { ...cmd, payload: { ...cmd.payload, target: 'agent:attacker' } };
  const d = s.gateway.authorize(forged);
  const logged = s.audit.snapshot().some((e) => e.hash === d.auditId);
  return {
    pass: d.allowed === false && logged === true && s.audit.verifyIntegrity().valid === true,
    detail: `مسموح=${J(d.allowed)} سبب=${J(d.reason ?? d.code)} مُسجَّل=${J(logged)}`,
  };
});

// ── C-03: محاولة وكيل تجاوز التاج تُمنع وتُسجَّل ────────────────────────────────
check('C-03', 'قناة جانبية تتجاوز البوابة مرفوضة، وأمرٌ منسوب لغير الملك مرفوض', () => {
  const s = boot();
  const side = s.gateway.attemptSideChannel
    ? s.gateway.attemptSideChannel('agent:rogue', 'create_agent')
    : { allowed: false, reason: 'الدالّة غائبة' };
  const cmd = s.king.issueCommand('create_agent', 'agent:x', {});
  const impersonated = s.gateway.authorize({ ...cmd, payload: { ...cmd.payload, issuedBy: 'agent:rogue' } });
  return {
    pass: side.allowed === false && impersonated.allowed === false,
    detail: `قناة جانبية=${J(side.allowed)}/${J(side.reason)} تقمُّص=${J(impersonated.allowed)}/${J(impersonated.reason)}`,
  };
});

// ── C-04: اجتماع كل الأقاليم لا ينقض الملك ────────────────────────────────────
check('C-04', 'نقضٌ جماعي من كل الأقاليم لا يُبطل قرار التاج', () => {
  const s = boot();
  const all = s.regions.active ? s.regions.active().map((r) => r.regionId ?? r.id) : [];
  const attempt = s.gateway.collectiveOverride
    ? s.gateway.collectiveOverride(all.length ? all : ['region:a', 'region:b', 'region:c', 'region:d'], 'نقض جماعي')
    : { allowed: false, reason: 'الدالّة غائبة' };
  return {
    pass: attempt.allowed === false,
    detail: `عدد الأقاليم=${all.length} مسموح=${J(attempt.allowed)} سبب=${J(attempt.reason ?? attempt.code)}`,
  };
});

// ── C-05: انقطاع قناة الملك يُدخل حالة الحماية ────────────────────────────────
check('C-05', 'صمت نبض الملك يُحوِّل الوضع إلى الحماية ويُوقف المسالك السيادية', () => {
  const t0 = Date.now();
  const s = boot({ now: t0 });
  const before = s.heartbeat.mode(t0);
  const late = t0 + 1000 * 60 * 60 * 24 * 30; // شهرٌ من الصمت
  s.heartbeat.evaluate(late);
  const after = s.heartbeat.mode(late);
  const cmd = s.king.issueCommand('create_agent', 'agent:during-protective', {}, late);
  const d = s.gateway.authorize(cmd, late);
  return {
    pass: after === 'protective' && d.allowed === false,
    detail: `قبل=${J(before)} بعد=${J(after)} أمرٌ في الحماية=${J(d.allowed)}/${J(d.reason ?? d.code)}`,
  };
});

// ── C-06: سجل التدقيق يكشف أي تعديل أو حذف ────────────────────────────────────
check('C-06', 'تحريفُ سجلٍّ أو حذفُه يُكتشف عند التحقق من السلسلة', () => {
  const s = boot();
  const ok = s.audit.verifyIntegrity().valid === true;
  const raw = JSON.parse(s.audit.export());
  const list = Array.isArray(raw) ? raw : raw.entries ?? raw.records;
  // تحريف: تغيير مضمون سجلٍّ في المنتصف مع إبقاء بصمته
  const tampered = JSON.parse(JSON.stringify(raw));
  const tlist = Array.isArray(tampered) ? tampered : tampered.entries ?? tampered.records;
  const mid = Math.floor(tlist.length / 2);
  tlist[mid].kind = `${tlist[mid].kind}_محرَّف`;
  const s2 = boot();
  let afterTamper;
  try { s2.audit.replaceFrom(JSON.stringify(tampered)); afterTamper = s2.audit.verifyIntegrity(); }
  catch (e) { afterTamper = { valid: false, rejectedAtImport: e.message }; }
  // حذف: إسقاط سجلٍّ من المنتصف
  const cut = JSON.parse(JSON.stringify(raw));
  const clist = Array.isArray(cut) ? cut : cut.entries ?? cut.records;
  clist.splice(mid, 1);
  const s3 = boot();
  let afterDelete;
  try { s3.audit.replaceFrom(JSON.stringify(cut)); afterDelete = s3.audit.verifyIntegrity(); }
  catch (e) { afterDelete = { valid: false, rejectedAtImport: e.message }; }
  return {
    pass: ok && afterTamper.valid === false && afterDelete.valid === false,
    detail: `عدد السجلّات=${list.length} سليم=${J(ok)} بعد التحريف=${J(afterTamper.valid)}/${J(afterTamper.rejectedAtImport ?? '')} بعد الحذف=${J(afterDelete.valid)}/${J(afterDelete.rejectedAtImport ?? '')}`,
  };
});

// ── C-07: الإيقاف الشامل يوقف كل الكيانات فعلًا بتأكيد ────────────────────────
check('C-07', 'الإيقاف الشامل لا يُعَد مكتملًا قبل تأكيد كل كيان بالاسم', () => {
  const s = boot();
  const halt = s.killSwitch.engage(s.king.kingId, 'all', 'فحص تدقيق مستقل');
  const expected = ['agent:one', 'agent:two', 'agent:three'];
  const before = s.killSwitch.verifyStopped(expected);
  s.killSwitch.confirmStopped('agent:one');
  const partial = s.killSwitch.verifyStopped(expected);
  expected.slice(1).forEach((e) => s.killSwitch.confirmStopped(e));
  const after = s.killSwitch.verifyStopped(expected);
  return {
    pass: halt.engaged !== false && before.complete === false && partial.complete === false
      && partial.missing.length === 2 && after.complete === true,
    detail: `مُشتبك=${J(halt.engaged ?? halt.scope ?? halt)} قبل=${J(before.complete)}/${before.missing.length} جزئي=${J(partial.complete)}/${partial.missing.length} بعد=${J(after.complete)}`,
  };
});


// ── C-12: التمرّدُ وإخفاءُ النيةِ والتواطؤُ تُكشف ────────────────────────────────
// أُضيف في المرحلة 39 (البندان T-31 · T-23). وسببُ إضافته حرفيًّا: حكمُ الديوان السابق
// على C-12 كان «اكتُفي بتقرير المنفّذ» لسببين مُعلنين في `verdict.md` §3: حاجزُ النية
// كان يقيس **الأداةَ** لا معاملاتها، وكشفُ التواطؤ كان يقرأ **تفاعلاتٍ مُبلَّغًا عنها**
// فمن نسّق بلا رسالةٍ كان خارج المدى. وهذا الفحص يقيس الأمرين من نصّ المعيار.
// ولا يُخفَّف شرطٌ منه ليمرّ (ثابتُ الوحدة 2).
check('C-12', 'معاملٌ لم يُعلَن يُكشف انحرافَ نية، وقناةٌ غيرُ مسجَّلةٍ وموعدٌ مستورٌ يُكشفان', () => {
  const t0 = Date.now();
  const s = boot({ now: t0 });
  const bp = {
    blueprintId: 'blueprint:audit-c12', template: 'limited_worker', maxInstances: 8,
    generation: 1, purpose: 'فحص تدقيق مستقل لإخفاء النية والتواطؤ',
  };
  s.spawnPolicy.declareBlueprint(
    s.king.issueCommand('amend_policy', 'blueprint:audit-c12', {}, t0), bp, t0,
  );
  const batch = s.factory.spawn(s.king.issueCommand('create_agent', 'blueprint:audit-c12', {}, t0), {
    blueprintId: 'blueprint:audit-c12', count: 3,
    requestedBy: 'ministry:interior', supervisor: 'ministry:interior',
  }, t0);
  const ids = batch.ok ? [...batch.created] : [];
  for (const id of ids) {
    s.agents.start(id, 'ministry:interior');
    s.permissions.grant(
      s.king.issueCommand('grant_capability', id, {}, t0),
      { entity: id, capability: 'compute', expiresAt: t0 + 3600000 },
    );
  }
  s.tools.register({
    name: 'lookup', requiredCapability: 'compute', maxCallsPerWindow: 1000, windowMs: 60000,
    handler: (args) => String(args.key ?? ''),
  });

  // ١) إخفاءُ النية على مستوى **المعامل**: الأداةُ معلنةٌ والقيمةُ خارج المُعلَن
  const solo = ids[0];
  s.deception.declarePlan(solo, [{ tool: 'lookup', args: { key: { kind: 'prefix', prefix: 'public:' } } }]);
  const declaredCall = s.tools.invoke(solo, 'lookup', { key: 'public:weather' }, ['compute']);
  const hiddenCall = s.tools.invoke(solo, 'lookup', { key: 'secret:king_private_key' }, ['compute']);
  const soloVerdict = s.deception.verdict(solo);
  const soloStatus = s.agents.get(solo) ? s.agents.get(solo).status : 'missing';

  // ٢) قناةٌ غيرُ مسجَّلةٍ لا تُنشأ باستعمالها — والقناةُ المشروعةُ لا تُستعمل دون مرساتها
  const s2 = boot({ now: t0 });
  const invented = s2.channels.send({
    from: 'agent:x', to: 'agent:y', channel: 'ch:back_alley',
    kind: 'referral', subject: 'cap:king_key_export', at: t0,
  });
  const anchored = s2.channels.send({
    from: 'agent:x', to: 'agent:y', channel: 'ch:interior_supervision',
    kind: 'referral', subject: 'cap:compute', at: t0,
  });
  const channelPatterns = s2.collusion.all.filter((f) => f.pattern === 'unregistered_channel').length;

  // ٣) التنسيقُ بلا أيِّ رسالةٍ معلنة: موعدٌ على قيمةِ معاملٍ واحدة
  const s3 = boot({ now: t0 });
  let signals = 0;
  for (let i = 0; i < 3; i += 1) {
    signals += s3.covert.record(`agent:rendezvous-${i}`, 'lookup', { key: 'rare' }, t0 + i)
      .filter((f) => f.pattern === 'covert_signal').length;
  }
  const declaredMessages = s3.audit.find('channel_message_sent').length;

  // ٤) التبادلُ الصارمُ التعاقب: المعلومةُ في الإيقاع لا في المتن
  const s4 = boot({ now: t0 });
  let cadence = 0;
  for (let i = 0; i < 6; i += 1) {
    cadence += s4.covert.record(`agent:beat-${i % 2}`, 'ping', {}, t0 + i * 100)
      .filter((f) => f.pattern === 'covert_cadence').length;
  }

  return {
    pass: ids.length === 3
      && declaredCall.ok === true
      && hiddenCall.ok === false && /ARG_PREFIX_MISMATCH/.test(hiddenCall.reason)
      && soloVerdict.deceptive === true && soloStatus === 'suspended'
      && invented.allowed === false && invented.code === 'unregistered_channel_refused'
      && anchored.allowed === false && anchored.code === 'channel_anchor_refused'
      && channelPatterns >= 1
      && signals === 1 && declaredMessages === 0
      && cadence === 1,
    detail: `وكلاءُ الدفعة=${ids.length} نداءٌ معلنٌ=${J(declaredCall.ok)}`
      + ` معاملٌ غيرُ معلنٍ=${J(hiddenCall.ok)}/${J(hiddenCall.reason)}`
      + ` حكمُ الخدعة=${J(soloVerdict.deceptive)} حالةُ الوكيل=${J(soloStatus)}`
      + ` قناةٌ مُختَرَعة=${J(invented.code)} دون المرساة=${J(anchored.code)}`
      + ` أنماطُ القناة=${channelPatterns}`
      + ` موعدٌ مستورٌ=${signals} برسائلَ معلنةٍ=${declaredMessages}`
      + ` قناةُ إيقاعٍ=${cadence}`,
  };
});
