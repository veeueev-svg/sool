/**
 * src/data/journal_drops.ts — دفترُ الإسقاطِ الدائم (المرحلة 39 · W-2026-040 · جولة 3)
 * المالك: وزارة البيانات
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: مسارُ ملفِّ العدّادِ (بجوارِ اليوميّة) وما يُسقَط من أصناف
 * المخرجات: عددُ ما أُسقط بحسب الصنف — **يبقى بعد موتِ العملية**
 * التبعيات: `node:fs` وحدَها. لا تعرف اليوميّةَ ولا سلسلةَ بصماتِها
 * الصلاحيات (RULE-004): تعدُّ وتُثبِت وتقرأ. لا تُدوّن قيدًا في اليوميّةِ ولا تكتب في سجلِّ التدقيق
 * السجلات: لا تكتب سجلًّا — العدُّ رقمٌ لا حدَث
 * حالات الفشل (كلها مغلقة):
 *   - ملفُّ العدّاد لا يُحلَّل ⇒ PERSISTENCE_DROP_COUNTER_UNREADABLE
 *   - صيغةٌ غير معلنة أو قيمةٌ غير عددية ⇒ PERSISTENCE_DROP_COUNTER_MALFORMED
 * اختبارات الوحدة: tests/data/persistence.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0024-durable-persistence.md
 *   · سجلُّ المراجعةِ التي أوجبت هذه الوحدة: docs/test-reports/phase-39-W-2026-040-review-round-2.md
 *
 * ## العيبُ الذي أوجب هذه الوحدة
 *
 * رفعت الجولةُ الثانيةُ من المراجعةِ المستقلّةِ عيبًا واحدًا برمزين
 * (`DROP_SIGNAL_VOLATILE_BEFORE_SUPERVISION` · `JOURNAL_DROP_PROBE_NEVER_TICKS_ON_BOOTSTRAP`):
 * كان عدُّ ما يُسقَط خارجَ النطاقِ `Map` في الذاكرةِ وحدَها، والماسحُ الذي يقرؤه يحتاج
 * وسيطًا **حيًّا**. فإن أُسقِط قيدٌ ثمّ ماتت العمليةُ قبل أن يُمسح — وهو حالُ الإقلاعِ
 * نفسِه، إذ المراقبةُ المستمرّةُ **مبنيّةٌ لا مُشغَّلة** (`src/composition/operations.ts`) —
 * ضاع الرقمُ بلا أثر. فخسارةٌ تُعَدُّ في الذاكرةِ ولا تنجو ليست معلومةً (RULE-001).
 *
 * فصار العدُّ يُثبَت على القُرصِ **متزامنًا مع كلِّ إسقاطٍ** ويُقرأ في الباني، فتُجمَع
 * الخسارةُ عبرَ الإقلاعات لا في إقلاعٍ واحد.
 *
 * ## وحدُّه مُعلَنٌ لا مُدَّعًى
 *
 * ملفٌّ مُستقلٌّ **لا حلقةٌ في سلسلةِ البصمات**: فحذفُه من القُرصِ يُرجِع العدَّ إلى الصفرِ
 * ولا يُكشَف بتحقّقِ السلسلة. وهذا **دَينٌ مُعلَنٌ لا مقفول** — إحرازُه يقتضي أن يصير
 * الإسقاطُ قيدًا في سلسلةٍ مبصومةٍ، وذاك عملُ بندٍ آخر.
 *
 * ## ثوابت هذه الوحدة
 *
 * 1) **التثبيتُ متزامنٌ مع العدّ**: لا تأجيلَ إلى ماسحٍ قد لا يُشغَّل (RULE-007).
 * 2) **الفاسدُ يُرفَض لا يُبلَع**: رقمٌ يُقرأ خطأً أسوأُ من رقمٍ لا يُقرأ.
 * 3) **العدُّ يزيد ولا ينقص**: لا دالّةَ تُصفّره — من أراد التصفيرَ حذف الملفَّ بيدِه معلنًا.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { SovereignViolation } from '../kernel/types';
import type { DurableKind } from '../kernel/config/persistence';

/** دفترُ ما أُسقط خارجَ النطاق — رقمٌ يُقاس لا دعوى تُروى */
export class JournalDropLedger {
  private readonly counts = new Map<DurableKind, number>();

  constructor(private readonly path: string) {
    this.load();
  }

  /** مسارُ الدفترِ المعلن — للقياس والتقارير لا للكتابة من الخارج */
  get file(): string {
    return this.path;
  }

  /** مجموعُ ما أُسقط خارجَ النطاق — عبرَ الإقلاعاتِ لا في إقلاعٍ واحد */
  get total(): number {
    let sum = 0;
    for (const n of this.counts.values()) sum += n;
    return sum;
  }

  /** تفصيلُ المُسقَط بحسب الصنف: نسخةٌ للقراءة، فلا يُصلح الخارجُ عدّادًا */
  byKind(): ReadonlyMap<DurableKind, number> {
    return new Map(this.counts);
  }

  /** يعدُّ إسقاطًا ويُثبِته على القُرصِ في الفعلِ نفسِه — لا بعده */
  count(kind: DurableKind): void {
    this.counts.set(kind, (this.counts.get(kind) ?? 0) + 1);
    this.persist();
  }

  /**
   * يقرأ الدفترَ من القُرص — وملفٌّ فاسدٌ يُرفَض رفضًا مُعلَنًا لا يُبلَع صمتًا (RULE-007).
   * وغيابُ الملفِّ ليس فسادًا: دفترٌ لم يُكتب بعدُ يعني صفرَ إسقاطٍ لا خطأً.
   */
  private load(): void {
    if (!existsSync(this.path)) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(this.path, 'utf8'));
    } catch (error) {
      throw new SovereignViolation(
        `دفتر الإسقاط غير مقروء: ${this.path} (${String(error)})`,
        'PERSISTENCE_DROP_COUNTER_UNREADABLE',
      );
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new SovereignViolation(
        `دفتر الإسقاط بصيغة غير معلنة: ${this.path}`,
        'PERSISTENCE_DROP_COUNTER_MALFORMED',
      );
    }
    for (const [kind, count] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof count !== 'number' || !Number.isInteger(count) || count < 0) {
        throw new SovereignViolation(
          `دفتر الإسقاط يحمل قيمة غير عددية للصنف ${kind}`,
          'PERSISTENCE_DROP_COUNTER_MALFORMED',
        );
      }
      this.counts.set(kind as DurableKind, count);
    }
  }

  /** يُثبِت الدفترَ متزامنًا — فموتُ العمليةِ بعد الإسقاطِ لا يمحو الخسارة */
  private persist(): void {
    const out: Record<string, number> = {};
    for (const [kind, n] of this.counts) out[kind] = n;
    writeFileSync(this.path, `${JSON.stringify(out)}\n`, 'utf8');
  }
}
