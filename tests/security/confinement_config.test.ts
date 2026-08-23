/**
 * tests/security/confinement_config.test.ts — رفضُ سياسةِ حصرٍ ناقصة (المرحلة 39، T-16)
 * المالك: ديوان التدقيق
 * المدخلات: مجلدُ تهيئةٍ مؤقّت يُنسخ من `config/` ثم يُشوَّه بندًا بندًا
 * المخرجات: رمزُ رفضٍ لكل تشويه | التبعيات: loadConfinement + resolveConfigDir
 * الصلاحيات: القياسُ وحده. لا يُعدّل هذا الملف `config/confinement.yaml` الحقيقي
 * السجلات: لا شيء | حالات الفشل: كلها مغلقة — سياسةٌ مشوّهة تُسقط التحميل لا تُصحَّح
 * اختبار القبول: هذا الملف نفسه
 * الوثيقة المرتبطة: docs/decisions/ADR-0026-kernel-confinement.md
 * ثابتُ هذا الملف: **الشرطُ المُلزم لا يُعطَّل من التهيئة.** لو مرّ `false` لَصارت
 * السياسةُ بابًا لتخفيف الحصر بلا مراجعة — وهو ما تمنعه RULE-005 وRULE-007.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { loadConfinement } from '../../src/index';

const REPO_CONFIG = resolve(__dirname, '../../../config');

/** ينسخ التهيئة الحقيقية ثم يُبدّل سطرًا واحدًا فيها — تشويهٌ واحدٌ لكل قياس */
function withPatchedConfig(from: string, to: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'sool-conf-'));
  cpSync(REPO_CONFIG, join(dir, 'config'), { recursive: true });
  const file = join(dir, 'config/confinement.yaml');
  const text = readFileSync(file, 'utf8');
  assert.ok(text.includes(from), `النصُّ المستهدَف غير موجود: ${from}`);
  writeFileSync(file, text.replace(from, to), 'utf8');
  return join(dir, 'config');
}

function rejects(configDir: string, code: string): void {
  try {
    assert.throws(() => loadConfinement(configDir), (error: Error & { code?: string }) => {
      assert.equal(error.code, code);
      return true;
    });
  } finally { rmSync(dirname(configDir), { recursive: true, force: true }); }
}

test('لا ملفَ سياسةٍ أصلًا: التحميلُ يسقط برمزه ولا يفترض حصرًا', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sool-conf-'));
  try {
    cpSync(REPO_CONFIG, join(dir, 'config'), { recursive: true });
    rmSync(join(dir, 'config/confinement.yaml'));
    assert.throws(
      () => loadConfinement(join(dir, 'config')),
      (error: Error & { code?: string }) => {
        assert.equal(error.code, 'CONFIG_NO_CONFINEMENT_POLICY');
        return true;
      },
    );
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('الافتراضُ ليس رفضًا: «allow» يُسقط التحميل (RULE-007)', () => {
  rejects(withPatchedConfig('default: "deny"', 'default: "allow"'), 'CONFIG_CONFINEMENT_DEFAULT_ALLOW');
});

test('شرطٌ مُلزم مُعطَّل: `false` لا يُقبل مهما كان البند', () => {
  rejects(withPatchedConfig('seccomp_filter: true', 'seccomp_filter: false'), 'CONFIG_CONFINEMENT_REQUIREMENT');
});

test('شرطٌ مُلزم محذوف: الغيابُ كالتعطيل — لا يُستنتج صحيحًا', () => {
  rejects(withPatchedConfig('read_only_root: true', 'read_only_root_typo: true'), 'CONFIG_CONFINEMENT_REQUIREMENT');
});

test('جذرُ الشاهد ليس مسارًا مطلقًا: يُرفض لأن الجذرَ النسبيَّ يتبع مكانَ التشغيل', () => {
  rejects(withPatchedConfig('witness_root: "/proc"', 'witness_root: "proc"'), 'CONFIG_CONFINEMENT_WITNESS');
});

test('منفذٌ بنيويٌّ خارج المدى: يُرفض ولا يُقصَر إلى حدٍّ صامت', () => {
  rejects(withPatchedConfig('port: 53', 'port: 70000'), 'CONFIG_CONFINEMENT_PORT');
});

test('وجهةُ التوليد ناقصة: بنيةٌ بلا مكانٍ معلن لا تُولَّد', () => {
  rejects(withPatchedConfig('directory: "infra/network-policy"', 'directory: ""'), 'CONFIG_CONFINEMENT_GENERATED');
});

test('شدّةُ الإنتاج ليست «حرجة»: تخفيفُ الشدّة من التهيئة مرفوض', () => {
  rejects(withPatchedConfig('production_severity: "critical"', 'production_severity: "high"'), 'CONFIG_CONFINEMENT_SEVERITY');
});
