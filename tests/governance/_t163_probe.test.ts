import { test } from 'node:test';
import assert from 'node:assert/strict';
// T-163 probe: فشلٌ متعمَّدٌ لإثباتِ أنّ ملخّصَ التشغيلِ يلتقطُ الأحكامَ الساقطة. ملفٌّ مؤقّتٌ يُحذفُ بعدَ الإثبات.
test('T-163 probe: deliberate failure to verify CI step summary captures failing tests', () => {
  assert.equal(1, 2, 'فشلٌ متعمَّدٌ — يُنتظرُ أن يظهرَ هذا السطرُ في ملخّصِ التشغيلِ (T-163)');
});
