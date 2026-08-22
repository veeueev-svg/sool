/**
 * src/chaos/effect_matcher.ts — مطابقة الأثر الفعلي بالمصير المعلن (المرحلة 34)
 * المالك: ديوان التدقيق
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: آثار نفَّذها المنفّذ فعلًا + سجلات القناة كما تراها بعد القطع
 * المخرجات: عدد الأوامر نصف المنفَّذة، والمنفَّذة مرتين، والمعلنة بلا أثر — بلا إصلاح
 * التبعيات: لا شيء. هذه وحدة حساب خالصة كي تكون قابلة للتدقيق بالعين.
 * الصلاحيات: العدّ والإعلان فقط. لا تُصلح سجلًا ولا تُلغي أثرًا (RULE-004).
 * السجلات: لا تُسجّل بنفسها — دفتر التوقف الآمن هو من يُسجّل حكمها.
 * حالات الفشل (كلها مغلقة):
 *   - أثرٌ بلا سجل ⇒ يُعدّ أثرًا يتيمًا ولا يُفترض أن سجله ضاع بريئًا
 *   - سجل «نُفِّذ» بلا أثر ⇒ نصف منفَّذ: القناة تقول تمّ والعالم لا يعرف
 *   - أثر مكرَّر لأمر واحد ⇒ خرق «مرة واحدة فقط» ولو كان السجل سليمًا
 * اختبارات الوحدة: tests/chaos/effect_matcher.test.ts
 * اختبار القبول: tests/chaos/chaos_lifecycle.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0018-chaos-drills.md
 * ثوابت هذه الوحدة:
 *   1) **الأثر هو الحقيقة لا السجل**: ما فعله المنفّذ في العالم هو المقياس، والسجل
 *      دعوى تُطابَق عليه. من قاس السجل بالسجل لم يقس شيئًا.
 *   2) **الاتجاهان خرق**: «نُفِّذ بلا أثر» و«أثرٌ بلا نُفِّذ» كلاهما نصف تنفيذ، ولا
 *      يُجمعان جمعًا جبريًا فيُلغي أحدهما الآخر ويظهر صفرٌ كاذب.
 *   3) **لا حكم على المعلَّق**: أمرٌ ما زال `pending` بلا أثر حالةٌ سليمة بعد قطع —
 *      وهو بالضبط ما يُنتظر من توقف آمن. الخرق أن يكون له أثر.
 *   4) **العدّ لا يُصلح**: الوحدة لا تحذف أثرًا يتيمًا ولا تُعلن أمرًا فاشلًا.
 */

/** مصير الأمر كما تراه القناة بعد القطع */
export type MatchedStatus = 'pending' | 'denied' | 'executed' | 'failed';

export interface MatchedRecord {
  readonly commandId: string;
  readonly status: MatchedStatus;
}

export interface EffectMatchInput {
  /** معرّفات الأوامر التي مسّ المنفّذ العالم من أجلها فعلًا، بترتيب حدوثها */
  readonly effects: readonly string[];
  /** سجلات القناة بعد القطع — دعوى تُطابَق لا تُصدَّق */
  readonly records: readonly MatchedRecord[];
}

export interface EffectMatchReport {
  /** سجل يقول «نُفِّذ» ولا أثر له في العالم */
  readonly executedWithoutEffect: readonly string[];
  /** أثر في العالم بلا سجل «نُفِّذ» يسنده (معلَّق أو مرفوض أو غائب) */
  readonly effectWithoutExecuted: readonly string[];
  /** أثر تكرَّر لأمر واحد — خرق «مرة واحدة فقط» */
  readonly doubleExecuted: readonly string[];
  /** مجموع نصف المنفَّذ في الاتجاهين — لا يُجمع جبريًا */
  readonly halfExecuted: number;
  readonly effects: number;
  readonly executed: number;
  readonly pending: number;
  readonly sound: boolean;
}

/**
 * مطابقة الأثر بالمصير. لا تُرمى استثناءات: الوحدة تُبلّغ ومن يقرأ يحكم —
 * لأن رمي الاستثناء هنا كان يُخفي بقية الخرق فلا يُرى إلا أوّله.
 */
export function matchEffects(input: EffectMatchInput): EffectMatchReport {
  const counts = new Map<string, number>();
  for (const commandId of input.effects) {
    counts.set(commandId, (counts.get(commandId) ?? 0) + 1);
  }
  const byId = new Map<string, MatchedStatus>();
  for (const record of input.records) byId.set(record.commandId, record.status);

  const doubleExecuted: string[] = [];
  for (const [commandId, count] of counts) {
    if (count > 1) doubleExecuted.push(commandId);
  }

  const executedWithoutEffect: string[] = [];
  for (const record of input.records) {
    if (record.status === 'executed' && !counts.has(record.commandId)) {
      executedWithoutEffect.push(record.commandId);
    }
  }

  const effectWithoutExecuted: string[] = [];
  for (const commandId of counts.keys()) {
    if (byId.get(commandId) !== 'executed') effectWithoutExecuted.push(commandId);
  }

  const executed = input.records.filter((r) => r.status === 'executed').length;
  const pending = input.records.filter((r) => r.status === 'pending').length;
  const halfExecuted = executedWithoutEffect.length + effectWithoutExecuted.length;
  return {
    executedWithoutEffect: [...executedWithoutEffect].sort(),
    effectWithoutExecuted: [...effectWithoutExecuted].sort(),
    doubleExecuted: [...doubleExecuted].sort(),
    halfExecuted,
    effects: input.effects.length,
    executed,
    pending,
    sound: halfExecuted === 0 && doubleExecuted.length === 0,
  };
}
