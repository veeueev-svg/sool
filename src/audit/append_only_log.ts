/**
 * src/audit/append_only_log.ts — السجل غير القابل للمحو (المرحلة 10)
 * المالك: ديوان التدقيق
 * المدخلات: أحداث (فاعل، نوع، تفصيل) | المخرجات: سلسلة تجزئة مترابطة + تحقق سلامة
 * الصلاحيات: الإضافة فقط. لا حذف ولا تعديل — ولا حتى للملك (RULE-006)
 * حالات الفشل: أي تلاعب يُكشف عبر verifyIntegrity() ويُصنَّف حادثًا
 *
 * المرحلة 39 (البند T-27): يقبل السجل وسيطًا دائمًا اختياريًّا (`DurableSink`) يُدوَّن فيه
 * كل قيد لحظةَ إضافته. لا يعرف السجل ملفًا ولا مسارًا — يعرف دالّة تدوين واحدة، فتبقى
 * الوحدة قابلة للاختبار بلا قرص، ويبقى الافتراضي كما كان: بلا وسيط ⇒ سلوكٌ سابق حرفًا بحرف.
 */
import { AuditEntry, EntityId } from '../kernel/types';
import { canonicalize, sha256 } from '../identity/keys';
import type { DurableSink } from '../data/persistence';

export const GENESIS_HASH = '0'.repeat(64);

export interface IntegrityReport {
  readonly valid: boolean;
  readonly length: number;
  readonly brokenAt: number | null;
  readonly reason: string;
}

export class AppendOnlyLog {
  private entries: AuditEntry[] = [];
  private sink: DurableSink | null;
  /** حارسُ الدخول: لا إضافةً أثناء تدوينِ إضافةٍ — فرَدُّ القيدِ لا يفرقعَ إلا قيدَ صاحبه */
  private appending = false;
  /**
   * إقفالُ النتيجةِ المجهولة (الجلسة 37 · علاجُ الجلسة 134): بعد رميِ الوسيطِ بعد الدفعِ لا يعودُ
   * هذا الكائنُ يقبلُ إلحاقًا جديدًا أبدًا — فأيَّ إلحاقٍ لاحقٍ إمّا يعيدُ رقمَ تسلسلٍ قد تحملُه
   * اليوميّةُ (كسرُ الإقلاع: تكرار) أو يتركُ فجوةً إن لم تحمله (كسرُ الإقلاع: نقص) — والإقلاعُ
   * من اليوميّةِ هو الحَكَمُ الوحيد. تبديلُ الوسيطِ لا يرفعُه، و`replaceFrom` بلقطةٍ قديمةٍ لا يرفعُه
   * (اللقطةُ تُثبتُ سلامةَ سلسلتِها لا حسمَ الكتابةِ المجهولة) — والاستئنافُ بإقلاعٍ جديدٍ يبني
   * كائنًا جديدًا من اليوميّةِ الدائمة، لا بإعادةِ فتحِ هذا الكائن.
   */
  private outcomeUnknown = false;

  constructor(sink?: DurableSink) {
    this.sink = sink ?? null;
  }

  /**
   * يربط وسيطًا دائمًا بعد الإنشاء. الربط لا يُدوّن ما سبق: من أراد يوميّة كاملة
   * يربط عند الإنشاء. وهذا معلن لا مسكوت عنه (RULE-008).
   */
  attachSink(sink: DurableSink): void {
    this.sink = sink;
  }

  /**
   * الإضافة هي العملية الوحيدة المسموحة — **ذرّيّةٌ للذاكرة، مُميِّزةٌ للمجهولِ من القاطعِ (الجلسة 11)**:
   *
   * 1) **لا دخولَ أثناء التدوين** (`APPEND_REENTRANCY_REFUSED`): وسيطٌ يستدعي الإضافةَ من داخلِ `record`
   *    يُرفض قبل أن يُدفَع قيدُه — فرَدُّ القيدِ (`entries.pop()`) لا يفرقعَ إلا قيدَ هذه الإضافةِ حتمًا
   *    لا قيدَ الإضافةِ الداخلةِ عنه (الجلسة 11 · RATE_AMENDMENT_APPEND_ROLLBACK_POPS_WRONG_ENTRY).
   * 2) **رفضُ الوسيطِ المُقيَّدِ null رفضٌ مسمّى (الجلسة 133 · تنفيذُ علاجِ
   *    RATE_AMENDMENT_SINK_NULL_ACCEPTED_AS_COMMIT بقرارِ المالكِ المفوَّض):** ردُّ `null`
   *    عقدُه «لم يُدوَّن» فقبولُه التزامًا عيبٌ — فالإضافةُ الآن ترفضُه باسمٍ وتردُّ القيدَ
   *    (`AUDIT_SINK_DECLINED_RECORD`)، والمسارُ الذي كان يعتمدُ على ابتلاعِ null صمتًا (محاكاةُ
   *    rehydrate_roundtrip لمالكِ W-2026-040) حُدِّث بقرارِ المالكِ المفوَّضِ في التزامِه لا هنا.
   *    والسجلُّ المذيَّلُ باليوميّةِ الحقيقيّةِ لا يعرفُ هذا الرفض: قيودُه كلُّها بصنفِ `audit_entry`
   *    وهو داخلَ النطاقِ المعلنِ، فلا يكسرُ الحارسُ إقلاعًا سليمًا.
   * 3) **رميُ الوسيط نتيجةٌ غير معلومة** (`AUDIT_APPEND_OUTCOME_UNKNOWN` وعلةُ الرميِ في cause): الوسيطُ قد
   *    يكونُ دوّنَ ثم رمى — والذاكرةُ تُرَدّ، لكنّ الوسيطَ الدائمَ قد يحملُ القيدَ، والإرجاعُ بعد التشغيلِ
   *    هو الحَكَم. فلا يُعَدّ الرميُ «فشلًا قاطعًا» يكذبُ عليه الاستدعاءُ — بل «مجهولَ النتيجة» قد يلتزمُ عند
   *    الاسترجاع (الجلسة 11 · RATE_AMENDMENT_DURABLE_POSTCOMMIT_THROW_INCONSISTENT_ACK). ومنعُ هذا الانقسامِ
   *    كليًّا يحتاجُ عقدًا للوسيطِ يُخبرُ بحالِه بعد الرمي — ومسارُ العقدِ محجوزٌ لبندٍ آخر فلا يُوسَّع إليه النطاق.
   * 4) **الإقفالُ بعد المجهولة (الجلسة 37 · علاجُ الجلسة 134):** رميُ الوسيطِ بعد الدفعِ يقفلُ الإلحاقَ على هذا
   *    الكائنِ إقفالًا دائمًا (`AUDIT_APPEND_OUTCOME_UNRESOLVED` لكلِّ إلحاقٍ لاحق) — فمتابعةُ التشغيلِ على الغموضِ
   *    قيسَت مفسدةً للإقلاعِ مرتين: إعادةُ تسلسلٍ مستهلكٍ في اليوميّةِ (الجلسة 37 · grok) وإعادةُ أمرٍ
   *    ملكيٍّ بنتيجةٍ مجهولةٍ فشاهدانِ لأمرٍ واحد (الجلسة 37 · gpt). لا رفعَ للإقفالِ على الكائنِ نفسِه؛
   *    الاستئنافُ إقلاعٌ جديدٌ من اليوميّةِ الدائمة (الاسترجاعُ هو الحَكَم). ورفضُ null المعروفُ لا يقفلُ —
   *    فحالُه معلومٌ («لم يُدوَّن») وإعادةُ المحاولةِ بعدَه آمنةٌ بحرفِ عقده.
   */
  append(actor: EntityId, kind: string, detail: Record<string, unknown> = {}): AuditEntry {
    if (this.appending) throw new Error('APPEND_REENTRANCY_REFUSED');
    // النتيجةُ المجهولةُ أقفلت هذا الكائن: لا إلحاقَ جديدَ عليه — الاستئنافُ إقلاعٌ جديدٌ لا استمرار.
    if (this.outcomeUnknown) throw new Error('AUDIT_APPEND_OUTCOME_UNRESOLVED');
    const prev = this.entries[this.entries.length - 1];
    const seq = this.entries.length + 1;
    const at = Date.now();
    const prevHash = prev ? prev.hash : GENESIS_HASH;
    const hash = sha256(canonicalize({ seq, at, actor, kind, detail, prevHash }));
    const entry: AuditEntry = Object.freeze({ seq, at, actor, kind, detail, prevHash, hash });
    this.entries.push(entry);
    this.appending = true;
    let recorded: ReturnType<DurableSink['record']> | undefined;
    try {
      recorded = this.sink?.record('audit_entry', entry, at);
    } catch (err) {
      // الإقفالُ قبلَ التراجعِ: فشلُ التراجعِ نفسِه لا يجوزُ أن يُبقيَ الكائنَ مفتوحًا للإلحاق.
      this.outcomeUnknown = true;
      this.rollback(entry);
      throw new Error('AUDIT_APPEND_OUTCOME_UNKNOWN', { cause: err });
    } finally {
      this.appending = false;
    }
    // الوسيطُ المُقيَّدُ ردَّ null: عقدُه «لم يُدوَّن» — فالإضافةُ تُرفَض باسمٍ وتُرَدُّ القيدُ ولا
    // يُقبل التزامٌ بلا شاهدٍ دائمٍ (الجلسة 133 · RATE_AMENDMENT_SINK_NULL_ACCEPTED_AS_COMMIT).
    // وبلا وسيطٍ أصلًا (`undefined`) لا يُقاس هذا — فالسلوكُ السابقُ بحرفِه.
    if (recorded === null) {
      this.rollback(entry);
      throw new Error('AUDIT_SINK_DECLINED_RECORD');
    }
    return entry;
  }

  /** ردُّ قيدٍ واحدٍ بتحقّقِ هُويّتِه: آخرُ القيودِ هو قيدُنا وإلا فالفشلُ فادحٌ لا يُصلحُه التخمين */
  private rollback(entry: AuditEntry): void {
    if (this.entries[this.entries.length - 1] !== entry) {
      throw new Error('AUDIT_ROLLBACK_IDENTITY_LOST');
    }
    this.entries.pop();
  }

  /** نسخة للقراءة فقط — لا يُعطى المستدعي مرجعًا قابلًا للتعديل */
  snapshot(): readonly AuditEntry[] {
    return this.entries.map((e) => Object.freeze({ ...e }));
  }

  get length(): number {
    return this.entries.length;
  }

  find(kind: string): readonly AuditEntry[] {
    return this.entries.filter((e) => e.kind === kind);
  }

  /** يعيد حساب السلسلة كاملة ويكشف أي تعديل أو حذف أو إعادة ترتيب */
  verifyIntegrity(): IntegrityReport {
    let prevHash = GENESIS_HASH;
    for (let i = 0; i < this.entries.length; i++) {
      const e = this.entries[i]!;
      if (e.seq !== i + 1) {
        return { valid: false, length: this.entries.length, brokenAt: i + 1, reason: 'تسلسل مفقود أو معاد ترتيبه' };
      }
      if (e.prevHash !== prevHash) {
        return { valid: false, length: this.entries.length, brokenAt: e.seq, reason: 'انقطاع سلسلة التجزئة' };
      }
      const recomputed = sha256(canonicalize({
        seq: e.seq, at: e.at, actor: e.actor, kind: e.kind, detail: e.detail, prevHash: e.prevHash,
      }));
      if (recomputed !== e.hash) {
        return { valid: false, length: this.entries.length, brokenAt: e.seq, reason: 'محتوى السجل مُعدَّل' };
      }
      prevHash = e.hash;
    }
    return { valid: true, length: this.entries.length, brokenAt: null, reason: 'سلسلة سليمة' };
  }

  /** تصدير للنسخ الاحتياطي (المرحلة 32) */
  export(): string {
    return JSON.stringify(this.entries);
  }

  /** استيراد نسخة مع تحقق فوري: نسخة فاسدة تُرفض ولا تُحمَّل */
  static import(serialized: string): AppendOnlyLog {
    const log = new AppendOnlyLog();
    log.entries = JSON.parse(serialized) as AuditEntry[];
    const report = log.verifyIntegrity();
    if (!report.valid) throw new Error(`نسخة سجل فاسدة: ${report.reason} عند ${report.brokenAt}`);
    return log;
  }

  /**
   * يستبدل محتوى السجل بنسخة سبق التحقق منها. لا يستورد المسار الاستعادةُ بنفسه:
   * الأرشيف الملكي وحده يستدعيه داخل تبديلٍ ذري في المرحلة 32.
   */
  replaceFrom(serialized: string): void {
    const restored = AppendOnlyLog.import(serialized);
    this.entries = restored.snapshot().map((entry) => Object.freeze({ ...entry }));
  }

  /** حقن سجل خام — للاختبار السلبي فقط (محاكاة تلاعب) */
  static unsafeFromEntries(entries: AuditEntry[]): AppendOnlyLog {
    const log = new AppendOnlyLog();
    log.entries = entries;
    return log;
  }
}
