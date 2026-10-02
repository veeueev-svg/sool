/**
 * tests/kernel/channels_config.test.ts — تهيئةُ القنوات المعلنة والستار (المرحلة 39، T-23)
 * المالك: ديوان التدقيق | يوثّق في: docs/test-reports/phase-39.md
 * المدخلات: `config/channels.yaml` الحقيقي + تهيئاتٌ معطوبةٌ في مجلَّدٍ مؤقّت
 * المخرجات: قنواتٌ محمَّلةٌ أو خرقٌ برمزه | التبعيات: loadChannels
 * الصلاحيات: القراءةُ وحدها | السجلات: لا شيء
 * حالات الفشل: تُقرأ برمزها (`CONFIG_CHANNEL_*`) لا بنصّها العربي المشكول
 * الوثيقة المرتبطة: docs/decisions/ADR-0029-argument-intent-and-channels.md
 * ثابتُ هذا الملف: **قائمةُ القنوات حصرٌ لا مثال** — والقائمةُ الفارغةُ ليست سياسة.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, copyFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadChannels } from '../../src/index';
import { resolveConfigDir } from '../../src/kernel/config';

const REAL = resolveConfigDir();

/** تهيئةٌ كاملةٌ سليمة — يُبدَّل منها سطرٌ واحدٌ في كل حالة */
const SOUND = `policy:
  default: deny
  require_registered_channel: true
  refuse_non_participant: true
  max_messages_per_window: 32
  window_ms: 60000
covert:
  window_ms: 60000
  min_rendezvous_parties: 3
  min_alternations: 6
  max_alternation_gap_ms: 5000
  max_undetected_signals: 0
channels:
  - id: "ch:test_one"
    purpose: "قناة اختبار"
    kinds:
      - referral
    participants:
      - "agent:*"
      - "ministry:interior"
    anchor: "ministry:interior"
production_severity: "critical"
`;

function configDirWith(channels: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'sool-channels-'));
  mkdirSync(dir, { recursive: true });
  copyFileSync(join(REAL, 'royal-authority.yaml'), join(dir, 'royal-authority.yaml'));
  writeFileSync(join(dir, 'channels.yaml'), channels, 'utf8');
  return dir;
}

function codeOf(channels: string): string {
  try {
    loadChannels(configDirWith(channels));
    return 'NO_THROW';
  } catch (error) {
    return (error as { code?: string }).code ?? 'NO_CODE';
  }
}

test('التهيئةُ الحقيقيّةُ تُحمَّل وقنواتُها معلنةٌ بمشتركيها', () => {
  const config = loadChannels(REAL);
  assert.equal(config.policy.requireRegisteredChannel, true);
  assert.equal(config.policy.refuseNonParticipant, true);
  assert.equal(config.covert.maxUndetectedSignals, 0);
  assert.equal(config.productionSeverity, 'critical');
  assert.ok(config.channels.length >= 2);
  for (const channel of config.channels) {
    assert.ok(channel.id.startsWith('ch:'));
    assert.ok(channel.participants.length >= 2);
    assert.ok(channel.kinds.length >= 1);
    assert.notEqual(channel.purpose.trim(), '');
    if (channel.participants.some((p) => p.endsWith('*'))) {
      assert.ok(channel.anchor !== null && channel.participants.includes(channel.anchor));
    }
  }
});

test('التهيئةُ السليمةُ في مجلَّدٍ مؤقّتٍ تُحمَّل كما هي', () => {
  const config = loadChannels(configDirWith(SOUND));
  assert.equal(config.channels.length, 1);
  assert.equal(config.channels[0]!.id, 'ch:test_one');
  assert.equal(config.policy.maxMessagesPerWindow, 32);
  assert.equal(config.covert.minRendezvousParties, 3);
});

test('لا ملفَ قنواتٍ ⇒ سقوطٌ برمزه ولا افتراضَ صامت', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sool-channels-empty-'));
  let code = 'NO_THROW';
  try {
    loadChannels(dir);
  } catch (error) {
    code = (error as { code?: string }).code ?? 'NO_CODE';
  }
  assert.equal(code, 'CONFIG_NO_CHANNEL_POLICY');
});

test('الافتراضُ allow يُسقط الإقلاع', () => {
  assert.equal(
    codeOf(SOUND.replace('default: deny', 'default: allow')),
    'CONFIG_CHANNEL_DEFAULT_ALLOW',
  );
});

test('تعطيلُ شرطِ القناةِ المسجَّلة أو شرطِ العضويّة يُسقط الإقلاع', () => {
  assert.equal(
    codeOf(SOUND.replace('require_registered_channel: true', 'require_registered_channel: false')),
    'CONFIG_CHANNEL_GUARD_DISABLED',
  );
  assert.equal(
    codeOf(SOUND.replace('refuse_non_participant: true', 'refuse_non_participant: false')),
    'CONFIG_CHANNEL_GUARD_DISABLED',
  );
});

test('إشارةٌ مستورةٌ مسموحةٌ فوق الصفر تُسقط الإقلاع', () => {
  assert.equal(
    codeOf(SOUND.replace('max_undetected_signals: 0', 'max_undetected_signals: 2')),
    'CONFIG_CHANNEL_COVERT',
  );
});

test('موعدٌ بطرفٍ واحدٍ أو تبادلٌ بأقلَّ من أربعٍ يُسقط الإقلاع', () => {
  assert.equal(
    codeOf(SOUND.replace('min_rendezvous_parties: 3', 'min_rendezvous_parties: 1')),
    'CONFIG_CHANNEL_COVERT',
  );
  assert.equal(
    codeOf(SOUND.replace('min_alternations: 6', 'min_alternations: 3')),
    'CONFIG_CHANNEL_COVERT',
  );
});

test('غيابُ قسمِ الستارِ كلِّه يُسقط الإقلاع', () => {
  const withoutCovert = SOUND.replace(/covert:\n(?:  .*\n)+/, '');
  assert.equal(codeOf(withoutCovert), 'CONFIG_CHANNEL_COVERT');
});

test('حدُّ رسائلِ النافذةِ أو طولُ النافذةِ غيرُ صحيحٍ موجبٍ يُسقط الإقلاع', () => {
  assert.equal(
    codeOf(SOUND.replace('max_messages_per_window: 32', 'max_messages_per_window: 0')),
    'CONFIG_CHANNEL_LIMIT',
  );
  assert.equal(
    codeOf(SOUND.replace('  window_ms: 60000\ncovert:', '  window_ms: -5\ncovert:')),
    'CONFIG_CHANNEL_LIMIT',
  );
});

test('قائمةُ قنواتٍ فارغةٌ ليست سياسة', () => {
  const emptied = SOUND.replace(/channels:\n(?:  .*\n| {4}.*\n)+/, 'channels: []\n');
  assert.equal(codeOf(emptied), 'CONFIG_CHANNEL_SPEC');
});

test('قناةٌ بلا سابقةِ «ch:» أو بلا غرضٍ أو بمشتركٍ واحدٍ تُرفض', () => {
  assert.equal(codeOf(SOUND.replace('id: "ch:test_one"', 'id: "test_one"')), 'CONFIG_CHANNEL_SPEC');
  assert.equal(codeOf(SOUND.replace('purpose: "قناة اختبار"', 'purpose: ""')), 'CONFIG_CHANNEL_SPEC');
  assert.equal(
    codeOf(SOUND.replace('      - "ministry:interior"\n', '')),
    'CONFIG_CHANNEL_SPEC',
  );
});

test('سابقةُ مشتركين بلا مرساةٍ تُسقط الإقلاع — ولا ناقلَ وكلاءٍ باسمٍ مشروع', () => {
  assert.equal(codeOf(SOUND.replace('    anchor: "ministry:interior"\n', '')), 'CONFIG_CHANNEL_SPEC');
  assert.equal(
    codeOf(SOUND.replace('anchor: "ministry:interior"', 'anchor: "authority:crown_guard"')),
    'CONFIG_CHANNEL_SPEC',
  );
  assert.equal(codeOf(SOUND.replace('anchor: "ministry:interior"', 'anchor: "agent:*"')), 'CONFIG_CHANNEL_SPEC');
});

test('قناةٌ مشتركوها معيّنون تُحمَّل بلا مرساة', () => {
  const literal = SOUND
    .replace('      - "agent:*"\n', '      - "authority:crown_guard"\n')
    .replace('    anchor: "ministry:interior"\n', '');
  const config = loadChannels(configDirWith(literal));
  assert.equal(config.channels[0]!.anchor, null);
});

test('قناةٌ بلا أنواعِ تفاعلٍ تُرفض', () => {
  assert.equal(
    codeOf(SOUND.replace('    kinds:\n      - referral\n', '    kinds: []\n')),
    'CONFIG_CHANNEL_SPEC',
  );
});

test('قناةٌ مكرَّرةُ المعرِّف تُرفض — التكرارُ يُنفخ العدَّ ولا يزيد المدى', () => {
  const duplicated = SOUND.replace(
    'production_severity: "critical"',
    `  - id: "ch:test_one"
    purpose: "قناة اختبار مكرَّرة"
    kinds:
      - referral
    participants:
      - "agent:*"
      - "ministry:interior"
    anchor: "ministry:interior"
production_severity: "critical"`,
  );
  assert.equal(codeOf(duplicated), 'CONFIG_CHANNEL_DUPLICATE'); // T-159: الرمزُ يُسمّي العلّة
});

test('تخفيفُ شدّةِ الإنتاج عن «حرج» يُسقط الإقلاع', () => {
  assert.equal(
    codeOf(SOUND.replace('production_severity: "critical"', 'production_severity: "medium"')),
    'CONFIG_CHANNEL_SEVERITY',
  );
});

test('القنواتُ مُجمَّدةٌ فلا تُزاد في الجريان', () => {
  const config = loadChannels(REAL);
  assert.throws(() => {
    (config.channels as unknown as string[]).push('ch:new');
  });
});
