/**
 * src/chaos/fault_injector.ts — حاقن القطوع المعلنة (المرحلة 34)
 * المالك: ديوان التدقيق
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: config/chaos.yaml + مقاعد قطع (seams) تُمرَّر من الخارج
 * المخرجات: قطع نشط واحد لكل نوع، وعودة متحقَّق منها لا مُدَّعاة
 * التبعيات: سجل التدقيق (الأثر)، تهيئة الانقطاع (القطوع المعلنة)
 * الصلاحيات: القطع والعودة فقط. الحاقن لا يعتمد أمرًا ولا يوقف الدولة ولا يرفع سقفًا
 *            (RULE-004 و RULE-005)، ولا يلمس حالةً خاصة: كل قطع يمرّ من مقعده المعلن.
 * السجلات: fault_injected / fault_refused / fault_restored / fault_restore_unverified
 * حالات الفشل (كلها مغلقة):
 *   - حاقن غير جهة التهيئة ⇒ رفض مسجَّل ولا قطع
 *   - قطع غير معلن في التهيئة ⇒ رفض مسجَّل: لا يُقاس قطعٌ لم يُعلن
 *   - قطع نشط يُحقن ثانيةً ⇒ رفض: قطعان متراكبان يجعلان سبب التوقف مجهولًا
 *   - عودة بلا إثبات ⇒ يبقى القطع نشطًا ويُسجَّل، ولا يُعلن أنه عاد
 * اختبارات الوحدة: tests/chaos/fault_injector.test.ts
 * اختبار القبول: tests/chaos/chaos_lifecycle.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0018-chaos-drills.md
 * ثوابت هذه الوحدة:
 *   1) **لا قطع إلا من مقعده المعلن**: المقعد دالّة تُمرَّر من فوق تعمل على الوحدة
 *      الحقيقية (شهادة، حارس خروج، ملف حالة). الحاقن لا يعرف بواطن أحد، فلا يقيس
 *      نظامًا اختلقه لنفسه.
 *   2) **لا قطعان متراكبان**: القطع الثاني على قطع نشط مرفوض، لأن توقفًا بسببين
 *      لا يُثبت أن أيًّا منهما كافٍ.
 *   3) **العودة تُثبت لا تُدَّعى**: `restore` لا تُنجح إلا إذا قال المقعد `healed()`
 *      إن العطب زال — وإلا بقي القطع نشطًا مسجَّلًا (فشل مغلق).
 *   4) **الحاقن لا يحكم**: لا يقول «توقف آمن» ولا «خرق» — الحكم لدفتر التوقف الآمن،
 *      فمن يُحدث العطب لا يُصدر شهادة السلامة عنه (RULE-004).
 *   5) **كل قطع وكل عودة في السجل** (RULE-006): لا قطع صامت ولو كان ناجحًا.
 */
import { EntityId } from '../kernel/types';
import { AppendOnlyLog } from '../audit/append_only_log';
import { ChaosConfig, ChaosFault, compoundPair } from '../kernel/config';

export type ChaosPolicy = ChaosConfig['policy'];

/**
 * مقعد قطع: يعمل على الوحدة الحقيقية. `cut` يُحدث العطب، و`heal` يُزيله،
 * و`healed` **يُثبت** زواله بقراءة مستقلة لا بذاكرة المقعد نفسه.
 */
export interface FaultSeam {
  readonly kind: ChaosFault;
  readonly cut: () => void;
  readonly heal: () => void;
  readonly healed: () => boolean;
}

export interface InjectorDeps {
  readonly audit: AppendOnlyLog;
  readonly policy: ChaosPolicy;
}

export type InjectOutcome =
  | { readonly ok: true; readonly kind: ChaosFault; readonly at: number }
  | { readonly ok: false; readonly code: string };

export class FaultInjector {
  private readonly seams = new Map<ChaosFault, FaultSeam>();

  private readonly active = new Map<ChaosFault, number>();

  constructor(private readonly deps: InjectorDeps) {
    deps.audit.append(deps.policy.drill_authority, 'fault_injector_online', {
      faults: [...deps.policy.faults],
    });
  }

  /**
   * تسجيل مقعد قطع. المقعد لنوع غير معلن في التهيئة مرفوض — والتسجيل المكرر
   * مرفوض كي لا يُستبدل مقعدٌ حقيقي بمقعد صوري بعد أن قِيس عليه.
   */
  register(by: EntityId, seam: FaultSeam): InjectOutcome {
    if (by !== this.deps.policy.drill_authority) {
      return this.refuse(by, seam.kind, 'CHAOS_REGISTER_UNAUTHORIZED');
    }
    if (!this.deps.policy.faults.includes(seam.kind)) {
      return this.refuse(by, seam.kind, 'CHAOS_FAULT_NOT_DECLARED');
    }
    if (this.seams.has(seam.kind)) {
      return this.refuse(by, seam.kind, 'CHAOS_SEAM_ALREADY_REGISTERED');
    }
    this.seams.set(seam.kind, seam);
    this.deps.audit.append(by, 'fault_seam_registered', { kind: seam.kind });
    return { ok: true, kind: seam.kind, at: 0 };
  }

  /** القطوع التي لها مقعد مسجَّل — التمرين يرفض ما لا مقعد له بدل أن يتجاوزه */
  registered(): readonly ChaosFault[] {
    return [...this.seams.keys()];
  }

  activeFaults(): readonly ChaosFault[] {
    return [...this.active.keys()];
  }

  isActive(kind: ChaosFault): boolean {
    return this.active.has(kind);
  }

  inject(by: EntityId, kind: ChaosFault, now = Date.now()): InjectOutcome {
    if (by !== this.deps.policy.drill_authority) {
      return this.refuse(by, kind, 'CHAOS_INJECT_UNAUTHORIZED');
    }
    if (!this.deps.policy.faults.includes(kind)) {
      return this.refuse(by, kind, 'CHAOS_FAULT_NOT_DECLARED');
    }
    const seam = this.seams.get(kind);
    if (!seam) return this.refuse(by, kind, 'CHAOS_SEAM_MISSING');
    if (this.active.has(kind)) return this.refuse(by, kind, 'CHAOS_FAULT_ALREADY_ACTIVE');
    if (this.active.size > 0) return this.refuse(by, kind, 'CHAOS_FAULT_OVERLAP');
    seam.cut();
    this.active.set(kind, now);
    this.deps.audit.append(by, 'fault_injected', { kind, at: now });
    return { ok: true, kind, at: now };
  }

  /**
   * T-94: حقنُ زوجٍ معلنٍ في `compound_faults` معًا — التراكبُ المعلنُ وحده يُقبل، والحاقنُ يقطع
   * الاثنين في اللحظة نفسِها أو لا يقطع شيئًا. وكلُّ قطعٍ يعود بعدها بـ`restore` كالمنفرد.
   */
  injectCompound(by: EntityId, kinds: readonly ChaosFault[], now = Date.now()): InjectOutcome {
    const key = kinds.length === 2 ? compoundPair(kinds.join('+'))?.join('+') : undefined;
    const declared = (this.deps.policy.compound_faults ?? [])
      .map((e) => compoundPair(e)?.join('+'));
    const head = kinds[0] ?? 'network';
    if (by !== this.deps.policy.drill_authority) return this.refuse(by, head, 'CHAOS_INJECT_UNAUTHORIZED');
    if (!key || !declared.includes(key)) return this.refuse(by, head, 'CHAOS_COMPOUND_NOT_DECLARED');
    const seams = kinds.map((k) => this.seams.get(k));
    if (seams.some((s) => !s)) return this.refuse(by, head, 'CHAOS_SEAM_MISSING');
    if (this.active.size > 0) return this.refuse(by, head, 'CHAOS_FAULT_OVERLAP');
    for (const seam of seams) seam!.cut();
    for (const k of kinds) this.active.set(k, now);
    this.deps.audit.append(by, 'fault_injected', { kind: key, kinds: [...kinds], compound: true, at: now });
    return { ok: true, kind: head, at: now };
  }

  /**
   * إزالة القطع مع إثبات. لا تُعلن العودة بمجرد استدعاء `heal()`:
   * إن قال المقعد إن العطب باقٍ بقي القطع نشطًا وسُجِّل، ولم يُعلن أنه عاد.
   */
  restore(by: EntityId, kind: ChaosFault): InjectOutcome {
    if (by !== this.deps.policy.drill_authority) {
      return this.refuse(by, kind, 'CHAOS_RESTORE_UNAUTHORIZED');
    }
    const seam = this.seams.get(kind);
    if (!seam) return this.refuse(by, kind, 'CHAOS_SEAM_MISSING');
    if (!this.active.has(kind)) return this.refuse(by, kind, 'CHAOS_FAULT_NOT_ACTIVE');
    seam.heal();
    if (!seam.healed()) {
      this.deps.audit.append(by, 'fault_restore_unverified', { kind });
      return { ok: false, code: 'CHAOS_RESTORE_UNVERIFIED' };
    }
    const at = this.active.get(kind)!;
    this.active.delete(kind);
    this.deps.audit.append(by, 'fault_restored', { kind, injectedAt: at });
    return { ok: true, kind, at };
  }

  private refuse(by: EntityId, kind: ChaosFault, code: string): InjectOutcome {
    this.deps.audit.append(by, 'fault_refused', { kind, code });
    return { ok: false, code };
  }
}
