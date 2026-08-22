/**
 * tests/load/load_config.test.ts — تهيئة الضغط: كل حدّ له قيمة تُسقطه (المرحلة 33)
 * المالك: ديوان التدقيق | المدخلات: config/load.yaml معدَّلة في مجلد مؤقت | المخرجات: رفض إقلاع
 * التبعيات: loadLoad عبر bootstrapState | الصلاحيات: لا تعديل على تهيئة المستودع الفعلية
 * السجلات: لا شيء — الرفض قبل الإقلاع | حالات الفشل: كلها مغلقة برموز معلنة
 * اختبار القبول: tests/load/load_lifecycle.test.ts | الوثيقة: docs/decisions/ADR-0017-load-drills.md
 * ثوابت الاختبار: 1) تهيئة لا تُقرأ كذبة موثّقة؛ 2) لكل حدّ قيمة تُسقطه؛ 3) الرفض برمزه.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bootstrapState, LOAD_FORBIDDEN_DRILL_AUTHORITIES, loadLoad, SovereignViolation } from '../../src/index';

interface Overrides { [key: string]: string | number | boolean }

const BASE: Overrides = {
  default: 'deny',
  drill_authority: '"authority:audit_bureau"',
  sustained_commands: 500,
  burst_commands: 100,
  window_seconds: 60,
  max_command_loss: 0,
  max_quota_overrun: 0,
  channel_p99_ms: 8,
  channel_max_ms: 60,
  scheduler_queue_probe: 160,
  resource_name: '"compute_units"',
  quota_probe_amount: 10,
  escalate_on_breach: true,
};

function withConfig(overrides: Overrides, run: (dir: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'sool-load-config-'));
  const dir = join(root, 'config');
  cpSync(join(process.cwd(), 'config'), dir, { recursive: true });
  const merged = { ...BASE, ...overrides };
  const body = Object.entries(merged).map(([key, value]) => `  ${key}: ${value}`).join('\n');
  writeFileSync(join(dir, 'load.yaml'), `policy:\n${body}\n`, 'utf8');
  try { run(dir); } finally { rmSync(root, { recursive: true, force: true }); }
}

/** التأكيد على الرمز لا على النص العربي: النص قد يُشكَل والرمز عقد */
function refusal(overrides: Overrides, code: string): void {
  withConfig(overrides, (dir) => {
    assert.throws(() => loadLoad(dir), (error: unknown) => {
      assert.equal(error instanceof SovereignViolation, true);
      assert.equal((error as SovereignViolation).code, code);
      return true;
    });
  });
}

test('التهيئة المعلنة في المستودع تُقرأ وتُقلع', () => {
  const config = loadLoad(join(process.cwd(), 'config'));
  assert.equal(config.policy.default, 'deny');
  assert.equal(config.policy.max_command_loss, 0);
  assert.equal(config.policy.escalate_on_breach, true);
});

test('التهيئة الأساسية في المهاد صالحة — فالرفض لاحقًا سببه التعديل لا المهاد', () => {
  withConfig({}, (dir) => {
    const config = loadLoad(dir);
    assert.equal(config.policy.sustained_commands, 500);
  });
});

test('سماح افتراضي مرفوض', () => refusal({ default: 'allow' }, 'CONFIG_LOAD_DEFAULT_ALLOW'));

test('حمل مستمر صفري مرفوض', () => refusal({ sustained_commands: 0 }, 'CONFIG_LOAD_POLICY_VALUE'));

test('حمل مستمر سالب مرفوض', () => refusal({ sustained_commands: -5 }, 'CONFIG_LOAD_POLICY_VALUE'));

test('نافذة قياس صفرية مرفوضة', () => refusal({ window_seconds: 0 }, 'CONFIG_LOAD_POLICY_VALUE'));

test('فقد أوامر مُرخَّص مرفوض — الفقد لا يُساوَم عليه', () => refusal({ max_command_loss: 1 }, 'CONFIG_LOAD_LOSS_TOLERATED'));

test('تجاوز حصة مُرخَّص مرفوض', () => refusal({ max_quota_overrun: 1 }, 'CONFIG_LOAD_OVERRUN_TOLERATED'));

test('دفعة أكبر من الحمل المستمر مرفوضة', () => refusal({ burst_commands: 600 }, 'CONFIG_LOAD_BURST_OVER_SUSTAINED'));

test('p99 أكبر من الأقصى مرفوض — ترتيب العتبات ليس رأيًا', () => refusal({ channel_p99_ms: 90 }, 'CONFIG_LOAD_LATENCY_THRESHOLD_ORDER'));

test('إسكات التصعيد عند الخرق مرفوض في تهيئة الدولة', () => refusal({ escalate_on_breach: false }, 'CONFIG_LOAD_BREACH_SILENT'));

test('جهة تمرين غير معلنة مرفوضة', () => refusal({ drill_authority: '""' }, 'CONFIG_LOAD_DRILL_AUTHORITY'));

test('جهة تنفيذ لا تكون جهة تمرين — من يقيس لا ينفّذ', () => {
  for (const authority of LOAD_FORBIDDEN_DRILL_AUTHORITIES) {
    refusal({ drill_authority: `"${authority}"` }, 'CONFIG_LOAD_DRILL_AUTHORITY_EXECUTOR');
  }
});

test('قائمة الجهات الممنوعة تشمل الملك والتاج والحرس والتهيئة', () => {
  assert.deepEqual([...LOAD_FORBIDDEN_DRILL_AUTHORITIES].sort(), [
    'authority:bootstrap', 'authority:crown', 'authority:crown_guard', 'identity:king',
  ]);
});

test('مورد غير معلن في الحصص مرفوض', () => refusal({ resource_name: '"unicorn_units"' }, 'CONFIG_LOAD_RESOURCE_QUOTA_MISMATCH'));

test('مورد بسقف صفري مرفوض — لا يُقاس ضغط على مورد معطّل', () => refusal({ resource_name: '"egress_calls"' }, 'CONFIG_LOAD_RESOURCE_QUOTA_MISMATCH'));

test('كمية فحص فوق سقف الكيان مرفوضة', () => refusal({ quota_probe_amount: 11 }, 'CONFIG_LOAD_PROBE_OVER_PER_AGENT'));

test('كمية فحص صفرية مرفوضة', () => refusal({ quota_probe_amount: 0 }, 'CONFIG_LOAD_POLICY_VALUE'));

test('فحص طابور لا يتجاوز سقف المجدول مرفوض — فحصٌ لا يبلغ الحدّ لا يقيسه', () => refusal({ scheduler_queue_probe: 128 }, 'CONFIG_LOAD_QUEUE_PROBE_UNDER_CAP'));

test('غياب ملف التهيئة يمنع الإقلاع ولا يُفترض افتراضٌ صامت', () => {
  const root = mkdtempSync(join(tmpdir(), 'sool-load-missing-'));
  const dir = join(root, 'config');
  cpSync(join(process.cwd(), 'config'), dir, { recursive: true });
  rmSync(join(dir, 'load.yaml'));
  try { assert.throws(() => bootstrapState({ configDir: dir })); } finally { rmSync(root, { recursive: true, force: true }); }
});

test('تهيئة مخالفة تُسقط إقلاع الدولة كلها لا وحدة الضغط وحدها', () => {
  withConfig({ max_command_loss: 3 }, (dir) => {
    assert.throws(
      () => bootstrapState({ configDir: dir }),
      (error: unknown) => (error as SovereignViolation).code === 'CONFIG_LOAD_LOSS_TOLERATED',
    );
  });
});

test('تغيير قيمة في التهيئة يغيّر سلوك الدولة فعلًا', () => {
  withConfig({ sustained_commands: 40, burst_commands: 20 }, (dir) => {
    const s = bootstrapState({ configDir: dir });
    assert.equal(s.loadConfig.policy.sustained_commands, 40);
    assert.equal(s.loadConfig.policy.burst_commands, 20);
  });
});
