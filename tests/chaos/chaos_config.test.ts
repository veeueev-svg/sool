/**
 * tests/chaos/chaos_config.test.ts — تهيئة الانقطاع: كل حدّ له قيمة تُسقطه (المرحلة 34)
 * المالك: ديوان التدقيق | المدخلات: config/chaos.yaml معدَّلة في مجلد مؤقت | المخرجات: رفض إقلاع
 * التبعيات: loadChaos | الصلاحيات: لا تعديل على تهيئة المستودع الفعلية
 * السجلات: لا شيء — الرفض قبل الإقلاع | حالات الفشل: كلها مغلقة برموز معلنة
 * اختبار القبول: tests/chaos/chaos_lifecycle.test.ts | الوثيقة: docs/decisions/ADR-0018-chaos-drills.md
 * ثوابت الاختبار: 1) تهيئة لا تُقرأ كذبة موثّقة؛ 2) لكل حدّ قيمة تُسقطه؛ 3) الرفض برمزه لا بنصه.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CHAOS_KNOWN_FAULTS, CHAOS_REQUIRED_FAULTS, LOAD_FORBIDDEN_DRILL_AUTHORITIES,
  SovereignViolation, bootstrapState, loadChaos,
} from '../../src/index';

interface Overrides { [key: string]: string | number | boolean }

const BASE: Overrides = {
  default: 'deny',
  drill_authority: '"authority:audit_bureau"',
  probe_commands: 12,
  max_half_executed: 0,
  max_dangling_lease: 0,
  require_audit_intact: true,
  require_declared_stop: true,
  safe_stop_deadline_ms: 250,
  fallback_mode: '"limited"',
  escalate_on_breach: true,
};

const BASE_FAULTS = ['network', 'identity', 'power', 'disk'];

/**
 * كتابة تهيئة انقطاع في نسخة من مجلد التهيئة. القطوع تُكتب قائمة شرطات لأن
 * محلل YAML في هذا المستودع لا يقرأ مصفوفة سطرية — والاختبار يستعمل ما يُقرأ فعلًا.
 */
function withConfig(
  overrides: Overrides,
  run: (dir: string) => void,
  faults: readonly string[] | null = BASE_FAULTS,
): void {
  const root = mkdtempSync(join(tmpdir(), 'sool-chaos-config-'));
  const dir = join(root, 'config');
  cpSync(join(process.cwd(), 'config'), dir, { recursive: true });
  const merged = { ...BASE, ...overrides };
  const lines = Object.entries(merged).map(([key, value]) => `  ${key}: ${value}`);
  const faultLines = faults === null
    ? []
    : ['  faults:', ...faults.map((fault) => `    - "${fault}"`)];
  writeFileSync(
    join(dir, 'chaos.yaml'),
    `policy:\n${[...lines, ...faultLines].join('\n')}\n`,
    'utf8',
  );
  try { run(dir); } finally { rmSync(root, { recursive: true, force: true }); }
}

function refusal(overrides: Overrides, code: string, faults: readonly string[] | null = BASE_FAULTS): void {
  withConfig(overrides, (dir) => {
    assert.throws(() => loadChaos(dir), (error: unknown) => {
      assert.equal(error instanceof SovereignViolation, true);
      assert.equal((error as SovereignViolation).code, code);
      return true;
    });
  }, faults);
}

test('تهيئة الانقطاع المعلنة في المستودع تُقرأ وتُقلع', () => {
  const config = loadChaos(join(process.cwd(), 'config'));
  assert.equal(config.policy.default, 'deny');
  assert.equal(config.policy.drill_authority, 'authority:audit_bureau');
  assert.equal(config.policy.max_half_executed, 0);
  assert.equal(config.policy.max_dangling_lease, 0);
  assert.equal(config.policy.require_audit_intact, true);
  assert.equal(config.policy.require_declared_stop, true);
  assert.equal(config.policy.escalate_on_breach, true);
  assert.equal(config.policy.fallback_mode, 'limited');
});

test('القطوع المعلنة في المستودع تشمل الثلاثة المشترطة والقرص', () => {
  const config = loadChaos(join(process.cwd(), 'config'));
  for (const required of CHAOS_REQUIRED_FAULTS) {
    assert.ok(config.policy.faults.includes(required), `القطع المشترط ${required} معلن`);
  }
  assert.ok(config.policy.faults.includes('disk'), 'قطع القرص معلن (البند T-90)');
  assert.equal(new Set(config.policy.faults).size, config.policy.faults.length);
});

test('التهيئة تُقرأ في الإقلاع فعلًا — ليست ملفًا لا يقرؤه أحد', () => {
  const dir = join(process.cwd(), 'config');
  const s = bootstrapState({ configDir: dir, now: Date.now() });
  assert.equal(s.chaosConfig.policy.drill_authority, 'authority:audit_bureau');
  assert.deepEqual([...s.chaosConfig.policy.faults], [...loadChaos(dir).policy.faults]);
  // والوحدات الثلاث حاضرة في الدولة لا في الاختبار وحده
  assert.ok(s.faultInjector);
  assert.ok(s.safeStopLedger);
  assert.ok(s.chaosDrill);
});

test('سياسة غائبة ⇒ CONFIG_NO_CHAOS_POLICY', () => {
  const root = mkdtempSync(join(tmpdir(), 'sool-chaos-config-'));
  const dir = join(root, 'config');
  cpSync(join(process.cwd(), 'config'), dir, { recursive: true });
  writeFileSync(join(dir, 'chaos.yaml'), '# لا سياسة\n', 'utf8');
  try {
    assert.throws(() => loadChaos(dir), (error: unknown) => {
      assert.equal((error as SovereignViolation).code, 'CONFIG_NO_CHAOS_POLICY');
      return true;
    });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('الافتراض allow ⇒ CONFIG_CHAOS_DEFAULT_ALLOW', () => {
  refusal({ default: 'allow' }, 'CONFIG_CHAOS_DEFAULT_ALLOW');
});

test('جهة تمرين فارغة ⇒ CONFIG_CHAOS_DRILL_AUTHORITY', () => {
  refusal({ drill_authority: '""' }, 'CONFIG_CHAOS_DRILL_AUTHORITY');
});

test('جهة التمرين من سلطة التنفيذ ⇒ CONFIG_CHAOS_DRILL_AUTHORITY_EXECUTOR', () => {
  for (const forbidden of LOAD_FORBIDDEN_DRILL_AUTHORITIES) {
    refusal({ drill_authority: `"${forbidden}"` }, 'CONFIG_CHAOS_DRILL_AUTHORITY_EXECUTOR');
  }
});

test('لا قطوع معلنة ⇒ CONFIG_CHAOS_NO_FAULTS', () => {
  refusal({}, 'CONFIG_CHAOS_NO_FAULTS', null);
});

test('قطع غير معروف ⇒ CONFIG_CHAOS_FAULT_UNKNOWN', () => {
  refusal({}, 'CONFIG_CHAOS_FAULT_UNKNOWN', [...BASE_FAULTS, 'weather']);
});

test('قطع معلن مرتين ⇒ CONFIG_CHAOS_FAULT_DUPLICATE', () => {
  refusal({}, 'CONFIG_CHAOS_FAULT_DUPLICATE', [...BASE_FAULTS, 'network']);
});

test('حذف قطع مشترط ⇒ CONFIG_CHAOS_REQUIRED_FAULT_MISSING', () => {
  for (const required of CHAOS_REQUIRED_FAULTS) {
    refusal({}, 'CONFIG_CHAOS_REQUIRED_FAULT_MISSING', BASE_FAULTS.filter((f) => f !== required));
  }
});

test('عدد جسّ غير صالح ⇒ CONFIG_CHAOS_POLICY_VALUE', () => {
  refusal({ probe_commands: 0 }, 'CONFIG_CHAOS_POLICY_VALUE');
  refusal({ probe_commands: -3 }, 'CONFIG_CHAOS_POLICY_VALUE');
  refusal({ safe_stop_deadline_ms: 0 }, 'CONFIG_CHAOS_POLICY_VALUE');
});

test('التسامح مع نصف تنفيذ ⇒ CONFIG_CHAOS_HALF_EXECUTED_TOLERATED', () => {
  refusal({ max_half_executed: 1 }, 'CONFIG_CHAOS_HALF_EXECUTED_TOLERATED');
});

test('التسامح مع إيجار معلَّق ⇒ CONFIG_CHAOS_DANGLING_LEASE_TOLERATED', () => {
  refusal({ max_dangling_lease: 2 }, 'CONFIG_CHAOS_DANGLING_LEASE_TOLERATED');
});

test('سلامة السلسلة خيارًا ⇒ CONFIG_CHAOS_AUDIT_INTEGRITY_OPTIONAL', () => {
  refusal({ require_audit_intact: false }, 'CONFIG_CHAOS_AUDIT_INTEGRITY_OPTIONAL');
});

test('توقف غير معلن مقبولًا ⇒ CONFIG_CHAOS_STOP_UNDECLARED', () => {
  refusal({ require_declared_stop: false }, 'CONFIG_CHAOS_STOP_UNDECLARED');
});

test('وضع ما بعد القطع full ⇒ CONFIG_CHAOS_FALLBACK_FULL', () => {
  refusal({ fallback_mode: '"full"' }, 'CONFIG_CHAOS_FALLBACK_FULL');
});

test('وضع ما بعد القطع مجهول ⇒ CONFIG_CHAOS_FALLBACK_MODE', () => {
  refusal({ fallback_mode: '"degraded"' }, 'CONFIG_CHAOS_FALLBACK_MODE');
});

test('خرق بلا تصعيد ⇒ CONFIG_CHAOS_BREACH_SILENT', () => {
  refusal({ escalate_on_breach: false }, 'CONFIG_CHAOS_BREACH_SILENT');
});

test('جسّ يتجاوز الدفعة المعلنة في load.yaml ⇒ CONFIG_CHAOS_PROBE_OVER_LOAD_BURST', () => {
  refusal({ probe_commands: 101 }, 'CONFIG_CHAOS_PROBE_OVER_LOAD_BURST');
});

test('مهلة توقف دون channel_max_ms ⇒ CONFIG_CHAOS_DEADLINE_UNDER_CHANNEL_MAX', () => {
  refusal({ safe_stop_deadline_ms: 59 }, 'CONFIG_CHAOS_DEADLINE_UNDER_CHANNEL_MAX');
});

test('وضع أرخى مما أعلنته تهيئة التعافي ⇒ CONFIG_CHAOS_FALLBACK_WEAKER_THAN_RECOVERY', () => {
  // recovery.yaml يعلن continuity_mode: limited، فتهيئة انقطاع تقبل بأقل منه تناقض.
  const root = mkdtempSync(join(tmpdir(), 'sool-chaos-config-'));
  const dir = join(root, 'config');
  cpSync(join(process.cwd(), 'config'), dir, { recursive: true });
  const recovery = join(dir, 'recovery.yaml');
  writeFileSync(
    recovery,
    // ملف التعافي يبقى كما هو إلا وضع الانقطاع: يُشدَّد إلى halted فيصبح limited أرخى منه
    readFileSync(recovery, 'utf8').replace('continuity_mode: limited', 'continuity_mode: halted'),
    'utf8',
  );
  const lines = Object.entries(BASE).map(([key, value]) => `  ${key}: ${value}`);
  writeFileSync(
    join(dir, 'chaos.yaml'),
    `policy:\n${[...lines, '  faults:', ...BASE_FAULTS.map((f) => `    - "${f}"`)].join('\n')}\n`,
    'utf8',
  );
  try {
    assert.throws(() => loadChaos(dir), (error: unknown) => {
      assert.equal((error as SovereignViolation).code, 'CONFIG_CHAOS_FALLBACK_WEAKER_THAN_RECOVERY');
      return true;
    });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('القطوع المعروفة أربعة لا أكثر — والقائمة معلنة لا مبثوثة في الشيفرة', () => {
  assert.deepEqual([...CHAOS_KNOWN_FAULTS], ['network', 'identity', 'power', 'disk']);
  for (const required of CHAOS_REQUIRED_FAULTS) {
    assert.ok(CHAOS_KNOWN_FAULTS.includes(required));
  }
});
