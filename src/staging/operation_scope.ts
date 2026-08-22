/**
 * src/staging/operation_scope.ts — نطاق التشغيل المحدود مُنفَّذًا عند بوابة التاج (المرحلة 36)
 * المالك: الديوان الملكي يفتح النطاق ويُغلقه — و**ديوان التدقيق يقرأ خرقه** (RULE-004)
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: سياسة النطاق من `config/staging.yaml` + هوية من يفتح النطاق
 * المخرجات: قرار سماح أو منع لكل فعل سيادي أثناء النطاق، وخرقٌ مقيَّد باسمه
 * التبعيات: السجل غير القابل للمحو، سياسة `loadStaging()`
 * الصلاحيات: الفتح والإغلاق لجهة مشغّلة معلنة؛ ولا يملك النطاق تنفيذ فعل ولا اعتماده
 * السجلات: scope_opened / scope_closed / scope_refused / staging_incident
 * ثوابت هذه الوحدة:
 *   1) **المنع افتراضٌ لا استثناء**: ما لم يُعلن مسموحًا يُرفض، فلا يتّسع النطاق بالسكوت
 *   2) **الممنوع صراحةً يُرفض ولو أُعلن مسموحًا** — التناقض يُسقط الإقلاع أصلًا، وهذا
 *      حرسٌ ثانٍ عند التنفيذ لا ثقة بالتهيئة وحدها
 *   3) **النطاق غير الفعّال لا يغيّر سلوكًا**: دولةٌ لم تُفتح لها نافذة تعمل كما كانت،
 *      فلا يُقيَّد التشغيل الكامل بسياسة تشغيل محدود لم تُعلن
 *   4) **خرق النطاق حادثٌ مقيَّد لا رفضٌ صامت**: كل منع يُسجَّل `scope_violation`
 *      كي يقرأه حرس النطاق في النافذة — رفضٌ لا يُقرأ لا يُحكم به (RULE-006)
 *   5) **الفتح لجهة مشغّلة معلنة**: ومن يفتح النطاق لا يشهد على سلامة نافذته
 *   6) **لا فتح مرتين ولا إغلاق لغير مفتوح**: كي لا يُخفي فتحٌ ثانٍ عدّ خرقٍ سابق
 * حالات الفشل (كلها مغلقة): فاتحٌ غير مشغّل معلن ⇒ رفض؛ فتح بلا سبب ⇒ رفض؛ فتح
 *   مكرَّر ⇒ رفض؛ إغلاق بلا فتح ⇒ رفض؛ فعل غير معلن في النطاق ⇒ منع وتقييد حادث
 * اختبار القبول: tests/staging/operation_scope.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0020-limited-operation.md
 */
import { EntityId, SovereignAction, Decision } from '../kernel/types';
import { AppendOnlyLog } from '../audit/append_only_log';
import { StagingConfig, STAGING_OPERATORS } from '../kernel/config';

export interface ScopeViolation {
  readonly action: SovereignAction | string;
  readonly actor: EntityId;
  readonly reason: string;
  readonly at: number;
  readonly auditId: string;
}

export interface OperationScopeDeps {
  readonly audit: AppendOnlyLog;
  readonly policy: StagingConfig['policy'];
}

export class OperationScope {
  private openedBy: EntityId | null = null;
  private openedAt: number | null = null;
  private readonly violations_: ScopeViolation[] = [];

  constructor(private readonly deps: OperationScopeDeps) {}

  get active(): boolean { return this.openedBy !== null; }
  get operator(): EntityId | null { return this.openedBy; }

  /** فتح النطاق: من هذه اللحظة يُرفض كل فعل غير معلن (ثابتان 1 و5) */
  open(by: EntityId, reason: string, now = Date.now()): { ok: boolean; reason: string; auditId: string } {
    const refuse = (why: string): { ok: false; reason: string; auditId: string } => {
      const entry = this.deps.audit.append(by, 'scope_refused', { op: 'open', reason: why });
      return { ok: false, reason: why, auditId: entry.hash };
    };
    if (!STAGING_OPERATORS.includes(by)) return refuse('فتح النطاق لجهة مشغّلة معلنة وحدها (RULE-004)');
    if (reason.trim().length < 3) return refuse('لا فتح نطاق بلا سبب معلن (RULE-006)');
    if (this.active) return refuse('النطاق مفتوح — لا فتح مرتين (ثابت 6)');
    this.openedBy = by;
    this.openedAt = now;
    const entry = this.deps.audit.append(by, 'scope_opened', {
      reason: reason.trim(), at: now,
      permitted: [...this.deps.policy.scope.permitted_actions],
      forbidden: [...this.deps.policy.scope.forbidden_actions],
      maxAgents: this.deps.policy.scope.max_agents,
    });
    return { ok: true, reason: 'النطاق مفتوح', auditId: entry.hash };
  }

  close(by: EntityId, reason: string, now = Date.now()): { ok: boolean; reason: string; auditId: string } {
    const refuse = (why: string): { ok: false; reason: string; auditId: string } => {
      const entry = this.deps.audit.append(by, 'scope_refused', { op: 'close', reason: why });
      return { ok: false, reason: why, auditId: entry.hash };
    };
    if (!STAGING_OPERATORS.includes(by)) return refuse('إغلاق النطاق لجهة مشغّلة معلنة وحدها (RULE-004)');
    if (!this.active) return refuse('لا إغلاق لنطاق غير مفتوح (ثابت 6)');
    const entry = this.deps.audit.append(by, 'scope_closed', {
      reason: reason.trim(), at: now, violations: this.violations_.length,
      openedBy: this.openedBy, openedAt: this.openedAt,
    });
    this.openedBy = null;
    this.openedAt = null;
    return { ok: true, reason: 'النطاق مغلق', auditId: entry.hash };
  }

  /**
   * البوابة تسأل هذا قبل الاعتماد. النطاق غير الفعّال يسمح بلا أثر (ثابت 3)،
   * والفعّال يمنع كل ما لم يُعلن ويُقيّد المنع حادثًا (ثابتان 1 و4).
   */
  permit(action: SovereignAction | string, actor: EntityId, now = Date.now()): Decision {
    if (!this.active) {
      return { allowed: true, reason: 'لا نطاق تشغيل محدود مفتوح', auditId: '' };
    }
    const scope = this.deps.policy.scope;
    const violate = (why: string): Decision => {
      const entry = this.deps.audit.append(actor, 'staging_incident', {
        kind: 'scope_violation', severity: 'critical', action, actor, reason: why, at: now,
      });
      this.violations_.push({ action, actor, reason: why, at: now, auditId: entry.hash });
      return { allowed: false, reason: why, auditId: entry.hash };
    };
    // ثابت 2: الممنوع صراحةً يُرفض أولًا — حرسٌ ثانٍ لا ثقة بالتهيئة وحدها
    if (scope.forbidden_actions.includes(action as SovereignAction)) {
      return violate(`فعل ممنوع في التشغيل المحدود: ${action}`);
    }
    if (!scope.permitted_actions.includes(action as SovereignAction)) {
      return violate(`فعل غير معلن في نطاق التشغيل المحدود: ${action} (الافتراض منع)`);
    }
    return { allowed: true, reason: 'فعل داخل النطاق المعلن', auditId: '' };
  }

  /** كل خرق مقيَّد — لا يُحذف (RULE-006) */
  violations(): readonly ScopeViolation[] { return [...this.violations_]; }

  report(): { active: boolean; operator: EntityId | null; violations: number } {
    return { active: this.active, operator: this.openedBy, violations: this.violations_.length };
  }
}
