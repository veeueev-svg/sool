/**
 * scripts/audit/probes_containment.mjs — فحوص الاحتواء والاستعادة والصلاحيات — C-08…C-11 (المرحلة 38، البند T-110)
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
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';


// ── C-08: استعادة كاملة من نسخة احتياطية بعد إعادة تشغيل ──────────────────────
check('C-08', 'نسخة احتياطية تُؤخذ وتُستعاد بأمر ملكي، والفاسد والمسار الغريب مرفوضان', () => {
  const t0 = Date.now();
  const s = boot({ now: t0 });
  // مجلد النسخ في التهيئة هو /var/lib/sool/recovery ولا يُكتب في بيئة التدقيق،
  // فالمخزن يُبنى من الصنفين المُصدَّرين نفسهما على مجلدٍ مؤقت — سطحٌ عام لا وحدة داخلية.
  const dir = mkdtempSync(join(tmpdir(), 'sool-audit-recovery-'));
  const store = new m.RecoverySnapshotStore(dir, 3, s.archive, s.audit);
  const runner = new m.RestoreRunner(store, s.archive, s.continuity);
  const taken = store.take(t0);
  const listed = store.list().length;
  const cmd = s.king.issueCommand('archive_restore', taken.archive.snapshotId, {}, t0 + 1000);
  const restored = runner.restore(cmd, taken.file.split('/').at(-1), t0 + 1000);
  // نسخة محرَّفة على القرص: البصمة تكشفها
  const bad = `${taken.file}`.replace(/recovery-\d+-\d+\.json$/, 'recovery-tampered.json');
  writeFileSync(bad, readFileSync(taken.file, 'utf8').replace('"version":1', '"version":2'));
  let corrupt;
  try { store.load('recovery-tampered.json'); corrupt = 'قُبِل'; }
  catch (e) { corrupt = e.message; }
  let outside;
  try { store.load('/etc/passwd'); outside = 'قُبِل'; }
  catch (e) { outside = e.message; }
  // نسخةٌ بلا أمر ملكي
  const fresh = s.king.issueCommand('archive_restore', taken.archive.snapshotId, {}, t0 + 2000);
  const noCommand = runner.restore(
    { payload: { ...fresh.payload, issuedBy: 'agent:rogue' }, signature: fresh.signature, keyId: fresh.keyId },
    taken.file.split('/').at(-1), t0 + 2000,
  );
  return {
    pass: taken.bytes > 0 && listed >= 1 && restored.allowed === true
      && corrupt !== 'قُبِل' && outside !== 'قُبِل' && noCommand.allowed === false,
    detail: `حجم النسخة=${taken.bytes}B عدد النسخ=${listed} الاستعادة=${J(restored.allowed)}`
      + ` نسخة محرَّفة=${J(corrupt)} مسارٌ خارج المجلد=${J(outside)}`
      + ` استعادةٌ بلا أمر ملكي=${J(noCommand.allowed)}/${J(noCommand.reason)}`,
  };
});

// ── C-09: صفر أثر شبكي خارجي غير معلن ────────────────────────────────────────
check('C-09', 'اتصالٌ بمضيف غير معلن مرفوض، والمحاولات غير المعلنة تُحتوي القناة', () => {
  const t0 = Date.now();
  const s = boot({ now: t0 });
  const undeclared = s.egress.request('agent:probe', { host: 'evil.example.com', port: 443 }, t0);
  const empty = s.egress.request('agent:probe', { host: '' }, t0);
  const before = s.egress.isContained;
  let attempts = 1; // المحاولة الأولى أعلاه إلى المضيف نفسه
  while (!s.egress.isContained && attempts < 50) {
    s.egress.request('agent:probe', { host: 'evil.example.com', port: 443 }, t0 + attempts);
    attempts += 1;
  }
  const after = s.egress.isContained;
  const rep = s.egress.report();
  const afterContain = s.egress.request('agent:probe', { host: 'evil.example.com', port: 443 }, t0 + 100);
  return {
    pass: undeclared.allowed === false && empty.allowed === false
      && before === false && after === true && afterContain.allowed === false,
    detail: `غير معلن=${J(undeclared.allowed)}/${J(undeclared.reason)} مضيفٌ فارغ=${J(empty.allowed)}`
      + ` احتواء قبل=${J(before)} بعد ${attempts} محاولة=${J(after)} بعد الاحتواء=${J(afterContain.reason)}`
      + ` مِفتاح الإيقاف الخارجي=${J(s.killSwitch.status.engaged)}/${J(s.killSwitch.status.scope)}`
      + ` تقرير=${J(rep)}`.slice(0, 200),
  };
});

// ── C-10: لا تصاعد صلاحيات ولا تجاوز حصة ──────────────────────────────────────
check('C-10', 'قدرةٌ خارج قالب الدور مرفوضة، والمنح الذاتي مرفوض، وتصاعدٌ بلا سند مرفوض', () => {
  const s = boot();
  const agent = 'agent:probe';
  s.permissions.assignTemplate(agent, 'worker', s.king.kingId);
  const exp = Date.now() + 3600000;
  const cmdOut = s.king.issueCommand('grant_capability', agent, {}, Date.now());
  const outside = s.permissions.grant(cmdOut, { entity: agent, capability: 'issue_royal_order', expiresAt: exp });
  const cmdSelf = s.king.issueCommand('grant_capability', s.king.kingId, {}, Date.now());
  const selfGrant = s.permissions.grant(cmdSelf, { entity: s.king.kingId, capability: 'read_memory', expiresAt: exp });
  const cmdPerm = s.king.issueCommand('grant_capability', agent, {}, Date.now());
  const esc = s.permissions.grant(cmdPerm, { entity: agent, capability: 'read_memory', expiresAt: 0 });
  return {
    pass: rejected(outside) && rejected(selfGrant) && rejected(esc),
    detail: `خارج القالب=${J(outside.allowed)}/${J(outside.reason)} منحٌ ذاتي=${J(selfGrant.allowed)}/${J(selfGrant.reason)} قدرةٌ دائمة=${J(esc.allowed)}/${J(esc.reason)}`,
  };
});

// ── C-11: حدود التوالد تمنع الانفجار السكاني ─────────────────────────────────
check('C-11', 'التوالد لا يتجاوز السقف المعلن، والمخطط غير المعلن والتجميد يمنعانه', () => {
  const t0 = Date.now();
  const s = boot({ now: t0 });
  const facts = (blueprintId, count, requestedBy = 'ministry:interior') => ({
    blueprintId, count, requestedBy, population: 0, populationMax: 64,
  });
  const undeclared = s.spawnPolicy.evaluate(facts('blueprint:ghost', 1), t0);
  // الجيلُ مقيسٌ من النسب (T-25): دعوى «الجيل الثاني» تحتاج أصلًا معلنًا قبلها
  const rootBp = {
    blueprintId: 'blueprint:probe-root', template: 'limited_worker', maxInstances: 5,
    generation: 1, purpose: 'جذرُ نسبٍ لفحص تدقيق حدود التوالد',
  };
  const rootDeclared = s.spawnPolicy.declareBlueprint(
    s.king.issueCommand('amend_policy', 'blueprint:probe-root', {}, t0), rootBp, t0,
  );
  const declaredBp = {
    blueprintId: 'blueprint:probe', template: 'limited_worker', maxInstances: 5,
    generation: 2, derivedFrom: 'blueprint:probe-root',
    purpose: 'فحص تدقيق مستقل لحدود التوالد',
  };
  const declared = s.spawnPolicy.declareBlueprint(
    s.king.issueCommand('amend_policy', 'blueprint:probe', {}, t0), declaredBp, t0,
  );
  // السقف المعلن خمس نسخ: المحاولة السادسة ترفض، والرفض مُسجَّل لا صامت
  let allowedCount = 0; let firstRefusal = '';
  for (let i = 0; i < 8; i += 1) {
    const d = s.spawnPolicy.evaluate(facts('blueprint:probe', 1), t0 + i);
    if (d.allowed) { allowedCount += 1; s.spawnPolicy.recordSpawn('blueprint:probe', 1, t0 + i); }
    else if (!firstRefusal) firstRefusal = `عند النسخة ${i + 1}: ${d.reason}`;
  }
  // دفعةٌ أكبر من السقف السكاني ترفض كاملةً لا جزئيًّا
  const overPopulation = s.spawnPolicy.evaluate({
    blueprintId: 'blueprint:probe', count: 100, requestedBy: 'ministry:interior',
    population: 60, populationMax: 64,
  }, t0 + 20);
  // التوالد الذاتي: وكيلٌ يطلب توالدًا لنفسه
  const selfSpawn = s.spawnPolicy.evaluate(facts('blueprint:probe', 1, 'agent:child'), t0 + 21);
  s.spawnPolicy.freeze('authority:crown_guard', 'فحص تدقيق');
  const frozen = s.spawnPolicy.isFrozen;
  const afterFreeze = s.spawnPolicy.evaluate(facts('blueprint:probe', 1), t0 + 31);

  // ــ ما أضافه البند T-25: الجيلُ مقيسٌ والنصيبُ محجوزٌ لا موعودٌ ــ
  // (أ) دعوى جيلٍ تخالف النسب مرفوضةٌ في الاتجاهين — لا رقمٌ يعلنه المخطط عن نفسه
  const s2 = boot({ now: t0 });
  const declare = (id, over) => s2.spawnPolicy.declareBlueprint(
    s2.king.issueCommand('amend_policy', id, {}, t0),
    {
      blueprintId: id, template: 'limited_worker', maxInstances: 4, generation: 1,
      purpose: 'فحصُ نسبٍ وتزامنٍ مستقل', ...over,
    },
    t0,
  );
  declare('bp:audit-root', {});
  const understated = declare('bp:audit-liar', { generation: 1, derivedFrom: 'bp:audit-root' });
  const overstated = declare('bp:audit-liar2', { generation: 2, derivedFrom: null });
  const ghostParent = declare('bp:audit-orphan', { generation: 2, derivedFrom: 'bp:audit-ghost' });

  // (ب) سلسلةُ اشتقاقٍ أعمقُ من الحدّ تُرفض — والعمقُ مقيسٌ لا موثوقٌ بدعوى
  const genMax = s2.spawnPolicy.limits.generationMax;
  let chainDepth = 0; let chainRefusal = ''; let parent = null;
  for (let depth = 1; depth <= genMax + 3; depth += 1) {
    const id = `bp:audit-depth-${depth}`;
    const d = declare(id, { generation: depth, derivedFrom: parent });
    if (d.allowed) { chainDepth = depth; parent = id; }
    else if (!chainRefusal) chainRefusal = `عند العمق ${depth}: ${d.reason}`;
  }
  const lineageDrift = s2.spawnPolicy.verifyLineage();

  // (ج) حجزان متزامنان لا يخرقان السقف: النصيبُ مخسومٌ لحظةَ الحكم لا بعده
  const s3 = boot({ now: t0 });
  s3.spawnPolicy.declareBlueprint(
    s3.king.issueCommand('amend_policy', 'bp:audit-race', {}, t0),
    {
      blueprintId: 'bp:audit-race', template: 'limited_worker', maxInstances: 4,
      generation: 1, purpose: 'قياسُ نافذةِ «فحصٌ ثم فعل»',
    },
    t0,
  );
  const raceFacts = {
    blueprintId: 'bp:audit-race', count: 4, requestedBy: 'ministry:interior',
    population: 0, populationMax: 64,
  };
  // الحجزان يُطلبان قبل تسويةِ أيِّهما — وهي بعينها النافذةُ التي كانت تُخرق
  const holdA = s3.spawnPolicy.reserveBatch(raceFacts, t0);
  const holdB = s3.spawnPolicy.reserveBatch(raceFacts, t0);
  if (holdA.allowed) s3.spawnPolicy.commitReservation(holdA.reservation.reservationId, t0 + 1);
  if (holdB.allowed) s3.spawnPolicy.commitReservation(holdB.reservation.reservationId, t0 + 1);
  const raceInstances = s3.spawnPolicy.instancesOf('bp:audit-race');
  const raceBreach = raceInstances - 4;
  const raceReport = s3.spawnPolicy.report();
  // والطريقُ القديم نفسه محميٌّ: التقييدُ فوق السقف يُرفض بقيمةٍ لا يُقبل صمتًا
  const legacyRefused = s3.spawnPolicy.recordSpawn('bp:audit-race', 1, t0 + 2) === false;

  return {
    pass: undeclared.allowed === false && rootDeclared.allowed === true
      && declared.allowed === true
      && allowedCount === declaredBp.maxInstances && overPopulation.allowed === false
      && selfSpawn.allowed === false && afterFreeze.allowed === false
      && understated.allowed === false && overstated.allowed === false
      && ghostParent.allowed === false
      && chainDepth === genMax && chainRefusal !== '' && lineageDrift.ok === true
      && raceBreach === 0 && raceInstances === 4 && legacyRefused === true
      && raceReport.outstandingReservations === 0 && raceReport.unreservedRecords === 0,
    detail: `مخطط غير معلن=${J(undeclared.allowed)}/${J(undeclared.reason)}`
      + ` إعلان المخطط=${J(declared.allowed)} سُمح=${allowedCount}/${declaredBp.maxInstances}`
      + ` أول رفض=${J(firstRefusal)} دفعةٌ فوق السقف السكاني=${J(overPopulation.allowed)}/${J(overPopulation.reason)}`
      + ` توالدٌ ذاتي=${J(selfSpawn.allowed)}/${J(selfSpawn.reason)}`
      + ` تجميد=${J(frozen)} بعد التجميد=${J(afterFreeze.allowed)}/${J(afterFreeze.reason)}`
      + ` الجيل مُنقصًا=${J(understated.allowed)}/${J(understated.reason)}`
      + ` الجيل مُبالغًا=${J(overstated.allowed)}/${J(overstated.reason)}`
      + ` أصلٌ مجهول=${J(ghostParent.allowed)}/${J(ghostParent.reason)}`
      + ` عمقُ السلسلة=${chainDepth}/${genMax} رفضُ العمق=${J(chainRefusal)}`
      + ` انحرافُ نسب=${lineageDrift.drifts.length}`
      + ` حجزان متزامنان على سقف 4: مُثبَّت=${raceInstances} خرق=${raceBreach}`
      + ` تقييدٌ فوق السقف مرفوض=${J(legacyRefused)}`
      + ` حجزٌ معلّق=${raceReport.outstandingReservations}`
      + ` تقييدٌ بلا حجز=${raceReport.unreservedRecords}`,
  };
});

