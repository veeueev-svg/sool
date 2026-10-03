/**
 * tests/external/risk_interactions_and_region_cap.test.ts — تفاعلُ عوامل المخاطر · سقفُ نطاقات الإقليم (T-63 · T-42 · W-2026-055)
 * المالك: ديوان التدقيق + مجلس الأقاليم | يوثّق في: docs/test-reports/phase-40-W-2026-055.md
 * يثبت: (1) زوجٌ معلنٌ مجتمعٌ يُضاف عليه فوق الجمع الخطّي فلا يُسوّى بمثلَيه، ويُقيَّد ما طُبِّق؛
 *       والإعلانُ الفاسد (عاملٌ غير معلن، زوجٌ مكرَّرٌ بترتيبين، إضافةٌ غير موجبة) فشلٌ مغلق؛
 *       (2) تفويضُ إقليمٍ فوق `max_delegated_domains_per_region` أو بنطاقٍ مكرَّرٍ مرفوضٌ باسمه،
 *       والسقفُ غيرُ المعلن أو الخارجُ عن حدّه يُسقط التحميل.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bootstrapState, ROYAL_COURT } from '../../src/index';
import { loadContracts, loadRegions, resolveConfigDir } from '../../src/kernel/config';

const T0 = Date.now();
const AUDITOR = 'authority:audit_bureau';
const KIND = 'contract:compute-capacity';

function withEdited(file: string, edit: (yaml: string) => string, fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 't63-'));
  try {
    cpSync(resolveConfigDir(), dir, { recursive: true });
    const path = join(dir, file);
    writeFileSync(path, edit(readFileSync(path, 'utf8')));
    fn(dir);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
const codeOf = (fn: () => unknown): string => {
  try { fn(); return 'NO_THROW'; } catch (e) { return (e as { code?: string }).code ?? 'UNKNOWN'; }
};

test('T-63: الزوجُ الخطِر يُضاف عليه فوق مجموعه — ويُقيَّد التفاعلُ المطبَّق', () => {
  const s = bootstrapState({ now: T0 });
  const assess = (factors: string[]) => {
    const r = s.partnerRisk.assess({ kindId: KIND, factors, assessedBy: AUDITOR, justification: 'تقديرٌ معلن' }, T0);
    assert.equal(r.ok, true);
    return r.ok ? r.assessment.score : -1;
  };
  const base = assess([]);
  const model = assess(['model_access']) - base;
  const exit = assess(['no_exit_clause']) - base;
  const both = assess(['model_access', 'no_exit_clause']) - base;
  assert.equal(both, model + exit + 25, 'الزوجُ أخطرُ من مجموعه بإضافته المعلنة');
  const linear = assess(['single_source', 'no_exit_clause']) - base;
  assert.equal(linear, 15 + exit, 'زوجٌ غيرُ معلنٍ تفاعلًا يبقى جمعًا');
  const last = s.audit.find('partner_risk_assessed').at(-2)?.detail as { interactions: string[] };
  assert.deepEqual(last.interactions, ['model_access+no_exit_clause']);
});

test('T-63: إعلانُ التفاعل الفاسد فشلٌ مغلق برمزه', () => {
  const cases: [string, string][] = [
    ['model_access+telepathy: 10', 'عاملٌ غير معلن'],
    ['no_exit_clause+model_access: 10', 'الزوجُ نفسُه بترتيبٍ آخر'],
    ['single_source+single_source: 10', 'عاملٌ مع نفسه'],
    ['single_source+data_egress: 0', 'إضافةٌ غير موجبة'],
  ];
  for (const [line, why] of cases) {
    withEdited('contracts.yaml', (y) => y.replace('risk_interactions:\n', `risk_interactions:\n  ${line}\n`), (dir) => {
      assert.equal(codeOf(() => loadContracts(dir)), 'CONFIG_CONTRACT_RISK_INTERACTION', why);
    });
  }
  assert.equal(codeOf(() => loadContracts()), 'NO_THROW', 'الإعلانُ الحقيقيُّ سليم');
});

test('T-42: تفويضُ إقليمٍ فوق السقف المعلن أو بنطاقٍ مكرَّر مرفوض — وعند السقف يقع', () => {
  const s = bootstrapState({ now: T0 });
  const cap = loadRegions().max_delegated_domains_per_region;
  const cmd = (target: string) => s.king.issueCommand('amend_policy', target, { kind: 'federation' }, T0);
  assert.equal(s.regions.establish(cmd('region:research'), { regionId: 'region:research', name: 'إقليم البحث', proposedBy: ROYAL_COURT }, T0).ok, true);
  const domains = Array.from({ length: cap + 1 }, (_, i) => `research_${i}`);
  const over = s.regions.delegate(cmd('region:research'), 'region:research', domains, T0);
  assert.equal(over.ok, false);
  if (!over.ok) assert.match(over.reason, /فوق السقف المعلن/);
  const dup = s.regions.delegate(cmd('region:research'), 'region:research', ['research_0', 'research_0'], T0);
  assert.equal(dup.ok, false);
  assert.equal(s.regions.delegate(cmd('region:research'), 'region:research', domains.slice(0, cap), T0).ok, true);
});

test('T-42: السقفُ غيرُ المعلن أو الخارجُ عن [1, 16] يُسقط التحميل', () => {
  for (const value of ['0', '17', '"كثير"']) {
    withEdited('regions.yaml', (y) => y.replace(/max_delegated_domains_per_region: \d+/, `max_delegated_domains_per_region: ${value}`), (dir) => {
      assert.equal(codeOf(() => loadRegions(dir)), 'CONFIG_REGION_DOMAIN_CAP', value);
    });
  }
  withEdited('regions.yaml', (y) => y.replace(/max_delegated_domains_per_region: \d+\n?/, ''), (dir) => {
    assert.equal(codeOf(() => loadRegions(dir)), 'CONFIG_REGION_DOMAIN_CAP', 'غيابُ السقف ليس إذنًا');
  });
});
