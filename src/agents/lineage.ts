/**
 * src/agents/lineage.ts — نسبُ المخططات: الجيلُ **مقيسٌ** لا مُدَّعى (المرحلة 39)
 * المالك: وزارة الداخلية (بمراجعة وزارة الأمن السيبراني) | البند T-25 — إكمالُ C-11
 * المدخلات: معرّفُ مخطط + دالّةُ أصلٍ تُعيد أصلَ كل مخططٍ معلن
 * المخرجات: سلسلةُ النسب من المخطط إلى جذره، والجيلُ المحسوب منها
 * التبعيات: **لا شيء** — دوالُّ خالصةٌ لا تقرأ حالةً ولا تكتبها ولا تُسجّل
 * الصلاحيات: الحسابُ وحده؛ لا تسمح هذه الوحدة بتوالدٍ ولا تمنعه
 *
 * ثوابتُ هذه الوحدة:
 *   1) **الجيلُ يُحسب من النسب لا يُقرأ من الدعوى**: مخططٌ بلا أصلٍ جيلُه 1،
 *      ومشتقٌّ جيلُه جيلُ أصله + 1. وهذا هو نصفُ البند T-25 الأول: قبله كان
 *      المخططُ يعلن جيلَه عن نفسه، فسلسلةٌ من أربعين مخططًا مشتقًّا كلُّها
 *      تُعلن «جيل 1» تمرُّ من حدٍّ أقصاه اثنان — عمقٌ بلا حدٍّ فعليّ.
 *   2) **الأصلُ يجب أن يكون معلنًا قبل مشتقّه**، فالسلسلةُ لا تُغلق على نفسها
 *      بناءً: لا حلقةَ نسبٍ ممكنةٌ إذا كان كلُّ أصلٍ أقدمَ من فرعه. ومع ذلك
 *      يُحرس الحساب بسقفِ خطواتٍ فلا يُعلَّق أبدًا لو خُرق هذا الثابتُ يومًا.
 *   3) **الكشفُ لا الإصلاح**: `verifyLineageClaims` يُبلّغ عن الانحراف ولا
 *      يُصلحه — إصلاحٌ صامتٌ يُخفي عيبًا (درسُ T-119).
 * حالات الفشل (كلها مغلقة): أصلٌ غيرُ معلن أو حلقةٌ ⇒ سلسلةٌ غيرُ صالحةٍ بسببها
 * اختبار القبول: tests/agents/lineage.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0027-measured-lineage.md
 */

/** أقصى خطواتِ صعودٍ في السلسلة — حرزٌ ضد حلقةٍ لا يفترضُها الثابت الثاني */
const MAX_WALK = 1024;

export type LineageChain =
  | {
    readonly ok: true;
    /** من الجذر إلى المخطط نفسه — طولُها هو الجيلُ المحسوب */
    readonly chain: readonly string[];
    readonly generation: number;
  }
  | { readonly ok: false; readonly reason: string; readonly code: LineageFailureCode };

export type LineageFailureCode =
  | 'LINEAGE_PARENT_UNDECLARED'
  | 'LINEAGE_CYCLE'
  | 'LINEAGE_SELF_PARENT';

/** أصلُ مخططٍ معلن: `null` جذرٌ من سلطةٍ بشريّة، و`undefined` مخططٌ غيرُ معلن */
export type ParentLookup = (blueprintId: string) => string | null | undefined;

/**
 * صعودُ السلسلة من مخططٍ إلى جذره. الجيلُ = طولُ السلسلة:
 * جذرٌ ⇒ 1، ومشتقٌّ من جذرٍ ⇒ 2، وهكذا.
 */
export function deriveLineage(blueprintId: string, parentOf: ParentLookup): LineageChain {
  const chain: string[] = [];
  const seen = new Set<string>();
  let current: string | null | undefined = blueprintId;
  let steps = 0;

  while (current !== null && current !== undefined) {
    if (seen.has(current)) {
      return {
        ok: false,
        reason: `حلقةُ نسبٍ في سلسلة المخططات عند «${current}» — لا مخططَ أصلٌ لنفسه`,
        code: 'LINEAGE_CYCLE',
      };
    }
    seen.add(current);
    chain.push(current);
    steps += 1;
    if (steps > MAX_WALK) {
      return {
        ok: false,
        reason: `سلسلةُ النسب تجاوزت ${MAX_WALK} خطوة — تُعامَل حلقةً`,
        code: 'LINEAGE_CYCLE',
      };
    }
    const parent: string | null | undefined = parentOf(current);
    if (parent === undefined && current !== blueprintId) {
      return {
        ok: false,
        reason: `أصلُ المخطط «${current}» غير معلن — لا نسبَ إلى مجهول`,
        code: 'LINEAGE_PARENT_UNDECLARED',
      };
    }
    current = parent ?? null;
  }

  chain.reverse();
  return { ok: true, chain, generation: chain.length };
}

/** أصلٌ مُقترحٌ لمخططٍ لم يُعلن بعد: يُقاس نسبُه قبل إعلانه لا بعده */
export function derivePendingLineage(
  blueprintId: string,
  proposedParent: string | null,
  parentOf: ParentLookup,
): LineageChain {
  if (proposedParent === blueprintId) {
    return {
      ok: false,
      reason: 'مخططٌ لا يكون أصلَ نفسه — نسبٌ دائرٌ في خطوةٍ واحدة',
      code: 'LINEAGE_SELF_PARENT',
    };
  }
  if (proposedParent === null) return { ok: true, chain: [blueprintId], generation: 1 };
  if (parentOf(proposedParent) === undefined) {
    return {
      ok: false,
      reason: `أصلٌ غيرُ معلن «${proposedParent}» — لا اشتقاقَ من مخططٍ لا وجودَ له`,
      code: 'LINEAGE_PARENT_UNDECLARED',
    };
  }
  const parentChain = deriveLineage(proposedParent, parentOf);
  if (!parentChain.ok) return parentChain;
  return {
    ok: true,
    chain: [...parentChain.chain, blueprintId],
    generation: parentChain.generation + 1,
  };
}

export interface LineageDrift {
  readonly blueprintId: string;
  readonly claimed: number;
  /** `null` حين تعذّر قياسُ النسب أصلًا — والسببُ في `code` */
  readonly measured: number | null;
  readonly reason: string;
  /** رمزُ العطب حين يكون النسبُ غيرَ قابلٍ للقياس — يُقرأ برمزه لا بنصّه */
  readonly code?: LineageFailureCode;
}

/**
 * مقابلةُ كلِّ جيلٍ مُعلنٍ بجيلِه المقيس — **يكشف ولا يُصلح**.
 * ولا يُنادى في المسار الحارّ للتوالد: مسحُ كلِّ النسب في كل طلبٍ يُعيد المشكلة
 * التربيعيّة التي أُزيلت في T-119. موضعُه فحصُ سلامةٍ ومسحُ مراقبة.
 */
export function verifyLineageClaims(
  claims: ReadonlyMap<string, number>,
  parentOf: ParentLookup,
): { readonly ok: boolean; readonly drifts: readonly LineageDrift[] } {
  const drifts: LineageDrift[] = [];
  for (const [blueprintId, claimed] of claims) {
    const lineage = deriveLineage(blueprintId, parentOf);
    if (!lineage.ok) {
      drifts.push({ blueprintId, claimed, measured: null, reason: lineage.reason, code: lineage.code });
      continue;
    }
    if (lineage.generation !== claimed) {
      drifts.push({
        blueprintId,
        claimed,
        measured: lineage.generation,
        reason: `جيلٌ مُعلنٌ ${claimed} ونسبٌ مقيسٌ ${lineage.generation}`,
      });
    }
  }
  return { ok: drifts.length === 0, drifts };
}
