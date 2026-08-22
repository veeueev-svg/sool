/**
 * src/kernel/termination_roll.ts — سجل المنتهين (المرحلة 35)
 * المالك: حرس التاج
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: قيد إنهاء لكيان: من أنهاه، ولماذا، ومتى
 * المخرجات: جواب واحد قاطع لكل مسلك في الدولة: هل هذا الكيان منتهٍ؟
 * التبعيات: سجل التدقيق فقط — عمدًا. السجل أدنى طبقةً من كل من يسأله كي لا تنشأ
 *           دورة اعتماد، ولئلّا يصير جواب «هل توقّف؟» رهينةَ الوحدة التي أوقفته.
 * الصلاحيات: القيد والقراءة فقط. لا يُنهي أحدًا ولا يرفع قيدًا ولا يستعيد موردًا.
 * السجلات: entity_terminated_recorded / termination_record_duplicate
 * حالات الفشل (كلها مغلقة):
 *   - قيد بكيان فارغ ⇒ يُرفض ولا يُصحَّح عن صاحبه
 *   - قيد مكرَّر ⇒ يُرفض بلا أثر ثانٍ، ويُسجَّل: التكرار حدثٌ يُعرف لا خطأ يُبتلع
 *   - سؤال عن كيان لم يُقيَّد ⇒ `false` صريحة، لا استنتاج من حالة وحدة أخرى
 * اختبارات الوحدة: tests/security/termination_roll.test.ts
 * اختبار القبول: tests/security/termination_lifecycle.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0019-stop-witness.md
 * ثوابت هذه الوحدة:
 *   1) **الإنهاء نهائي لا يُرفع**: لا دالّة حذف ولا استئناف. عودة كيان إلى العمل
 *      تكون بهوية جديدة تمرّ من البوابة، كما استُقرّ في المرحلة 34 لسحب الهوية.
 *      قيدٌ يُرفع يجعل «منتهٍ» حالةً مؤقّتة، وحالةٌ مؤقّتة لا يُبنى عليها منعٌ قاطع.
 *   2) **مصدر واحد للحقيقة**: كل مسلك سيادي (أداة، إيجار، جدولة، قدرة، توالد)
 *      يسأل هذا السجل وحده. مصدران للحقيقة يعنيان بابًا يُنسى تحديثه.
 *   3) **القيد لا يُنفَّذ عنه أثر**: السجل لا يسحب قدرة ولا يحرّر إيجارًا — من قيّد
 *      هو من ينفّذ (RULE-004)، وسجلٌّ يُصلح ما يرصده يُفسد الدليل.
 *   4) **القيد مُسجَّل دائمًا** في السجل الأبدي (RULE-006): قيدٌ صامت لا يُدقَّق.
 */
import { EntityId } from './types';
import { AppendOnlyLog } from '../audit/append_only_log';

export interface TerminationRecord {
  readonly entity: EntityId;
  readonly by: EntityId;
  readonly reason: string;
  readonly at: number;
}

export class TerminationRoll {
  private readonly records = new Map<EntityId, TerminationRecord>();

  constructor(private readonly audit: AppendOnlyLog) {}

  /**
   * يقيّد كيانًا منتهيًا. يُرجع `true` للقيد الأول فقط؛ فالتكرار لا يُنتج أثرًا ثانيًا
   * ولا يُعدّ نجاحًا جديدًا، ويُسجَّل كي يُرى في التدقيق.
   */
  record(entity: EntityId, by: EntityId, reason: string, at = Date.now()): boolean {
    if (typeof entity !== 'string' || entity.trim() === '') return false;
    if (this.records.has(entity)) {
      this.audit.append(by, 'termination_record_duplicate', { entity });
      return false;
    }
    this.records.set(entity, { entity, by, reason, at });
    this.audit.append(by, 'entity_terminated_recorded', { entity, reason, at });
    return true;
  }

  /** الجواب القاطع الذي تبني عليه كل المسالك منعها */
  isTerminated(entity: EntityId): boolean {
    return this.records.has(entity);
  }

  recordOf(entity: EntityId): TerminationRecord | undefined {
    const record = this.records.get(entity);
    return record ? { ...record } : undefined;
  }

  list(): readonly TerminationRecord[] {
    return [...this.records.values()].map((record) => ({ ...record }));
  }

  get size(): number {
    return this.records.size;
  }
}
