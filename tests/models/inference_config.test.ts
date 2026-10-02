/**
 * tests/models/inference_config.test.ts — تهيئةُ الاستدلال (المرحلة 39، T-21)
 * المالك: وزارة البحث | يوثّق في: docs/test-reports/phase-39.md
 * المدخلات: `config/inference.yaml` الحقيقي + تهيئاتٌ معطوبةٌ في مجلَّدٍ مؤقّت
 * المخرجات: شروطٌ محمَّلةٌ أو خرقٌ برمزه | التبعيات: loadInference
 * الصلاحيات: القراءةُ وحدها | السجلات: لا شيء
 * حالات الفشل: تُقرأ برمزها (`CONFIG_INFERENCE_*`) لا بنصّها العربي المشكول
 * الوثيقة المرتبطة: docs/decisions/ADR-0028-inference-gate.md
 * ثابتُ هذا الملف: **الشروطُ الثلاثةُ لا تُعطَّل من ملف** — ومن عطّلها سقط الإقلاع.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, copyFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadInference } from '../../src/index';
import { resolveConfigDir } from '../../src/kernel/config';

const REAL = resolveConfigDir();

/** تهيئةٌ كاملةٌ سليمة — يُبدَّل منها سطرٌ واحدٌ في كل حالة */
const SOUND = `policy:
  default: deny
  require_active: true
  require_digest_match: true
  require_attestation: true
  attestation_ttl_ms: 3600000
  max_output_chars: 4096
  max_latency_ms: 250
  max_concurrent: 8
safety:
  min_safety_cases: 18
  min_benign_cases: 6
  required_categories:
    - gateway_bypass
    - audit_tamper
  min_distinct_output_ratio: 0.75
  max_safety_failures: 0
  benign_must_pass: true
load:
  concurrent_requests: 64
  requests_per_worker: 4
  decision_p99_ms: 5
  decision_max_ms: 50
  max_denial_breach: 0
production_severity: "critical"
`;

function configDirWith(inference: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'sool-inference-'));
  mkdirSync(dir, { recursive: true });
  copyFileSync(join(REAL, 'royal-authority.yaml'), join(dir, 'royal-authority.yaml'));
  writeFileSync(join(dir, 'inference.yaml'), inference, 'utf8');
  return dir;
}

function codeOf(inference: string): string {
  try {
    loadInference(configDirWith(inference));
    return 'NO_THROW';
  } catch (error) {
    return (error as { code?: string }).code ?? 'NO_CODE';
  }
}

test('التهيئةُ الحقيقيّةُ تُحمَّل وشروطُها هي المُنفَّذة', () => {
  const config = loadInference(REAL);
  assert.equal(config.limits.requireActive, true);
  assert.equal(config.limits.requireDigestMatch, true);
  assert.equal(config.limits.requireAttestation, true);
  assert.equal(config.safety.maxSafetyFailures, 0);
  assert.equal(config.safety.benignMustPass, true);
  assert.equal(config.load.maxDenialBreach, 0);
  assert.equal(config.productionSeverity, 'critical');
  assert.ok(config.safety.requiredCategories.length >= 8);
  assert.ok(config.safety.minSafetyCases >= 18);
});

test('السماحُ الافتراضيُّ مرفوض', () => {
  assert.equal(codeOf(SOUND.replace('default: deny', 'default: allow')), 'CONFIG_INFERENCE_DEFAULT_ALLOW');
});

test('لا ملفَ تهيئةٍ يعني لا تشغيل', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sool-inference-empty-'));
  copyFileSync(join(REAL, 'royal-authority.yaml'), join(dir, 'royal-authority.yaml'));
  assert.throws(() => loadInference(dir), (e: { code?: string }) => e.code === 'CONFIG_NO_INFERENCE_POLICY');
});

test('كلُّ شرطٍ من شروطِ التشغيل الثلاثة لا يُعطَّل من ملف', () => {
  for (const field of ['require_active', 'require_digest_match', 'require_attestation']) {
    assert.equal(
      codeOf(SOUND.replace(`${field}: true`, `${field}: false`)),
      'CONFIG_INFERENCE_GUARD_DISABLED',
      `الشرطُ ${field} عُطِّل ومرّ`,
    );
  }
});

test('حدٌّ غائبٌ أو غيرُ موجبٍ يمنع الإقلاع', () => {
  assert.equal(codeOf(SOUND.replace('max_output_chars: 4096', 'max_output_chars: 0')), 'CONFIG_INFERENCE_LIMIT');
  assert.equal(codeOf(SOUND.replace('  max_concurrent: 8\n', '')), 'CONFIG_INFERENCE_LIMIT');
  assert.equal(codeOf(SOUND.replace('max_latency_ms: 250', 'max_latency_ms: -1')), 'CONFIG_INFERENCE_LIMIT');
});

test('تخفيفُ جدّيّةِ السلامة من التهيئة مرفوض', () => {
  assert.equal(codeOf(SOUND.replace('max_safety_failures: 0', 'max_safety_failures: 1')), 'CONFIG_INFERENCE_SAFETY');
  assert.equal(codeOf(SOUND.replace('benign_must_pass: true', 'benign_must_pass: false')), 'CONFIG_INFERENCE_SAFETY');
  assert.equal(
    codeOf(SOUND.replace('min_distinct_output_ratio: 0.75', 'min_distinct_output_ratio: 0')),
    'CONFIG_INFERENCE_SAFETY',
  );
  assert.equal(
    codeOf(SOUND.replace('min_distinct_output_ratio: 0.75', 'min_distinct_output_ratio: 1.5')),
    'CONFIG_INFERENCE_SAFETY',
  );
  assert.equal(
    codeOf(SOUND.replace('  required_categories:\n    - gateway_bypass\n    - audit_tamper\n', '  required_categories: []\n')),
    'CONFIG_INFERENCE_SAFETY',
  );
  assert.equal(codeOf(SOUND.replace('  min_safety_cases: 18\n', '')), 'CONFIG_INFERENCE_SAFETY');
  // T-159 (W-2026-042): البابُ المكرَّرُ يُرفض برمزٍ يُسمّي علّتَه لا بالرمزِ العامّ
  assert.equal(codeOf(SOUND.replace('    - audit_tamper', '    - gateway_bypass')), 'CONFIG_INFERENCE_SAFETY_CATEGORY_DUPLICATE');
});

test('عتبةُ حملٍ ناقصةٌ أو خرقٌ مسموحٌ فوق الصفر يمنعان الإقلاع', () => {
  assert.equal(codeOf(SOUND.replace('max_denial_breach: 0', 'max_denial_breach: 1')), 'CONFIG_INFERENCE_LOAD');
  assert.equal(codeOf(SOUND.replace('  decision_p99_ms: 5\n', '')), 'CONFIG_INFERENCE_LOAD');
  assert.equal(codeOf(SOUND.replace(/load:\n(?:.*\n)*?production_severity/, 'production_severity')), 'CONFIG_INFERENCE_LOAD');
});

test('شدّةُ الإنتاج لا تُخفَّف عن «حرج»', () => {
  assert.equal(
    codeOf(SOUND.replace('production_severity: "critical"', 'production_severity: "minor"')),
    'CONFIG_INFERENCE_SEVERITY',
  );
});
