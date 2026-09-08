/**
 * tests/security/proc_fixture.ts — جذرُ شاهدٍ مُصطنع لقياس الحصر (المرحلة 39، T-16)
 * المالك: ديوان التدقيق
 * المدخلات: تفاصيلُ حقائقٍ يريدها المختبِر | المخرجات: مجلدٌ يشبه `/proc` بنيةً ونصًّا
 * التبعيات: `node:fs` و`node:os` فقط
 * الصلاحيات: الكتابةُ في مجلدٍ مؤقّت وحده — لا يلمس `/proc` الحقيقي ولا يزعم تغييره
 * السجلات: لا شيء | حالات الفشل: يرمي إن تعذّرت الكتابة، فلا اختبارَ على جذرٍ ناقص
 * اختبار القبول: tests/security/confinement.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0026-kernel-confinement.md
 * ثوابت هذا المهاد:
 *   1) **الجذرُ المُصطنع لا يُثبت حصرًا**: يُثبت أن القارئ يقرأ ما يُكتب له. الحصرُ
 *      الحقيقي يُقاس بمسبار `scripts/confinement_probe.ts` على النواة نفسها.
 *   2) **النصُّ بصيغة النواة حرفًا**: أعمدةُ `net/route` وحقولُ `self/mountinfo`
 *      بترتيبها المعلن، فلو غيّر القارئُ تفسيرَه سقط الاختبار لا مرّ.
 */
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface FakeFacts {
  readonly uid: number;
  readonly capEff: string;
  readonly capBnd: string;
  readonly noNewPrivs: 0 | 1;
  readonly seccomp: 0 | 1 | 2;
  /** واجهاتٌ غير الحلقة المحلية — المجالُ الفارغ لا شيء فيه غير `lo` */
  readonly interfaces: readonly string[];
  /** مسارٌ افتراضي IPv4 على واجهةٍ غير `lo` — وجودُه معناه بوابةُ خروج */
  readonly defaultRoute: boolean;
  /** مسارٌ افتراضي **IPv6** (`::/0`) على واجهةٍ غير `lo` — البقعةُ العمياءُ في W-2026-039 */
  readonly ipv6DefaultRoute?: boolean;
  /** مسارُ IPv4 **غيرُ افتراضيٍّ** إلى شبكةٍ مجاورة (`192.168.0.0/24`) على واجهةٍ غير `lo` */
  readonly localRoute?: boolean;
  /** مسارُ IPv6 غيرُ افتراضيٍّ (`fe80::/64`) على واجهةٍ غير `lo` */
  readonly ipv6LinkLocalRoute?: boolean;
  /**
   * أَيُكتب `net/ipv6_route` أصلًا؟ الافتراضُ نعم — ونواةٌ بلا مكدّسِ IPv6 لا ملفَّ لها،
   * وهي حالةٌ تُقاس صراحةً لأنّ غيابَ الملفِّ حقيقةٌ لا عجزٌ عن القراءة (W-2026-039).
   */
  readonly ipv6Stack?: boolean;
  readonly readOnlyRoot: boolean;
}

/** عمليّةٌ محصورةٌ بكل الشروط السبعة — أضيقُ ما يقبله `verifyConfinement` */
export const CONFINED: FakeFacts = {
  uid: 10001,
  capEff: '0000000000000000',
  capBnd: '0000000000000000',
  noNewPrivs: 1,
  seccomp: 2,
  interfaces: [],
  defaultRoute: false,
  readOnlyRoot: true,
};

/** عمليّةٌ كبيئة هذا المستودع: لا جذر ولا قدرات، وكلُّ ما بعدهما مفتوح */
export const UNCONFINED: FakeFacts = {
  uid: 2000,
  capEff: '0000000000000000',
  capBnd: '000001ffffffffff',
  noNewPrivs: 0,
  seccomp: 0,
  interfaces: ['eth0'],
  defaultRoute: true,
  readOnlyRoot: false,
};

function statusText(f: FakeFacts): string {
  return [
    'Name:\tnode',
    `Uid:\t${f.uid}\t${f.uid}\t${f.uid}\t${f.uid}`,
    `Gid:\t${f.uid}\t${f.uid}\t${f.uid}\t${f.uid}`,
    'CapInh:\t0000000000000000',
    `CapPrm:\t${f.capEff}`,
    `CapEff:\t${f.capEff}`,
    `CapBnd:\t${f.capBnd}`,
    'CapAmb:\t0000000000000000',
    `NoNewPrivs:\t${f.noNewPrivs}`,
    `Seccomp:\t${f.seccomp}`,
    '',
  ].join('\n');
}

function devText(f: FakeFacts): string {
  const header = 'Inter-|   Receive\n face |bytes    packets\n';
  const rows = ['lo', ...f.interfaces]
    .map((name) => `${name.padStart(6)}: 0 0 0 0 0 0 0 0`)
    .join('\n');
  return `${header}${rows}\n`;
}

function routeText(f: FakeFacts): string {
  const header = 'Iface\tDestination\tGateway \tFlags\tRefCnt\tUse\tMetric\tMask';
  const rows: string[] = [];
  const iface = f.interfaces[0] ?? 'eth0';
  if (f.defaultRoute) {
    rows.push(`${iface}\t00000000\t0100FEA9\t0003\t0\t0\t0\t00000000`);
    rows.push(`${iface}\t0000FEA9\t00000000\t0001\t0\t0\t0\t0000FFFF`);
  }
  // مسلكٌ غيرُ افتراضيٍّ إلى 192.168.0.0/24: لا وجهةَ صفريّةَ فيه، ومع ذلك هو طريقُ خروج
  if (f.localRoute === true) {
    rows.push(`${iface}\t0000A8C0\t00000000\t0001\t0\t0\t0\t00FFFFFF`);
  }
  // مسلكُ الحلقةِ المحليّةِ نفسِه: يُكتب دائمًا ولا يُعدّ خروجًا — مقياسُ عدمِ الضجيج
  rows.push('lo\t0000007F\t00000000\t0001\t0\t0\t0\t000000FF');
  return `${header}\n${rows.join('\n')}\n`;
}

/**
 * `net/ipv6_route` بصيغةِ النواة حرفًا: عشرةُ أعمدةٍ **بلا ترويسة**، الأوّلُ وجهةٌ من
 * 32 خانةً ستّ عشرية، والثاني طولُ البادئةِ ست عشريًّا، والأخيرُ اسمُ الجهاز.
 */
function ipv6RouteText(f: FakeFacts): string {
  const iface = f.interfaces[0] ?? 'eth0';
  const zero = '0'.repeat(32);
  const rows: string[] = [];
  if (f.ipv6DefaultRoute === true) {
    rows.push(`${zero} 00 ${zero} 00 fe80${'0'.repeat(27)}1 00000400 00000000 00000000 00000003     ${iface}`);
  }
  if (f.ipv6LinkLocalRoute === true) {
    rows.push(`fe80${'0'.repeat(28)} 40 ${zero} 00 ${zero} 00000100 00000001 00000000 00000001     ${iface}`);
  }
  // مدخلانِ على `lo` يوجدان في كلِّ نواةٍ حتى في المجال الفارغ — ومنهما وجهةٌ صفريّة:
  // فلو عُدَّت الوجهةُ الصفريّةُ بلا نظرٍ إلى الجهاز لَسقط المجالُ المحصورُ زورًا
  rows.push(`${zero} 00 ${zero} 00 ${zero} ffffffff 00000001 00000000 00200200       lo`);
  rows.push(`${'0'.repeat(31)}1 80 ${zero} 00 ${zero} 00000000 00000003 00000000 80200001       lo`);
  return `${rows.join('\n')}\n`;
}

function mountinfoText(f: FakeFacts): string {
  const options = f.readOnlyRoot ? 'ro,relatime' : 'rw,relatime';
  return [
    `1 1 0:1 / / ${options} shared:1 - overlay overlay ${options}`,
    '2 1 0:2 / /tmp rw,nosuid - tmpfs tmpfs rw',
    '',
  ].join('\n');
}

/** يكتب جذرًا مُصطنعًا ويعيد مساره — على المُنادي حذفُه بـ`rmSync` */
export function writeFakeProc(facts: FakeFacts): string {
  const root = mkdtempSync(join(tmpdir(), 'sool-proc-'));
  mkdirSync(join(root, 'self/ns'), { recursive: true });
  mkdirSync(join(root, 'net'), { recursive: true });
  writeFileSync(join(root, 'self/status'), statusText(facts), 'utf8');
  writeFileSync(join(root, 'self/mountinfo'), mountinfoText(facts), 'utf8');
  writeFileSync(join(root, 'net/dev'), devText(facts), 'utf8');
  writeFileSync(join(root, 'net/route'), routeText(facts), 'utf8');
  // الافتراضُ نواةٌ ذاتُ مكدّسِ IPv6؛ و`ipv6Stack: false` يحاكي نواةً بلا ملفٍّ أصلًا
  if (facts.ipv6Stack !== false) {
    writeFileSync(join(root, 'net/ipv6_route'), ipv6RouteText(facts), 'utf8');
  }
  // في `/proc` الحقيقي رابطٌ رمزي؛ وهنا ملفٌّ عادي يقرأه القارئُ بالبديل المعلن
  writeFileSync(join(root, 'self/ns/net'), 'net:[4026999999]', 'utf8');
  return root;
}
