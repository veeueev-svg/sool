/**
 * src/security/egress_manifest.ts — توليدُ منشورات الحصر من الإعلان الواحد
 * المالك: وزارة الأمن السيبراني | المرحلة: 39 (البند T-16 — إكمالُ C-09)
 * المدخلات: `ExternalConfig` (النظائرُ المعلنة) و`ConfinementConfig` (شروطُ الحصر)
 * المخرجات: نصوصُ منشوراتٍ ثلاثة: منعٌ افتراضي، سماحٌ بالمعلن، ووصفُ تشغيلٍ متقشّف
 * التبعيات: التهيئةُ وحدها — لا نظامَ ملفات ولا شبكة ولا عشوائية ولا وقت
 * الصلاحيات: التوليدُ نصًّا؛ ولا تكتب هذه الوحدة ملفًّا — الكاتبُ هو السكربت
 * السجلات: لا شيء — التوليدُ دالةٌ نقيّة تُعاد فتُعطي البايتَ نفسه
 *
 * لماذا التوليد لا الكتابة اليدوية: القاعدة RULE-005 تقول «السياسة واحدة لا اثنتان».
 * لو كُتبت قائمةُ المضيفين في `infra/` بيدٍ ثانية لصار للدولة سياستان: واحدةٌ يقرؤها
 * التطبيق (`config/external.yaml`) وأخرى تُنفّذها الحاوية. وتناقضُهما لا يظهر بالمراجعة
 * بالعين: إما أن تمنع الحاوية ما يسمح به التطبيق (فيُوسَّع المنشورُ لتمشي الخدمة، وهذه
 * أخطرُ صور الانحراف)، أو أن تسمح الحاوية بما يمنعه التطبيق (فتبقى نافذةٌ لا تراها
 * البوابة). فالمنشورُ مولَّد، والمقابلةُ بايتيّة في `scripts/check_confinement.ts`.
 *
 * ثوابت هذه الوحدة:
 *   1) **دالةٌ نقيّة**: نفسُ المدخل يعطي نفسَ البايت — وإلا لم تصحّ المقابلة البايتية
 *   2) **لا مضيفَ من الشيفرة**: كل اسمٍ في الخرج مأخوذٌ من `counterparties` حرفيًّا
 *   3) **المنعُ أوّلًا**: منشورُ المنع الافتراضي لا يذكر استثناءً، فلو فُقد منشورُ
 *      السماح بقيت الدولةُ مغلقةً لا مفتوحة (RULE-007)
 *   4) **الترتيبُ ثابت**: النظائرُ تُرتَّب بمعرّفها قبل الكتابة، فلا يُغيّر ترتيبُ
 *      التهيئة بايتَ الخرج فيُظنّ انحرافًا ما هو إعادةُ صَفّ
 * حالات الفشل (كلها مغلقة): نظيرٌ بمضيفٍ فارغ أو منفذٍ غير صحيح ⇒
 *   EGRESS_MANIFEST_UNDECLARED_HOST (لا يُولَّد منشورٌ من إعلانٍ ناقص)
 * اختبار القبول: tests/security/egress_manifest.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0026-kernel-confinement.md
 */
import { SovereignViolation } from '../kernel/types';
import { ConfinementConfig, ExternalConfig } from '../kernel/config';

export interface EgressManifests {
  /** منعُ كل خروجٍ — منشورٌ قياسي يفهمه كلُّ عنقود بلا إضافةٍ من المُشغِّل */
  readonly defaultDeny: string;
  /** السماحُ بالمعلن وحده — بأسماء المضيفين، فيلزمه مُشغِّلٌ يفهم `toFQDNs` */
  readonly allowlist: string;
  /** وصفُ تشغيلٍ متقشّف — كلُّ شرطٍ في `require` له سطرٌ يُنفّذه هنا */
  readonly runtime: string;
}

interface Peer {
  readonly id: string;
  readonly host: string;
  readonly port: number;
  readonly purpose: string;
}

/** ثابت 2 + 4: المضيفون من الإعلان وحده، مرتَّبون بمعرّفهم ترتيبًا ثابتًا */
function peers(external: ExternalConfig): readonly Peer[] {
  const out: Peer[] = [];
  for (const counterparty of external.counterparties) {
    const host = String(counterparty.host ?? '').trim().toLowerCase();
    const port = Number(counterparty.port);
    // شكلُ المضيف يُتحقّق لا يُقبل على علّاته: مضيفٌ فيه مسافةٌ أو محرفٌ غريب يُكتب
    // في المنشور قيمةً لا يطابقها شيء، فتمرّ قاعدةُ سماحٍ ميتةٌ تُوهم أن النظير
    // موصول، أو تكسر المنشورَ عند التطبيق. والفشلُ عند التوليد أرخصُ منه بعده.
    const shaped = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/.test(host);
    if (host === '' || !shaped || !Number.isSafeInteger(port) || port <= 0 || port > 65535) {
      throw new SovereignViolation(
        `نظيرٌ خارجيٌّ بإعلانٍ ناقص لا يُولَّد له منشور: ${counterparty.id}`,
        'EGRESS_MANIFEST_UNDECLARED_HOST',
      );
    }
    out.push({ id: counterparty.id, host, port, purpose: counterparty.purpose });
  }
  return [...out].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

const BANNER = [
  '# ⚠️ ملفٌّ مولَّد — لا يُحرَّر بيد.',
  '# مصدرُه الوحيد: config/external.yaml + config/confinement.yaml',
  '# مُولِّدُه: src/security/egress_manifest.ts عبر `npm run render:confinement`',
  '# حاجزُه: `npm run check:confinement` يُعيد التوليد ويقابل البايت — فتحريرٌ يدوي',
  '#         يوسّع الخروج يسقط عند بوابة الدفع لا بعد التشغيل (RULE-005 · RULE-007).',
].join('\n');

function renderDefaultDeny(confinement: ConfinementConfig['policy']): string {
  const { namespace, workload_label: label } = confinement.generated;
  // ثابت 3: هذا المنشور لا يذكر استثناءً بقصد — فقدانُ منشور السماح يُغلق لا يفتح
  return `${BANNER}
#
# منعُ الخروج الافتراضي. يُطبَّق على الحمولة كلها بلا استثناء، ويسبق منشورَ السماح
# في الترتيب المنطقي: من لم يُسمَّ في منشورٍ آخر لا يخرج. حذفُ هذا الملف لا يفتح
# الخروجَ بحدّ ذاته، لكنه يُسقط \`npm run check:confinement\` — فالغيابُ يُقاس.
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: sool-default-deny-egress
  namespace: ${namespace}
  labels:
    app: ${label}
    sool.gap: "T-16"
    sool.criterion: "C-09"
spec:
  podSelector:
    matchLabels:
      app: ${label}
  policyTypes:
    - Egress
  # قائمةُ الخروج فارغةٌ بقصد: صفرُ قواعد = صفرُ خروج مسموح.
  egress: []
`;
}

function renderAllowlist(
  external: ExternalConfig,
  confinement: ConfinementConfig['policy'],
): string {
  const { namespace, workload_label: label } = confinement.generated;
  const declared = peers(external);
  const dns = confinement.infrastructure_ports
    .map((p) => `          - port: "${p.port}"\n            protocol: ${p.protocol}   # ${p.name}`)
    .join('\n');
  const rules = declared.map((peer) => [
    `  # ${peer.id} — ${peer.purpose}`,
    '  - toFQDNs:',
    `      - matchName: "${peer.host}"`,
    '    toPorts:',
    '      - ports:',
    `          - port: "${peer.port}"`,
    '            protocol: TCP',
  ].join('\n')).join('\n');
  return `${BANNER}
#
# السماحُ بالمعلن وحده. كلُّ قاعدةٍ أدناه لها نظيرٌ مطابقٌ في \`config/external.yaml\`
# بمضيفه ومنفذه حرفيًّا، وكلُّ نظيرٍ هناك له قاعدةٌ هنا — والطرفان مقيسان.
#
# انحيازٌ معلن (RULE-008): مطابقةُ **أسماء** المضيفين ليست في \`NetworkPolicy\` القياسي
# (فهو يعرف CIDR والوسوم لا أسماء النطاقات). فهذا المنشور بصيغة \`CiliumNetworkPolicy\`
# ويلزمه مُشغِّلُ شبكةٍ يدعم \`toFQDNs\`. والإعلانُ في \`external.yaml\` بالأسماء لا
# بالعناوين لأن العنوانَ يتبدّل والاسمَ هو ما تعاقدت عليه الدولة. من شغّل الدولة على
# مُشغِّلٍ لا يدعم ذلك فعليه إبقاءُ منعِ الخروج الافتراضي وحدَه، ويبقى \`external.yaml\`
# بلا نظائر — لا أن يوسّع هذا الملف بـ CIDR أوسع من المعلن.
apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: sool-allow-declared-counterparties
  namespace: ${namespace}
  labels:
    app: ${label}
    sool.gap: "T-16"
    sool.criterion: "C-09"
spec:
  endpointSelector:
    matchLabels:
      app: ${label}
  egress:
  # المنافذُ البنيوية: بلا ترجمةِ أسماءٍ لا يُحلّ اسمُ نظيرٍ معلن، فيصير المنعُ
  # عن غير قصدٍ منعًا عن كل شيء — وهذا يُخفي الخللَ لا يمنعه.
  - toEndpoints:
      - matchLabels:
          k8s:io.kubernetes.pod.namespace: kube-system
          k8s:k8s-app: kube-dns
    toPorts:
      - ports:
${dns}
        rules:
          dns:
            - matchPattern: "*"
${rules === '' ? '  # لا نظيرَ خارجيٌّ معلن — فلا قاعدةَ سماحٍ واحدة، والمنعُ وحده قائم.\n' : `${rules}\n`}`;
}

function renderRuntime(confinement: ConfinementConfig['policy']): string {
  const label = confinement.generated.workload_label;
  return `${BANNER}
#
# وصفُ التشغيل المتقشّف. لكلِّ شرطٍ في \`config/confinement.yaml\` سطرٌ يُنفّذه هنا،
# ولكلِّ سطرٍ هنا شرطٌ يقيسه \`src/security/confinement.ts\` من \`/proc\` بعد الإقلاع.
# فالوصفُ لا يشهد لنفسه: الشاهدُ هو النواة، وهذا الملف دعوى تُقاس.
services:
  ${label}:
    build:
      context: ../..
      dockerfile: infra/docker/Dockerfile
    # لا مستخدمَ جذر (non_root) — والرقم من Dockerfile نفسه لا من تخمين
    user: "10001:10001"
    # جذرٌ للقراءة فقط (read_only_root) — وما يلزمه كتابةً يُعلن حجمًا مؤقّتًا
    read_only: true
    tmpfs:
      - /tmp:rw,noexec,nosuid,nodev,size=64m
    volumes:
      # اليوميّةُ الدائمة (T-120) هي الاستثناءُ الوحيد للكتابة، وهي حجمٌ لا جذر
      - sool-state:/var/lib/sool
    security_opt:
      # منعُ اكتساب الصلاحيات (no_new_privileges)
      - "no-new-privileges:true"
    # مِصفاةُ نداءات النظام (seccomp_filter): لا يُذكر \`seccomp\` هنا بقصد. مِصفاةُ
    # المُشغِّل الافتراضية تُطبَّق تلقائيًّا وتعطي \`Seccomp=2\`، وذكرُ ملفٍ لا وجود له
    # في المستودع كان سيكون دعوى بلا سند. والممنوعُ صراحةً هو \`seccomp:unconfined\`:
    # من كتبه أسقط الشرط، ويكشفه الشاهدُ من \`/proc\` بـ \`Seccomp=0\` بعد الإقلاع.
    cap_drop:
      # إسقاطُ القدرات كلها (no_effective_capabilities + empty_bounding_set)
      - ALL
    # لا قدرةَ تُستعاد: لا \`cap_add\` في هذا الملف بقصد، وإضافتُها انحرافٌ يُعلن
    networks:
      - sool-internal
    restart: "on-failure"
networks:
  # منعُ الخروج الافتراضي (default_deny_egress) على مستوى المُشغِّل: شبكةٌ \`internal\`
  # لا تُمنح بوابةً افتراضية، فلا مسارَ خروجٍ في جدول النواة — وهو نفسُ ما يقيسه
  # الشاهدُ من \`/proc/net/route\`، ونفسُ الحالة التي قِيس فيها \`ENETUNREACH\`.
  sool-internal:
    internal: true
volumes:
  sool-state:

# انحيازٌ معلن (RULE-008) — هذا الوصفُ يمنع الخروجَ كلَّه، لا الخروجَ غير المعلن:
# \`compose\` لا يعرف السماحَ باسمِ مضيف، فلا يستطيع تنفيذ قائمة \`external.yaml\`.
# فمن شغّل الدولة بهذا الوصف لا يصل نظيرًا خارجيًّا معلنًا أصلًا — وهذا فشلٌ مغلق
# مقبول (RULE-007) لا صورةَ تشغيلٍ كاملة. الصورةُ التي تُنفّذ السماحَ بالمعلن وحده
# هي منشورا \`infra/network-policy/\` على عنقودٍ يدعم \`toFQDNs\`. والممنوعُ صراحةً:
# تحويلُ \`internal: true\` إلى \`false\` ليمشي نظير — فذلك يفتح الخروجَ كلَّه لا المعلنَ
# منه، وهو الانحرافُ الذي فُتح البند T-16 لمنعه، ويكشفه حاجزُ المقابلة البايتية.
`;
}

/** ثابت 1: دالةٌ نقيّة — نفسُ التهيئة تعطي نفسَ البايت في كل مناداة */
export function renderEgressManifests(
  external: ExternalConfig,
  confinement: ConfinementConfig['policy'],
): EgressManifests {
  return {
    defaultDeny: renderDefaultDeny(confinement),
    allowlist: renderAllowlist(external, confinement),
    runtime: renderRuntime(confinement),
  };
}

/** المضيفون المعلنون بصيغةٍ يقابلها الحاجز — تُصدَّر للاختبار وللسكربت معًا */
export function declaredEgressTargets(external: ExternalConfig): readonly string[] {
  return peers(external).map((peer) => `${peer.host}:${peer.port}`);
}
