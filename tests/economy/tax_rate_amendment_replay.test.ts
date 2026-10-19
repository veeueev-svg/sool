/**
 * tests/economy/tax_rate_amendment_replay.test.ts — اعتمادُ البوابةِ مربوطٌ بحمولةِ الأمر (T-53 · W-2026-065)
 * الجولة 46 (الجلسة 144 · علاج عيب grok RATE_AMENDMENT_IDEMPOTENT_APPROVAL_NOT_PAYLOAD_BOUND): بوابةُ التاجِ
 * تعيدُ القرارَ السابقَ لأيِّ حمولةٍ تحملُ commandId سبقَ اعتمادُه قبلَ فحصِ التوقيع — فلا يُعدَّلُ ولا يُعفى
 * بقرارٍ لحمولةٍ أخرى، ولا يُعفي أمرُ إعفاءٍ نُفّذَ مرّةً ثانيةً.
 * ملفٌّ جديدٌ معلنٌ لسقفِ الوحدةِ 400 سطرًا (سابقةُ الجلستين 133 و138 · توسيعُ نطاقٍ معلنٌ في §2 من عقدِ البند).
 * المالك: وزارة المالية تحت التاج | يوثّق في: docs/test-reports/phase-40-W-2026-065.md
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { REVENUE_TARGET, bootstrapState } from '../../src/index';
import type { SignedRoyalCommand } from '../../src/kernel/types';

const NOW = Date.now();

/** يوميّةٌ حقيقيةٌ بمجلدِ حالةٍ — عينُ عدةِ المشهدِ في tax_rate_amendment_alias.test.ts */
function journalScene() {
  const root = mkdtempSync(join(tmpdir(), 'sool-rate-replay-46-'));
  const config = join(root, 'config');
  const state = join(root, 'state');
  cpSync(join(process.cwd(), 'config'), config, { recursive: true });
  writeFileSync(join(config, 'recovery.yaml'), [
    'policy:', '  rto_seconds: 30', '  rpo_seconds: 60', '  backup_interval_seconds: 30',
    '  retention_count: 3', '  verify_after_restore: true',
    `  backup_directory: "${join(root, 'backups')}"`, '  continuity_mode: limited', '',
  ].join('\n'), 'utf8');
  return {
    boot: (now = NOW) => bootstrapState({ configDir: config, now, persistenceDir: state }),
    clean: () => rmSync(root, { recursive: true, force: true }),
  };
}

/** حمولةٌ جديدةٌ بتوقيعٍ مزوّرٍ تستعيرُ معرّفَ أمرٍ معتمدٍ لفعلٍ آخر — مسبارُ grok بحرفه */
function forgeWithId(other: SignedRoyalCommand, params: Record<string, unknown>): SignedRoyalCommand {
  return {
    ...other,
    signature: 'not-a-signature',
    payload: { ...other.payload, action: 'amend_policy', target: REVENUE_TARGET, nonce: 'forged-nonce-not-signed', params },
  } as SignedRoyalCommand;
}

test('**T-53/مجلس 46أ** — RATE_AMENDMENT_IDEMPOTENT_APPROVAL_NOT_PAYLOAD_BOUND (grok · الجولة 46): معرّفُ declare_emergency المعتمدُ لا يمرّرُ amend_policy بتوقيعٍ مزوّر — النسبةُ 25 لا 80 ولا شاهدَ rate_amended والإقلاعُ يشهد، والأمرُ الموقَّعُ السليمُ ينجح (علاجُ الجلسة 144)', () => {
  const sc = journalScene();
  try {
    const at = NOW + 1_000;
    const s = sc.boot();
    const other = s.king.issueCommand('declare_emergency', 'crown:halt', { reason: 'probe' }, at);
    assert.equal(s.gateway.authorize(other, at).allowed, true, 'الأمرُ الآخرُ معتمدٌ — بذرةُ المسبار');
    const forged = forgeWithId(other, { kind: 'economy', base: 'compute_usage', ratePerMille: 80 });
    const refused = s.revenue.amendRate(forged, 'compute_usage', 80, at);
    assert.equal(refused.ok, false, 'القرارُ المعادُ لحمولةٍ أخرى ليس اعتمادًا لهذا التعديل');
    assert.match(refused.ok ? '' : refused.reason, /اعتمادُ البوابةِ لا يطابقُ حمولةَ هذا الأمر/);
    assert.equal(s.revenue.rateFor('compute_usage')?.ratePerMille, 25, 'النسبةُ باقيةٌ 25');
    assert.equal(s.audit.find('rate_amended').length, 0, 'لا شاهدَ تعديل');
    assert.equal(s.audit.find('command_approved').length, 1, 'قيدُ الاعتمادِ الوحيدُ قيدُ declare_emergency');
    // والصورةُ الأدقّ: معرّفُ amend_policy معتمدٍ على 40 بالفعلِ والهدفِ نفسَيهما لا يمرّرُ params مزوّرةً على 80
    const signed40 = s.king.issueCommand('amend_policy', REVENUE_TARGET,
      { kind: 'economy', base: 'compute_usage', ratePerMille: 40 }, at + 10);
    assert.equal(s.gateway.authorize(signed40, at + 10).allowed, true, 'أمرُ 40 معتمدٌ مباشرةً من البوابة');
    const forged80 = { ...signed40, signature: 'not-a-signature',
      payload: { ...signed40.payload, nonce: 'forged-80', params: { kind: 'economy', base: 'compute_usage', ratePerMille: 80 } } };
    const r80 = s.revenue.amendRate(forged80 as SignedRoyalCommand, 'compute_usage', 80, at + 10);
    assert.equal(r80.ok, false, 'params المعتمدةُ 40 لا تمرّرُ 80');
    assert.match(r80.ok ? '' : r80.reason, /اعتمادُ البوابةِ لا يطابقُ حمولةَ هذا الأمر/);
    assert.equal(s.revenue.rateFor('compute_usage')?.ratePerMille, 25, 'والنسبةُ باقيةٌ 25');
    // وparams مطابقةٌ بحروفِها لا تكفي: الفعلُ والهدفُ المعتمدانِ declare_emergency/crown:halt لا amend_policy/الإيراد
    const p80 = { kind: 'economy', base: 'compute_usage', ratePerMille: 80 };
    const halt80 = s.king.issueCommand('declare_emergency', 'crown:halt', p80, at + 20);
    assert.equal(s.gateway.authorize(halt80, at + 20).allowed, true, 'declare_emergency بـ params التعديلِ معتمد');
    const rHalt = s.revenue.amendRate(forgeWithId(halt80, p80), 'compute_usage', 80, at + 20);
    assert.equal(rHalt.ok, false, 'الفعلُ والهدفُ المعتمدانِ غيرُ المطلوبَين — مرفوض');
    assert.equal(s.revenue.rateFor('compute_usage')?.ratePerMille, 25, 'والنسبةُ باقيةٌ 25');
    assert.equal(s.audit.verifyIntegrity().valid, true, 'السلسلةُ سليمة');
    // الإقلاعُ من اليوميّةِ الحقيقيةِ يشهدُ أنّ لا تعديلَ دائمًا
    const second = sc.boot(at + 60_000);
    assert.equal(second.revenue.rateFor('compute_usage')?.ratePerMille, 25, 'بعدَ الإقلاعِ 25');
    assert.equal(second.audit.find('rate_amended').length, 0, 'ولا شاهدَ تعديلٍ مستعاد');
    assert.equal(second.audit.verifyIntegrity().valid, true, 'والسلسلةُ سليمةٌ بعدَ الإقلاع');
    // الطريقُ القويمُ مفتوح: أمرٌ موقَّعٌ جديدٌ على التعديلِ بعينِه ينجح
    const good = second.king.issueCommand('amend_policy', REVENUE_TARGET,
      { kind: 'economy', base: 'compute_usage', ratePerMille: 40 }, at + 61_000);
    const ok = second.revenue.amendRate(good, 'compute_usage', 40, at + 61_000);
    assert.equal(ok.ok, true, 'الأمرُ الموقَّعُ السليمُ ينجح');
    assert.equal(second.revenue.rateFor('compute_usage')?.ratePerMille, 40, 'والنسبةُ 40');
  } finally {
    sc.clean();
  }
});

test('**T-53/مجلس 46ب** — الجنسُ نفسُه في waive: المعرّفُ المستعارُ لا يُعفي بتوقيعٍ مزوّر، وأمرُ الإعفاءِ المعتمدُ لا يُعفي تقديرًا ثانيًا (علاجُ الجلسة 144)', () => {
  const s = bootstrapState({ now: NOW });
  const at = NOW + 1_000;
  const other = s.king.issueCommand('create_agent', 'agent:probe', { kind: 'probe' }, at);
  assert.equal(s.gateway.authorize(other, at).allowed, true, 'بذرةُ المسبار معتمدة');
  const a = s.revenue.assess('compute_usage', 'external:compute-provider', 1_000_000, at, at);
  const b = s.revenue.assess('compute_usage', 'external:compute-provider', 2_000_000, at, at);
  assert.equal(a.ok && b.ok, true, 'تقديرانِ للمسبار');
  const idA = a.ok ? a.levy.levyId : '';
  const idB = b.ok ? b.levy.levyId : '';
  const forged = s.revenue.waive(forgeWithId(other, { kind: 'economy' }), idA, 'إعفاء مزور', at);
  assert.equal(forged.ok, false, 'المعرّفُ المستعارُ لا يُعفي');
  assert.match(forged.ok ? '' : forged.reason, /اعتمادُ البوابةِ لا يطابقُ حمولةَ هذا الأمر/);
  assert.equal(s.revenue.get(idA)?.status, 'assessed', 'التقديرُ باقٍ مستحقًّا');
  assert.equal(s.audit.find('levy_waived').length, 0, 'لا شاهدَ إعفاء');
  // أمرُ إعفاءٍ موقَّعٌ سليمٌ يُعفي مرّةً واحدة — وإعادتُه على تقديرٍ آخرَ مرفوضةٌ مسمّاة
  const cmd = s.king.issueCommand('amend_policy', REVENUE_TARGET, { kind: 'economy' }, at + 10);
  const first = s.revenue.waive(cmd, idA, 'إعفاء معلن', at + 10);
  assert.equal(first.ok, true, 'الإعفاءُ الموقَّعُ السليمُ ينجح');
  const again = s.revenue.waive(cmd, idB, 'إعفاء معاد', at + 20);
  assert.equal(again.ok, false, 'أمرُ الإعفاءِ المنفَّذُ لا يُعفي ثانيةً');
  assert.match(again.ok ? '' : again.reason, /نُفّذ سابقًا/);
  assert.equal(s.revenue.get(idB)?.status, 'assessed', 'التقديرُ الثاني باقٍ مستحقًّا');
  assert.equal(s.audit.find('levy_waived').length, 1, 'شاهدُ إعفاءٍ واحد');
  assert.equal(s.audit.verifyIntegrity().valid, true, 'السلسلةُ سليمة');
});
