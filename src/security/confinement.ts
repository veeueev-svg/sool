/**
 * src/security/confinement.ts — شاهدُ الحصر على مستوى النواة (المرحلة 39 — البند T-16)
 * المالك: وزارة الأمن السيبراني | إكمالُ المعيار C-09
 * المدخلات: جذرُ `/proc` المعلن في `config/confinement.yaml`، وسياسةُ الشروط منه
 * المخرجات: `ConfinementFacts` (ما تقوله النواة) و`ConfinementVerdict` (ما ينقص منه)
 * التبعيات: نظامُ الملفات للقراءة فقط — ولا تنفيذَ أمرٍ خارجي ولا شبكة
 * الصلاحيات: **القراءةُ وحدها.** لا تُصلح هذه الوحدة حصرًا ولا تُنشئه ولا تُنزله؛
 *            من يُنشئ الحصر هو مُشغِّل الحاوية، وهذه الوحدة تشهد عليه لا تنوب عنه
 * السجلات: لا تكتب — من يُقيّد الحادث هو المراقب الدائم (فصلُ الأدوار، RULE-004)
 *
 * لماذا وُجدت: قاس المدقّق في C-09 أن الرفضَ هو الافتراض داخل العملية، ثم أعلن الفجوة
 * بنصّها: «المنعُ تطبيقيٌّ داخل العملية فقط». والفرقُ ليس لفظيًّا: بوابةُ
 * `NetworkEgressGuard` تمنع من **ينادي البوابة**، ومن يفتح مقبسًا بغيرها لا تراه.
 * فالسؤال الذي تجيب عنه هذه الوحدة سؤالٌ واحد: هل تستطيع هذه العمليّة الخروجَ لو
 * تجاوزت شيفرتَنا كلَّها؟ والجوابُ لا يُؤخذ من دعوى، بل من `/proc`.
 *
 * ثوابت هذه الوحدة:
 *   1) **الحقيقةُ من النواة لا من الإعلان**: كل قيمةٍ هنا مقروءةٌ من ملفٍ في `/proc`
 *      تكتبه النواةُ نفسها. لا مُعامل يُمرَّر ليقول «أنا محصور».
 *   2) **العجزُ عن القراءة خرقٌ لا صمت**: `/proc` غيرُ مقروء ⇒ رفضٌ مغلق برمزه.
 *      من لا يستطيع إثبات حصره فهو غير محصور (RULE-007).
 *   3) **الجذرُ مُعامل لا ثابت**: يُبدَّل في الاختبار بجذرٍ مُصطنع، فيُقاس الحكمُ على
 *      حالاتٍ لا تُصنع في هذه البيئة (نواةٌ محصورة تمامًا) بلا إضعافِ القياس.
 *   4) **الشاهدُ لا يُصنّف شدّة**: الشدّةُ من `config/production.yaml` وحدها (RULE-005).
 * حالات الفشل (كلها مغلقة): ملفٌ غائب أو غيرُ مقروء ⇒ CONFINEMENT_FACTS_UNREADABLE؛
 *   حقلٌ متوقَّع غيرُ موجود في `status` ⇒ CONFINEMENT_FACTS_MALFORMED
 * اختبار القبول: tests/security/confinement.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0026-kernel-confinement.md
 */
import { readFileSync, readlinkSync } from 'node:fs';
import { join } from 'node:path';
import { SovereignViolation } from '../kernel/types';
import { ConfinementConfig, ConfinementRequirement } from '../kernel/config';

/** ما تقوله النواةُ عن العمليّة الجارية — لا رأيَ فيها ولا تفسير */
export interface ConfinementFacts {
  readonly uid: number;
  /** CapEff — القدراتُ الفعّالة الآن، بصيغتها السّتّ عشرية كما تكتبها النواة */
  readonly effectiveCapabilities: string;
  /** CapBnd — سقفُ ما يمكن اكتسابه لاحقًا؛ غيرُ الصفر يعني أن القدرة تُستعاد */
  readonly boundingCapabilities: string;
  readonly noNewPrivileges: boolean;
  /** Seccomp — 0 معطَّل، 1 صارم، 2 مِصفاة */
  readonly seccompMode: number;
  /** الواجهاتُ الشبكية القائمة (بأسمائها) — الحلقةُ المحلية ليست خروجًا */
  readonly interfaces: readonly string[];
  /** عددُ المسارات الافتراضية إلى خارج الحلقة المحلية — صفرٌ يعني لا طريقَ خروج */
  readonly defaultRoutes: number;
  readonly readOnlyRoot: boolean;
  /** مُعرّفُ المجال الشبكي (inode) — يُدوَّن للقياس ولا يُشترط بذاته */
  readonly networkNamespace: string;
}

export interface ConfinementFailure {
  readonly requirement: ConfinementRequirement;
  /** ما وجدته النواةُ فعلًا — الرقمُ لا الوصف، فالتقريرُ يُعاد قياسُه */
  readonly measured: string;
  readonly reason: string;
}

export interface ConfinementVerdict {
  readonly confined: boolean;
  readonly failures: readonly ConfinementFailure[];
  readonly facts: ConfinementFacts;
}

function readProc(root: string, relative: string): string {
  try {
    return readFileSync(join(root, relative), 'utf8');
  } catch {
    // ثابت 2: العجزُ عن القراءة خرقٌ مغلق — لا تُخمَّن حالةُ حصرٍ لا تُقرأ
    throw new SovereignViolation(
      `شاهدُ الحصر غير مقروء: ${join(root, relative)}`, 'CONFINEMENT_FACTS_UNREADABLE',
    );
  }
}

function field(status: string, name: string): string {
  const match = new RegExp(`^${name}:\\s*(.+)$`, 'm').exec(status);
  if (!match) {
    throw new SovereignViolation(
      `حقلٌ متوقَّع غير موجود في شاهد الحصر: ${name}`, 'CONFINEMENT_FACTS_MALFORMED',
    );
  }
  return match[1]!.trim();
}

/** القدرةُ صفرٌ إن كانت كلُّ خاناتها أصفارًا — تُقرأ نصًّا لا رقمًا (64 بتًّا) */
function isZeroMask(hex: string): boolean {
  return /^0+$/.test(hex.trim());
}

function readInterfaces(root: string): readonly string[] {
  const text = readProc(root, 'net/dev');
  const names: string[] = [];
  for (const line of text.split('\n').slice(2)) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const name = line.slice(0, idx).trim();
    if (name !== '') names.push(name);
  }
  return names;
}

/**
 * يعدّ المسارات الافتراضية (الوجهة 00000000) على واجهةٍ ليست الحلقة المحلية.
 * سببُ القياس بهذه الصورة: مجالٌ شبكيٌّ فارغٌ فيه `lo` وحدها لا مسارَ افتراضي فيه،
 * فالنواةُ تردّ `ENETUNREACH` قبل أن تُنادى شيفرةُ الدولة. وهذا هو المقياس لا الدعوى.
 */
function countDefaultRoutes(root: string): number {
  const text = readProc(root, 'net/route');
  let count = 0;
  for (const line of text.split('\n').slice(1)) {
    const cells = line.trim().split(/\s+/);
    if (cells.length < 3) continue;
    const [iface, destination] = cells as [string, string, ...string[]];
    if (iface === 'lo') continue;
    if (/^0+$/.test(destination)) count += 1;
  }
  return count;
}

function readReadOnlyRoot(root: string): boolean {
  const text = readProc(root, 'self/mountinfo');
  for (const line of text.split('\n')) {
    const cells = line.trim().split(/\s+/);
    // الحقلُ الخامس نقطةُ التركيب، والسادس خياراتُها — بترتيب mountinfo المعلن
    if (cells.length < 6 || cells[4] !== '/') continue;
    return cells[5]!.split(',').includes('ro');
  }
  return false;
}

/** ثابت 1 + 3: الحقائقُ من النواة، والجذرُ مُعامل ليُقاس ما لا تصنعه هذه البيئة */
export function readConfinementFacts(witnessRoot: string): ConfinementFacts {
  const status = readProc(witnessRoot, 'self/status');
  // مُعرّفُ المجال رابطٌ رمزي في `/proc` الحقيقي وملفٌّ عادي في الجذر المُصطنع.
  // غيابُه لا يُرفَع خرقًا لأنه لا يُشترط بذاته — يُدوَّن للقياس فقط (ثابت 4).
  const namespace = (() => {
    const path = join(witnessRoot, 'self/ns/net');
    try {
      return readlinkSync(path);
    } catch {
      try {
        return readFileSync(path, 'utf8').trim();
      } catch {
        return 'غير معروف';
      }
    }
  })();
  return {
    uid: Number(field(status, 'Uid').split(/\s+/)[0]),
    effectiveCapabilities: field(status, 'CapEff'),
    boundingCapabilities: field(status, 'CapBnd'),
    noNewPrivileges: field(status, 'NoNewPrivs') === '1',
    seccompMode: Number(field(status, 'Seccomp')),
    interfaces: readInterfaces(witnessRoot),
    defaultRoutes: countDefaultRoutes(witnessRoot),
    readOnlyRoot: readReadOnlyRoot(witnessRoot),
    networkNamespace: namespace,
  };
}

type Test = { readonly ok: boolean; readonly measured: string; readonly reason: string };

function evaluate(facts: ConfinementFacts): Readonly<Record<ConfinementRequirement, Test>> {
  return {
    non_root: {
      ok: facts.uid !== 0,
      measured: `uid=${facts.uid}`,
      reason: 'العمليّة تعمل بالجذر — أوّلُ حدٍّ غائب وما بعده لا يُعتدّ به',
    },
    no_effective_capabilities: {
      ok: isZeroMask(facts.effectiveCapabilities),
      measured: `CapEff=${facts.effectiveCapabilities}`,
      reason: 'قدراتٌ فعّالة قائمة — العمليّة تملك صلاحية نواة',
    },
    empty_bounding_set: {
      ok: isZeroMask(facts.boundingCapabilities),
      measured: `CapBnd=${facts.boundingCapabilities}`,
      reason: 'مجموعةُ الحدّ غير فارغة — القدرةُ تُستعاد بملفٍ ذي قدرات أو setuid',
    },
    no_new_privileges: {
      ok: facts.noNewPrivileges,
      measured: `NoNewPrivs=${facts.noNewPrivileges ? 1 : 0}`,
      reason: 'اكتسابُ صلاحياتٍ جديدة ممكن — طريقُ setuid مفتوح',
    },
    seccomp_filter: {
      ok: facts.seccompMode === 2,
      measured: `Seccomp=${facts.seccompMode}`,
      reason: 'لا مِصفاةَ نداءاتِ نظام — سطحُ النواة كاملٌ أمام العمليّة',
    },
    read_only_root: {
      ok: facts.readOnlyRoot,
      measured: `root=${facts.readOnlyRoot ? 'ro' : 'rw'}`,
      reason: 'جذرُ نظام الملفات قابلٌ للكتابة — تُبدَّل الشيفرةُ في زمن التشغيل',
    },
    default_deny_egress: {
      ok: facts.defaultRoutes === 0,
      measured: `مسارات افتراضية=${facts.defaultRoutes} واجهات=${facts.interfaces.join('،')}`,
      reason: 'طريقُ خروجٍ قائم في النواة — فالمنعُ تطبيقيٌّ وحده وهو فجوةُ C-09',
    },
  };
}

/**
 * يقابل الحقائقَ بالشروط المعلنة ويعيد ما نقص بسببه. لا يرمي: العجزُ عن الحصر ليس
 * خطأً برمجيًّا بل حالةُ تشغيلٍ تُقاس ثم يحكم عليها من يملك الحكم — المراقبُ في
 * الإنتاج، والمدقّقُ في التدقيق. وهذا هو الفرق بين الشاهد والقاضي (RULE-004).
 */
export function verifyConfinement(
  policy: ConfinementConfig['policy'],
  facts: ConfinementFacts,
): ConfinementVerdict {
  const tests = evaluate(facts);
  const failures: ConfinementFailure[] = [];
  for (const [requirement, test] of Object.entries(tests) as [ConfinementRequirement, Test][]) {
    if (policy.require[requirement] !== true) continue;
    if (test.ok) continue;
    failures.push({ requirement, measured: test.measured, reason: test.reason });
  }
  return { confined: failures.length === 0, failures, facts };
}

/**
 * شاهدُ الحصر بصيغةٍ يقرؤها الماسحُ الإنتاجي: يُعيد القياسَ في كل مسحة، فلا تُخزَّن
 * حالةٌ قديمة. لو نُقلت العمليّة إلى مجالٍ شبكيٍّ مفتوح بعد الإقلاع لَظهر ذلك.
 */
export interface ConfinementWitness {
  readonly witnessRoot: string;
  verify(): ConfinementVerdict;
}

export function confinementWitness(policy: ConfinementConfig['policy']): ConfinementWitness {
  return {
    witnessRoot: policy.witness_root,
    verify: () => verifyConfinement(policy, readConfinementFacts(policy.witness_root)),
  };
}
