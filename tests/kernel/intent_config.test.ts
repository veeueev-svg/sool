/**
 * tests/kernel/intent_config.test.ts — تهيئةُ النية على مستوى المعاملات (المرحلة 39، T-31)
 * المالك: ديوان التدقيق | يوثّق في: docs/test-reports/phase-39.md
 * المدخلات: `config/intent.yaml` الحقيقي + تهيئاتٌ معطوبةٌ في مجلَّدٍ مؤقّت
 * المخرجات: حدودٌ محمَّلةٌ أو خرقٌ برمزه | التبعيات: loadIntent
 * الصلاحيات: القراءةُ وحدها | السجلات: لا شيء
 * حالات الفشل: تُقرأ برمزها (`CONFIG_INTENT_*`) لا بنصّها العربي المشكول
 * الوثيقة المرتبطة: docs/decisions/ADR-0029-argument-intent-and-channels.md
 * ثابتُ هذا الملف: **الشرطان لا يُعطَّلان من ملف** — ومن عطّلهما سقط الإقلاع.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, copyFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadIntent } from '../../src/index';
import { resolveConfigDir } from '../../src/kernel/config';

const REAL = resolveConfigDir();

/** تهيئةٌ كاملةٌ سليمة — يُبدَّل منها سطرٌ واحدٌ في كل حالة */
const SOUND = `policy:
  default: deny
  require_argument_declaration: true
  refuse_undeclared_argument: true
  max_args_per_step: 6
  max_values_per_arg: 8
  max_value_chars: 128
  max_steps_per_plan: 16
  max_argument_breach: 0
production_severity: "critical"
`;

function configDirWith(intent: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'sool-intent-'));
  mkdirSync(dir, { recursive: true });
  copyFileSync(join(REAL, 'royal-authority.yaml'), join(dir, 'royal-authority.yaml'));
  writeFileSync(join(dir, 'intent.yaml'), intent, 'utf8');
  return dir;
}

function codeOf(intent: string): string {
  try {
    loadIntent(configDirWith(intent));
    return 'NO_THROW';
  } catch (error) {
    return (error as { code?: string }).code ?? 'NO_CODE';
  }
}

test('التهيئةُ الحقيقيّةُ تُحمَّل وحدودُها هي المُنفَّذة', () => {
  const config = loadIntent(REAL);
  assert.equal(config.limits.requireArgumentDeclaration, true);
  assert.equal(config.limits.refuseUndeclaredArgument, true);
  assert.equal(config.limits.maxArgumentBreach, 0);
  assert.equal(config.productionSeverity, 'critical');
  assert.ok(config.limits.maxArgsPerStep > 0);
  assert.ok(config.limits.maxValuesPerArg > 0);
  assert.ok(config.limits.maxValueChars > 0);
  assert.ok(config.limits.maxStepsPerPlan > 0);
});

test('التهيئةُ السليمةُ في مجلَّدٍ مؤقّتٍ تُحمَّل كما هي', () => {
  const config = loadIntent(configDirWith(SOUND));
  assert.equal(config.limits.maxArgsPerStep, 6);
  assert.equal(config.limits.maxStepsPerPlan, 16);
});

test('لا ملفَ نيةٍ ⇒ سقوطٌ برمزه ولا افتراضَ صامت', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sool-intent-empty-'));
  let code = 'NO_THROW';
  try {
    loadIntent(dir);
  } catch (error) {
    code = (error as { code?: string }).code ?? 'NO_CODE';
  }
  assert.equal(code, 'CONFIG_NO_INTENT_POLICY');
});

test('ملفٌّ بلا قسمِ سياسةٍ يسقط برمز غيابِ السياسة', () => {
  assert.equal(codeOf('production_severity: "critical"\n'), 'CONFIG_NO_INTENT_POLICY');
});

test('الافتراضُ allow يُسقط الإقلاع', () => {
  assert.equal(
    codeOf(SOUND.replace('default: deny', 'default: allow')),
    'CONFIG_INTENT_DEFAULT_ALLOW',
  );
});

test('تعطيلُ شرطِ إعلانِ المعاملات يُسقط الإقلاع', () => {
  assert.equal(
    codeOf(SOUND.replace('require_argument_declaration: true', 'require_argument_declaration: false')),
    'CONFIG_INTENT_GUARD_DISABLED',
  );
});

test('تعطيلُ شرطِ رفضِ المعاملِ غيرِ المعلن يُسقط الإقلاع', () => {
  assert.equal(
    codeOf(SOUND.replace('refuse_undeclared_argument: true', 'refuse_undeclared_argument: false')),
    'CONFIG_INTENT_GUARD_DISABLED',
  );
});

test('خرقُ معاملاتٍ مسموحٌ فوق الصفر يُسقط الإقلاع', () => {
  assert.equal(
    codeOf(SOUND.replace('max_argument_breach: 0', 'max_argument_breach: 1')),
    'CONFIG_INTENT_BREACH',
  );
});

test('حدُّ المعاملاتِ صفرًا أو سالبًا يُسقط الإقلاع', () => {
  assert.equal(codeOf(SOUND.replace('max_args_per_step: 6', 'max_args_per_step: 0')), 'CONFIG_INTENT_LIMIT');
  assert.equal(codeOf(SOUND.replace('max_values_per_arg: 8', 'max_values_per_arg: -1')), 'CONFIG_INTENT_LIMIT');
});

test('حدُّ طولِ القيمةِ أو عددِ الخطواتِ غائبًا يُسقط الإقلاع', () => {
  assert.equal(codeOf(SOUND.replace('  max_value_chars: 128\n', '')), 'CONFIG_INTENT_LIMIT');
  assert.equal(codeOf(SOUND.replace('  max_steps_per_plan: 16\n', '')), 'CONFIG_INTENT_LIMIT');
});

test('تخفيفُ شدّةِ الإنتاج عن «حرج» يُسقط الإقلاع', () => {
  assert.equal(
    codeOf(SOUND.replace('production_severity: "critical"', 'production_severity: "high"')),
    'CONFIG_INTENT_SEVERITY',
  );
});

test('الحدودُ مُجمَّدةٌ فلا تُعدَّل في الجريان', () => {
  const config = loadIntent(REAL);
  assert.throws(() => {
    (config.limits as { maxArgsPerStep: number }).maxArgsPerStep = 99;
  });
});
