/**
 * src/recovery/continuity.ts — وضع الدولة بين الانقطاع والاستعادة (المرحلة 32)
 * المالك: وزارة البنية
 * المدخلات: إعلان انقطاع أو بدء/نتيجة استعادة | المخرجات: وضع full أو limited أو halted
 * التبعيات: سجل التدقيق | الصلاحيات: لا يستعيد ولا يفك تجميدا ولا يغيّر سياسة
 * السجلات: continuity_mode_changed
 * حالات الفشل: سبب غائب أو نجاح استعادة غير متحقق ⇒ halted، لا تخمين
 * اختبارات الوحدة: tests/recovery/continuity.test.ts
 * اختبار القبول: tests/recovery/recovery_lifecycle.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0016-recovery.md
 * ثوابت هذه الوحدة:
 *   1) الانقطاع لا يعني نجاح الاستعادة: يبدأ الوضع limited أو halted بسبب معلن.
 *   2) الاستعادة الناجحة لا تعيد full تلقائيا: تبقى limited ولا تفك تجميد التوالد.
 *   3) الفشل يبقي halted: لا إكمال ناقص ولا قرار تخميني (RULE-007).
 */
import { AppendOnlyLog } from '../audit/append_only_log';

export type ContinuityMode = 'full' | 'limited' | 'halted';
export interface ContinuityState { readonly mode: ContinuityMode; readonly reason: string; readonly at: number; }

export class ContinuityController {
  private state: ContinuityState = { mode: 'full', reason: 'الدولة قائمة', at: 0 };
  constructor(private readonly audit: AppendOnlyLog, private readonly fallback: ContinuityMode) {}
  get current(): ContinuityState { return { ...this.state }; }
  enterOutage(reason: string, now = Date.now()): ContinuityState {
    return this.set(this.fallback, reason, now);
  }
  beginRestore(now = Date.now()): ContinuityState { return this.set('halted', 'تبديل استعادة جارٍ', now); }
  completeRestore(ok: boolean, now = Date.now()): ContinuityState {
    return this.set(ok ? 'limited' : 'halted', ok ? 'استعادة متحققة؛ القرار التشغيلي التالي معلن' : 'استعادة فاشلة؛ الحالة السابقة أُرجعت', now);
  }
  declareFull(reason: string, now = Date.now()): ContinuityState { return this.set('full', reason, now); }
  private set(mode: ContinuityMode, reason: string, at: number): ContinuityState {
    if (!reason.trim()) throw new Error('CONTINUITY_REASON_REQUIRED');
    this.state = { mode, reason: reason.trim(), at };
    this.audit.append('ministry:infrastructure', 'continuity_mode_changed', { ...this.state });
    return this.current;
  }
}
