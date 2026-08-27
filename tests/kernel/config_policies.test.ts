/**
 * tests/kernel/config_policies.test.ts — محمّلُ السياسات الحاكمة (المرحلة 40، البند T-137)
 * المالك: القيّم على المستودع
 * المدخلات: `config/policies.yaml` الحقيقيّ + نسخٌ معطوبةٌ في tmpdir + `DEFAULT_POLICY` قراءةً
 * المخرجات: تأكيدُ أنّ الإعلانَ يُقرأ ويُنفَذ، وأنّ كلَّ مخالفةٍ تُرفض برمزها المسمّى
 * التبعيات: `node:test` · `node:fs` · `node:os` — ولا شبكةَ ولا حالةَ مشتركة
 * الصلاحيات (RULE-004): يقرأ المستودعَ ولا يكتب فيه حرفًا؛ كلُّ عبثٍ في tmpdir
 * السجلات: لا شيء
 * حالات الفشل المُغطّاة: غيابُ الخريطة · مفتاحٌ مجهول · مفتاحٌ ناقص · سياسةٌ حاكمةٌ تُطفأ
 *   · نفاذٌ خارجيٌّ مفتوحٌ بالإعلان · عمرُ أمرٍ خارجَ الحدَّين (صفرٌ وفوق الأقصى بواحد)
 *   · **انحرافُ الإعلانِ عن ثابتِ البوابة** (الاختبارُ الذي يقوم مقامَ الربطِ المؤجَّل)
 * اختبار القبول: هذا الملف نفسه — `npm test`
 * الوثيقة المرتبطة: docs/test-reports/W-2026-002-declaration-readers.md · docs/decisions/ADR-0042-declaration-readers.md
 *
 * ثوابت هذا الملف:
 *
 * 1) **حاجزُ الانحراف يقوم مقامَ ربطٍ لم يُملَك**: الربطُ الكاملُ يقتضي تعديلَ
 *    `src/composition/sovereignty.ts` (حيث تُبنى بوابةُ التاج) وهو **محجوزٌ لبندٍ آخر**
 *    (W-2026-003) فلا يُلمس من هنا. فبدلًا من ربطٍ صامتٍ أو دَينٍ بلا حاجز: يُقارَن ثابتُ
 *    `DEFAULT_POLICY` بالإعلان قيمةً بقيمة — فمن غيّر أحدَهما دون الآخر سقط عليه اختبار
 *    باسمه. والدَّينُ باقٍ **معلنًا** لا مستورًا.
 *
 * 2) **يُقرأ ولا يُعدَّل**: يُستورد `DEFAULT_POLICY` قراءةً؛ ولا سطرَ يُكتب في
 *    `src/crown/crown_gateway.ts` — فالسياسةُ لا تُغيَّر من داخل الوحدة التي تحكمها (RULE-005).
 *
 * 3) **العبثُ في نسخةٍ لا في الأصل**: كلُّ حالةٍ سلبيّةٍ تكتب مجلدَ إعلانٍ مؤقّتًا وتحذفه —
 *    فnode يشغّل الاختباراتَ بالتوازي، ومن عبث بملفٍّ حقيقيٍّ أسقط بوابةَ غيره بالاحتمال.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadPolicies,
  POLICIES_KNOWN_KEYS,
  POLICIES_MUST_HOLD,
  POLICY_COMMAND_AGE_BOUNDS,
  resolveConfigDir,
} from '../../src/kernel/config';
import { DEFAULT_POLICY } from '../../src/crown/crown_gateway';

const REAL = resolveConfigDir();

/** الإعلانُ الصحيحُ كما هو في المستودع — أساسٌ تُشتقّ منه الحالاتُ السلبيّة */
const SOUND: Record<string, string> = {
  audit_every_decision: 'true',
  fail_closed_on_missing_identity: 'true',
  fail_closed_on_missing_policy: 'true',
  require_signed_commands: 'true',
  replay_protection: 'true',
  max_command_age_seconds: '120',
  external_egress_default: '"deny"',
  kill_switch_reachable_always: 'true',
};

/** يكتب `policies.yaml` في مجلدٍ مؤقّتٍ ويُعيد رمزَ الرفض أو `NO_THROW` (الثابت 3) */
function codeOf(mutate: (keys: Record<string, string>) => Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'sool-policies-'));
  try {
    const keys = mutate({ ...SOUND });
    const body = ['policies:', ...Object.entries(keys).map(([k, v]) => `  ${k}: ${v}`), ''].join('\n');
    writeFileSync(join(dir, 'policies.yaml'), body, 'utf8');
    loadPolicies(dir);
    return 'NO_THROW';
  } catch (error) {
    return (error as { code?: string }).code ?? 'NO_CODE';
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('T-137: الإعلانُ الحقيقيُّ يُقرأ ويُنفَذ — وثمانيةُ مفاتيحَ لا تاسعَ لها', () => {
  const config = loadPolicies(REAL);
  assert.equal(POLICIES_KNOWN_KEYS.length, 8);
  assert.equal(Object.keys(config.policies).length, POLICIES_KNOWN_KEYS.length);
  for (const [key] of POLICIES_MUST_HOLD) {
    assert.equal((config.policies as unknown as Record<string, unknown>)[key], true, key);
  }
  assert.equal(config.policies.external_egress_default, 'deny');
  assert.equal(config.policies.max_command_age_seconds, 120);
});

test('T-137: الأساسُ المصطنعُ يمرّ — فحاجزٌ لا يُعرف له بابٌ يُفتح جدار', () => {
  assert.equal(codeOf((k) => k), 'NO_THROW');
});

test('T-137: خريطةُ السياسات الغائبةُ رفضٌ مغلق — غيابُ السياسة ليس إذنًا', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sool-policies-empty-'));
  try {
    writeFileSync(join(dir, 'policies.yaml'), 'other: 1\n', 'utf8');
    assert.throws(() => loadPolicies(dir), (e) => (e as { code?: string }).code === 'CONFIG_NO_POLICIES');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('T-137: مفتاحٌ زائدٌ بلا قارئٍ يُرفض — وهي علّةُ البند نفسِها في صورةٍ أصغر', () => {
  assert.equal(codeOf((k) => ({ ...k, invented_policy: 'true' })), 'CONFIG_POLICY_UNKNOWN_KEY');
});

test('T-137: كلُّ مفتاحٍ محكومٍ يُرفض غيابُه بعينه — لا افتراضَ لقيمةٍ لم تُعلن', () => {
  for (const key of POLICIES_KNOWN_KEYS) {
    assert.equal(
      codeOf((k) => { delete k[key]; return k; }),
      'CONFIG_POLICY_MISSING_KEY',
      `مفتاحٌ مرَّ غيابُه: ${key}`,
    );
  }
});

test('T-137: كلُّ سياسةٍ حاكمةٍ تُرفض إن أُطفئت بالإعلان — ستٌّ لا واحدة', () => {
  assert.equal(POLICIES_MUST_HOLD.length, 6);
  for (const [key, why] of POLICIES_MUST_HOLD) {
    assert.equal(
      codeOf((k) => ({ ...k, [key]: 'false' })),
      'CONFIG_POLICY_MUST_HOLD',
      `سياسةٌ أُطفئت ومرَّت: ${key}`,
    );
    assert.notEqual(why.trim(), '', `سببُ الرفض غيرُ منطوق: ${key}`);
  }
});

test('T-137: فتحُ النفاذ الخارجيّ بالإعلان يُرفض — الأصلُ المنع', () => {
  assert.equal(codeOf((k) => ({ ...k, external_egress_default: '"allow"' })), 'CONFIG_POLICY_EGRESS_DEFAULT');
});

test('T-137: عمرُ الأمر يُقبل عند الحدَّين ويُرفض خارجَهما بواحد', () => {
  const { min, max } = POLICY_COMMAND_AGE_BOUNDS;
  assert.equal(codeOf((k) => ({ ...k, max_command_age_seconds: String(min) })), 'NO_THROW');
  assert.equal(codeOf((k) => ({ ...k, max_command_age_seconds: String(max) })), 'NO_THROW');
  assert.equal(codeOf((k) => ({ ...k, max_command_age_seconds: String(min - 1) })), 'CONFIG_POLICY_COMMAND_AGE');
  assert.equal(codeOf((k) => ({ ...k, max_command_age_seconds: String(max + 1) })), 'CONFIG_POLICY_COMMAND_AGE');
});

test('T-137: لا انحرافَ بين إعلانِ السياسات وثابتِ بوابةِ التاج (الثابت 1)', () => {
  const declared = loadPolicies(REAL).policies;
  assert.equal(
    DEFAULT_POLICY.maxCommandAgeSeconds,
    declared.max_command_age_seconds,
    'انحرافٌ: عمرُ الأمر في DEFAULT_POLICY يخالف config/policies.yaml — غيّر الإعلانَ والثابتَ معًا',
  );
  assert.equal(
    DEFAULT_POLICY.requireSignedCommands,
    declared.require_signed_commands,
    'انحرافٌ: اشتراطُ التوقيع في DEFAULT_POLICY يخالف الإعلان',
  );
  assert.equal(
    DEFAULT_POLICY.replayProtection,
    declared.replay_protection,
    'انحرافٌ: منعُ الإعادة في DEFAULT_POLICY يخالف الإعلان',
  );
});
