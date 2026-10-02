/**
 * tests/kernel/lease_call_sites.test.ts — كلُّ موضعِ تأجيرٍ يُصرّح بمدةِ عملِه (T-161 · W-2026-046)
 * المالك: وزارة البنية | يوثّق في: docs/test-reports/phase-40-W-2026-046.md
 * يثبت: (1) حصرًا لكلِّ نداءِ `.lease(` في `src/` خارجَ السجلِّ نفسِه: لا نداءَ بلا وسيطِ مدة —
 *        فموضعٌ جديدٌ بلا مدةٍ يسقط هنا لا يحجز ساعةً صامتًا. (2) سلوكًا: تمرينُ الحصصِ يمنح
 *        ثانيةً واحدةً لا السقف (3600). ولا يثبت: أنّ مددَ الأعمالِ غيرِ المتزامنةِ صحيحة — لا منها اليوم.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { SYNC_CALL_LEASE_SECONDS } from '../../src/kernel/resource_registry';
import { loadHarness } from '../load/helpers';

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
  });
}

/** وسائطُ النداءِ على المستوى الأعلى: عدُّ الفواصلِ خارجَ الأقواسِ والنصوص */
function argCount(text: string, open: number): number {
  let depth = 0; let commas = 0; let quote = '';
  for (let i = open; i < text.length; i += 1) {
    const c = text[i]!;
    if (quote) { if (c === quote && text[i - 1] !== '\\') quote = ''; continue; }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
    if ('([{'.includes(c)) depth += 1;
    else if (')]}'.includes(c)) { depth -= 1; if (depth === 0) return commas + 1; }
    else if (c === ',' && depth === 1) commas += 1;
  }
  return -1;
}

test('T-161: لا نداءَ تأجيرٍ في src/ بلا مدةِ عملٍ مُصرَّحة (خمسةُ وسائط)', () => {
  const sites: string[] = [];
  const bare: string[] = [];
  for (const file of walk('src')) {
    if (file.endsWith('resource_registry.ts')) continue;
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/resources!?\.lease\(/g)) {
      const at = m.index! + m[0].length - 1;
      const line = text.slice(0, at).split('\n').length;
      sites.push(`${file}:${line}`);
      if (argCount(text, at) < 5) bare.push(`${file}:${line}`);
    }
  }
  assert.equal(sites.length >= 4, true, `حصرٌ أعمى: ${sites.join(' · ')}`);
  assert.deepEqual(bare, [], 'موضعُ تأجيرٍ بلا مدةٍ يحجز السقفَ اسمًا (T-161)');
});

test('T-161: تمرينُ الحصصِ يمنح ثانيةً لا السقف — والاستعادةُ في النداءِ نفسِه', () => {
  const h = loadHarness();
  const before = h.s.audit.find('resource_leased').length;
  const out = h.drill.pressureQuota(h.authority);
  assert.equal(out.ok, true);
  const leased = h.s.audit.find('resource_leased').slice(before);
  assert.equal(leased.length > 0, true);
  for (const e of leased) assert.equal(e.detail.grantedSeconds, SYNC_CALL_LEASE_SECONDS);
  assert.equal(SYNC_CALL_LEASE_SECONDS, 1);
});
