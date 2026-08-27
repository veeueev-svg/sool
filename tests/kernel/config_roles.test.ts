/**
 * tests/kernel/config_roles.test.ts — محمّلُ الأدوار وفصلِ الصلاحيات (المرحلة 40، البند T-137)
 * المالك: القيّم على المستودع
 * المدخلات: `config/roles.yaml` الحقيقيّ + نسخٌ معطوبةٌ في tmpdir
 * المخرجات: تأكيدُ أنّ RULE-004 صار **مُنفَذًا** لا موصوفًا في ملفٍّ لا يقرؤه أحد
 * التبعيات: `node:test` · `node:fs` · `node:os`
 * الصلاحيات (RULE-004): يقرأ المستودعَ ولا يكتب فيه؛ كلُّ عبثٍ في tmpdir
 * السجلات: لا شيء
 * حالات الفشل المُغطّاة: غيابُ الخريطة · دورٌ مجهول · دورٌ ناقص · حقٌّ غيرُ منطقيّ
 *   · اعتمادٌ وتنفيذٌ في دورٍ واحد · ملكٌ ينفّذ · لا مدقّقَ خالصًا · دورٌ بلا صلاحية
 * اختبار القبول: هذا الملف نفسه — `npm test`
 * الوثيقة المرتبطة: docs/test-reports/W-2026-002-declaration-readers.md
 *
 * ثوابت هذا الملف:
 *
 * 1) **القاعدةُ الحاكمةُ تُختبر لا تُقتبس**: RULE-004 كان نصًّا في `GOVERNING_RULE.md` وجدولًا في
 *    `config/roles.yaml` لا يقرؤه سطر. فهنا يُختبر **إنفاذُه**: دورٌ يجمع الاعتمادَ والتنفيذَ
 *    يُرفض برمزٍ باسمه. ولو مرَّ لَكانت القاعدةُ نصيحةً.
 *
 * 2) **كلُّ دورٍ يُجرَّب بعينه**: لا يكفي أن يسقط دورٌ واحد — فحلقةٌ تمرّ على الأدوار الستّة
 *    كلِّها تحذف كلَّ واحدٍ وتُفسد كلَّ حقٍّ فيه، فلا يبقى بابٌ لم يُطرَق.
 *
 * 3) **العبثُ في نسخةٍ لا في الأصل**: node يشغّل الاختباراتَ بالتوازي.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadRoles, ROLES_KNOWN_NAMES, ROLE_POWER_FIELDS, resolveConfigDir } from '../../src/kernel/config';
import type { RolePowers } from '../../src/kernel/config/roles';

const REAL = resolveConfigDir();

/** الإعلانُ الصحيحُ كما هو في المستودع — أساسٌ تُشتقّ منه الحالاتُ السلبيّة */
function sound(): Record<string, Record<string, boolean>> {
  return {
    king: { propose: true, approve: true, execute: false, audit: false },
    crown_guard: { propose: false, approve: false, execute: true, audit: false },
    minister: { propose: true, approve: false, execute: true, audit: false },
    governor: { propose: true, approve: false, execute: true, audit: false },
    auditor: { propose: false, approve: false, execute: false, audit: true },
    agent: { propose: true, approve: false, execute: true, audit: false },
  };
}

/** يكتب `roles.yaml` في مجلدٍ مؤقّتٍ ويُعيد رمزَ الرفض أو `NO_THROW` (الثابت 3) */
function codeOf(mutate: (roles: Record<string, Record<string, boolean>>) => Record<string, Record<string, unknown>>): string {
  const dir = mkdtempSync(join(tmpdir(), 'sool-roles-'));
  try {
    const roles = mutate(sound());
    const lines = ['roles:'];
    for (const [name, powers] of Object.entries(roles)) {
      lines.push(`  ${name}:`);
      for (const [field, value] of Object.entries(powers)) lines.push(`    ${field}: ${String(value)}`);
    }
    writeFileSync(join(dir, 'roles.yaml'), `${lines.join('\n')}\n`, 'utf8');
    loadRoles(dir);
    return 'NO_THROW';
  } catch (error) {
    return (error as { code?: string }).code ?? 'NO_CODE';
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('T-137: الإعلانُ الحقيقيُّ يُقرأ — ستّةُ أدوارٍ كلٌّ بحقوقه الأربعة', () => {
  const config = loadRoles(REAL);
  assert.equal(ROLES_KNOWN_NAMES.length, 6);
  assert.equal(Object.keys(config.roles).length, 6);
  for (const name of ROLES_KNOWN_NAMES) {
    const powers = config.roles[name] as RolePowers;
    for (const field of ROLE_POWER_FIELDS) assert.equal(typeof powers[field], 'boolean', `${name}.${field}`);
    assert.ok(!(powers.approve && powers.execute), `دورٌ يجمع الاعتمادَ والتنفيذ: ${name}`);
  }
  assert.equal(config.roles['king']?.execute, false);
  assert.equal(config.roles['auditor']?.audit, true);
  assert.equal(config.roles['auditor']?.execute, false);
});

test('T-137: الأساسُ المصطنعُ يمرّ — فبوابةٌ لا بابَ لها جدار', () => {
  assert.equal(codeOf((r) => r), 'NO_THROW');
});

test('T-137: خريطةُ الأدوار الغائبةُ رفضٌ مغلق', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sool-roles-empty-'));
  try {
    writeFileSync(join(dir, 'roles.yaml'), 'other: 1\n', 'utf8');
    assert.throws(() => loadRoles(dir), (e) => (e as { code?: string }).code === 'CONFIG_NO_ROLES');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('T-137: دورٌ مجهولٌ يُرفض — واسمٌ بلا سلطةٍ إعلانٌ لا يُنفَذ', () => {
  assert.equal(
    codeOf((r) => ({ ...r, shadow_king: { propose: true, approve: false, execute: false, audit: false } })),
    'CONFIG_ROLE_UNKNOWN',
  );
});

test('T-137: كلُّ دورٍ محكومٍ يُرفض غيابُه بعينه (الثابت 2)', () => {
  for (const name of ROLES_KNOWN_NAMES) {
    assert.equal(codeOf((r) => { delete r[name]; return r; }), 'CONFIG_ROLE_MISSING', `دورٌ مرَّ غيابُه: ${name}`);
  }
});

test('T-137: كلُّ حقٍّ في كلِّ دورٍ يُرفض غيابُه أو كونُه غيرَ منطقيّ (الثابت 2)', () => {
  for (const name of ROLES_KNOWN_NAMES) {
    for (const field of ROLE_POWER_FIELDS) {
      assert.equal(
        codeOf((r) => { delete r[name]![field]; return r; }),
        'CONFIG_ROLE_FIELD',
        `حقٌّ مرَّ غيابُه: ${name}.${field}`,
      );
      assert.equal(
        codeOf((r) => ({ ...r, [name]: { ...r[name]!, [field]: 'yes' } })),
        'CONFIG_ROLE_FIELD',
        `حقٌّ غيرُ منطقيٍّ مرَّ: ${name}.${field}`,
      );
    }
  }
});

test('T-137: من اعتمد لا ينفّذ — RULE-004 مُنفَذٌ لا موصوف (الثابت 1)', () => {
  assert.equal(
    codeOf((r) => ({ ...r, king: { ...r['king']!, approve: true, execute: true } })),
    'CONFIG_ROLE_SEPARATION',
  );
  // ولا يهرب بأن يُعطى الوزيرُ اعتمادًا مع تنفيذه القائم
  assert.equal(
    codeOf((r) => ({ ...r, minister: { ...r['minister']!, approve: true } })),
    'CONFIG_ROLE_SEPARATION',
  );
});

test('T-137: الملكُ لا ينفّذ — ولو رُفع عنه الاعتماد', () => {
  assert.equal(
    codeOf((r) => ({ ...r, king: { propose: true, approve: false, execute: true, audit: false } })),
    'CONFIG_ROLE_KING_EXECUTES',
  );
});

test('T-137: لا بدَّ من مدقّقٍ لا يفعل غيرَ التدقيق', () => {
  assert.equal(
    codeOf((r) => ({ ...r, auditor: { ...r['auditor']!, propose: true } })),
    'CONFIG_ROLE_NO_AUDITOR',
  );
});

test('T-137: دورٌ بأربعةِ false ليس دورًا — سطرٌ يُقرأ ولا يعني شيئًا', () => {
  assert.equal(
    codeOf((r) => ({ ...r, agent: { propose: false, approve: false, execute: false, audit: false } })),
    'CONFIG_ROLE_IDLE',
  );
});
