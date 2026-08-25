/**
 * src/kernel/config/declaration_memo.ts — ذاكرةُ قراءةٍ واحدةٍ لكلِّ مسارٍ في الإقلاع (البند T-139)
 * المالك: القيّم على المستودع | المدخلات: مسارُ ملفٍّ · حجمُه · زمنُ تعديله بالنانو ثانية
 * المخرجات: وثيقةٌ مُحلَّلةٌ **نسخةً** وعددُ عُقدها — أو لا شيءَ فيُقرأ الملفُّ من القرص
 * التبعيات: لا شيء (وحدةٌ بلا تبعيّةٍ على النواة: لا تقرأ قرصًا ولا ترمي)
 * الصلاحيات (RULE-004): تخزّن وتُرجع؛ **لا تقرأ ملفًّا ولا تحرس سقفًا ولا تُلغي حرَسًا**
 * السجلات: لا قيدَ لها وحدَها — أثرُها محورُ `memo_hits` في قيدِ `boot_work_measured`
 * حالات الفشل: لا ترمي. وعدمُ التطابق (حجمٌ أو زمنٌ) ⇒ لا شيء ⇒ قراءةٌ من القرص
 * الوثيقة: docs/decisions/ADR-0038-declaration-read-memo.md
 *   · القياسُ الخام: docs/audit/measurements/phase-39-T139.txt
 *
 * ثوابت هذه الوحدة:
 *
 *   1) **الذاكرةُ ذاكرةُ إقلاعٍ لا ذاكرةُ عمليّة**: تُنسى في أوّلِ كلِّ تركيبِ سيادةٍ
 *      (`resetDeclarationMemo` في `composeSovereignty` قبل الحصر). فكلُّ إقلاعٍ يقرأ إعلانَه
 *      من القرص من جديدٍ، ولا تُبنى دولةٌ على نصٍّ قرأته دولةٌ قبلها. وهذا أيضًا ما يجعل
 *      عدَّ العمل (T-134) **ثابتًا بين إقلاعَين** فيصلح عقدًا لا حظًّا.
 *
 *   2) **التطابقُ شرطٌ لا حسنُ ظنّ**: لا تُرجع الذاكرةُ شيئًا إلّا إذا طابق **الحجمُ وزمنُ
 *      التعديل بالنانو ثانية** ما خُزِّن. فمن عدّل ملفًّا بين قراءتَين — حتى بحجمٍ مساوٍ —
 *      قُرئ ملفُّه من القرص. والزمنُ بالنانو لا بالمللي: كتابتانِ في مللي ثانيةٍ واحدةٍ
 *      واردتان في الاختبارات.
 *
 *   3) **تُعطي نسخةً لا مرجعًا**: كلُّ استرجاعٍ يُرجع `structuredClone` — فمُحمِّلٌ يعدّل
 *      الوثيقةَ التي أُعطيها لا يُفسد ما يُعطى لمحمِّلٍ بعده. وهو ثمنٌ مقيسٌ ومُعلنٌ في
 *      القياس الخام: النسخُ أرخصُ من قراءةٍ وتحليلٍ، وأغلى من مرجعٍ مُشترَك.
 *
 *   4) **لا تُلغي حرَسًا**: سقفُ بايتات الملف وسقفُ بايتات المجلد (T-130 · T-133) يقعان
 *      **قبل** سؤالِ الذاكرة في `loadYamlFile`، ودفترُ ما حُمِّل يُقيَّد في الحالتَين. فالذاكرةُ
 *      توفّر قراءةً وتحليلًا، **ولا توفّر حكمًا**.
 *
 *   5) **لا تحرس حجمَ نفسها**: مفاتيحُها مساراتُ إعلانٍ محروسٌ عددُها وحجمُها بمدى الحصر
 *      وسقوفه (T-133)، وتُنسى كلَّ إقلاع — فلا سقفَ ثالثًا لها. ومن أدخل عليها مساراتٍ بلا
 *      حدٍّ فليُعلن ذلك بندًا.
 */

/** ما يُخزَّن لكلِّ مسار: بصمةُ الملفِّ ووثيقتُه وعددُ عُقدها */
type MemoEntry = {
  readonly bytes: number;
  readonly mtimeNs: bigint;
  readonly doc: Record<string, unknown>;
  readonly nodes: number;
};

/** ما تُرجعه الذاكرةُ عند التطابق: نسخةٌ من الوثيقة وعددُ عُقدها كما حُسب مرّةً */
export type MemoizedDeclaration = {
  readonly doc: Record<string, unknown>;
  readonly nodes: number;
};

const MEMO = new Map<string, MemoEntry>();

/**
 * يسأل الذاكرةَ عن مسارٍ ببصمته.
 * @param path مسارُ الملفّ
 * @param bytes حجمُه الآن كما قيس قبل السؤال
 * @param mtimeNs زمنُ تعديله الآن بالنانو ثانية
 * @returns نسخةٌ من الوثيقة وعُقدُها عند التطابق، و`undefined` عند أيِّ اختلاف
 */
export function memoizedDeclaration(
  path: string, bytes: number, mtimeNs: bigint,
): MemoizedDeclaration | undefined {
  const entry = MEMO.get(path);
  if (!entry) return undefined;
  if (entry.bytes !== bytes || entry.mtimeNs !== mtimeNs) return undefined;
  return { doc: structuredClone(entry.doc), nodes: entry.nodes };
}

/**
 * يُخزّن وثيقةً قُرئت من القرص ببصمتها — تُخزَّن **نسخةً** (الثابت 3).
 * @param path مسارُ الملفّ
 * @param bytes حجمُه كما قيس قبل القراءة
 * @param mtimeNs زمنُ تعديله بالنانو ثانية
 * @param doc الوثيقةُ المُحلَّلة
 * @param nodes عُقدُها المعلنة كما حُسبت مرّةً واحدة
 */
export function memoizeDeclaration(
  path: string, bytes: number, mtimeNs: bigint, doc: Record<string, unknown>, nodes: number,
): void {
  MEMO.set(path, { bytes, mtimeNs, doc: structuredClone(doc), nodes });
}

/**
 * يُنسى المحفوظ — يُنادى في أوّلِ كلِّ إقلاعٍ (الثابت 1) وفي الاختبارات والأدوات.
 * @param path مسارٌ بعينه، أو لا شيءَ فيُنسى الكلّ
 */
export function resetDeclarationMemo(path?: string): void {
  if (path === undefined) MEMO.clear();
  else MEMO.delete(path);
}

/** عددُ المسارات المحفوظةِ الآن — يُقرأ في التقارير والاختبارات لا يُستنتج */
export function declarationMemoSize(): number {
  return MEMO.size;
}
