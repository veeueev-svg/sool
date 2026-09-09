/**
 * scripts/check_rehydrate_census.ts — حاجزُ حصرِ إرجاعِ أصنافِ اليوميّة (المرحلة 39 · W-2026-040)
 * المالك: وزارة البيانات
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: config/persistence.yaml (بمُحلِّلِ المستودعِ نفسِه) · src/data/rehydrate_census.ts
 *   · src/kernel/config/persistence.ts · src/index.ts · src/** — والجذرُ يُوجَّه بـ`SOOL_CHECK_ROOT`
 * المخرجات: رمز 0 إن كان كلُّ صنفٍ في النطاق مُدَّعًى ودعواه قائمةً على **بنيةِ الشفرة**، و1 مع الحكم
 * التبعيات: مُترجمُ TypeScript (شجرةُ النحو) + مُحلِّلُ YAML الداخليّ. لا grep على الشفرة.
 * الصلاحيات (RULE-004): فحصٌ يقرأ ولا يُصلح؛ لا يُضيف دعوى ولا يُعدّل نطاقًا
 * السجلات: خرجٌ نصّي في البوابة
 * اختبار القبول: tests/data/rehydrate_census.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0048-rehydrate-census.md
 *   · القياسُ الخام: docs/test-reports/phase-39-W-2026-040-measurements.txt
 *   · سجلُّ المراجعةِ التي أوجبت هذه الصيغة: docs/test-reports/phase-39-W-2026-040-review-round-1.md
 *
 * ## لماذا كُتب هذا الحاجزُ من جديد
 *
 * صيغتُه الأولى (`check_rehydrate_census.sh`) كانت تُبرهن الاستهلاكَ بـ`grep -qF "'kind'"`،
 * ورفضها المراجعانِ المستقلّانِ معًا بعيبٍ واحد: **تطابقُ السلسلةِ ليس برهانَ استهلاك**.
 * فاسمُ الصنفِ في تعليقٍ أو سطرِ سجلٍّ أو ثابتٍ لا يُقرأ يُخضِّر الحاجزَ، ويمكن حذفُ منطقِ
 * الإرجاعِ كلِّه وإبقاءُ الاسمِ في تعليقٍ فيعود الفقدُ الصامتُ والحاجزُ أخضر.
 *
 * فالبرهانُ هنا **نحويٌّ لا معجميّ**: تُقرأ شجرةُ نحوِ الملفِّ المُدَّعى، ولا تُقبل الدعوى إلّا
 * إن ورد اسمُ الصنفِ في **موضعِ توزيعٍ** له فرعٌ غيرُ فارغ: `case 'kind':` له عبارات (أو يسقط
 * إلى بندٍ له عبارات)، أو مقارنةُ `=== / !==` في شرطٍ فرعُه يعمل. والتعليقاتُ ليست عُقَدًا في
 * الشجرة فلا تُرى أصلًا، والسلسلةُ في نداءِ سجلٍّ ليست موضعَ توزيعٍ فتُرفض.
 *
 * **وحدُّ هذا البرهانِ مُعلَن**: بنيةٌ لا سلوك — يشهد أنّ للصنفِ فرعَ توزيعٍ غيرَ فارغ، ولا يشهد
 * أنّ ما في الفرعِ يُعيد الحالةَ صحيحةً. ذاك يشهد به اختبارُ الرحلةِ الكاملةِ في
 * `tests/data/rehydrate_roundtrip.test.ts` — وهما معًا لا أحدُهما.
 *
 * ## ثوابتُ هذا الفحص
 *
 * 1) **يقرأ من الجذرِ نصًّا لا بالاستيراد**: كلُّ مدخلٍ يُفتح من `SOOL_CHECK_ROOT` ويُحلَّل، فلو
 *    استورد الجدولَ من الحزمةِ المبنيّة لَما رأى تطفيرًا في جذرٍ منسوخ — وحاجزٌ لا يُرى ساقطًا
 *    ليس حاجزًا.
 * 2) **النطاقُ يُقرأ بمُحلِّلِ YAML الحقيقيّ** (`parseSimpleYaml`) لا بنمطٍ سطريّ، **وتُقابل
 *    المجموعاتُ لا الأعداد**: كلُّ عضوٍ في النطاقِ يجب أن يكون عضوًا في التعدادِ المغلق. فسطرٌ
 *    عليه تعليقٌ لاحقٌ يُنتج عضوًا لا وجودَ له في التعدادِ فيسقط — لا يُعَدُّ ويُسكَت عنه.
 * 3) **لكلِّ حكمٍ رمزٌ لاتينيٌّ ثابت** `[RC-NN]`: النصُّ يُنقَّح والرمزُ عقدٌ بين الفحصِ واختباره.
 * 4) **الحصرُ الأعمى يسقط**: مدخلٌ موجودٌ وحصيلتُه صفرٌ يعني أنّ الصيغةَ تغيّرت والفحصُ عَمِي.
 *
 * الاستخدام: node dist/scripts/check_rehydrate_census.js
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { parseSimpleYaml } from '../src/kernel/config/yaml';
import {
  argumentSites, constructionSites, dispatchSites, lineOf, parseFile, producerSites,
  readClaims, readDeclared, readReasons, sourceFiles, walk,
} from './rehydrate_proof';
import type { Claim } from './rehydrate_proof';

const ROOT = process.env.SOOL_CHECK_ROOT ?? '.';
const CFG = join(ROOT, 'config/persistence.yaml');
const CENSUS = join(ROOT, 'src/data/rehydrate_census.ts');
const KINDS = join(ROOT, 'src/kernel/config/persistence.ts');
const BOOT = join(ROOT, 'src/index.ts');
const SRC = join(ROOT, 'src');

let fail = 0;
const say = (s: string): void => { console.log(s); };
const bad = (s: string): void => { fail = 1; console.log(s); };

// ── المدخلات ───────────────────────────────────────────────────────────────────────
say('حاجزُ حصرِ الإرجاع: لكلِّ صنفٍ في النطاق دعوى قائمةٌ على بنيةِ الشفرة (W-2026-040)');
for (const f of [CFG, CENSUS, KINDS, BOOT]) {
  if (!existsSync(f)) {
    say(`✗ [RC-09] مدخلٌ غائب: ${relative(ROOT, f)} — فحصٌ بلا مدخلٍ لا يحكم، ولا يُقال «لا انحراف»`);
    process.exit(1);
  }
}

const censusSf = parseFile(CENSUS);
const claims = readClaims(censusSf);
const declared = readDeclared(parseFile(KINDS));
const reasons = readReasons(censusSf);
const yamlDoc = parseSimpleYaml(readFileSync(CFG, 'utf8'));
const policy = (yamlDoc.policy ?? {}) as Record<string, unknown>;
const rawScope = Array.isArray(policy.scope) ? policy.scope.map((v) => String(v)) : [];

say(`  المقيس: نطاقُ التدوين ${rawScope.length} عنصرًا · جدولُ الدعاوى ${claims.length} صفًّا`
  + ` · التعدادُ المغلق ${declared.length} صنفًا · مُعجمُ الإعفاء ${reasons.length} سببًا`);

// ── [RC-06] حصرٌ أعمى ────────────────────────────────────────────────────────────────
if (rawScope.length === 0 || claims.length === 0 || declared.length === 0 || reasons.length === 0) {
  say(`✗ [RC-06] حصرٌ أعمى: قُرئ ${rawScope.length} من النطاق و${claims.length} من الجدول`
    + ` و${declared.length} من التعداد و${reasons.length} من المُعجم — والمدخلاتُ موجودة.`);
  say('         فالصيغةُ تغيّرت والفحصُ لم يعد يرى ما يحكم عليه. لا يُطبع «✓» على حصرٍ فارغ.');
  process.exit(1);
}

// ── [RC-10] مقابلةُ مجموعاتٍ لا أعداد: كلُّ عضوٍ في النطاقِ عضوٌ في التعدادِ المغلق ─────
const declaredSet = new Set(declared);
const scope: string[] = [];
const seenScope = new Set<string>();
for (const item of rawScope) {
  if (!declaredSet.has(item)) {
    bad(`✗ [RC-10] عضوٌ في نطاق التدوين ليس عضوًا في التعداد المغلق: «${item}»`);
    say('         قُرئ النطاقُ بمُحلِّلِ YAML نفسِه وقوبلت المجموعتان عضوًا عضوًا — فلا يُنجي هنا'
      + ' تعليقٌ لاحقٌ على السطرِ ولا خطأُ كتابةٍ: عضوٌ لا وجودَ له في التعدادِ يسقط ولا يُعَدّ.');
    continue;
  }
  if (seenScope.has(item)) {
    bad(`✗ [RC-10] عضوٌ مكرّرٌ في نطاق التدوين: ${item} — تكرارٌ يُخفي أيَّ سطرٍ حكَم`);
    continue;
  }
  seenScope.add(item);
  scope.push(item);
}

// ── [RC-01] صنفٌ في النطاق بلا صفٍّ في الجدول ────────────────────────────────────────
const byKind = new Map<string, Claim>();
for (const c of claims) byKind.set(c.kind, c);
for (const kind of scope) {
  if (!byKind.has(kind)) {
    bad(`✗ [RC-01] صنفٌ في نطاق التدوين بلا دعوى إرجاع: ${kind}`);
    say('         يُدوَّن على القرص ويُسقَط صمتًا عند الإقلاع — يُضاف صفٌّ في REHYDRATE_CLAIMS أو يُنزع من scope.');
  }
}

// ── فحصُ كلِّ صفّ ────────────────────────────────────────────────────────────────────
const files = sourceFiles(SRC);
let provenConsumers = 0;
let provenExempt = 0;
for (const claim of claims) {
  const { kind, consumer, exemption } = claim;

  if (!declaredSet.has(kind)) {
    bad(`✗ [RC-02] صفٌّ لصنفٍ ليس في التعداد المغلق: ${kind} — لا حرسَ على معدوم (RULE-001).`);
    continue;
  }

  // [RC-11] حرسُ الحصرِ المتبادل ساكنًا — كما يُحرَس في التشغيل
  if (consumer !== null && exemption !== null) {
    bad(`✗ [RC-11] صفٌّ بمستهلكٍ وإعفاءٍ معًا: ${kind} (السطر ${claim.line})`);
    say('         الدعوى واحدةٌ لا اثنتان: مستهلكٌ يُبرهَن أو إعفاءٌ يُبرَّر — والجمعُ يُخفي أيَّهما حكَم.');
    continue;
  }
  if (consumer === null && exemption === null) {
    bad(`✗ [RC-11] صفٌّ بلا مستهلكٍ ولا إعفاء: ${kind} (السطر ${claim.line}) — صفٌّ لا يقول شيئًا لا يُدَّعى به.`);
    continue;
  }

  if (consumer !== null) {
    const path = join(ROOT, consumer);
    if (!existsSync(path)) {
      bad(`✗ [RC-03] مستهلكٌ مُدَّعًى لا وجودَ لملفّه: ${kind} ⇐ ${consumer}`);
      continue;
    }
    const sites = dispatchSites(parseFile(path), kind);
    if (sites.length === 0) {
      bad(`✗ [RC-03] مستهلكٌ مُدَّعًى بلا موضعِ توزيعٍ في شجرةِ نحوِه: ${kind} ⇐ ${consumer}`);
      say('         لا يكفي ذكرُ الاسم: يُطلب بندُ `case` له عباراتٌ أو مقارنةُ هُويّةٍ في شرطٍ له فرعٌ يعمل.');
      say('         واسمٌ في تعليقٍ أو في سطرِ سجلٍّ أو في بندٍ فارغٍ ليس استهلاكًا — وهو أخطرُ من غيابِ الدعوى لأنّه يُطمئن.');
      continue;
    }
    provenConsumers += 1;
    continue;
  }

  if (!reasons.includes(exemption as string)) {
    bad(`✗ [RC-08] سببُ إعفاءٍ خارجَ المُعجم المغلق: ${kind} (الإعفاء: «${exemption}»)`);
    continue;
  }

  if (exemption === 'declared_without_producer') {
    const producers = producerSites(ROOT, files, kind);
    if (producers.length > 0) {
      bad(`✗ [RC-04] إعفاءٌ بطل موجبُه: ${kind} مُعفًى بحجّة «لا مُنتِجَ له» وله مُنتِجٌ في: ${producers.join(' ')}`);
      say('         صارت له حالةٌ تُدوَّن ولا تُستعاد — يُكتب له مستهلكُ إرجاعٍ أو يُنزع من scope.');
      continue;
    }
    provenExempt += 1;
    continue;
  }

  if (exemption === 'compaction_marker') {
    const compactor = join(ROOT, 'src/data/journal_compaction.ts');
    if (!existsSync(compactor)) {
      bad(`✗ [RC-05] إعفاءٌ بحجّة «علامةُ ضغط» ولا ملفَّ ضاغطٍ أصلًا: ${kind}`);
      continue;
    }
    const compactorSf = parseFile(compactor);
    // البرهانُ شقّان لا شقّ: الضاغطُ **يبني** العلامة، والضاغطُ **يقرؤها**. وكلاهما عقدةٌ
    // في الشجرة لا سطرُ نصّ — فتعليقٌ يذكر الاسمَ لا يُنجي هنا.
    const built = constructionSites(compactorSf, kind);
    const used = [...dispatchSites(compactorSf, kind), ...argumentSites(compactorSf, kind)];
    if (built.length === 0 || used.length === 0) {
      bad(`✗ [RC-05] إعفاءٌ بحجّة «علامةُ ضغط» وبرهانُه ناقصٌ في src/data/journal_compaction.ts: ${kind}`
        + ` — مواضعُ بناءٍ ${built.length} · مواضعُ قراءةٍ ${used.length} (يُطلب واحدٌ من كلٍّ)`);
      say('         العلامةُ يُنتجها الضاغطُ ويقرؤها هو نفسُه، فمن سقط أحدُ الشقّين صارت العلامةُ اسمًا لا آلة.');
      continue;
    }
    provenExempt += 1;
    continue;
  }

  bad(`✗ [RC-08] سببُ إعفاءٍ لا حرسَ له في هذا الفحص: ${kind} (الإعفاء: «${exemption}»)`);
}

// ── [RC-07] الحاجزُ منادًى نداءً حقيقيًّا في مسارِ الإقلاع، وقبلَ أوّلِ إرجاع ─────────────
const bootSf = parseFile(BOOT);
let censusCall: ts.CallExpression | undefined;
const rehydrateCalls: ts.CallExpression[] = [];
walk(bootSf, (n) => {
  if (!ts.isCallExpression(n)) return;
  const callee = n.expression;
  const name = ts.isIdentifier(callee) ? callee.text
    : (ts.isPropertyAccessExpression(callee) ? callee.name.text : '');
  if (name === 'assertRehydrateCensus') { censusCall ??= n; return; }
  if (/^rehydrate[A-Z]/.test(name)) rehydrateCalls.push(n);
});
if (censusCall === undefined) {
  bad('✗ [RC-07] حاجزُ الحصر غيرُ منادًى نداءً في مسار الإقلاع (src/index.ts) — والاسمُ في تعليقٍ ليس نداءً (RULE-001).');
} else if (rehydrateCalls.length === 0) {
  bad('✗ [RC-07] لا نداءَ إرجاعٍ واحدٌ في مسار الإقلاع — فالحاجزُ يحرس بابًا لا يُدخَل منه (RULE-001).');
} else {
  const first = Math.min(...rehydrateCalls.map((c) => c.getStart(bootSf)));
  if (censusCall.getStart(bootSf) > first) {
    bad(`✗ [RC-07] الحاجزُ منادًى بعدَ أوّلِ إرجاع (السطر ${lineOf(bootSf, censusCall)} بعد `
      + `${lineOf(bootSf, rehydrateCalls[0] as ts.CallExpression)}) — حكمٌ بعد الفعلِ لا يمنعه.`);
  }
}

// ── [RC-12] عدّادُ الإسقاطِ يقرؤه مسارُ إنتاج، لا مسبارٌ ولا اختبار ─────────────────────
const readers = files.filter((f) => {
  const rel = relative(ROOT, f);
  if (rel === 'src/data/persistence.ts') return false;
  const sf = parseFile(f);
  let found = false;
  walk(sf, (n) => {
    if (ts.isPropertyAccessExpression(n) && (n.name.text === 'droppedByKind' || n.name.text === 'droppedOutOfScope')) found = true;
  });
  return found;
});
if (readers.length === 0) {
  bad('✗ [RC-12] عدّادُ الإسقاطِ لا يقرؤه مسارُ إنتاجٍ واحد: `droppedByKind`/`droppedOutOfScope` مُحصًى ولا يصل أحدًا.');
  say('         خسارةٌ تُعَدُّ في الذاكرةِ ولا تُقرأ ليست معلومةً بل رقمٌ يموت مع العملية (RULE-001).');
} else {
  say(`  قارئو عدّادِ الإسقاطِ في الإنتاج: ${readers.map((f) => relative(ROOT, f)).join(' · ')}`);
}

if (fail === 0) {
  say(`✓ حصرُ الإرجاع: ${scope.length} صنفًا في النطاق كلُّها مُدَّعاة · ${provenConsumers} بمستهلكٍ`
    + ` له موضعُ توزيعٍ في شجرةِ نحوِه · ${provenExempt} بإعفاءٍ قائمِ الموجب · والحاجزُ منادًى قبل أوّلِ إرجاع`);
  say('  وحدُّ هذا البرهانِ مُعلَن: بنيةٌ لا سلوك — يشهد بوجودِ فرعِ توزيعٍ يعمل، لا بصحّةِ ما فيه.');
  say('  صحّةُ ما في الفرعِ يشهد بها اختبارُ الرحلةِ الكاملة: tests/data/rehydrate_roundtrip.test.ts');
}
process.exit(fail);
