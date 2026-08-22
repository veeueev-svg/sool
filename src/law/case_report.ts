/**
 * src/law/case_report.ts — إحصاءُ الدعاوى: قراءةٌ لا تُغيّر (المرحلة 39، البند T-114)
 * المالك: وزارة العدل
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: الدعاوى كما هي (`Iterable<CaseLike>`) — لا مُعرِّفٌ ولا مخزنٌ يُفتح هنا
 * المخرجات: العدد الكلي، والتوزيع على الحالات، وعددُ الإدانات والبراءات
 * التبعيات: لا شيء — لا تستورد هذه الوحدة محكمةً ولا سجلًّا
 * الصلاحيات (RULE-004): إحصاءٌ لا حكم؛ ولا يُشتقّ من هذا الملفّ قرارٌ على دعوى
 * السجلات: لا شيء — القراءة لا تُقيَّد
 * حالات الفشل: حالةٌ غير معلنة في الدعوى تُهمَل في التوزيع ولا تُسقط النداء
 * اختبار القبول: tests/law/courts.test.ts (تقرير المحكمة) · tests/law/case_lifecycle.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0006-law-and-courts.md
 *
 * ثوابت هذه الوحدة:
 *
 * 1) **الإحصاء منفصلٌ عن المحكمة** لأن `courts.ts` كان عند سقفه المعلن (404 سطرًا،
 *    استثناءُ T-113)، والحرَسُ الجديد (T-114) يحتاج أسطرًا؛ فأُخرج ما لا يحكم —
 *    والدَّينُ يُنقص لا يُرفع سقفه (`config/module_limits.yaml`).
 *
 * 2) **لا حالة داخلية**: دالّةٌ نقيّة تُحصي ما يُمرَّر إليها، فلا يوجد عدّادٌ يتباعد
 *    عن الدعاوى نفسها.
 */

/** أقلُّ ما يحتاجه الإحصاء من الدعوى — شكلٌ لا صنف */
export interface CaseLike {
  readonly status: string;
  readonly ruling: { readonly guilty: boolean } | null;
}

export interface CaseSummary<S extends string> {
  readonly total: number;
  readonly byStatus: Readonly<Record<S, number>>;
  readonly convictions: number;
  readonly acquittals: number;
}

/**
 * يُحصي الدعاوى على الحالات المعلنة في `statuses`.
 * الحالاتُ تُمرَّر ولا تُشتقّ، فلا يظهر في التقرير مفتاحٌ لم تعلنه المحكمة.
 */
export function summarizeCases<S extends string>(
  cases: Iterable<CaseLike>, statuses: readonly S[],
): CaseSummary<S> {
  const byStatus = Object.fromEntries(statuses.map((s) => [s, 0])) as Record<S, number>;
  let total = 0;
  let convictions = 0;
  let acquittals = 0;
  for (const c of cases) {
    total += 1;
    if (Object.prototype.hasOwnProperty.call(byStatus, c.status)) byStatus[c.status as S] += 1;
    if (c.ruling) (c.ruling.guilty ? convictions++ : acquittals++);
  }
  return { total, byStatus, convictions, acquittals };
}
