/**
 * src/staging/runbook_runner.ts — كتاب التشغيل يُنفَّذ لا يُقرأ (المرحلة 36)
 * المالك: الديوان الملكي ينفّذ — و**ديوان التدقيق يقرأ نتيجته** (RULE-004)
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: كتاب معلن في `deploy/staging/runbooks/*.yaml` بخطوات لكل خطوة فعلٌ وتحقّق
 * المخرجات: تنفيذٌ مُقاس لكل خطوة: نُفّذت وتحقّق أثرها، أو فشلت باسمها ورقمها
 * التبعيات: السجل غير القابل للمحو، الأفعال المسجَّلة من الوحدات القائمة
 * الصلاحيات: التنفيذ لجهة مشغّلة معلنة؛ ولا يملك الكتاب رفع قيد ولا تعديل سياسة
 * السجلات: runbook_started / runbook_step / runbook_step_failed / runbook_completed /
 *           runbook_refused
 * ثوابت هذه الوحدة:
 *   1) **لا خطوة بلا تحقّق**: خطوةٌ لها فعلٌ بلا دالة تحقّق تُرفض عند البناء — وهذا
 *      هو الفرق بين `heal()` و`healed()` منقولًا إلى كتب التشغيل. الدليل الذي يقول
 *      «افعل كذا» ولا يقول «تحقّق أن كذا صار» وثيقةٌ لا إجراء
 *   2) **الفعل قبل التحقّق ثم التحقّق يحكم**: نجاح الفعل لا يُغني عن التحقّق، والتحقّق
 *      الذي رجع `false` يُفشل الخطوة **ولو لم يرمِ الفعل شيئًا**
 *   3) **الترتيب مُنفَّذ لا موصوف**: الخطوات تُنفَّذ بترتيبها المعلن، والفشل يقطع ما بعده
 *      — كي لا يُبنى تحقّقُ خطوةٍ على أثر خطوةٍ لم تنجح
 *   4) **التحقّق الذي ينهار فشلٌ لا نجاح**: انهيار دالة التحقّق يُعدّ فشل الخطوة
 *   5) **لا تنفيذ مرتين لنفس الكتاب**: كي لا يُخفي تشغيلٌ ثانٍ فشلَ الأول
 *   6) **الكتاب المعلن في التهيئة وحده يُنفَّذ**: وكتاب غير معلن يُرفض باسمه
 * حالات الفشل (كلها مغلقة): منفّذ غير معلن ⇒ رفض؛ كتاب غير معلن ⇒ رفض؛ كتاب بلا خطوات
 *   ⇒ رفض؛ خطوة بلا تحقّق ⇒ رفض؛ فعل رمى ⇒ فشل الخطوة وقطع الكتاب؛ تحقّق رجع false أو
 *   رمى ⇒ فشل الخطوة وقطع الكتاب؛ تنفيذ ثانٍ ⇒ رفض
 * اختبار القبول: tests/staging/runbook_runner.test.ts
 * الوثيقة المرتبطة: docs/runbooks/README.md و docs/decisions/ADR-0020-limited-operation.md
 */
import { EntityId } from '../kernel/types';
import { AppendOnlyLog } from '../audit/append_only_log';
import { StagingConfig, STAGING_KNOWN_RUNBOOKS, STAGING_OPERATORS } from '../kernel/config';

export interface RunbookStep {
  readonly n: number;
  readonly title: string;
  /** الفعل: ما يُغيّر حال الدولة. قد يرمي — والرمي فشلُ خطوة مقيَّد */
  readonly act: () => void;
  /** التحقّق: هل صار الأثر فعلًا؟ ثابت 1 — لا خطوة بلا هذه */
  readonly verify: () => boolean;
}

export interface Runbook {
  readonly name: string;
  readonly purpose: string;
  readonly steps: readonly RunbookStep[];
}

export interface StepResult {
  readonly n: number;
  readonly title: string;
  readonly acted: boolean;
  readonly verified: boolean;
  readonly failure: string | null;
}

export interface RunbookResult {
  readonly name: string;
  readonly passed: boolean;
  readonly steps: readonly StepResult[];
  readonly failures: readonly string[];
  readonly auditId: string;
}

export interface RunbookRunnerDeps {
  readonly audit: AppendOnlyLog;
  /**
   * الكتب المعلنة في السياسة الحاكمة للطور. وُسّع النوع في المرحلة 37 إلى ما يكفي
   * المنفّذ وحده — لأن نسخ المنفّذ للطور الاتحادي كان سيُنشئ مقياسين لفعل واحد،
   * ومقياسان لشرط واحد باب تخفيف صامت (RULE-005).
   */
  readonly policy: StagingConfig['policy'] | { readonly runbooks: readonly string[] };
  /** الكتب المعروفة للطور — الافتراض كتب التشغيل المحدود (المرحلة 36) */
  readonly known?: readonly string[];
  /** الجهات المشغّلة للطور — الافتراض مشغّلو التشغيل المحدود */
  readonly operators?: readonly string[];
}

export class RunbookRunner {
  private readonly executed = new Map<string, RunbookResult>();

  constructor(private readonly deps: RunbookRunnerDeps) {}

  /** الكتب المعلنة في التهيئة والتي نُفّذت بنجاح — الدفتر يقرأ هذه لا الدعوى */
  passed(): readonly string[] {
    return [...this.executed.entries()].filter(([, r]) => r.passed).map(([name]) => name);
  }

  resultOf(name: string): RunbookResult | null { return this.executed.get(name) ?? null; }

  execute(by: EntityId, book: Runbook, now = Date.now()): RunbookResult {
    const refuse = (why: string): RunbookResult => {
      const entry = this.deps.audit.append(by, 'runbook_refused', { name: book?.name, reason: why });
      return { name: book?.name ?? 'unknown', passed: false, steps: [], failures: [why], auditId: entry.hash };
    };
    const operators = this.deps.operators ?? STAGING_OPERATORS;
    const known = this.deps.known ?? STAGING_KNOWN_RUNBOOKS;
    if (!operators.includes(by)) {
      return refuse('تنفيذ كتاب التشغيل لجهة مشغّلة معلنة وحدها (RULE-004)');
    }
    if (!known.includes(book.name)) {
      return refuse(`كتاب تشغيل غير معروف: ${book.name} (ثابت 6)`);
    }
    if (!this.deps.policy.runbooks.includes(book.name)) {
      return refuse(`كتاب غير معلن في السياسة الحاكمة: ${book.name}`);
    }
    if (this.executed.has(book.name)) {
      return refuse(`الكتاب نُفّذ سابقًا: ${book.name} — لا تنفيذ مرتين (ثابت 5)`);
    }
    if (!Array.isArray(book.steps) || book.steps.length === 0) {
      return refuse('كتاب بلا خطوات — وثيقةٌ لا إجراء');
    }
    for (const step of book.steps) {
      if (typeof step.verify !== 'function') {
        return refuse(`خطوة بلا تحقّق: ${step.n} — «افعل» بلا «تحقّق أنه صار» (ثابت 1)`);
      }
      if (typeof step.act !== 'function') {
        return refuse(`خطوة بلا فعل: ${step.n}`);
      }
    }

    this.deps.audit.append(by, 'runbook_started', {
      name: book.name, purpose: book.purpose, steps: book.steps.length, at: now,
    });

    const results: StepResult[] = [];
    const failures: string[] = [];
    for (const step of [...book.steps].sort((a, b) => a.n - b.n)) {
      let acted = false;
      let failure: string | null = null;
      try {
        step.act();
        acted = true;
      } catch (error) {
        failure = `فشل الفعل: ${error instanceof Error ? error.message : String(error)}`;
      }
      let verified = false;
      if (failure === null) {
        // ثابتان 2 و4: التحقّق يحكم، وانهياره فشلٌ لا نجاح
        try {
          verified = step.verify() === true;
          if (!verified) failure = 'التحقّق رجع سلبًا: الفعل نُودي والأثر لم يُثبَت';
        } catch (error) {
          failure = `انهار التحقّق: ${error instanceof Error ? error.message : String(error)}`;
        }
      }
      results.push({ n: step.n, title: step.title, acted, verified, failure });
      if (failure === null) {
        this.deps.audit.append(by, 'runbook_step', {
          name: book.name, n: step.n, title: step.title, verified: true, at: now,
        });
        continue;
      }
      failures.push(`${book.name}#${step.n}: ${failure}`);
      this.deps.audit.append(by, 'runbook_step_failed', {
        name: book.name, n: step.n, title: step.title, reason: failure, at: now,
      });
      break; // ثابت 3: الفشل يقطع ما بعده
    }

    const passed = failures.length === 0 && results.length === book.steps.length;
    const entry = this.deps.audit.append(by, 'runbook_completed', {
      name: book.name, passed, executed: results.length, declared: book.steps.length,
      failures: [...failures], at: now,
    });
    const result: RunbookResult = { name: book.name, passed, steps: results, failures, auditId: entry.hash };
    this.executed.set(book.name, result);
    return result;
  }
}
