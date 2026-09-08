/**
 * tests/security/confinement.test.ts — قياسُ شاهد الحصر وسياسته (المرحلة 39، T-16)
 * المالك: ديوان التدقيق
 * المدخلات: جذرُ شاهدٍ مُصطنع (tests/security/proc_fixture.ts) + `config/confinement.yaml`
 * المخرجات: حكمٌ مقيس لا مزعوم | التبعيات: readConfinementFacts + verifyConfinement + loadConfinement
 * الصلاحيات: القياسُ وحده — لا يُصلح الاختبارُ حصرًا ولا يُخفّف شرطًا
 * السجلات: لا شيء | حالات الفشل: تُقرأ برمزها لا بنصّها العربي المشكول
 * اختبار القبول: هذا الملف نفسه + scripts/confinement_probe.ts على النواة الحقيقية
 * الوثيقة المرتبطة: docs/decisions/ADR-0026-kernel-confinement.md
 * ثوابتُ هذا الملف:
 *   1) **الجذرُ المُصطنع يقيس القارئ لا الحصر.** الحصرُ الحقيقي يُقاس بالمسبار على
 *      النواة، وخرجُه محفوظٌ في docs/audit/measurements/phase-39-T16.txt.
 *   2) **العجزُ عن القراءة خرقٌ لا صمت**: جذرٌ غير موجود يرمي `CONFINEMENT_FACTS_UNREADABLE`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  readConfinementFacts, verifyConfinement, confinementWitness,
  loadConfinement, CONFINEMENT_REQUIREMENTS,
} from '../../src/index';
import { writeFakeProc, CONFINED, UNCONFINED } from './proc_fixture';

const POLICY = loadConfinement().policy;

test('الشروطُ السبعة كلها مُلزمة في التهيئة — ولا شرطَ يُعطَّل منها', () => {
  for (const requirement of CONFINEMENT_REQUIREMENTS) {
    assert.equal(POLICY.require[requirement], true, requirement);
  }
  assert.equal(POLICY.default, 'deny');
  assert.equal(POLICY.production_severity, 'critical');
});

test('جذرٌ محصور: الحكمُ محصورٌ بلا شرطٍ ناقص', () => {
  const root = writeFakeProc(CONFINED);
  try {
    const verdict = verifyConfinement(POLICY, readConfinementFacts(root));
    assert.equal(verdict.failures.length, 0);
    assert.equal(verdict.confined, true);
    assert.equal(verdict.facts.uid, 10001);
    assert.deepEqual(verdict.facts.interfaces, ['lo']);
    assert.equal(verdict.facts.defaultRoutes, 0);
    assert.equal(verdict.facts.readOnlyRoot, true);
    assert.equal(verdict.facts.seccompMode, 2);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('جذرٌ كبيئة هذا المستودع: خمسةُ شروطٍ تسقط ولا يُعلن حصرٌ', () => {
  const root = writeFakeProc(UNCONFINED);
  try {
    const verdict = verifyConfinement(POLICY, readConfinementFacts(root));
    assert.equal(verdict.confined, false);
    const failed = verdict.failures.map((f) => f.requirement).sort();
    assert.deepEqual(failed, [
      'default_deny_egress', 'empty_bounding_set', 'no_new_privileges',
      'read_only_root', 'seccomp_filter',
    ]);
    // كلُّ سقوطٍ يحمل قياسَه ونصَّ سببه — خرقٌ بلا رقمٍ لا يُسدّ (RULE-009)
    for (const failure of verdict.failures) {
      assert.ok(failure.measured.length > 0, failure.requirement);
      assert.ok(failure.reason.length > 0, failure.requirement);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('الجذرُ وحده يُسقط الحكم: uid=0 يُسقط non_root حتى لو استُوفي ما بعده', () => {
  const root = writeFakeProc({ ...CONFINED, uid: 0 });
  try {
    const verdict = verifyConfinement(POLICY, readConfinementFacts(root));
    assert.equal(verdict.confined, false);
    assert.equal(verdict.failures[0]?.requirement, 'non_root');
    assert.equal(verdict.failures[0]?.measured, 'uid=0');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('قدرةٌ فعّالةٌ واحدة تُسقط الحكم — القدرةُ صفرٌ أو ليست صفرًا، ولا وسط', () => {
  const root = writeFakeProc({ ...CONFINED, capEff: '0000000000000400' });
  try {
    const verdict = verifyConfinement(POLICY, readConfinementFacts(root));
    assert.equal(verdict.confined, false);
    assert.ok(verdict.failures.some((f) => f.requirement === 'no_effective_capabilities'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('مسارٌ افتراضيٌّ واحد على واجهةٍ غير lo يُسقط default_deny_egress', () => {
  const root = writeFakeProc({ ...CONFINED, interfaces: ['eth0'], defaultRoute: true });
  try {
    const verdict = verifyConfinement(POLICY, readConfinementFacts(root));
    assert.equal(verdict.facts.defaultRoutes, 1);
    assert.ok(verdict.failures.some((f) => f.requirement === 'default_deny_egress'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('واجهةٌ إضافيةٌ بلا مسارٍ افتراضي لا تُسقط الشرط — المقياسُ الطريقُ لا الواجهة', () => {
  const root = writeFakeProc({ ...CONFINED, interfaces: ['eth0'], defaultRoute: false });
  try {
    const verdict = verifyConfinement(POLICY, readConfinementFacts(root));
    assert.equal(verdict.facts.defaultRoutes, 0);
    assert.equal(verdict.confined, true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ── W-2026-039: البقعةُ العمياءُ عن IPv6 وعن المسالكِ غيرِ الافتراضيّة ──────────────
// كلُّ اختبارٍ هنا كان **يمرُّ قبلَ العلاج بـ`confined=true`** — وهذا هو الخرقُ نفسُه.
// القياسُ الخامُّ قبلَ وبعدَ: docs/test-reports/phase-39-W-2026-039-measurements.txt

test('مسلكٌ افتراضيٌّ IPv6 على واجهةٍ غير lo يُسقط الحكم — ولا مسلكَ IPv4 البتّة', () => {
  const root = writeFakeProc({
    ...CONFINED, interfaces: ['eth0'], defaultRoute: false, ipv6DefaultRoute: true,
  });
  try {
    const verdict = verifyConfinement(POLICY, readConfinementFacts(root));
    assert.equal(verdict.facts.defaultRoutes, 0, 'لا مسلكَ IPv4 افتراضيًّا أصلًا');
    assert.equal(verdict.facts.ipv6DefaultRoutes, 1);
    assert.equal(verdict.confined, false, 'شاهدٌ يقول محصورٌ وطريقُ الخروجِ مفتوح');
    assert.ok(verdict.failures.some((f) => f.requirement === 'default_deny_egress'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('مسلكٌ IPv4 غيرُ افتراضيٍّ إلى شبكةٍ مجاورةٍ يُسقط الحكم — المجاورةُ خارجٌ', () => {
  const root = writeFakeProc({
    ...CONFINED, interfaces: ['eth0'], defaultRoute: false, localRoute: true,
  });
  try {
    const verdict = verifyConfinement(POLICY, readConfinementFacts(root));
    assert.equal(verdict.facts.defaultRoutes, 0);
    assert.equal(verdict.facts.ipv6DefaultRoutes, 0);
    assert.equal(verdict.facts.egressRoutes, 1);
    assert.equal(verdict.confined, false);
    assert.ok(verdict.failures.some((f) => f.requirement === 'default_deny_egress'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('مسلكٌ IPv6 غيرُ افتراضيٍّ (fe80::/64) على واجهةٍ غير lo يُسقط الحكم', () => {
  const root = writeFakeProc({
    ...CONFINED, interfaces: ['eth0'], defaultRoute: false, ipv6LinkLocalRoute: true,
  });
  try {
    const verdict = verifyConfinement(POLICY, readConfinementFacts(root));
    assert.equal(verdict.facts.ipv6DefaultRoutes, 0, 'طولُ البادئةِ 40 فليس افتراضيًّا');
    assert.equal(verdict.facts.egressRoutes, 1);
    assert.equal(verdict.confined, false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('مجالٌ فارغٌ حقيقيٌّ: مسالكُ lo وحدَها — وفيها وجهةٌ صفريّةٌ — لا تُعدّ خروجًا', () => {
  const root = writeFakeProc(CONFINED);
  try {
    const verdict = verifyConfinement(POLICY, readConfinementFacts(root));
    assert.equal(verdict.facts.ipv6DefaultRoutes, 0);
    assert.equal(verdict.facts.egressRoutes, 0);
    assert.equal(verdict.facts.ipv6StackPresent, true);
    // مقياسُ عدمِ الانحدار: علاجٌ يُسقط هذه الحالةَ استبدل العمى بالضجيج
    assert.equal(verdict.confined, true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('نواةٌ بلا مكدّسِ IPv6: غيابُ الملفّ يُقرأ صفرًا **ويُعلَن** ولا يُسكَت عنه', () => {
  const root = writeFakeProc({ ...CONFINED, ipv6Stack: false });
  try {
    const facts = readConfinementFacts(root);
    assert.equal(facts.ipv6StackPresent, false);
    assert.equal(facts.ipv6DefaultRoutes, 0);
    assert.equal(verifyConfinement(POLICY, facts).confined, true);
    // ومصدرُ الصفرِ مقروءٌ في نصّ القياس حين يسقط الشرط لسببٍ آخر
    const noisy = writeFakeProc({
      ...CONFINED, ipv6Stack: false, interfaces: ['eth0'], defaultRoute: true,
    });
    try {
      const failure = verifyConfinement(POLICY, readConfinementFacts(noisy)).failures
        .find((f) => f.requirement === 'default_deny_egress');
      assert.ok(failure?.measured.includes('مكدّس IPv6=غائب'), failure?.measured);
    } finally { rmSync(noisy, { recursive: true, force: true }); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('نصُّ القياس يذكر التعدادَ الثلاثيَّ — فلا يُقرأ حكمٌ بلا معرفةِ ما قيس', () => {
  const root = writeFakeProc({
    ...CONFINED, interfaces: ['eth0'], defaultRoute: true, ipv6DefaultRoute: true,
  });
  try {
    const failure = verifyConfinement(POLICY, readConfinementFacts(root)).failures
      .find((f) => f.requirement === 'default_deny_egress');
    assert.ok(failure, 'الشرطُ يجب أن يسقط');
    for (const part of ['افتراضي v4=', 'افتراضي v6=', 'مسالكُ خروج=', 'مكدّس IPv6=']) {
      assert.ok(failure.measured.includes(part), `${part} مفقودٌ من: ${failure.measured}`);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('جذرٌ غير موجود: عجزُ القراءة خرقٌ مغلق برمزه لا صمتٌ يُفسَّر حصرًا', () => {
  const missing = join(tmpdir(), 'sool-proc-لا-يوجد-abc123');
  assert.throws(() => readConfinementFacts(missing), (error: Error & { code?: string }) => {
    assert.equal(error.code, 'CONFINEMENT_FACTS_UNREADABLE');
    return true;
  });
});

test('حقلٌ ناقص في الشاهد: بنيةٌ مشوّهة تُرفض ولا تُخمَّن', () => {
  const root = mkdtempSync(join(tmpdir(), 'sool-proc-bad-'));
  try {
    mkdirSync(join(root, 'self'), { recursive: true });
    writeFileSync(join(root, 'self/status'), 'Name:\tnode\nUid:\t10001\n', 'utf8');
    assert.throws(() => readConfinementFacts(root), (error: Error & { code?: string }) => {
      assert.equal(error.code, 'CONFINEMENT_FACTS_MALFORMED');
      return true;
    });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('الشاهدُ كائنٌ يُسأل في كل مرة: جذرُه معلنٌ وحكمُه يُعاد قياسه لا يُخزَّن', () => {
  const root = writeFakeProc(CONFINED);
  try {
    const witness = confinementWitness({ ...POLICY, witness_root: root });
    assert.equal(witness.witnessRoot, root);
    assert.equal(witness.verify().confined, true);
    // يُبدَّل الجذرُ على القرص فيتبدّل الحكم — لأن القراءة في كل نداء لا مرةً واحدة
    writeFileSync(join(root, 'self/mountinfo'), '1 1 0:1 / / rw,relatime - overlay o rw\n', 'utf8');
    const second = witness.verify();
    assert.equal(second.confined, false);
    assert.ok(second.failures.some((f) => f.requirement === 'read_only_root'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
