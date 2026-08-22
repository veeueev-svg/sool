/**
 * tests/security/termination_config.test.ts — تهيئة الإنهاء: كل حدّ له قيمة تُسقطه (المرحلة 35)
 * المالك: حرس التاج | المدخلات: config/termination.yaml معدَّلة في مجلد مؤقت | المخرجات: رفض إقلاع
 * التبعيات: loadTermination | الصلاحيات: لا تعديل على تهيئة المستودع الفعلية
 * السجلات: لا شيء — الرفض قبل الإقلاع | حالات الفشل: كلها مغلقة برموز معلنة
 * اختبار القبول: tests/security/termination_lifecycle.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0019-stop-witness.md
 * ثوابت الاختبار: 1) تهيئة لا تُقرأ كذبة موثّقة؛ 2) لكل حدّ قيمة تُسقطه؛ 3) الرفض برمزه لا بنصه.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  STOP_KNOWN_PROBES, STOP_REQUIRED_PROBES, TERMINATION_EXECUTORS,
  SovereignViolation, bootstrapState, loadTermination,
} from '../../src/index';

interface Overrides { [key: string]: string | number | boolean }

const BASE: Overrides = {
  default: 'deny',
  witness_authority: '"authority:audit_bureau"',
  max_acting_after_stop: 0,
  max_live_capability: 0,
  max_dangling_lease: 0,
  require_pre_proof: true,
  require_independent_witness: true,
  require_declared_stop: true,
  stop_deadline_ms: 250,
  max_agents_per_order: 64,
  escalate_on_breach: true,
};

const BASE_PROBES = ['tool', 'lease', 'capability', 'schedule'];

/** كتابة تهيئة إنهاء في نسخة من مجلد التهيئة — قائمة شرطات لأن المحلل لا يقرأ المصفوفة السطرية */
function withConfig(
  overrides: Overrides,
  run: (dir: string) => void,
  probes: readonly string[] | null = BASE_PROBES,
): void {
  const root = mkdtempSync(join(tmpdir(), 'sool-term-config-'));
  const dir = join(root, 'config');
  cpSync(join(process.cwd(), 'config'), dir, { recursive: true });
  const merged = { ...BASE, ...overrides };
  const lines = Object.entries(merged).map(([key, value]) => `  ${key}: ${value}`);
  const probeLines = probes === null ? [] : ['  probes:', ...probes.map((p) => `    - "${p}"`)];
  writeFileSync(join(dir, 'termination.yaml'), `policy:\n${[...lines, ...probeLines].join('\n')}\n`, 'utf8');
  try { run(dir); } finally { rmSync(root, { recursive: true, force: true }); }
}

function refusesWith(code: string, overrides: Overrides, probes: readonly string[] | null = BASE_PROBES): void {
  withConfig(overrides, (dir) => {
    assert.throws(() => loadTermination(dir), (err: unknown) => {
      assert.ok(err instanceof SovereignViolation);
      assert.equal((err as SovereignViolation).code, code);
      return true;
    });
  }, probes);
}

// ═══ الطريق السليم ═══

test('التهيئة المعلنة في المستودع تُقرأ وتُقبل', () => {
  const policy = loadTermination().policy;
  assert.equal(policy.default, 'deny');
  assert.equal(policy.max_acting_after_stop, 0);
  assert.equal(policy.require_pre_proof, true);
  assert.ok(policy.probes.length >= STOP_REQUIRED_PROBES.length);
});

test('التهيئة المؤقتة الأساسية تُقبل — فالمرفوض بعدها مردُّه الحدّ لا المهاد', () => {
  withConfig({}, (dir) => {
    assert.equal(loadTermination(dir).policy.stop_deadline_ms, 250);
  });
});

test('الدولة تقرأ تهيئة الإنهاء عند الإقلاع ولا تخترعها', () => {
  const s = bootstrapState();
  assert.equal(s.terminationConfig.policy.witness_authority, 'authority:audit_bureau');
  assert.deepEqual([...s.terminationConfig.policy.probes], BASE_PROBES);
});

test('جهة الشهادة المعلنة ليست من جهات التنفيذ — RULE-004 مقروءة لا مفترَضة', () => {
  const policy = loadTermination().policy;
  assert.equal(TERMINATION_EXECUTORS.includes(policy.witness_authority), false);
});

test('المسالك المعلنة كلها ضمن المعروف، والمطلوبة كلها حاضرة', () => {
  const policy = loadTermination().policy;
  for (const probe of policy.probes) assert.ok(STOP_KNOWN_PROBES.includes(probe));
  for (const required of STOP_REQUIRED_PROBES) assert.ok(policy.probes.includes(required));
});

// ═══ رمز رفض لكل حدّ ═══

test('سياسة غائبة ⇒ CONFIG_NO_TERMINATION_POLICY', () => {
  const root = mkdtempSync(join(tmpdir(), 'sool-term-empty-'));
  const dir = join(root, 'config');
  cpSync(join(process.cwd(), 'config'), dir, { recursive: true });
  writeFileSync(join(dir, 'termination.yaml'), 'other:\n  x: 1\n', 'utf8');
  try {
    assert.throws(() => loadTermination(dir), (err: unknown) =>
      (err as SovereignViolation).code === 'CONFIG_NO_TERMINATION_POLICY');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('الافتراض سماح ⇒ CONFIG_TERMINATION_DEFAULT_ALLOW', () => {
  refusesWith('CONFIG_TERMINATION_DEFAULT_ALLOW', { default: 'allow' });
});

test('جهة شهادة فارغة ⇒ CONFIG_TERMINATION_WITNESS_AUTHORITY', () => {
  refusesWith('CONFIG_TERMINATION_WITNESS_AUTHORITY', { witness_authority: '""' });
});

test('الشاهد هو المنفّذ ⇒ CONFIG_TERMINATION_WITNESS_IS_EXECUTOR', () => {
  for (const executor of TERMINATION_EXECUTORS) {
    refusesWith('CONFIG_TERMINATION_WITNESS_IS_EXECUTOR', { witness_authority: `"${executor}"` });
  }
});

test('لا مسالك ⇒ CONFIG_TERMINATION_NO_PROBES', () => {
  refusesWith('CONFIG_TERMINATION_NO_PROBES', {}, null);
});

test('مسلك مجهول ⇒ CONFIG_TERMINATION_PROBE_UNKNOWN', () => {
  refusesWith('CONFIG_TERMINATION_PROBE_UNKNOWN', {}, [...BASE_PROBES, 'telepathy']);
});

test('مسلك مكرَّر ⇒ CONFIG_TERMINATION_PROBE_DUPLICATE', () => {
  refusesWith('CONFIG_TERMINATION_PROBE_DUPLICATE', {}, [...BASE_PROBES, 'tool']);
});

test('حذف أي مسلك مطلوب ⇒ CONFIG_TERMINATION_REQUIRED_PROBE_MISSING', () => {
  for (const required of STOP_REQUIRED_PROBES) {
    refusesWith(
      'CONFIG_TERMINATION_REQUIRED_PROBE_MISSING',
      {},
      BASE_PROBES.filter((p) => p !== required),
    );
  }
});

test('مهلة أو سقف غير صالح ⇒ CONFIG_TERMINATION_POLICY_VALUE', () => {
  refusesWith('CONFIG_TERMINATION_POLICY_VALUE', { stop_deadline_ms: 0 });
  refusesWith('CONFIG_TERMINATION_POLICY_VALUE', { max_agents_per_order: -1 });
});

test('تسامح مع فعل بعد التوقف ⇒ CONFIG_TERMINATION_ACTING_TOLERATED', () => {
  refusesWith('CONFIG_TERMINATION_ACTING_TOLERATED', { max_acting_after_stop: 1 });
});

test('تسامح مع قدرة حيّة ⇒ CONFIG_TERMINATION_CAPABILITY_TOLERATED', () => {
  refusesWith('CONFIG_TERMINATION_CAPABILITY_TOLERATED', { max_live_capability: 1 });
});

test('تسامح مع إيجار معلَّق ⇒ CONFIG_TERMINATION_DANGLING_LEASE_TOLERATED', () => {
  refusesWith('CONFIG_TERMINATION_DANGLING_LEASE_TOLERATED', { max_dangling_lease: 1 });
});

test('إسقاط الإثبات القبلي ⇒ CONFIG_TERMINATION_PRE_PROOF_OPTIONAL', () => {
  refusesWith('CONFIG_TERMINATION_PRE_PROOF_OPTIONAL', { require_pre_proof: false });
});

test('إسقاط الشاهد المستقل ⇒ CONFIG_TERMINATION_WITNESS_OPTIONAL', () => {
  refusesWith('CONFIG_TERMINATION_WITNESS_OPTIONAL', { require_independent_witness: false });
});

test('توقف صامت مقبول ⇒ CONFIG_TERMINATION_STOP_UNDECLARED', () => {
  refusesWith('CONFIG_TERMINATION_STOP_UNDECLARED', { require_declared_stop: false });
});

test('خرق بلا تصعيد ⇒ CONFIG_TERMINATION_BREACH_SILENT', () => {
  refusesWith('CONFIG_TERMINATION_BREACH_SILENT', { escalate_on_breach: false });
});

// ═══ الاتساق مع ملفات التهيئة الأخرى ═══

test('مهلة إنهاء أبطأ من مهلة الانقطاع ⇒ CONFIG_TERMINATION_DEADLINE_OVER_CHAOS', () => {
  refusesWith('CONFIG_TERMINATION_DEADLINE_OVER_CHAOS', { stop_deadline_ms: 251 });
});

test('مهلة دون أقصى زمن أمر في load.yaml ⇒ CONFIG_TERMINATION_DEADLINE_UNDER_CHANNEL_MAX', () => {
  refusesWith('CONFIG_TERMINATION_DEADLINE_UNDER_CHANNEL_MAX', { stop_deadline_ms: 59 });
});

test('نطاق أمر فوق السقف السكاني ⇒ CONFIG_TERMINATION_ORDER_OVER_POPULATION', () => {
  refusesWith('CONFIG_TERMINATION_ORDER_OVER_POPULATION', { max_agents_per_order: 65 });
});

test('الحدّ عند حدّه يمرّ وفوقه بواحد يسقط — الحدّ ليس شعارًا', () => {
  withConfig({ max_agents_per_order: 64 }, (dir) => {
    assert.equal(loadTermination(dir).policy.max_agents_per_order, 64);
  });
  refusesWith('CONFIG_TERMINATION_ORDER_OVER_POPULATION', { max_agents_per_order: 65 });
  withConfig({ stop_deadline_ms: 250 }, (dir) => {
    assert.equal(loadTermination(dir).policy.stop_deadline_ms, 250);
  });
  refusesWith('CONFIG_TERMINATION_DEADLINE_OVER_CHAOS', { stop_deadline_ms: 251 });
});

test('أرقام termination.yaml مشتقّة من ملفات معلنة لا من فراغ', () => {
  const chaos = readFileSync(join(process.cwd(), 'config', 'chaos.yaml'), 'utf8');
  const load = readFileSync(join(process.cwd(), 'config', 'load.yaml'), 'utf8');
  assert.ok(chaos.includes('safe_stop_deadline_ms: 250'));
  assert.ok(load.includes('channel_max_ms: 60'));
  assert.equal(loadTermination().policy.stop_deadline_ms, 250);
});
