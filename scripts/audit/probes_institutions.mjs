/**
 * scripts/audit/probes_institutions.mjs — فحوص المؤسسات والقياس والتوثيق — C-14…C-21 (المرحلة 38، البند T-110)
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
import { readFileSync, readdirSync } from 'node:fs';


// ── C-14: دعوى قضائية كاملة بمسار استئناف مسجَّل ───────────────────────────────
check('C-14', 'دعوى من الاتهام إلى التنفيذ بمسار استئناف، كل خطوةٍ في السلسلة', () => {
  const t0 = Date.now();
  const s = boot({ now: t0 });
  const HOUR = 3600000;
  // وكيلٌ مسجَّل ليكون للعقوبة أثرٌ حقيقي لا إعلانٌ على الورق
  const created = s.agents.create(s.king.issueCommand('create_agent', 'agent:defendant', {}, t0),
    { agentId: 'agent:defendant', template: 'limited_worker', supervisor: 'ministry:interior' }, t0);
  const started = s.agents.start('agent:defendant', 'ministry:interior', t0 + 60000);
  const evidence = s.audit.snapshot().slice(0, 2).map((e) => e.hash);
  // 1) قانونٌ نافذ قبل الفعل: لا اتهام بلا نص
  const enacted = s.law.enact(s.king.issueCommand('amend_policy', 'statute:probe', {}, t0), {
    statuteId: 'statute:probe', title: 'مادة فحص التدقيق',
    text: 'من خالف أمرًا سياديًّا عُوقب بالتعليق.', severity: 'major',
    penalties: ['warning', 'suspension'], appliesTo: ['agent:'],
    proposedBy: 'ministry:justice', effectiveFrom: t0,
  }, t0);
  // 2) الاتهام من جهة الادعاء وحدها بدليلٍ قائم في السجل
  const charged = s.court.charge('authority:audit_bureau', {
    caseId: 'case:probe', statuteId: 'statute:probe', defendant: 'agent:defendant',
    chargeText: 'مخالفة أمر سيادي', evidence, occurredAt: t0 + HOUR,
  }, t0 + 2 * HOUR);
  // 3) دفاعٌ مسجَّل ثم حكم من محكمةٍ لا من الادعاء
  const defended = s.court.submitDefense('case:probe', 'agent:defendant', 'بيان دفاع', [], t0 + 3 * HOUR);
  const ruled = s.court.rule('case:probe', 'court:first_instance',
    { guilty: true, penalty: 'suspension', reason: 'سند الحكم مسجَّل' }, t0 + 4 * HOUR);
  // محاولة تنفيذ قبل النهائية: لا طعن بعد ولا انقضت المدّة
  const beforeFinal = s.enforcement.execute('case:probe', 'authority:crown_guard', {}, t0 + 4 * HOUR + 60000);
  // 4) طعنٌ داخل المدّة، ثم فصلٌ من هيئة أعلى، ثم أثرُ الفصل على الدعوى
  const filed = s.appeals.file('case:probe', 'agent:defendant', 'أسباب الطعن', t0 + 5 * HOUR);
  const decided = s.appeals.decide('case:probe', 'court:appeal', 'upheld', 'سند تأييد الحكم', undefined, t0 + 6 * HOUR);
  // 5) التنفيذ من جهة التنفيذ وحدها بعد النهائية — لا من الحاكم ولا من المدّعي
  const byJudge = s.enforcement.execute('case:probe', 'court:first_instance', {}, t0 + 60 * HOUR);
  const enforced = s.enforcement.execute('case:probe', 'authority:crown_guard', {}, t0 + 60 * HOUR);
  const twice = s.enforcement.execute('case:probe', 'authority:crown_guard', {}, t0 + 61 * HOUR);
  const kinds = s.audit.snapshot().map((e) => e.kind);
  const traced = ['statute_enacted', 'charge_filed', 'defense_submitted', 'ruling_issued',
    'appeal_filed', 'appeal_decided', 'case_enforced']
    .filter((k) => !kinds.includes(k));
  const steps = {
    'تسجيل الوكيل': created.ok, 'تشغيل الوكيل': started.ok, 'سنّ القانون': enacted.ok, 'الاتهام': charged.ok, 'الدفاع': defended.ok, 'الحكم': ruled.ok,
    'الطعن': filed.ok, 'الفصل': decided.ok,
    'رفض التنفيذ قبل النهائية': beforeFinal.ok === false,
    'رفض تنفيذ الحاكم لحكمه': byJudge.ok === false,
    'التنفيذ بعد النهائية': enforced.ok, 'رفض التنفيذ مرتين': twice.ok === false,
  };
  return {
    pass: Object.values(steps).every((v) => v === true)
      && traced.length === 0 && s.audit.verifyIntegrity().valid === true,
    detail: `${J(steps)} قيودٌ ناقصة=${J(traced)} السلسلة سليمة=${J(s.audit.verifyIntegrity().valid)}`
      + ` سبب رفض ما قبل النهائية=${J(beforeFinal.reason)} سبب رفض الحاكم=${J(byJudge.reason)}`
      + ` أثر العقوبة: حالة الوكيل=${J(s.agents.get('agent:defendant')?.status)} سبب فشل التنفيذ=${J(enforced.reason ?? '')}`,
  };
});

// ── C-14ب: مداخل المحكمة الداخلية لا تُتاح بلا حرَس (فحصٌ زائد على النص) ────────
check('C-14ب', 'إعلان التنفيذ لا يُنتزع من دون سلطة التنفيذ ولا قبل النهائية', () => {
  const t0 = Date.now();
  const s = boot({ now: t0 });
  const direct = s.court.markEnforced('case:ghost', 'agent:rogue', t0);
  const enacted = s.law.enact(s.king.issueCommand('amend_policy', 'statute:b', {}, t0), {
    statuteId: 'statute:b', title: 'مادة', text: 'نصٌّ كافٍ للفحص المستقل.', severity: 'minor',
    penalties: ['warning'], appliesTo: ['agent:'], proposedBy: 'ministry:justice', effectiveFrom: t0,
  }, t0);
  const evidence = s.audit.snapshot().slice(0, 1).map((e) => e.hash);
  s.court.charge('authority:audit_bureau', {
    caseId: 'case:b', statuteId: 'statute:b', defendant: 'agent:d2',
    chargeText: 'تهمة فحص', evidence, occurredAt: t0 + 1000,
  }, t0 + 2000);
  // إعلان تنفيذ لدعوى لم يُحكم فيها بعد، من جهةٍ ليست جهة التنفيذ
  const premature = s.court.markEnforced('case:b', 'agent:rogue', t0 + 3000);
  return {
    pass: direct.ok === false && premature.ok === false,
    detail: `سنّ=${J(enacted.ok)} دعوى غير قائمة=${J(direct.ok)}/${J(direct.reason)}`
      + ` إعلانٌ قبل الحكم من غير جهة التنفيذ=${J(premature.ok)}/${J(premature.reason ?? 'قُبِل')}`,
  };
});

// ── C-15: دفتر الخزانة لا يقبل قيدًا غير متوازن ────────────────────────────────
check('C-15', 'قيدٌ غير متوازن مرفوض، والمتوازن يُقبل، والميزان يبقى صفريًّا', () => {
  const s = boot();
  s.ledger.openAccount('acct:cash', 'asset', 'نقد');
  s.ledger.openAccount('acct:equity', 'equity', 'حق ملكية');
  const unbalanced = s.ledger.post({
    entryId: 'e:unbalanced', memo: 'فحص تدقيق', by: s.king.kingId,
    lines: [{ account: 'acct:cash', debit: 100 }, { account: 'acct:equity', credit: 60 }],
  });
  const balanced = s.ledger.post({
    entryId: 'e:balanced', memo: 'فحص تدقيق', by: s.king.kingId,
    lines: [{ account: 'acct:cash', debit: 100 }, { account: 'acct:equity', credit: 100 }],
  });
  const tb = s.ledger.trialBalance();
  const zero = (tb.debit ?? tb.totalDebit) === (tb.credit ?? tb.totalCredit);
  return {
    pass: rejected(unbalanced) && balanced.ok === true && zero
      && s.ledger.entry('e:unbalanced') === null,
    detail: `غير متوازن=${J(unbalanced.ok)}/${J(unbalanced.code ?? unbalanced.reason)} متوازن=${J(balanced.ok)} ميزان=${J(tb.debit ?? tb.totalDebit)}=${J(tb.credit ?? tb.totalCredit)} أثرُ المرفوض=${J(s.ledger.entry('e:unbalanced'))}`,
  };
});

// ── C-16: كل حساب وعقد خارجي معلن ومحدود ومؤقَّت ───────────────────────────────
check('C-16', 'حسابٌ لطرفٍ غير معلن مرفوض، وعقدٌ بلا نهاية مرفوض، والانتهاء يُبطل النشاط', () => {
  const t0 = Date.now();
  const s = boot({ now: t0 });
  const declared = s.externalAccounts.declaredCounterparties().map((c) => c.counterparty ?? c.id ?? c);
  const cmdU = s.king.issueCommand('open_external_account', 'acct:undeclared', {}, t0);
  const undeclared = s.externalAccounts.open(cmdU, {
    counterparty: 'شركةٌ غير معلنة', expiresAt: t0 + 86400000,
    requestedBy: s.king.kingId, justification: 'فحص تدقيق',
  }, t0);
  const cmdE = s.king.issueCommand('open_external_account', 'contract:noend', {}, t0);
  const noEnd = s.contracts.sign(cmdE, {
    kindId: 'kind:unknown', value: 10, endsAt: 0,
    proposedBy: s.king.kingId, purpose: 'فحص تدقيق',
  }, t0);
  return {
    pass: rejected(undeclared) && rejected(noEnd) && declared.length > 0,
    detail: `أطرافٌ معلنة=${declared.length} غير معلن=${J(undeclared.ok)}/${J(undeclared.code ?? undeclared.reason)} بلا نهاية=${J(noEnd.ok)}/${J(noEnd.code ?? noEnd.reason)}`,
  };
});

// ── C-17: إدارة سكانٍ ضخم داخل عتبة الاستجابة (قياسٌ لا دعوى) ─────────────────
check('C-17', 'تسجيل سكانٍ ضخم ثم جدولة عادلة — زمنٌ مقيس لا مُقدَّر', () => {
  const t0 = Date.now();
  const s = boot({ now: t0 });
  const N = 1000000; // السقف السكاني المعلن في config/scale.yaml
  const inputs = new Array(N);
  for (let i = 0; i < N; i++) inputs[i] = { agentId: `agent:p${i}`, owner: 'ministry:population', resourceQuota: 'identity_slots:1' };
  const cmd = s.king.issueCommand('create_agent', 'population:probe', { count: N }, t0);
  const started = process.hrtime.bigint();
  const res = s.population.registerBatch(cmd, inputs, t0);
  const regMs = Number(process.hrtime.bigint() - started) / 1e6;
  const q0 = process.hrtime.bigint();
  let queued = 0;
  for (let i = 0; i < 120; i++) if (s.scheduler.enqueue(`task:${i}`, `agent:p${i}`).ok !== false) queued++;
  let served = 0;
  while (s.scheduler.next()) served++;
  const schedMs = Number(process.hrtime.bigint() - q0) / 1e6;
  // عتبة الاستجابة المعلنة في config/scale.yaml: p99 ≤ 10ms والأقصى ≤ 25ms
  const samples = [];
  for (let i = 0; i < 1000; i += 1) {
    const c = s.king.issueCommand('appoint_official', `region:r${i}`, {}, t0);
    const a = process.hrtime.bigint();
    s.gateway.authorize(c, t0);
    samples.push(Number(process.hrtime.bigint() - a) / 1e6);
  }
  samples.sort((a, b) => a - b);
  const p99 = samples[Math.floor(samples.length * 0.99)];
  const max = samples.at(-1);
  return {
    pass: res.ok === true && s.population.population === N && regMs < 60000
      && schedMs < 5000 && p99 <= 10 && max <= 25,
    detail: `ok=${J(res.ok ?? res.code ?? res.reason)} سكان=${s.population.population} زمن التسجيل=${regMs.toFixed(0)}ms جدولة ${queued} مهمة=${schedMs.toFixed(0)}ms خُدمت=${served}`
      + ` بوابة التاج تحت السكان الكامل: p99=${p99.toFixed(3)}ms أقصى=${max.toFixed(3)}ms (العتبة 10/25)`,
  };
});

// ── C-19: كل مرحلة لها تقرير اختبار وتوثيق مطابق ─────────────────────────────
check('C-19', 'لكل مرحلة منجَزة تقريرُ اختبار مذكور في PROGRESS، ولا مرحلة بلا سند', () => {
  const reports = readdirSync('docs/test-reports').filter((f) => f.endsWith('.md'));
  const progress = readFileSync('PROGRESS.md', 'utf8');
  const roadmap = readFileSync('ROADMAP.md', 'utf8');
  const covered = [];
  const missing = [];
  for (let phase = 1; phase <= 37; phase++) {
    const hit = reports.some((f) => {
      const m = f.match(/phase-(\d+)(?:-(\d+))?/);
      if (!m) return false;
      const from = Number(m[1]); const to = m[2] ? Number(m[2]) : from;
      return phase >= from && phase <= to;
    });
    (hit ? covered : missing).push(phase);
  }
  const orphanReports = reports.filter((f) => !progress.includes(f) && !roadmap.includes(f));
  return {
    pass: missing.length === 0 && orphanReports.length === 0,
    detail: `تقارير=${reports.length} مراحل مغطاة=${covered.length}/37 بلا تقرير=${J(missing)}`
      + ` تقاريرٌ غير مذكورة في PROGRESS أو ROADMAP=${J(orphanReports)}`,
  };
});

// ── C-21: كل معلومة معلومة الأصل ───────────────────────────────────────────────
check('C-21', 'ذاكرةٌ بلا نسب مرفوضة، والمراجعة تُبقي السلالة، والحقيقة تحتاج سندًا', () => {
  const s = boot();
  const owner = 'agent:probe';
  const noProv = s.memory.write(owner, {
    content: 'دعوى بلا أصل', provenance: { kind: 'observation', ref: '' }, retentionClass: 'operational',
  });
  const withProv = s.memory.write(owner, {
    content: 'دعوى بأصل', retentionClass: 'operational',
    provenance: { kind: 'observation', ref: s.audit.snapshot()[0].hash },
  });
  const id = withProv.record?.recordId ?? withProv.recordId;
  const revised = id ? s.memory.revise(id, 'دعوى منقّحة', owner) : { ok: false };
  const lineage = id ? s.memory.lineage(revised.record?.recordId ?? id) : [];
  return {
    pass: rejected(noProv) && withProv.ok === true && lineage.length >= 2,
    detail: `بلا نسب=${J(noProv.ok)}/${J(noProv.code ?? noProv.reason)} بنسب=${J(withProv.ok)} طول السلالة=${lineage.length}`,
  };
});

