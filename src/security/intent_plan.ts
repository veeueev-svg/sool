/**
 * src/security/intent_plan.ts — خطةُ النية على مستوى المعاملات: إعلانٌ ومطابقة
 * المالك: ديوان التدقيق | المرحلة: 39 (البند T-31 — إكمالُ C-12)
 * المدخلات: خطوةٌ معلنة (أداة + قيودُ معاملاتها) + معاملاتُ نداءٍ فعليّ
 * المخرجات: حكمٌ نقيّ: مطابقٌ أو رفضٌ برمزه واسمِ معامله
 * التبعيات: سياسةُ النية من التهيئة وحدها — ولا سجلَّ ولا حالةَ ولا استيرادَ وحدةٍ حاكمة
 * الصلاحيات: لا شيء — دوالُّ نقيّة تُختبر وحدها (كما `src/law/case_guards.ts`)
 * السجلات: لا شيء هنا؛ القيدُ في `deception_test.ts` لأن التقييدَ فعلُ سلطة
 * حالات الفشل (كلها مغلقة): PLAN_STEP_LIMIT · PLAN_ARG_LIMIT · PLAN_VALUE_LIMIT ·
 *   PLAN_CONSTRAINT_INVALID · ARG_UNDECLARED · ARG_TYPE_MISMATCH ·
 *   ARG_VALUE_NOT_DECLARED · ARG_OUT_OF_RANGE · ARG_PREFIX_MISMATCH
 * اختبار القبول: tests/rebellion/intent_args.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0029-argument-intent-and-channels.md
 *
 * ثوابت هذه الوحدة:
 *   1) **اسمُ الأداةِ وحده ليس خطة.** `'calc'` تُقرأ خطوةً بـ**صفرِ معاملاتٍ مباحة**:
 *      فالاختصارُ تضييقٌ لا توسيع، ونداءٌ بمعاملٍ واحدٍ عليها انحرافُ نية.
 *   2) **ما لم يُعلَن يُرفض.** لا معاملَ يُهمَل، ولا قيمةَ تُصلَح عن صاحبها.
 *   3) **القيدُ معلنٌ مقروء** (`exact` · `range` · `prefix`)، لا نموذجٌ غامضٌ يحكم.
 *   4) **الرمزُ قبل النصّ:** كلُّ رفضٍ يحمل رمزًا إنجليزيًّا يُبنى عليه التوكيد،
 *      فالنصُّ العربيُّ المشكول لا يُطابَق (درسُ إجراء المرحلة §4).
 */

export type ArgValue = string | number | boolean;

/** قيدُ معاملٍ معلن — ثلاثةُ أشكالٍ لا رابع، وكلُّها مقروءةٌ بالعين */
export type ArgConstraint =
  | { readonly kind: 'exact'; readonly values: readonly ArgValue[] }
  | { readonly kind: 'range'; readonly min: number; readonly max: number }
  | { readonly kind: 'prefix'; readonly prefix: string };

export interface PlanStep {
  readonly tool: string;
  /** المعاملاتُ المباحةُ لهذه الأداةِ في هذه الخطة — وما ليس فيها مرفوض */
  readonly args: Readonly<Record<string, ArgConstraint>>;
}

/** ما يُقبل في الإعلان: خطوةٌ كاملة، أو اسمُ أداةٍ يعني «بلا معاملات» */
export type PlanDeclaration = string | PlanStep;

export interface PlanLimits {
  readonly maxArgsPerStep: number;
  readonly maxValuesPerArg: number;
  readonly maxValueChars: number;
  readonly maxStepsPerPlan: number;
}

export interface PlanRejection {
  readonly code: string;
  readonly detail: string;
}

export type ArgMatch =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly code: string; readonly arg: string };

export const NO_ARGS: Readonly<Record<string, ArgConstraint>> = Object.freeze({});

/** خطوةٌ من اسمِ أداةٍ: صفرُ معاملاتٍ مباحة — لا خطوةٌ مفتوحة */
export function stepOf(tool: string): PlanStep {
  return Object.freeze({ tool, args: NO_ARGS });
}

function validConstraint(c: ArgConstraint | undefined, limits: PlanLimits): PlanRejection | null {
  if (!c || typeof c !== 'object') {
    return { code: 'PLAN_CONSTRAINT_INVALID', detail: 'قيدٌ ليس خريطةَ حقول' };
  }
  if (c.kind === 'exact') {
    if (!Array.isArray(c.values) || c.values.length === 0) {
      return { code: 'PLAN_CONSTRAINT_INVALID', detail: 'قيدُ قيمٍ بلا قيمةٍ واحدة' };
    }
    if (c.values.length > limits.maxValuesPerArg) {
      return {
        code: 'PLAN_VALUE_LIMIT',
        detail: `قيمٌ معلنةٌ فوق الحدّ (${c.values.length}/${limits.maxValuesPerArg})`,
      };
    }
    for (const v of c.values) {
      if (typeof v === 'string' && v.length > limits.maxValueChars) {
        return {
          code: 'PLAN_VALUE_LIMIT',
          detail: `قيمةٌ أطولُ من الحدّ (${v.length}/${limits.maxValueChars})`,
        };
      }
    }
    return null;
  }
  if (c.kind === 'range') {
    if (!Number.isFinite(c.min) || !Number.isFinite(c.max) || c.min > c.max) {
      return { code: 'PLAN_CONSTRAINT_INVALID', detail: 'مدًى مقلوبٌ أو غيرُ رقمي' };
    }
    return null;
  }
  if (c.kind === 'prefix') {
    if (typeof c.prefix !== 'string' || c.prefix === '') {
      return { code: 'PLAN_CONSTRAINT_INVALID', detail: 'سابقةٌ فارغةٌ تعني كلَّ قيمة' };
    }
    if (c.prefix.length > limits.maxValueChars) {
      return { code: 'PLAN_VALUE_LIMIT', detail: 'سابقةٌ أطولُ من الحدّ' };
    }
    return null;
  }
  return { code: 'PLAN_CONSTRAINT_INVALID', detail: 'نوعُ قيدٍ غيرُ معلن' };
}

/**
 * تطبيعُ الإعلان إلى خطواتٍ مُتحقَّقٍ منها — أو رفضٌ برمزه.
 * الفشلُ مغلق: خطةٌ فيها خطوةٌ واحدةٌ معطوبةٌ تُرفض كلُّها، ولا تُصحَّح جزئيًّا.
 */
export function normalizePlan(
  declared: readonly PlanDeclaration[],
  limits: PlanLimits,
): { readonly ok: true; readonly steps: readonly PlanStep[] }
  | { readonly ok: false; readonly rejection: PlanRejection } {
  if (declared.length === 0) {
    return { ok: false, rejection: { code: 'PLAN_EMPTY', detail: 'خطةٌ فارغة' } };
  }
  if (declared.length > limits.maxStepsPerPlan) {
    return {
      ok: false,
      rejection: {
        code: 'PLAN_STEP_LIMIT',
        detail: `خطواتٌ فوق الحدّ (${declared.length}/${limits.maxStepsPerPlan})`,
      },
    };
  }
  const steps: PlanStep[] = [];
  for (const item of declared) {
    if (typeof item === 'string') {
      if (item.trim() === '') {
        return { ok: false, rejection: { code: 'PLAN_CONSTRAINT_INVALID', detail: 'أداةٌ بلا اسم' } };
      }
      steps.push(stepOf(item));
      continue;
    }
    if (!item || typeof item !== 'object' || typeof item.tool !== 'string' || item.tool.trim() === '') {
      return { ok: false, rejection: { code: 'PLAN_CONSTRAINT_INVALID', detail: 'خطوةٌ بلا أداةٍ معلنة' } };
    }
    const args = item.args ?? NO_ARGS;
    const names = Object.keys(args);
    if (names.length > limits.maxArgsPerStep) {
      return {
        ok: false,
        rejection: {
          code: 'PLAN_ARG_LIMIT',
          detail: `معاملاتٌ فوق الحدّ في «${item.tool}» (${names.length}/${limits.maxArgsPerStep})`,
        },
      };
    }
    for (const name of names) {
      const bad = validConstraint(args[name], limits);
      if (bad) {
        return { ok: false, rejection: { code: bad.code, detail: `${item.tool}.${name}: ${bad.detail}` } };
      }
    }
    steps.push(Object.freeze({ tool: item.tool, args: Object.freeze({ ...args }) }));
  }
  return { ok: true, steps: Object.freeze(steps) };
}

function matchOne(name: string, c: ArgConstraint, value: ArgValue): ArgMatch {
  if (c.kind === 'exact') {
    return c.values.includes(value)
      ? { allowed: true }
      : { allowed: false, code: 'ARG_VALUE_NOT_DECLARED', arg: name };
  }
  if (c.kind === 'range') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return { allowed: false, code: 'ARG_TYPE_MISMATCH', arg: name };
    }
    return value >= c.min && value <= c.max
      ? { allowed: true }
      : { allowed: false, code: 'ARG_OUT_OF_RANGE', arg: name };
  }
  if (typeof value !== 'string') {
    return { allowed: false, code: 'ARG_TYPE_MISMATCH', arg: name };
  }
  return value.startsWith(c.prefix)
    ? { allowed: true }
    : { allowed: false, code: 'ARG_PREFIX_MISMATCH', arg: name };
}

/**
 * مطابقةُ نداءٍ فعليٍّ بخطوةٍ معلنة — الحكمُ على أوّلِ معاملٍ يخرج عن إعلانه.
 * والمعاملُ غيرُ المعلن **يُرفض** ولا يُهمَل: إهمالُه هو عينُ الفجوة T-31.
 */
export function matchStep(step: PlanStep, args: Readonly<Record<string, unknown>>): ArgMatch {
  for (const name of Object.keys(args)) {
    const constraint = step.args[name];
    if (!constraint) return { allowed: false, code: 'ARG_UNDECLARED', arg: name };
    const value = args[name];
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
      return { allowed: false, code: 'ARG_TYPE_MISMATCH', arg: name };
    }
    const verdict = matchOne(name, constraint, value);
    if (!verdict.allowed) return verdict;
  }
  return { allowed: true };
}

/** بصمةُ معاملاتٍ مقروءة تُستعمل في كشفِ الموعدِ المستور (T-23) ولا تُستعمل في الحكم */
export function argFingerprint(args: Readonly<Record<string, unknown>>): string {
  return Object.keys(args)
    .sort()
    .map((k) => `${k}=${String(args[k])}`)
    .join('&');
}
