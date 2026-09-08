/**
 * src/security/confinement.ts — شاهدُ الحصر على مستوى النواة (المرحلة 39 — البند T-16)
 * المالك: وزارة الأمن السيبراني | إكمالُ المعيار C-09
 * المدخلات: جذرُ `/proc` المعلن في `config/confinement.yaml`، وسياسةُ الشروط منه
 *   (وتُقرأ منه `net/route` و`net/ipv6_route` معًا — W-2026-039)
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

/**
 * عددُ أعمدةِ `net/ipv6_route` كما تكتبها النواة. السطرُ الأقصرُ منه سطرٌ غيرُ مكتمل
 * فيُتجاوز ولا يُفسَّر: تفسيرُ سطرٍ ناقصٍ اختراعُ حقيقةٍ لم تكتبها النواة.
 */
const IPV6_ROUTE_COLUMNS = 10;

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
  /** عددُ المسارات الافتراضية **IPv4** إلى خارج الحلقة المحلية (`net/route`) */
  readonly defaultRoutes: number;
  /** عددُ المسارات الافتراضية **IPv6** (`::/0`) من `net/ipv6_route` — W-2026-039 */
  readonly ipv6DefaultRoutes: number;
  /**
   * **كلُّ مسلكٍ على جهازٍ غير `lo`**، افتراضيًّا كان أم لا، في IPv4 وIPv6 جميعًا.
   * وهذا هو المقياسُ المطلقُ الذي يطابق نصَّ C-09: لا «صفرُ بوّاباتٍ افتراضيّة»
   * بل «صفرُ أثرٍ شبكيٍّ خارجيٍّ غيرِ معلن» — وشبكةٌ مجاورةٌ في المتناول أثرٌ خارجي.
   */
  readonly egressRoutes: number;
  /**
   * أحاضرٌ `net/ipv6_route` في هذه النواة؟ غيابُ الملفِّ نفسِه معناه لا مكدّسَ IPv6
   * أصلًا — وهي حقيقةٌ تُعلَن ولا تُسكَت عنها، لئلّا يُقرأ صفرٌ لا يُعرف مصدرُه.
   */
  readonly ipv6StackPresent: boolean;
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
 * تعدادُ المسالك كما تكتبها النواة — ثلاثةُ أرقامٍ تُقرأ مجتمعةً لا رقمٌ واحد (W-2026-039).
 */
interface RouteCensus {
  readonly ipv4Default: number;
  readonly ipv6Default: number;
  /** كلُّ مسلكٍ على جهازٍ غير `lo` في العائلتَين معًا */
  readonly egress: number;
  readonly ipv6StackPresent: boolean;
}

/** وجهةٌ أصفارٌ كلُّها — وهي صيغةُ المسلكِ الافتراضيّ في العائلتَين */
function isZeroDestination(hex: string): boolean {
  return /^0+$/.test(hex);
}

/**
 * `net/route` (IPv4): ترويسةٌ ثمّ أسطرٌ أوّلُ خاناتها اسمُ الجهاز والثانيةُ الوجهة.
 * يُعدّ منها شيءان: المسلكُ الافتراضيُّ، و**كلُّ مسلكٍ** على جهازٍ غير `lo`.
 */
function censusIpv4(root: string): { readonly def: number; readonly egress: number } {
  const text = readProc(root, 'net/route');
  let def = 0;
  let egress = 0;
  for (const line of text.split('\n').slice(1)) {
    const cells = line.trim().split(/\s+/);
    if (cells.length < 3) continue;
    const [iface, destination] = cells as [string, string, ...string[]];
    if (iface === 'lo') continue;
    egress += 1;
    if (isZeroDestination(destination)) def += 1;
  }
  return { def, egress };
}

/**
 * `net/ipv6_route`: **عشرةُ أعمدةٍ بلا ترويسة** — الأوّلُ وجهةٌ من 32 خانةً، والثاني
 * طولُ البادئة، والأخيرُ اسمُ الجهاز. والمسلكُ الافتراضيُّ (`::/0`) وجهةٌ صفريّةٌ
 * **وطولُ بادئةٍ صفر** معًا — والشرطان لازمان، فـ`::1/128` وجهتُه ليست صفرًا.
 *
 * **غيابُ الملفّ ليس عجزًا عن القراءة**: نواةٌ بُنيت بلا `CONFIG_IPV6` لا تكتب هذا
 * الملفّ أصلًا، ولا مسلكَ IPv6 فيها بالضرورة. فيُقرأ صفرًا **ويُعلَن مصدرُ الصفر**
 * في `ipv6StackPresent` وفي نصّ القياس، فلا يُقرأ صفرٌ لا يُعرف أمن قياسٍ هو أم من غياب.
 * وما عدا الغيابِ من أسبابِ التعذّر (إذنٌ ممنوع مثلًا) يبقى خرقًا مغلقًا (الثابت 2).
 */
function censusIpv6(root: string): {
  readonly def: number; readonly egress: number; readonly present: boolean;
} {
  let text: string;
  try {
    text = readFileSync(join(root, 'net/ipv6_route'), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { def: 0, egress: 0, present: false };
    }
    throw new SovereignViolation(
      `شاهدُ الحصر غير مقروء: ${join(root, 'net/ipv6_route')}`, 'CONFINEMENT_FACTS_UNREADABLE',
    );
  }
  let def = 0;
  let egress = 0;
  for (const line of text.split('\n')) {
    const cells = line.trim().split(/\s+/);
    if (cells.length < IPV6_ROUTE_COLUMNS) continue;
    const destination = cells[0]!;
    const prefixLength = cells[1]!;
    const device = cells[cells.length - 1]!;
    if (device === 'lo') continue;
    egress += 1;
    if (isZeroDestination(destination) && isZeroDestination(prefixLength)) def += 1;
  }
  return { def, egress, present: true };
}

/**
 * يعدّ طرقَ الخروج في العائلتَين معًا. سببُ القياس بهذه الصورة: مجالٌ شبكيٌّ فارغٌ
 * فيه `lo` وحدها لا مسلكَ خروجٍ فيه بتاتًا، فالنواةُ تردّ `ENETUNREACH` قبل أن تُنادى
 * شيفرةُ الدولة. وهذا هو المقياس لا الدعوى.
 *
 * **لماذا ثلاثةُ أرقامٍ لا رقمٌ واحد** (W-2026-039): كان الشاهدُ يعدّ المسلكَ
 * الافتراضيَّ في IPv4 وحدَه، فكانت عمليّةٌ لها `::/0` على `eth0` تُعلَن «محصورة»،
 * وكذلك من لها مسلكٌ إلى شبكةٍ مجاورةٍ بلا بوّابةٍ افتراضيّة. وقُيس ذلك قبل العلاج
 * في docs/test-reports/phase-39-W-2026-039-measurements.txt §1.
 */
function censusRoutes(root: string): RouteCensus {
  const v4 = censusIpv4(root);
  const v6 = censusIpv6(root);
  return {
    ipv4Default: v4.def,
    ipv6Default: v6.def,
    egress: v4.egress + v6.egress,
    ipv6StackPresent: v6.present,
  };
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
  // تُقرأ حقولُ `status` أوّلًا ثمّ المسالك: بنيةٌ مشوّهةٌ تُرفض بـMALFORMED لا
  // بـUNREADABLE، فترتيبُ القراءةِ هو الذي يُسمّي الخرقَ باسمه الصحيح.
  const uid = Number(field(status, 'Uid').split(/\s+/)[0]);
  const effectiveCapabilities = field(status, 'CapEff');
  const boundingCapabilities = field(status, 'CapBnd');
  const noNewPrivileges = field(status, 'NoNewPrivs') === '1';
  const seccompMode = Number(field(status, 'Seccomp'));
  const routes = censusRoutes(witnessRoot);
  return {
    uid,
    effectiveCapabilities,
    boundingCapabilities,
    noNewPrivileges,
    seccompMode,
    interfaces: readInterfaces(witnessRoot),
    defaultRoutes: routes.ipv4Default,
    ipv6DefaultRoutes: routes.ipv6Default,
    egressRoutes: routes.egress,
    ipv6StackPresent: routes.ipv6StackPresent,
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
      // ثلاثةُ شروطٍ لا واحد: لا بوّابةَ IPv4، ولا بوّابةَ IPv6، ولا مسلكَ خروجٍ أصلًا
      ok: facts.defaultRoutes === 0
        && facts.ipv6DefaultRoutes === 0
        && facts.egressRoutes === 0,
      measured: `افتراضي v4=${facts.defaultRoutes} · افتراضي v6=${facts.ipv6DefaultRoutes}`
        + ` · مسالكُ خروج=${facts.egressRoutes}`
        + ` · مكدّس IPv6=${facts.ipv6StackPresent ? 'حاضر' : 'غائب'}`
        + ` · واجهات=${facts.interfaces.join('،')}`,
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
