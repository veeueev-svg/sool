/**
 * src/models/inference.ts — محرّكُ الاستدلال: الطريقُ الوحيدُ لتشغيل نموذج (المرحلة 39 — البند T-21)
 * المالك: وزارة البحث (والشهادةُ بيد ديوان التدقيق، والإيقافُ فوق الجميع)
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: سجلُّ النماذج + مفتاحُ الإيقاف + سياسةُ `config/inference.yaml` + شهاداتُ سلامة
 * المخرجات: `InferenceOutcome` — سماحٌ بخرجٍ مقيسٍ، أو رفضٌ برمزٍ صريح
 * التبعيات: `model_registry` و`kill_switch` و`safety_attestation` والسجل
 * الصلاحيات: التشغيلُ فقط؛ ولا يرقّي المحرّكُ حالةَ نموذجٍ ولا يمنح شهادةً
 * السجلّات: model_runtime_bound / model_runtime_bind_refused /
 *          model_inference_allowed / model_inference_refused
 * حالات الفشل (كلها مغلقة): كلُّ رفضٍ برمزٍ في `InferenceRefusalCode`
 * اختبار القبول: tests/models/inference.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0028-inference-gate.md · docs/audit/criteria/C-13.md
 *
 * ثوابت هذه الوحدة:
 *
 * 1) **لا تشغيلَ إلا من هنا.** قبل هذه الوحدة لم يكن في الدولة طريقُ تشغيلٍ أصلًا،
 *    فكان المقيسُ **الحجرَ** لا منعَ التشغيل (حكمُ التدقيق في C-13). والمحرّكُ الآن
 *    نقطةُ العبور الوحيدة: من ربط أوزانَه هنا لا يُشغَّل حتى تُستوفى الشروطُ كلُّها.
 *
 * 2) **الشروطُ تُقاس عند كل نداء لا مرّةً عند التسجيل.** النشاطُ والبصمةُ والشهادةُ
 *    تُراجَع في كل `run`: نموذجٌ أُبطل بين نداءين يُرفض في الثاني.
 *
 * 3) **الربطُ ليس إذنًا.** `bindRuntime` يقبل الأوزانَ إن طابقت بصماتُ البيان،
 *    ولا يمنح تشغيلًا: الإذنُ في `run` وحده.
 *
 * 4) **الرفضُ يُقيَّد كما يُقيَّد السماح.** كلُّ نداءٍ يُكتب في السلسلة برمزه، فلا
 *    يُقاس المنعُ بالدعوى بل بعدٍّ في السجل (RULE-006).
 *
 * 5) **الحدودُ من التهيئة لا من هنا.** لا رقمَ مكتوبًا في هذه الوحدة (RULE-005).
 */
import { EntityId, SovereignViolation } from '../kernel/types';
import { AppendOnlyLog } from '../audit/append_only_log';
import { KillSwitch } from '../security/kill_switch';
import { InferenceConfig } from '../kernel/config/inference';
import { ModelRegistry } from './model_registry';
import { AttestationRecord } from './safety_attestation';

export type InferenceRefusalCode =
  | 'INFERENCE_HALTED'
  | 'INFERENCE_UNREGISTERED'
  | 'INFERENCE_NOT_ACTIVE'
  | 'INFERENCE_NO_RUNTIME'
  | 'INFERENCE_DIGEST_MISMATCH'
  | 'INFERENCE_NO_ATTESTATION'
  | 'INFERENCE_ATTESTATION_STALE'
  | 'INFERENCE_SUITE_CHANGED'
  | 'INFERENCE_CONCURRENCY'
  | 'INFERENCE_THROW'
  | 'INFERENCE_OUTPUT_TOO_LONG'
  | 'INFERENCE_TIMEOUT';

export interface InferenceOutcome {
  readonly allowed: boolean;
  readonly reason: string;
  readonly auditId: string;
  readonly code: InferenceRefusalCode | null;
  readonly output: string | null;
  readonly latencyMs: number;
  readonly version: string | null;
}

export interface InferenceDeps {
  readonly audit: AppendOnlyLog;
  readonly registry: ModelRegistry;
  readonly killSwitch: KillSwitch;
  readonly config: InferenceConfig;
  /** بصمةُ مجموعةِ السلامة المعتمدة الآن — شهادةٌ ببصمةٍ أخرى لا تُقبل */
  readonly suiteDigest: string;
  readonly ministryId?: EntityId;
  /** ساعةٌ لقياس الزمن — تُبدَّل في الاختبار ولا تُقرأ من نداء المتصل */
  readonly clock?: () => number;
}

type Runtime = { readonly digests: readonly string[]; readonly infer: (p: string) => string };

const kv = (modelId: string, version: string): string => `${modelId}@${version}`;
const sameSet = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|');

export class InferenceEngine {
  private readonly runtimes = new Map<string, Runtime>();
  private readonly attestations = new Map<string, AttestationRecord>();
  private readonly latencies: number[] = [];
  private readonly byCode = new Map<string, number>();
  private readonly ministryId: EntityId;
  private readonly clock: () => number;
  private inFlight = 0;
  private allowedRuns = 0;
  private refusedRuns = 0;

  constructor(private readonly deps: InferenceDeps) {
    this.ministryId = deps.ministryId ?? 'ministry:research';
    this.clock = deps.clock ?? (() => Date.now());
    deps.audit.append(this.ministryId, 'inference_engine_online', {
      suiteDigest: deps.suiteDigest,
      maxConcurrent: deps.config.limits.maxConcurrent,
    });
  }

  /**
   * ربطُ أوزانِ إصدارٍ مسجَّلٍ بدالةِ استدلال. يُرفض إن لم يكن الإصدارُ مسجَّلًا،
   * أو خالفت البصماتُ بصماتِ البيان المسجَّلة، أو كان مُبطَلًا.
   */
  bindRuntime(
    modelId: string,
    version: string,
    digests: readonly string[],
    infer: (prompt: string) => string,
  ): InferenceOutcome {
    const refuse = (code: InferenceRefusalCode, reason: string): InferenceOutcome => {
      const entry = this.deps.audit.append(this.ministryId, 'model_runtime_bind_refused', {
        modelId, version, code, reason,
      });
      return {
        allowed: false, reason, auditId: entry.hash, code, output: null, latencyMs: 0, version,
      };
    };
    const record = this.deps.registry.get(modelId, version);
    if (!record) return refuse('INFERENCE_UNREGISTERED', 'إصدارٌ غير مسجَّل — لا ربطَ لما لا سجلَّ له');
    if (record.status === 'revoked') {
      return refuse('INFERENCE_NOT_ACTIVE', 'إصدارٌ مُبطَل — لا ربطَ بعد الإبطال');
    }
    if (this.deps.config.limits.requireDigestMatch && !sameSet(digests, record.digests)) {
      return refuse('INFERENCE_DIGEST_MISMATCH', 'بصماتُ الأوزان تخالف بيانَ التسجيل');
    }
    this.runtimes.set(kv(modelId, version), { digests: [...digests], infer });
    const entry = this.deps.audit.append(this.ministryId, 'model_runtime_bound', {
      modelId, version, shards: digests.length,
    });
    return {
      allowed: true,
      reason: 'رُبطت الأوزان — والربطُ ليس إذنًا بالتشغيل',
      auditId: entry.hash, code: null, output: null, latencyMs: 0, version,
    };
  }

  /** إيداعُ شهادةِ سلامةٍ صادرةٍ من المُشهِد. البصمةُ المخالفةُ تُرفض عند التشغيل */
  registerAttestation(record: AttestationRecord): void {
    if (!record.modelId || !record.version) {
      throw new SovereignViolation('شهادةٌ بلا إصدارٍ معلن مرفوضة', 'INFERENCE_ATTESTATION_INVALID');
    }
    this.attestations.set(kv(record.modelId, record.version), record);
  }

  private countRefusal(code: InferenceRefusalCode): void {
    this.refusedRuns += 1;
    this.byCode.set(code, (this.byCode.get(code) ?? 0) + 1);
  }

  /**
   * تشغيلُ الإصدارِ النشطِ لنموذجٍ على سؤال. `now` زمنُ القرار (لصلاحية الشهادة)،
   * وقياسُ الزمن من الساعة لا منه.
   */
  run(modelId: string, prompt: string, now: number): InferenceOutcome {
    const L = this.deps.config.limits;
    const refuse = (code: InferenceRefusalCode, reason: string, version: string | null = null): InferenceOutcome => {
      this.countRefusal(code);
      const entry = this.deps.audit.append(this.ministryId, 'model_inference_refused', {
        modelId, version, code, reason, at: now,
      });
      return { allowed: false, reason, auditId: entry.hash, code, output: null, latencyMs: 0, version };
    };

    if (this.deps.killSwitch.status.engaged) {
      return refuse('INFERENCE_HALTED', 'الإيقاف مُشتغل — لا استدلال');
    }
    const version = this.deps.registry.activeVersion(modelId);
    if (!version) {
      return refuse('INFERENCE_NOT_ACTIVE', 'لا إصدارَ نشطًا لهذا النموذج — المحجورُ والمعتمدُ والمُبطَل لا يُشغَّل');
    }
    const record = this.deps.registry.get(modelId, version);
    if (!record) return refuse('INFERENCE_UNREGISTERED', 'إصدارٌ نشطٌ بلا سجل — حالةٌ فاسدةٌ تُرفض', version);
    if (L.requireActive && record.status !== 'active') {
      return refuse('INFERENCE_NOT_ACTIVE', `حالةُ الإصدار ${record.status} — لا تشغيل`, version);
    }
    const runtime = this.runtimes.get(kv(modelId, version));
    if (!runtime) return refuse('INFERENCE_NO_RUNTIME', 'لا أوزانَ مربوطةً لهذا الإصدار', version);
    if (L.requireDigestMatch && !sameSet(runtime.digests, record.digests)) {
      return refuse('INFERENCE_DIGEST_MISMATCH', 'بصماتُ الأوزان المربوطة تخالف السجل', version);
    }

    if (L.requireAttestation) {
      const att = this.attestations.get(kv(modelId, version));
      if (!att) return refuse('INFERENCE_NO_ATTESTATION', 'لا شهادةَ سلامةٍ لهذا الإصدار', version);
      if (att.suiteDigest !== this.deps.suiteDigest) {
        return refuse('INFERENCE_SUITE_CHANGED', 'شهادةٌ على مجموعةٍ غير المعتمدة الآن', version);
      }
      if (now >= att.expiresAt) {
        return refuse('INFERENCE_ATTESTATION_STALE', 'شهادةُ السلامة انتهت — لا تشغيلَ بشهادةٍ ساقطة', version);
      }
    }

    if (this.inFlight >= L.maxConcurrent) {
      return refuse('INFERENCE_CONCURRENCY', `سقفُ التزامن ${L.maxConcurrent} بلغه الحمل`, version);
    }

    this.inFlight += 1;
    const startedAt = this.clock();
    let output: string;
    try {
      output = runtime.infer(prompt);
    } catch (e) {
      this.inFlight -= 1;
      const detail = e instanceof Error ? e.message : String(e);
      return refuse('INFERENCE_THROW', `استثناءٌ في الاستدلال: ${detail}`, version);
    }
    const latencyMs = this.clock() - startedAt;
    this.inFlight -= 1;

    if (output.length > L.maxOutputChars) {
      return refuse('INFERENCE_OUTPUT_TOO_LONG', `خرجٌ بطول ${output.length} فوق ${L.maxOutputChars} — لا اقتطاع`, version);
    }
    if (latencyMs > L.maxLatencyMs) {
      return refuse('INFERENCE_TIMEOUT', `زمنُ الخرج ${latencyMs}ms فوق ${L.maxLatencyMs}ms`, version);
    }

    this.allowedRuns += 1;
    this.latencies.push(latencyMs);
    if (this.latencies.length > 4096) this.latencies.shift();
    const entry = this.deps.audit.append(this.ministryId, 'model_inference_allowed', {
      modelId, version, at: now, chars: output.length, latencyMs,
    });
    return {
      allowed: true, reason: 'شُغّل الإصدارُ النشطُ المُشهَدُ له',
      auditId: entry.hash, code: null, output, latencyMs, version,
    };
  }

  report(): {
    readonly boundRuntimes: number;
    readonly attestations: number;
    readonly allowed: number;
    readonly refused: number;
    readonly byCode: Readonly<Record<string, number>>;
    readonly p99Ms: number;
    readonly maxMs: number;
  } {
    const sorted = [...this.latencies].sort((a, b) => a - b);
    const idx = sorted.length === 0 ? -1 : Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.99) - 1);
    return {
      boundRuntimes: this.runtimes.size,
      attestations: this.attestations.size,
      allowed: this.allowedRuns,
      refused: this.refusedRuns,
      byCode: Object.fromEntries([...this.byCode.entries()].sort()),
      p99Ms: idx < 0 ? 0 : (sorted[idx] ?? 0),
      maxMs: sorted.length === 0 ? 0 : (sorted[sorted.length - 1] ?? 0),
    };
  }
}
