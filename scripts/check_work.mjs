#!/usr/bin/env node
/**
 * scripts/check_work.mjs — بوابةُ ضبط العمل (RULE-010 … RULE-017)
 * المالك: القيّم على المستودع | المرحلة: 40
 * المدخلات: docs/work/WORK_QUEUE.json · docs/work/WORK_LOG.md · docs/work/orders/*.md
 *   وفَرقُ المراجعة (git diff) أو المتغيّر WORK_CHANGED_FILES
 * المخرجات: 0 إذا كان العملُ محجوزًا ومملوكًا بلا تداخل | 1 مع بيان المخالفة
 * الصلاحيات (RULE-004): تقرأ ولا تُصلح. لا تُعدّل سجلًّا ولا تُرقّي حالة — الإصلاحُ فعلُ جهة.
 * حالات الفشل المُغطّاة: سجلٌّ غيرُ مقروء · معرّفٌ مكرّر · حالةٌ خارج المعجم · حقلٌ ناقص ·
 *   مالكٌ يراجع نفسَه · نطاقٌ خارج المستودع · نطاقان متداخلان · بندُ PROGRESS محجوزٌ مرّتين ·
 *   عقدٌ مفقود أو ناقصُ الأقسام · معرّفٌ في السجلَّين · صفُّ سجلٍّ ناقص · تغييرٌ بلا حجز ·
 *   تغييرٌ بلا أثرٍ في السجل · تبعيةٌ غيرُ مغلقة · تاريخٌ مقلوب
 * اختبار القبول: tests/governance/work_control.test.ts — `npm test`
 * الوثيقة المرتبطة: docs/work/WORK_CONTROL.md · GOVERNING_RULE.md §RULE-010..017
 *
 * ثوابت هذا الملف:
 *
 * 1) **المعجمُ مغلقٌ في الشفرة، ومُطابَقٌ في البيان**: قائمةُ الحالات معلنةٌ هنا قانونًا،
 *    ويجب أن يطابقها `statuses` في WORK_QUEUE.json حرفًا بحرف — فلا يُخترع حالٌ في البيان،
 *    ولا يتأخّر البيانُ عن القانون.
 *
 * 2) **الحجزُ يُفتح مرّةً ويُغلق مرّة**: البندُ الحيُّ في WORK_QUEUE.json وحده، والمغلقُ في
 *    WORK_LOG.md وحده. وجودُه في الاثنين مخالفة، وغيابُه من الاثنين مع تغييرٍ في نطاقه مخالفة.
 *
 * 3) **لا يُقاس النِّيّةُ بل الفَرق**: بابُ منع التكرار الأخير يقرأ `git diff` ويسأل عن كل
 *    مسارٍ محكوم: مَن حجزه؟ فما لا مالكَ له يُرفض قبل الدمج لا بعده.
 *
 * 4) **فشلٌ مغلق**: كلُّ ما لا يُقرأ يُرفض (لا يُفترض صحيحًا). وغيابُ `.git` يُسقط بابَ الفَرق
 *    وحده — وهو انحرافٌ معلن يُستخدم في الاختبار، ولا يُسقط الأبوابَ الأخرى.
 * 5) **وثائقُ الحالِ مشتركةٌ بإعلانٍ لا مباحةٌ ولا محجوزة** (T-144): SHARED_DOCS يلمسها كلُّ
 *    عملٍ بحكم RULE-000 والخطوةِ 6 من الميثاق، فحجزُها حجزًا مانعًا يُجمّد المستودعَ كلَّه
 *    على بندٍ واحد — وقد قيس ذلك ثلاثَ مرّاتٍ متعاقبة. فلا تُدرَج في scope (والإدراجُ يُرفض)،
 *    ولمسُها يُوجب أن يُسمّيها عقدُ البندِ في §6 «الأثر في الوثائق». فالمشاركةُ بإعلانٍ مقروء.
 *
 * 6) **الحجزُ يُقاس بالهويّة لا بالوجود** (T-144): بابُ الفَرق كان يسأل «ألهذا المسارِ حاجزٌ
 *    حيٌّ أيًّا كان؟» فكانت الكتابةُ في نطاقِ بندٍ آخرَ تمرّ آليًّا — وهو نقيضُ RULE-011.
 *    فصار يسأل عن البندِ **المُعلَنِ** في مِذيال `Work:` من رسالة الالتزام (أو WORK_ITEM في
 *    الاختبار): أهذا المسارُ في نطاقِ هذا البندِ بعينِه؟ وما لا يُعلَن صاحبُه يُرفض.
 *
 * 7) **مدخلُ الفَرقِ لا يُصدَّق كما يُعطى، ومصدرُه يُعلن دائمًا** (T-143): كان
 *    `WORK_CHANGED_FILES` يُقبل بلا سؤالٍ عن أصله، وحكمُ الحجزِ وRULE-015 يقعان على **مجموعِ**
 *    المسارات — فتوسيعُ المدخلِ يزيد أسبابَ القبول، و**تقليمُه يُسقط المخالفةَ من الوجود**.
 *    وقيس ذلك: التزامةٌ واحدةٌ بعينها حُكم عليها بـ1 حين صدق مُشغّلُها وبـ0 حين قلّم مدخلَه.
 *    فصار المدخلُ **يُقابَل بفَرقِ git** ويسقط عند الاختلاف برمزَين مسمَّيَين (أوسعُ · أضيقُ)،
 *    **والحكمُ يقع على الفَرقِ الحقيقيِّ لا على المُعلَن**. ويبقى للمُختبِر مدخلٌ مصطنعٌ بعلامةٍ
 *    صريحةٍ `WORK_DIFF_SOURCE=declared` **تُعلن نفسَها في الخرج**، لأنّ من أغلق البابَ على
 *    المُختبِر أغلقه على نفسه. **وحدُّه المُعلَن**: من وضع العلامةَ متعمّدًا مرّ — فالبوابةُ
 *    تحكم على السهوِ لا على الاحتيال. ومصدرُ الفَرقِ يُطبَع في كلِّ تشغيلٍ بلا استثناء، فلا
 *    يُقرأ «✓» بلا معرفةِ ما قيس.
 *
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.SOOL_WORK_ROOT ?? dirname(HERE);
const QUEUE = 'docs/work/WORK_QUEUE.json';
const LOG = 'docs/work/WORK_LOG.md';
const ORDERS = 'docs/work/orders';
const TEMPLATE = 'docs/work/orders/TEMPLATE.md';

/** المعجمُ المغلق: حالاتُ البند الحيّ (الثابت 1) */
const STATUSES = ['PROPOSED', 'CLAIMED', 'IN_PROGRESS', 'BLOCKED', 'REVIEW', 'VERIFIED'];
/** الحالاتُ التي تحجز النطاق فتمنع غيرَها منه */
const LOCKING = ['CLAIMED', 'IN_PROGRESS', 'BLOCKED', 'REVIEW', 'VERIFIED'];
/** نتائجُ الإغلاق في السجل التاريخي */
const RESULTS = ['MERGED', 'CANCELLED'];
/**
 * العلامةُ الصريحةُ التي تُبيح مدخلَ فَرقٍ مصطنعًا — وتُعلن نفسَها في الخرج (الثابت 7).
 * وموضعُها هنا لا بعد `readChanged` لأنّ البابَ يُشغَّل في المتنِ قبل تعريفِها، فتُقرأ في
 * منطقةِ الموتِ الزمنيّ ويسقط الملفُّ كلُّه بـReferenceError — وقد وقع ذلك فعلًا وقيس.
 */
const DIFF_FLAG = 'WORK_DIFF_SOURCE';
const DIFF_FLAG_VALUE = 'declared';
/** المساراتُ المحكومة: تغييرُها يستلزم حجزًا (الثابت 3) */
const GOVERNED = ['src/', 'tests/', 'scripts/', 'config/', 'docs/', '.github/'];
/** ملفاتُ الجذر المحكومة */
const GOVERNED_FILES = [
  'package.json', 'tsconfig.json', 'version.json', 'GOVERNING_RULE.md',
  'ROADMAP.md', 'PROGRESS.md', 'ARCHITECTURE.md', 'CHANGELOG.md',
  'COMPLETION_CRITERIA.md', 'CONTRIBUTING.md', 'README.md', 'OWNERSHIP.md',
];
/** ملفاتُ الحكم نفسها: يُسمح بتغييرها في التزامة الإغلاق بلا نطاقٍ يشملها */
const SELF = [QUEUE, LOG];
/**
 * وثائقُ الحالِ (الثابت 5): مشتركةٌ بإعلانٍ في §6 من العقد، ولا تُحجَز حجزًا مانعًا.
 * القائمةُ **مغلقةٌ مسمّاةٌ** لا اصطلاحَ اسمٍ — فلا يصير ملفٌّ مشتركًا بأن يُشبه اسمُه اسمَها.
 */
const SHARED_DOCS = ['PROGRESS.md', 'ROADMAP.md', 'CHANGELOG.md', 'version.json'];
/** القسمُ الذي يُعلن فيه البندُ ما يلمسه من وثائق الحال */
const IMPACT = '## 6) الأثر في الوثائق';
const REQUIRED = ['id', 'title', 'owner', 'reviewer', 'area', 'phase', 'status', 'scope', 'acceptance', 'evidence', 'next_step', 'created_at', 'updated_at'];
const SECTIONS = ['## 1) المسألة', '## 2) النطاق المحجوز', '## 3) خارج النطاق', '## 4) معيار القبول', '## 5) الدليل', '## 6) الأثر في الوثائق', '## 7) الخطوة التالية'];
const ID_RE = /^W-\d{4}-\d{3}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const errors = [];
const notes = [];
/** يُعلَنان قبل أوّل نداءٍ لـreport() لأنّ الفشلَ المغلقَ قد يقع قبل قراءة السجلَّين */
let items = [];
const logIds = new Map();
const fail = (m) => errors.push(m);
const abs = (p) => join(ROOT, p);
const read = (p) => readFileSync(abs(p), 'utf8');

// ── 1) السجلُّ الحيُّ مقروءٌ ومعجمُه مطابق ─────────────────────────────────────
for (const p of [QUEUE, LOG, TEMPLATE]) {
  if (!existsSync(abs(p))) fail(`ملفٌّ واجبٌ غيرُ موجود: ${p} — ولا يُحكم عملٌ بسجلٍّ غائب`);
}
if (errors.length > 0) { report(); }

let queue;
try {
  queue = JSON.parse(read(QUEUE));
} catch (e) {
  fail(`${QUEUE} غيرُ مقروءٍ كـJSON: ${e.message} — فشلٌ مغلق (الثابت 4)`);
  report();
}
if (queue.schema_version !== 1) fail(`${QUEUE}: schema_version=${queue.schema_version} غيرُ مدعوم — البوابةُ تعرف 1 وحدَها`);
if (JSON.stringify(queue.statuses) !== JSON.stringify(STATUSES)) {
  fail(`${QUEUE}: حقلُ statuses يخالف المعجمَ المغلقَ في البوابة — المعجم: ${STATUSES.join(' · ')}`);
}
items = Array.isArray(queue.work_items) ? queue.work_items : [];
if (!Array.isArray(queue.work_items)) fail(`${QUEUE}: work_items ليست قائمة`);

// ── 2) كلُّ بندٍ: معرّفٌ ونصابُ حقولٍ وحالٌ من المعجم ────────────────────────
const seen = new Map();
for (const it of items) {
  const id = String(it.id ?? '(بلا معرّف)');
  if (!ID_RE.test(id)) fail(`معرّفٌ لا يوافق الصيغة W-YYYY-NNN: «${id}»`);
  if (seen.has(id)) fail(`معرّفٌ مكرّرٌ في ${QUEUE}: ${id} — والمعرّفُ لا يُعاد استعماله أبدًا`);
  seen.set(id, it);
  for (const f of REQUIRED) {
    const v = it[f];
    const empty = v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
    if (empty) fail(`${id}: حقلٌ واجبٌ ناقصٌ أو فارغ: ${f}`);
  }
  if (it.status !== undefined && !STATUSES.includes(it.status)) {
    fail(RESULTS.includes(it.status)
      ? `${id}: الحالُ ${it.status} لا موضعَ له في ${QUEUE} — انقل البندَ إلى ${LOG} في التزامة الإغلاق نفسِها (الثابت 2)`
      : `${id}: حالٌ خارج المعجم المغلق: «${it.status}»`);
  }
  if (it.owner && it.reviewer && String(it.owner).trim() === String(it.reviewer).trim()) {
    fail(`${id}: المالكُ والمراجعُ جهةٌ واحدة (${it.owner}) — والفصلُ شرطٌ لا تجميل (RULE-004)`);
  }
  if (it.status === 'BLOCKED' && !it.blocked_reason) fail(`${id}: حالُه BLOCKED بلا blocked_reason — والعائقُ الذي لا يُسمّى لا يُرفع`);
  if ((it.status === 'REVIEW' || it.status === 'VERIFIED') && !it.verification) {
    fail(`${id}: حالُه ${it.status} بلا verification — ولا مراجعةَ على دعوى بلا دليلِ تشغيل`);
  }
  for (const d of ['created_at', 'updated_at']) {
    if (it[d] !== undefined && !DATE_RE.test(String(it[d]))) fail(`${id}: ${d}=«${it[d]}» ليس تاريخًا YYYY-MM-DD`);
  }
  if (DATE_RE.test(String(it.created_at)) && DATE_RE.test(String(it.updated_at)) && String(it.updated_at) < String(it.created_at)) {
    fail(`${id}: updated_at (${it.updated_at}) قبل created_at (${it.created_at}) — تاريخٌ مقلوب`);
  }
  for (const s of it.scope ?? []) {
    const p = String(s);
    if (p.startsWith('/') || p.includes('..')) fail(`${id}: نطاقٌ غيرُ مسموح «${p}» — المساراتُ نسبيّةٌ داخل المستودع (RULE-006)`);
    if (p === '' || p === '.' || p === '*' || p === '**' || p === '**/*' || p === '/') {
      fail(`${id}: نطاقٌ يستولي على المستودع كلِّه «${p}» — الحجزُ يُسمّى ولا يُعمّم`);
    }
    if (SHARED_DOCS.includes(p)) {
      fail(`${id}: وثيقةُ حالٍ محجوزةٌ حجزًا مانعًا «${p}» — يلمسها كلُّ عملٍ بحكم RULE-000، فحجزُها يُجمّد المستودعَ على بندٍ واحد. أَخرِجها من scope وأَعلِنها في «${IMPACT}» من عقدِك (T-144)`);
    }
  }
}

// ── 3) العقدُ الورقيُّ لكل بندٍ حيّ ─────────────────────────────────────────────
const tpl = existsSync(abs(TEMPLATE)) ? read(TEMPLATE) : '';
for (const s of SECTIONS) if (tpl && !tpl.includes(s)) fail(`${TEMPLATE}: قسمٌ واجبٌ ناقص «${s}»`);
for (const it of items) {
  const path = `${ORDERS}/${it.id}.md`;
  if (!existsSync(abs(path))) { fail(`${it.id}: لا عقدَ له في ${path} — والبندُ بلا عقدٍ دعوى`); continue; }
  const body = read(path);
  const head = body.split('\n').find((l) => l.startsWith('# ')) ?? '';
  if (!head.includes(it.id)) fail(`${path}: العنوانُ الأوّل لا يذكر ${it.id}`);
  if (it.title && !head.includes(String(it.title))) fail(`${path}: عنوانُ العقد يخالف عنوانَ البند في ${QUEUE}`);
  for (const s of SECTIONS) if (!body.includes(s)) fail(`${path}: قسمٌ واجبٌ ناقص «${s}»`);
  for (const s of it.scope ?? []) if (!body.includes(String(s))) fail(`${path}: النطاقُ «${s}» محجوزٌ في ${QUEUE} ولا يُذكر في العقد`);
}
for (const f of existsSync(abs(ORDERS)) ? readdirSync(abs(ORDERS)) : []) {
  if (!f.endsWith('.md') || f === 'TEMPLATE.md') continue;
  const id = f.slice(0, -3);
  if (!ID_RE.test(id)) fail(`${ORDERS}/${f}: اسمُ الملف ليس معرّفًا W-YYYY-NNN`);
}

// ── 4) لا نطاقان متداخلان، ولا بندُ PROGRESS محجوزٌ مرّتين ────────────────────
const active = items.filter((it) => LOCKING.includes(it.status));
const covers = (claim, path) => path === claim || path.startsWith(claim.endsWith('/') ? claim : `${claim}/`);
const clash = (a, b) => a === b || covers(a, b) || covers(b, a);
for (let i = 0; i < active.length; i += 1) {
  for (let j = i + 1; j < active.length; j += 1) {
    for (const a of active[i].scope ?? []) {
      for (const b of active[j].scope ?? []) {
        if (clash(String(a), String(b))) {
          fail(`تداخلُ نطاقٍ بين بندَين حيَّين: ${active[i].id} («${a}» · ${active[i].owner}) و${active[j].id} («${b}» · ${active[j].owner}) — جهتان تعملان في موضعٍ واحد (RULE-012)`);
        }
      }
    }
  }
}
const claimed = new Map();
for (const it of active) {
  for (const t of it.progress_items ?? []) {
    const key = String(t);
    if (key === 'لا ينطبق') continue;
    if (claimed.has(key)) fail(`بندُ PROGRESS «${key}» محجوزٌ مرّتين: ${claimed.get(key)} و${it.id} — وهذا عينُ التكرار الذي تمنعه البوابة (RULE-013)`);
    else claimed.set(key, it.id);
  }
}

// ── 5) السجلُّ التاريخيّ: صفوفٌ تامّةٌ ومعرّفاتٌ لا تتكرّر ولا تُقيم في السجلَّين ──
const logText = read(LOG);
/** ما بين <!-- و--> شرحٌ للقارئ لا صفوفٌ تُعدّ: تُقفل قراءتُه صراحةً */
let inComment = false;
for (const line of logText.split('\n')) {
  const t = line.trim();
  if (inComment) { if (t.includes('-->')) inComment = false; continue; }
  if (t.startsWith('<!--')) { if (!t.includes('-->')) inComment = true; continue; }
  if (!t.startsWith('|')) continue;
  const cells = t.split('|').slice(1, -1).map((c) => c.trim());
  if (!ID_RE.test(cells[0] ?? '')) continue;
  if (cells.length !== 10) { fail(`${LOG}: صفُّ ${cells[0]} فيه ${cells.length} خليةً والعقدُ 10 خلايا`); continue; }
  const [id, title, owner, reviewer, scope, result, merge, report_, closed, rest] = cells;
  if (logIds.has(id)) fail(`${LOG}: معرّفٌ مكرّر ${id} — سطرُ الإغلاق يُكتب مرّةً واحدة`);
  logIds.set(id, { id, title, owner, reviewer, scope, result, merge, report_, closed, rest });
  if (!RESULTS.includes(result)) fail(`${LOG}: ${id} نتيجتُه «${result}» خارج المعجم (${RESULTS.join(' · ')})`);
  for (const [name, v] of [['العنوان', title], ['المالك', owner], ['المراجع', reviewer], ['النطاق', scope], ['ما بقي', rest]]) {
    if (!v || v === '—') fail(`${LOG}: ${id} خليةُ «${name}» فارغة — والسجلُّ الذي لا يُقرأ لا يمنع تكرارًا`);
  }
  if (!DATE_RE.test(closed)) fail(`${LOG}: ${id} تاريخُ الإغلاق «${closed}» ليس YYYY-MM-DD`);
  if (result === 'MERGED') {
    if (!merge || merge === '—') fail(`${LOG}: ${id} مدموجٌ بلا مرجعِ دمج — ولا يُقبل إغلاقٌ بلا أثرٍ في التاريخ (RULE-014)`);
    const rp = (report_.match(/\(([^)]+)\)/)?.[1] ?? report_).trim();
    if (!rp || rp === '—') fail(`${LOG}: ${id} مدموجٌ بلا تقريرِ اختبار (RULE-008)`);
    else if (!existsSync(abs(rp))) fail(`${LOG}: ${id} يشير إلى تقريرٍ غيرِ موجود: ${rp}`);
  }
  if (seen.has(id)) fail(`${id} مقيمٌ في ${QUEUE} و${LOG} معًا — والحجزُ يُغلق بالنقل لا بالنسخ (الثابت 2)`);
}

// ── 6) التبعياتُ معروفةٌ ولا يُراجَع بندٌ فوق تبعيةٍ مفتوحة ───────────────────
for (const it of items) {
  for (const d of it.dependencies ?? []) {
    const dep = String(d);
    if (dep === 'لا شيء') continue;
    if (!seen.has(dep) && !logIds.has(dep)) { fail(`${it.id}: تبعيةٌ إلى معرّفٍ لا وجودَ له: ${dep}`); continue; }
    const closedOk = logIds.get(dep)?.result === 'MERGED';
    if (!closedOk && (it.status === 'REVIEW' || it.status === 'VERIFIED')) {
      fail(`${it.id}: حالُه ${it.status} وتبعيتُه ${dep} لم تُدمج بعد — ولا يُراجَع بناءٌ على أساسٍ لم يُثبَّت`);
    }
  }
}

// ── 7) بابُ الفَرق: كلُّ مسارٍ محكومٍ تغيّر له مالكٌ حاجزٌ (الثابت 3) ──────────
const diffSource = readChanged();
const changed = diffSource.kind === 'paths' ? diffSource.paths : null;
if (diffSource.kind === 'dropped') {
  notes.push('ℹ بابُ الفَرق مُسقَط: لا تاريخَ git يُقارَن به ولا مدخلَ مُعلَن (انحرافٌ معلن — الثابت 4)');
} else if (changed === null) {
  notes.push('ℹ بابُ الفَرق مُسقَط: مدخلُ الفَرقِ مرفوضٌ فلا يُحكم به (فشلٌ مغلقٌ — الثابت 7)');
} else if (changed.length === 0) {
  notes.push('ℹ بابُ الفَرق: لا مساراتَ في الفَرق');
} else {
  const governedChanges = changed.filter(isGoverned);
  const selfOnly = governedChanges.filter((p) => !SELF.includes(p) && p !== TEMPLATE && !p.startsWith(`${ORDERS}/`));
  const logTouched = changed.includes(LOG);
  const queueTouched = changed.includes(QUEUE);
  const orderTouched = changed.some((p) => p.startsWith(`${ORDERS}/`));
  const claims = [
    ...active.flatMap((it) => (it.scope ?? []).map((s) => ({ id: it.id, owner: it.owner, scope: String(s) }))),
    ...(logTouched ? [...logIds.values()].flatMap((r) => r.scope.split('·').map((s) => ({ id: r.id, owner: r.owner, scope: s.trim().replace(/^`|`$/g, '') }))) : []),
  ].filter((c) => c.scope !== '');
  // وثائقُ الحالِ تُقاس بقاعدةٍ أخرى: مشتركةٌ بإعلانٍ لا محجوزةٌ بنطاق (الثابت 5)
  const sharedTouched = selfOnly.filter((p) => SHARED_DOCS.includes(p));
  const ownedChanges = selfOnly.filter((p) => !SHARED_DOCS.includes(p));
  const declared = declaredItem();
  if (declared === null) {
    if (selfOnly.length > 0) {
      fail(`تغييرٌ محكومٌ بلا بندٍ مُعلَن: ${selfOnly.length} مسارًا تغيّر ولا مِذيالَ «Work: W-YYYY-NNN» في رسالة الالتزام — والحجزُ يُقاس بالهويّة لا بالوجود، فمن لم يُعلن بندَه لم يُقَس عملُه (RULE-011 · GOVERNING_RULE.md قالبُ رسالة الالتزام)`);
    }
  } else if (!seen.has(declared.id) && !logIds.has(declared.id)) {
    fail(`البندُ المُعلَن ${declared.id} (${declared.source}) لا وجودَ له في ${QUEUE} ولا في ${LOG} — ومِذيالٌ يشير إلى لا شيءٍ أسوأُ من لا مِذيال`);
  } else {
    const mine = claims.filter((c) => c.id === declared.id).map((c) => c.scope);
    for (const p of ownedChanges) {
      if (mine.some((s) => covers(s, p))) continue;
      const other = claims.find((c) => covers(c.scope, p));
      if (other) {
        fail(`كتابةٌ في نطاقِ بندٍ آخر: «${p}» محجوزٌ لـ${other.id} (${other.owner}) والعملُ المُعلَن ${declared.id} — ووجودُ حاجزٍ ليس إذنًا لغير صاحبِه (RULE-011 · الثابت 6)`);
      } else {
        fail(`تغييرٌ بلا حجز: «${p}» تغيّر وليس في نطاق ${declared.id} ولا يحجزه بندٌ أخرُ — وسِّع نطاقَك في ${QUEUE} قبل اللمس (RULE-011)`);
      }
    }
    const impact = declaredImpact(declared.id);
    for (const p of sharedTouched) {
      if (impact === null) {
        fail(`وثيقةُ حالٍ لُمست بلا عقدٍ يُقرأ: «${p}» تغيّرت ولا عقدَ لـ${declared.id} في ${ORDERS}/`);
      } else if (!impact.includes(p)) {
        fail(`وثيقةُ حالٍ لُمست بلا إعلان: «${p}» تغيّرت ولا يذكرها «${IMPACT}» من عقد ${declared.id} — والمشتركُ يُعلَن في العقدِ ولا يُحجَز بالنطاق (الثابت 5)`);
      }
    }
  }
  if (selfOnly.length > 0 && !queueTouched && !logTouched) {
    fail(`تغييرٌ محكومٌ بلا أثرٍ في السجل: لا ${QUEUE} ولا ${LOG} تغيّرا — والسجلُّ يُحدَّث مع كل عملٍ لا بعده (RULE-015)`);
  }
  if (selfOnly.length > 0 && !orderTouched && !logTouched) {
    fail(`تغييرٌ محكومٌ بلا أثرٍ في عقده: لا عقدَ في ${ORDERS}/ تغيّر ولا سطرَ إغلاقٍ كُتب (RULE-015)`);
  }
}

report();

// ── الأدوات ──────────────────────────────────────────────────────────────────
function isGoverned(p) {
  return GOVERNED.some((g) => p.startsWith(g)) || GOVERNED_FILES.includes(p);
}

/**
 * البندُ المُعلَنُ لهذا الفَرق (الثابت 6): مِذيالُ `Work:` من رسالة الالتزام، أو WORK_ITEM.
 * ولا يُستنبَط من المسارات المتغيّرة أبدًا: استنباطُ صاحبِ العملِ من العملِ دورٌ يُبطِل الحكم.
 */
function declaredItem() {
  const env = process.env.WORK_ITEM;
  if (env !== undefined && env.trim() !== '') return { id: env.trim(), source: 'متغير WORK_ITEM' };
  if (!existsSync(abs('.git'))) return null;
  const r = spawnSync('git', ['log', '-1', '--pretty=%B'], { cwd: ROOT, encoding: 'utf8' });
  if (r.status !== 0) return null;
  const m = r.stdout.match(/^[ \t]*Work:[ \t]*(W-\d{4}-\d{3})[ \t]*$/m);
  return m === null ? null : { id: m[1], source: 'مِذيال Work: من رسالة الالتزام' };
}

/**
 * أسماءُ وثائقِ الحالِ المُعلَنةُ في §6 من عقدِ بندٍ — أو null إن لا عقدَ يُقرأ.
 * والمقيسُ **ورودُ الاسم** في القسم لا صدقُ ما يُقال عنه — حدٌّ مُعلَنٌ لا يُدَّعى غيرُه.
 */
function declaredImpact(id) {
  const path = `${ORDERS}/${id}.md`;
  if (!existsSync(abs(path))) return null;
  const body = read(path);
  const start = body.indexOf(IMPACT);
  if (start < 0) return null;
  const after = body.slice(start + IMPACT.length);
  const end = after.search(/\n## /);
  const section = end < 0 ? after : after.slice(0, end);
  return SHARED_DOCS.filter((d) => section.includes(d));
}

/** فَرقُ المراجعةِ الحقيقيُّ من تاريخِ git — أو null إن لم يُقرأ */
function gitDiff(base) {
  const r = spawnSync('git', ['diff', '--name-only', base, 'HEAD'], { cwd: ROOT, encoding: 'utf8' });
  if (r.status !== 0) return null;
  return r.stdout.split('\n').map((s) => s.trim()).filter((s) => s !== '').map((s) => posix.normalize(s));
}

/**
 * مصدرُ الفَرقِ الذي يُحكم به (الثابت 7). ويُعلن في `notes` دائمًا، وأحوالُه أربعةٌ لا خامسَ لها:
 *   { kind: 'paths', paths }  — يُحكم بهذه المسارات
 *   { kind: 'dropped' }       — لا تاريخَ git ولا مدخلَ: بابُ الفَرقِ يُسقَط (الثابت 4)
 *   { kind: 'refused' }       — مدخلٌ مُعلَنٌ لا يُقابَل بشيء: فشلٌ مغلقٌ والخطأُ سُجّل
 * ولا يُصدَّق مدخلٌ بلا مقابلةٍ أو علامةٍ صريحة.
 */
function readChanged() {
  const env = process.env.WORK_CHANGED_FILES;
  const base = process.env.WORK_DIFF_BASE ?? 'HEAD^';
  const hasGit = existsSync(abs('.git'));

  if (env === undefined) {
    if (!hasGit) return { kind: 'dropped' };
    const real = gitDiff(base);
    if (real === null) {
      errors.push(`مصدرُ الفَرقِ لا يُقرأ: \`git diff --name-only ${base} HEAD\` سقط في «${ROOT}» — ولا يُحكم على التزامٍ بفَرقٍ مجهول (الثابت 4 · الثابت 7)`);
      return { kind: 'refused' };
    }
    notes.push(`ℹ مصدرُ الفَرق: \`git diff --name-only ${base} HEAD\` — فَرقُ المراجعةِ الحقيقيّ (${real.length} مسارًا)`);
    return { kind: 'paths', paths: real };
  }

  const given = env.split(/[\n,]/).map((s) => s.trim()).filter((s) => s !== '').map((s) => posix.normalize(s));

  if (process.env[DIFF_FLAG] === DIFF_FLAG_VALUE) {
    notes.push(`ℹ مصدرُ الفَرق: WORK_CHANGED_FILES بإذنٍ صريح (${DIFF_FLAG}=${DIFF_FLAG_VALUE}) — تشغيلٌ مصطنعٌ **لا يُحتجُّ به على التزام** (${given.length} مسارًا · الثابت 7)`);
    return { kind: 'paths', paths: given };
  }

  if (!hasGit) {
    errors.push(`مدخلُ فَرقٍ مُعلَنٌ بلا ما يُقابله: WORK_CHANGED_FILES موضوعٌ ولا تاريخَ git في «${ROOT}» — فإن كان تشغيلًا مصطنعًا فأعلِنه بـ${DIFF_FLAG}=${DIFF_FLAG_VALUE}، وإلّا فلا يُصدَّق مدخلٌ لا يُقابَل (T-143 · الثابت 7)`);
    return { kind: 'refused' };
  }

  const real = gitDiff(base);
  if (real === null) {
    errors.push(`مدخلُ فَرقٍ مُعلَنٌ لا يُقابَل: \`git diff --name-only ${base} HEAD\` سقط في «${ROOT}» (T-143 · الثابت 7)`);
    return { kind: 'refused' };
  }

  const wider = given.filter((p) => !real.includes(p));
  const narrower = real.filter((p) => !given.includes(p));
  notes.push(`ℹ مصدرُ الفَرق: WORK_CHANGED_FILES مُقابَلًا بـ\`git diff --name-only ${base} HEAD\` (${given.length} مُعلَنًا · ${real.length} حقيقيًّا) — والحكمُ على الحقيقيّ (الثابت 7)`);
  if (wider.length > 0) {
    errors.push(`مدخلُ فَرقٍ أوسعُ من الحقيقة: ${wider.map((p) => `«${p}»`).join(' · ')} مُعلَنٌ ولم يتغيّر بين ${base} وHEAD — وكلُّ زيادةٍ في المدخلِ زيادةٌ في أسبابِ القبول (T-143 · الثابت 7)`);
  }
  if (narrower.length > 0) {
    errors.push(`مدخلُ فَرقٍ أضيقُ من الحقيقة: ${narrower.map((p) => `«${p}»`).join(' · ')} تغيّر بين ${base} وHEAD ولم يُعلَن — وما أُخفي عن البوابةِ تحكم فيه (T-143 · الثابت 7)`);
  }
  return { kind: 'paths', paths: real };
}

function report() {
  const live = items.filter((it) => LOCKING.includes(it.status)).length;
  const d = declaredItem();
  console.log(`بوابةُ ضبط العمل: ${items.length} بندًا في السجل الحيّ (منها ${live} حاجزٌ للنطاق) · ${logIds.size} بندًا مغلقًا · البندُ المُعلَن: ${d === null ? 'لا شيء' : `${d.id} (${d.source})`} · وثائقُ الحالِ المشتركة: ${SHARED_DOCS.length}`);
  for (const n of notes) console.log(`  ${n}`);
  if (errors.length === 0) {
    console.log('✓ كلُّ عملٍ محجوزٌ ومملوكٌ ومراجَعٌ بلا تداخل — RULE-010..017 مستوفاة');
    process.exit(0);
  }
  for (const e of errors) console.log(`✗ ${e}`);
  console.log(`✗ بوابةُ ضبط العمل ترفض: ${errors.length} مخالفة — الطريقُ في docs/work/WORK_CONTROL.md`);
  process.exit(1);
}
