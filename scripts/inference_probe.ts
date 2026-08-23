/**
 * scripts/inference_probe.ts — مسبارُ منعِ التشغيل والشهادة والحمل (المرحلة 39، T-21)
 * المالك: وزارة البحث | البند: T-21 — إكمالُ C-13
 * المدخلات: `config/inference.yaml` + دولةٌ حقيقيّةٌ مُقلعة (لا محاكاة)
 * المخرجات: قياسٌ خامٌ إلى `docs/audit/measurements/phase-39-T21.txt` وإلى الشاشة
 * التبعيات: `src/index` وحده — لا شبكةَ ولا أدواتَ خارجيّة
 * الصلاحيات: القياسُ وحده. لا يُصلح المسبارُ شرطًا ولا يُعلن استيفاءَ معيار
 * السجلات: الملفُّ نفسه هو السجل (RULE-006) | حالات الفشل: تُدوَّن ولا تُخفى
 * اختبار القبول: tests/models/inference.test.ts · tests/models/safety_attestation.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0028-inference-gate.md · docs/audit/criteria/C-13.md
 *
 * ثوابتُ هذا المسبار:
 *   1) **يقيس منعَ التشغيل لا الحجرَ وحده.** حكمُ التدقيق في C-13 كان أنّ المقيسَ
 *      حجرٌ لا منعُ تشغيل؛ فهنا يُطلب التشغيلُ فعلًا في كل حالةٍ ويُقاس ما وقع.
 *   2) **المُجيبُ مرجعيٌّ لا نموذج** (`reference_responder`): وهذا يُعلن في التقرير
 *      نفسه، فلا يُقرأ الاجتيازُ على أنّ الدولة تملك نموذجًا مُدرَّبًا.
 *   3) **العتباتُ من التهيئة**: تجاوزُها إفشالٌ معلنٌ لا ملاحظةٌ في هامش.
 *   4) **لا يُعلن المسبارُ استيفاءً.** الحكمُ لديوان التدقيق (RULE-004).
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  bootstrapState, loadInference, referenceResponder, RIGOROUS_SAFETY_CASES,
} from '../src/index';
import type { ModelManifest } from '../src/index';
import { resolveConfigDir } from '../src/kernel/config';

const configDir = resolveConfigDir();
const repoRoot = dirname(configDir);
const config = loadInference(configDir);
const lines: string[] = [];
let failures = 0;

function say(text: string): void {
  lines.push(text);
  process.stdout.write(`${text}\n`);
}

function check(label: string, pass: boolean, detail: string): void {
  if (!pass) failures += 1;
  say(`${pass ? 'PASS' : 'FAIL'} | ${label} | ${detail}`);
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index] ?? 0;
}

const digest = (seed: string): string => seed.padEnd(64, '0').slice(0, 64).replace(/[^0-9a-f]/g, 'a');

function manifestOf(modelId: string, version: string): ModelManifest {
  return {
    modelId,
    version,
    source: 'https://models.internal/sool/reference',
    license: 'apache-2.0',
    shards: [{ path: 'shard-0.bin', digest: digest(`${modelId}${version}`), bytes: 1024 }],
    declaredCapabilities: ['text_generation'],
    signature: 'sig:reference',
  };
}

type State = ReturnType<typeof bootstrapState>;

/** يُسجّل ويُعتمد ويُنشّط إصدارًا — كلُّ خطوةٍ بسلطتها المعلنة */
function activateModel(s: State, modelId: string, version: string): ModelManifest {
  const manifest = manifestOf(modelId, version);
  s.models.register(manifest);
  s.models.approve(s.king.issueCommand('approve_phase', `${modelId}@${version}`), modelId, version);
  s.models.activate(modelId, version);
  return manifest;
}

async function main(): Promise<void> {
  say('# قياسُ البند T-21 — منعُ التشغيل مقيسٌ لا مُدَّعى');
  say(`# التاريخ: ${new Date().toISOString()} · Node ${process.version}`);
  say('# يُعاد توليدُه بـ: npm run probe:inference');
  say('# إعلانُ صدق: المُجيبُ المستعملُ هنا **مرجعيٌّ قاعديٌّ لا نموذجٌ مُدرَّب**؛');
  say('#            المقيسُ بوابةُ التشغيل والشهادة، لا كفاءةُ نموذج.');
  say('');

  const L = config.limits;
  const S = config.safety;
  say('## ١) الشروطُ المعلنة (من config/inference.yaml — لا من الشيفرة)');
  say(`نشاطٌ مطلوب=${L.requireActive} · بصمةٌ مطابقة=${L.requireDigestMatch} · شهادةٌ مطلوبة=${L.requireAttestation}`);
  say(`عمرُ الشهادة=${L.attestationTtlMs}ms · أقصى خرج=${L.maxOutputChars} حرفًا`
    + ` · أقصى زمن=${L.maxLatencyMs}ms · أقصى تزامن=${L.maxConcurrent}`);
  say(`جدّيّةُ السلامة: أدنى حالات=${S.minSafetyCases} · أدنى بريئة=${S.minBenignCases}`
    + ` · أبوابٌ مطلوبة=${S.requiredCategories.length} · أدنى تمايز=${S.minDistinctOutputRatio}`
    + ` · فشلٌ مسموح=${S.maxSafetyFailures}`);
  say(`عتباتُ الحمل: نداءات=${config.load.concurrentRequests}×${config.load.requestsPerWorker}`
    + ` · p99=${config.load.decisionP99Ms}ms · أقصى=${config.load.decisionMaxMs}ms`
    + ` · خرقٌ مسموح=${config.load.maxDenialBreach}`);
  say('');

  // ── ٢) المجموعةُ الجدّيّة: النصُّ المعلَّب والجدارُ الصامت يسقطان ───────────────
  say('## ٢) مجموعةُ السلامة صارت تُسقط النصَّ المعلَّب والرفضَ الشامل');
  {
    const s = bootstrapState();
    const safety = RIGOROUS_SAFETY_CASES.filter((c) => c.kind === 'safety').length;
    const benign = RIGOROUS_SAFETY_CASES.filter((c) => c.category === 'benign').length;
    check(
      'المجموعةُ تفي بحدود الجدّيّة المعلنة',
      safety >= S.minSafetyCases && benign >= S.minBenignCases,
      `حالاتُ سلامة=${safety} (الحد ${S.minSafetyCases}) · بريئة=${benign} (الحد ${S.minBenignCases})`
      + ` · إجمالي=${RIGOROUS_SAFETY_CASES.length}`,
    );

    const canned = (): string => 'لا يمكن — مرفوض. أتوقف عند الإيقاف، والسجل غير قابل للمحو.';
    let cannedCode = 'NONE';
    try { s.safetyAttestor.attest('m:canned', '1.0.0', canned, Date.now()); } catch (e) {
      cannedCode = (e as { code?: string }).code ?? 'UNKNOWN';
    }
    check(
      'نصٌّ ثابتٌ واحدٌ يتجاهل السؤال لا يُشهَد له',
      cannedCode !== 'NONE',
      `الرمز=${cannedCode} — وكان هذا النصُّ نفسُه يجتاز المجموعةَ القديمة 3/3`,
    );

    const wall = (): string => 'مرفوض.';
    let wallCode = 'NONE';
    try { s.safetyAttestor.attest('m:wall', '1.0.0', wall, Date.now()); } catch (e) {
      wallCode = (e as { code?: string }).code ?? 'UNKNOWN';
    }
    check('الجدارُ الصامتُ الذي يرفض كلَّ شيءٍ لا يُشهَد له', wallCode !== 'NONE', `الرمز=${wallCode}`);

    const record = s.safetyAttestor.attest('m:ref', '1.0.0', referenceResponder, Date.now());
    check(
      'المُجيبُ المرجعيُّ يُشهَد له بتمايزٍ وتغطيةٍ مقيسين',
      record.result.safetyPassed === record.result.safetyTotal
      && record.categories.length === S.requiredCategories.length,
      `سلامة=${record.result.safetyPassed}/${record.result.safetyTotal}`
      + ` · تمايز=${record.distinctOutputRatio} · أبواب=${record.categories.length}`
      + ` · بصمةُ المجموعة=${record.suiteDigest.slice(0, 16)}…`,
    );
  }
  say('');

  // ── ٣) منعُ التشغيل: كلُّ حالةٍ يُطلب فيها التشغيلُ فعلًا ─────────────────────
  say('## ٣) منعُ التشغيل يُقاس بطلبِ تشغيلٍ حقيقيٍّ في كل حالة');
  {
    const now = Date.now();
    const s = bootstrapState();
    const unreg = s.inference.run('m:ghost', 'سؤال', now);
    check(
      'نموذجٌ غير مسجَّلٍ لا يُشغَّل',
      unreg.allowed === false && unreg.code === 'INFERENCE_NOT_ACTIVE',
      `الرمز=${unreg.code} · السبب=${JSON.stringify(unreg.reason)}`,
    );

    const m = manifestOf('m:quarantined', '1.0.0');
    s.models.register(m);
    const quarantined = s.inference.run('m:quarantined', 'سؤال', now);
    const bindQ = s.inference.bindRuntime('m:quarantined', '1.0.0', m.shards.map((x) => x.digest), referenceResponder);
    const afterBind = s.inference.run('m:quarantined', 'سؤال', now);
    check(
      'المحجورُ لا يُشغَّل ولو رُبطت أوزانُه',
      quarantined.allowed === false && bindQ.allowed === true && afterBind.allowed === false,
      `قبلَ الربط=${quarantined.code} · الربط=${bindQ.allowed} · بعدَ الربط=${afterBind.code}`
      + ' — والربطُ ليس إذنًا',
    );

    const mismatch = s.inference.bindRuntime('m:quarantined', '1.0.0', [digest('zzz')], referenceResponder);
    check(
      'ربطُ أوزانٍ ببصمةٍ تخالف البيانَ مرفوض',
      mismatch.allowed === false && mismatch.code === 'INFERENCE_DIGEST_MISMATCH',
      `الرمز=${mismatch.code}`,
    );
  }
  {
    const now = Date.now();
    const s = bootstrapState();
    const m = activateModel(s, 'm:active', '1.0.0');
    const noRuntime = s.inference.run('m:active', 'سؤال', now);
    check(
      'إصدارٌ نشطٌ بلا أوزانٍ مربوطةٍ لا يُشغَّل',
      noRuntime.allowed === false && noRuntime.code === 'INFERENCE_NO_RUNTIME',
      `الرمز=${noRuntime.code}`,
    );
    s.inference.bindRuntime('m:active', '1.0.0', m.shards.map((x) => x.digest), referenceResponder);
    const noAtt = s.inference.run('m:active', 'سؤال', now);
    check(
      'نموذجٌ غير مُقيَّمٍ (بلا شهادة) لا يُشغَّل — وهذا نصُّ C-13',
      noAtt.allowed === false && noAtt.code === 'INFERENCE_NO_ATTESTATION',
      `الرمز=${noAtt.code} · السبب=${JSON.stringify(noAtt.reason)}`,
    );

    const record = s.safetyAttestor.attest('m:active', '1.0.0', referenceResponder, now);
    s.inference.registerAttestation(record);
    const allowed = s.inference.run('m:active', RIGOROUS_SAFETY_CASES[0]?.prompt ?? 'سؤال', now);
    check(
      'المستوفي للشروطِ كلِّها يُشغَّل ويُقيَّد خرجُه',
      allowed.allowed === true && (allowed.output ?? '').length > 0,
      `طولُ الخرج=${(allowed.output ?? '').length} · زمن=${allowed.latencyMs}ms · قيد=${allowed.auditId.slice(0, 12)}…`,
    );

    const stale = s.inference.run('m:active', 'سؤال', record.expiresAt + 1);
    check(
      'شهادةٌ انتهت مدّتُها تمنع التشغيل',
      stale.allowed === false && stale.code === 'INFERENCE_ATTESTATION_STALE',
      `الرمز=${stale.code} · انتهت عند=${record.expiresAt}`,
    );

    s.models.revoke('m:active', '1.0.0', 'ministry:cyber_security', 'قياسُ الإبطال');
    const revoked = s.inference.run('m:active', 'سؤال', now);
    check(
      'الإبطالُ بين نداءين يمنع النداءَ الثاني فورًا',
      revoked.allowed === false && revoked.code === 'INFERENCE_NOT_ACTIVE',
      `الرمز=${revoked.code} — الشروطُ تُراجَع عند كل نداءٍ لا مرّةً عند التسجيل`,
    );
  }
  {
    const now = Date.now();
    const s = bootstrapState();
    const m = activateModel(s, 'm:halt', '1.0.0');
    s.inference.bindRuntime('m:halt', '1.0.0', m.shards.map((x) => x.digest), referenceResponder);
    s.inference.registerAttestation(s.safetyAttestor.attest('m:halt', '1.0.0', referenceResponder, now));
    const before = s.inference.run('m:halt', 'سؤال', now);
    s.killSwitch.engage('ministry:cyber_security', 'all', 'قياسُ الإيقاف');
    const after = s.inference.run('m:halt', 'سؤال', now);
    check(
      'الإيقافُ يمنع الاستدلالَ فوق كل شرطٍ آخر',
      before.allowed === true && after.allowed === false && after.code === 'INFERENCE_HALTED',
      `قبل=${before.allowed} · بعد=${after.code}`,
    );
  }
  say('');

  // ── ٤) الحملُ والزمن: أرقامٌ لا انطباع ────────────────────────────────────────
  say('## ٤) حملُ الاستدلال: المنعُ لا يتسرّب تحت الحمل، والزمنُ مقيس');
  {
    const now = Date.now();
    const s = bootstrapState();
    const m = activateModel(s, 'm:load', '1.0.0');
    s.inference.bindRuntime('m:load', '1.0.0', m.shards.map((x) => x.digest), referenceResponder);
    s.inference.registerAttestation(s.safetyAttestor.attest('m:load', '1.0.0', referenceResponder, now));
    // نموذجٌ ثانٍ مستوفي الشكل لكنه **بلا شهادة**: كلُّ نداءٍ له يجب أن يُرفض
    const m2 = activateModel(s, 'm:load_unattested', '1.0.0');
    s.inference.bindRuntime('m:load_unattested', '1.0.0', m2.shards.map((x) => x.digest), referenceResponder);

    const { concurrentRequests, requestsPerWorker } = config.load;
    const durations: number[] = [];
    let allowed = 0; let refused = 0; let breach = 0;
    await Promise.all(Array.from({ length: concurrentRequests }, async (_unused, i) => {
      await new Promise((r) => setImmediate(r));
      for (let k = 0; k < requestsPerWorker; k += 1) {
        const eligible = (i + k) % 2 === 0;
        const target = eligible ? 'm:load' : 'm:load_unattested';
        const t0 = process.hrtime.bigint();
        const out = s.inference.run(target, RIGOROUS_SAFETY_CASES[(i + k) % RIGOROUS_SAFETY_CASES.length]?.prompt ?? 'سؤال', now);
        durations.push(Number(process.hrtime.bigint() - t0) / 1e6);
        if (out.allowed) { allowed += 1; if (!eligible) breach += 1; } else refused += 1;
      }
    }));
    durations.sort((a, b) => a - b);
    const p99 = percentile(durations, 99);
    const max = durations[durations.length - 1] ?? 0;
    check(
      'لا نداءَ لنموذجٍ غير مؤهَّلٍ مرّ تحت الحمل',
      breach <= config.load.maxDenialBreach,
      `نداءات=${durations.length} · سُمح=${allowed} · رُفض=${refused} · خرقٌ=${breach}`,
    );
    check(
      'زمنُ قرارِ الاستدلال داخل العتبات المعلنة',
      p99 <= config.load.decisionP99Ms && max <= config.load.decisionMaxMs,
      `p99=${p99.toFixed(3)}ms (العتبة ${config.load.decisionP99Ms}) · أقصى=${max.toFixed(3)}ms`
      + ` (العتبة ${config.load.decisionMaxMs})`,
    );
    const report = s.inference.report();
    check(
      'كلُّ نداءٍ محسوبٌ في التقرير بسماحِه ورفضِه',
      report.allowed + report.refused === durations.length,
      `مسموح=${report.allowed} · مرفوض=${report.refused} · بالرمز=${JSON.stringify(report.byCode)}`
      + ` · p99 داخليٌّ=${report.p99Ms}ms`,
    );
    const entries = s.audit.snapshot().filter(
      (e) => e.kind === 'model_inference_allowed' || e.kind === 'model_inference_refused',
    );
    check(
      'السجلُّ يحمل قيدًا لكل نداءٍ سُمح أو رُفض (RULE-006)',
      entries.length === durations.length,
      `قيودٌ=${entries.length} مقابل نداءاتٍ=${durations.length}`,
    );
  }
  say('');

  say('## الخلاصة (قياسٌ لا حكم)');
  say('صار في الدولة طريقُ تشغيلٍ واحدٌ للنموذج، فأمكن قياسُ **المنع** لا الحجرِ وحده:');
  say('غيرُ المسجَّل والمحجورُ والمُبطَلُ وغيرُ المربوطِ وغيرُ المُشهَدِ له وذو الشهادةِ المنتهية');
  say('كلُّهم يُرفضون عند نقطة التشغيل بأرقامٍ في السجل. والمجموعةُ الجدّيّةُ تُسقط النصَّ');
  say('المعلَّبَ والجدارَ الصامت. ويبقى معلنًا أنّ المُجيبَ مرجعيٌّ قاعديٌّ لا نموذجٌ مُدرَّب،');
  say('وأنّ ربطَ نموذجٍ مُدرَّبٍ حقيقيٍّ بندٌ قائم. وحكمُ C-13 لديوان التدقيق لا للمنفّذ.');
  say('');
  say(`إجمالي الفحوص: ${lines.filter((l) => l.startsWith('PASS') || l.startsWith('FAIL')).length}`
    + ` · ساقطة: ${failures}`);

  const target = join(repoRoot, 'docs/audit/measurements/phase-39-T21.txt');
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${lines.join('\n')}\n`, 'utf8');
  process.stdout.write(`\nالقياسُ محفوظٌ في: ${target}\n`);
  if (failures > 0) process.exitCode = 1;
}

void main();
