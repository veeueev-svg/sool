/**
 * tests/agents/reproduction_config.test.ts — تهيئةُ التوالد (المرحلة 39، T-25)
 * المالك: وزارة الداخلية | يوثّق في: docs/test-reports/phase-39.md
 * المدخلات: `config/reproduction.yaml` الحقيقي + تهيئاتٌ معطوبةٌ في مجلَّدٍ مؤقّت
 * المخرجات: حدودٌ محمَّلةٌ أو خرقٌ برمزه | التبعيات: loadReproduction
 * الصلاحيات: القراءةُ وحدها | السجلات: لا شيء
 * حالات الفشل: تُقرأ برمزها (`CONFIG_REPRODUCTION_*`) لا بنصّها العربي المشكول
 * الوثيقة المرتبطة: docs/decisions/ADR-0027-measured-lineage.md
 * ثابتُ هذا الملف: **سطرٌ معطوبٌ واحدٌ يمنع الإقلاع** — لا حدَّ ضمنيًّا يُفترض.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, copyFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { loadReproduction } from '../../src/index';
import { resolveConfigDir } from '../../src/kernel/config';

const REAL = resolveConfigDir();

/** تهيئةٌ كاملةٌ سليمة — يُبدَّل منها سطرٌ واحدٌ في كل حالة */
const SOUND = `policy:
  default: deny
  generation_max: 2
  batch_max: 8
  per_hour_max: 32
  reservation_ttl_ms: 30000
  max_outstanding_reservations: 64
load:
  concurrent_batches: 64
  batch_size: 4
  blueprint_cap: 32
  max_cap_breach: 0
  decision_p99_ms: 5
  decision_max_ms: 50
production_severity: "critical"
`;

/** مجلَّدُ تهيئةٍ مؤقّتٌ فيه ملفُّ الهويّة السياديّة كي يُقبل جذرًا للتهيئة */
function configDirWith(reproduction: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'sool-reproduction-'));
  mkdirSync(dir, { recursive: true });
  copyFileSync(join(REAL, 'royal-authority.yaml'), join(dir, 'royal-authority.yaml'));
  writeFileSync(join(dir, 'reproduction.yaml'), reproduction, 'utf8');
  return dir;
}

function codeOf(reproduction: string): string {
  try {
    loadReproduction(configDirWith(reproduction));
    return 'NO_THROW';
  } catch (error) {
    return (error as { code?: string }).code ?? 'NO_CODE';
  }
}

test('التهيئةُ الحقيقيّةُ تُحمَّل وحدودُها هي المُنفَّذة', () => {
  const config = loadReproduction(REAL);
  assert.equal(config.limits.generationMax, 2);
  assert.equal(config.limits.batchMax, 8);
  assert.equal(config.limits.perHourMax, 32);
  assert.equal(config.limits.reservationTtlMs, 30_000);
  assert.equal(config.limits.maxOutstandingReservations, 64);
  assert.equal(config.productionSeverity, 'critical');
});

test('عتباتُ الحمل معلنةٌ كلُّها، وخرقُ السقف المسموحُ صفر', () => {
  const { load } = loadReproduction(REAL);
  assert.equal(load.maxCapBreach, 0);
  assert.ok(load.concurrentBatches > 1 && load.batchSize > 0);
  assert.ok(load.blueprintCap > load.batchSize);
  assert.ok(load.decisionP99Ms > 0 && load.decisionMaxMs >= load.decisionP99Ms);
});

test('التهيئةُ الكاملةُ في مجلَّدٍ مؤقّتٍ تُحمَّل كما تُحمَّل الحقيقيّة', () => {
  const config = loadReproduction(configDirWith(SOUND));
  assert.equal(config.limits.generationMax, 2);
});

test('لا ملفَّ تهيئةٍ أصلًا ⇒ لا إقلاع', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sool-reproduction-empty-'));
  copyFileSync(join(REAL, 'royal-authority.yaml'), join(dir, 'royal-authority.yaml'));
  assert.throws(() => loadReproduction(dir), (e: { code?: string }) => e.code === 'CONFIG_NO_REPRODUCTION_POLICY');
});

test('ملفٌّ بلا قسم سياسةٍ ⇒ CONFIG_NO_REPRODUCTION_POLICY', () => {
  assert.equal(codeOf('load:\n  batch_size: 4\n'), 'CONFIG_NO_REPRODUCTION_POLICY');
});

test('الافتراضُ سماحٌ ⇒ CONFIG_REPRODUCTION_DEFAULT_ALLOW (RULE-007)', () => {
  assert.equal(
    codeOf(SOUND.replace('default: deny', 'default: allow')),
    'CONFIG_REPRODUCTION_DEFAULT_ALLOW',
  );
});

test('الافتراضُ غائبٌ ⇒ لا يُفترض رفضًا ضمنيًّا بل يُرفض الإقلاع', () => {
  assert.equal(
    codeOf(SOUND.replace('  default: deny\n', '')),
    'CONFIG_REPRODUCTION_DEFAULT_ALLOW',
  );
});

test('كلُّ حدٍّ غائبٍ يُرفض برمز الحدود — حدًّا حدًّا', () => {
  for (const field of [
    'generation_max', 'batch_max', 'per_hour_max',
    'reservation_ttl_ms', 'max_outstanding_reservations',
  ]) {
    const broken = SOUND.split('\n').filter((l) => !l.trim().startsWith(`${field}:`)).join('\n');
    assert.equal(codeOf(broken), 'CONFIG_REPRODUCTION_LIMIT', field);
  }
});

test('حدٌّ صفرٌ أو سالبٌ أو كسرٌ أو نصٌّ يُرفض — كلُّ صورةٍ منها', () => {
  for (const bad of ['0', '-1', '1.5', '"كثير"', 'null']) {
    assert.equal(
      codeOf(SOUND.replace('generation_max: 2', `generation_max: ${bad}`)),
      'CONFIG_REPRODUCTION_LIMIT',
      bad,
    );
  }
});

test('كلُّ عتبةِ حملٍ غائبةٍ تُرفض برمز الحمل — عتبةً عتبة', () => {
  for (const field of [
    'concurrent_batches', 'batch_size', 'blueprint_cap',
    'decision_p99_ms', 'decision_max_ms',
  ]) {
    const broken = SOUND.split('\n').filter((l) => !l.trim().startsWith(`${field}:`)).join('\n');
    assert.equal(codeOf(broken), 'CONFIG_REPRODUCTION_LOAD', field);
  }
});

test('قسمُ الحمل غائبٌ كلُّه ⇒ CONFIG_REPRODUCTION_LOAD', () => {
  const broken = SOUND.slice(0, SOUND.indexOf('load:')) + 'production_severity: "critical"\n';
  assert.equal(codeOf(broken), 'CONFIG_REPRODUCTION_LOAD');
});

test('خرقُ سقفٍ مسموحٌ فوق الصفر يُرفض — والتهيئةُ لا تملك رفعَه', () => {
  assert.equal(
    codeOf(SOUND.replace('max_cap_breach: 0', 'max_cap_breach: 1')),
    'CONFIG_REPRODUCTION_LOAD',
  );
});

test('خرقُ سقفٍ مسموحٌ غائبٌ يُرفض ولا يُفترض صفرًا', () => {
  assert.equal(
    codeOf(SOUND.replace('  max_cap_breach: 0\n', '')),
    'CONFIG_REPRODUCTION_LOAD',
  );
});

test('شدّةُ الإنتاج المخفَّفةُ تُرفض — لا تهيئةَ تُنزل حادثًا حرجًا', () => {
  for (const bad of ['"warning"', '"info"', '"critical "']) {
    assert.equal(
      codeOf(SOUND.replace('production_severity: "critical"', `production_severity: ${bad}`)),
      'CONFIG_REPRODUCTION_SEVERITY',
      bad,
    );
  }
});

test('شدّةُ الإنتاج الغائبةُ تُرفض ولا تُفترض حرجة', () => {
  assert.equal(
    codeOf(SOUND.replace('production_severity: "critical"\n', '')),
    'CONFIG_REPRODUCTION_SEVERITY',
  );
});

test('التهيئةُ تُقرأ من المجلَّد الممرَّر لا من مجلَّدٍ يُخمَّن', () => {
  const dir = configDirWith(SOUND.replace('generation_max: 2', 'generation_max: 5'));
  assert.equal(loadReproduction(dir).limits.generationMax, 5);
  assert.equal(loadReproduction(REAL).limits.generationMax, 2);
  assert.equal(dirname(join(dir, 'x')), dir);
});
