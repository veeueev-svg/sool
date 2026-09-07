# تقريرُ اختبارٍ — T-16 · T-124 · شاهدُ الحصر داخل الحاوية الفعليّة: الحاويةُ تُبنى وتُشهد لا تُعلَن

> **البند:** `W-2026-035` · **المرحلة:** 39 · **الجلسة:** 76 · **التاريخ:** 2026-09-07
> **المنفّذ:** القيّم على المستودع — Perplexity Computer (الجلسة 76) · **المراجع:** جهةٌ مستقلّةٌ لاحقة ≠ 76 (RULE-004 · RULE-016)
> **القياسُ الخامّ للحاوية:** [`docs/audit/measurements/phase-39-T16-container.txt`](../audit/measurements/phase-39-T16-container.txt) — يُلتقطُ من سجلِّ تشغيل وظيفةِ CI
> **القياسُ الخامّ للتطوير:** [`docs/audit/measurements/phase-39-T16.txt`](../audit/measurements/phase-39-T16.txt) — `confined=false` (معلَنُ الانحراف، RULE-008)

---

## 1) العلّةُ المقيسة — لا الموصوفة

أعلن المدقّق في [`verdict.md`](../audit/verdict.md) §3 أنّ فجوةَ C-09 قائمةٌ: «المنعُ الشبكيُّ
تطبيقيٌّ داخلَ العمليّةِ؛ لا حصرَ على مستوى الحاويةِ والنواة». وقياسُ `phase-39-T16.txt` أثبتها:
نداءُ `net.connect` خامٌّ خارجَ مجالٍ محصور ⇒ `connected`، وداخلَ `unshare --net` ⇒
`ENETUNREACH` — فالنواةُ تمنعُ، لكنّ بيئةَ التطويرِ ليست الحاوية. ووُجد في المستودع
`infra/docker/Dockerfile` يُنشئ الحصرَ و`src/security/confinement.ts` يشهدُ عليه من `/proc`،
لكنّ الشاهدَ لم يُشغَّل قطّ **داخل** حاويةٍ فعليّة. وضرُّه: تبقى فجوةُ C-09 مفتوحةً، فيبقى
ادّعاءُ «الحصرُ قائم» وعدًا بلا حامل (RULE-007: غيابُ الدليلِ خرقٌ لا حياد).

## 2) اكتشافٌ أثناءَ التنفيذ — الصورةُ كانت مُعلنةً لا مَبنية

أوّلُ بناءٍ حقيقيٍّ للصورة على وظيفةِ CI `confinement-witness.yml` كشف عيبًا كامنًا: طورُ
البناءِ في `infra/docker/Dockerfile` كان ينسخ `package.json` و`tsconfig.json` ومصادرَها ثمّ
ينادي `npm run build` (`tsc`) **دون تثبيتِ التبعيات** — فصار `sh: 1: tsc: not found` ورجع
البناءُ برمزِ 127. والعلّةُ أنّ المُصرِّفَ `tsc` تبعيةُ تطويرٍ (devDependencies)، ولم يكن
يطورُ البناءِ أمرَ `npm ci` يُثبّتُها. فالصورةُ كانت مُعلنةً لا مَبنية، وحقّقها حاجزُ النصِّ
`check:confinement` (يفحصُ USER/FROM-distroless/ENTRYPOINT/لا-privileged) لا التشغيل —
وهو عينُ ما أنشئ T-124 لاكتشافه.

### الإصلاحُ في `infra/docker/Dockerfile` (طور البناء)

```dockerfile
COPY package.json package-lock.json tsconfig.json ./
COPY src ./src
COPY tests ./tests
COPY scripts ./scripts
# المُصرِّفُ (tsc) تبعيةُ تطويرٍ لا تشغيلٍ — يُثبَّت هنا في طور البناء وحده، ولا
# شيءَ منه يُشحن. والمشروعُ بصفرِ تبعياتِ تشغيل، فلا node_modules في الطور الأخير.
RUN npm ci
RUN npm run build
```

ولا يُشحنُ شيءٌ من `node_modules` إلى صورةِ التشغيل (distroless): المشروعُ بصفرِ تبعياتِ
تشغيل، فالطورُ الأخيرُ ينسخُ `dist/` وحدَها. فأُثبِّتَ المُصرِّفُ في طورِ البناءِ وحده.

## 3) العلاجُ المُنفَّذ — بنيةٌ مُستنسَخةٌ تشهدُ على نفسها

شاهدٌ (`scripts/confinement_witness.ts`) يُصرَّفُ ضمنَ البناءِ إلى
`dist/scripts/confinement_witness.js`، ثمّ تُشغّلُه وظيفةُ CI
[`.github/workflows/confinement-witness.yml`](../../.github/workflows/confinement-witness.yml)
على `ubuntu-latest` **داخلَ حاويةٍ فعليّة** تُبنى من `infra/docker/Dockerfile`:

```bash
docker build -t sool-confinement-witness .
docker run --rm \
  --network=none --cap-drop=ALL --security-opt no-new-privileges \
  --read-only --tmpfs /tmp:rw,noexec,nosuid,nodev,size=64m \
  --entrypoint /nodejs/bin/node sool-confinement-witness \
  dist/scripts/confinement_witness.js
```

والشاهدُ نفسُه:

- يقرأُ `/proc` بـ`readConfinementFacts` ويُتحقّقُ بـ`confinementWitness(policy)` من الشرط
  السبعةِ المُعلنةِ في `config/confinement.yaml` (non_root · no_effective_capabilities ·
  empty_bounding_set · no_new_privileges · seccomp_filter · read_only_root ·
  default_deny_egress).
- **لا يكتبُ ملفًّا** — جذرُ الحاوية للقراءةِ فقط (`--read-only`)، فيخرجُ القياسَ إلى
  `stdout` وحدَه، فلا يخترقُ قيودَها. (القياسُ الخامُّ يُلتقطُ من سجلِّ التشغيل خارجًا.)
- يخرجُ برمزِ 0 إن كان `confined=true`، وبرمزِ 1 إن لم يكن — **فلا نجاحٌ صامتٌ** (RULE-007).
  لذا إن نقصَ شرطٌ سقطتِ الخطوةُ وصارتِ الوظيفةُ حمراء.

## 4) القياسُ المحلّيُّ — الشاهدُ في بيئةِ التطوير (مُعلَنُ الانحراف)

لا يستطيعُ المُنفّذُ تشغيلَ Docker داخلَ الصندوقِ (لا dockerd: cgroup متداخلٌ و`nft` غيرُ
مدعوم)، فقيسَ الشاهدَ محلّيًّا بـ`node dist/scripts/confinement_witness.js`:

```
الحصرُ على هذه العمليّة: غير محصور · نقصٌ=5
[empty_bounding_set(CapBnd=000001ffffffffff) · no_new_privileges(NoNewPrivs=0) ·
 seccomp_filter(Seccomp=0) · read_only_root(root=rw) ·
 default_deny_egress(مسارات افتراضية=1 واجهات=lo،eth0)]
رمزُ الخروج: 1
```

وهو **المتوقَّعُ تمامًا** في بيئةِ التطوير (مطابقٌ لـ`phase-39-T16.txt`) — فالشاهدُ يفصلُ بين
«داخلَ الحاويةِ المحصورة» و«خارجها»، ويعودُ صادقًا عن كلٍّ. هذا القياسُ يُثبتُ أنّ الشاهدَ
سليمٌ منطقيًّا (يرفضُ `confined=false` برمزِ 1) لا أنّ الحصرَ قائمٌ هنا — والحصرُ يُقاسُ على
الحاويةِ في CI.

## 5) القياسُ على الحاوية — وظيفةُ CI (يُستكمَل بعدَ تشغيلها)

الوظيفةُ `confinement-witness.yml` تُشغَّلُ على هذا الدفعِ (`بناءٌ + إصلاحُ طورِ البناء`).
النتيجةُ المُتوقَّعةُ: `confined=true · نقصٌ=0 · رمزُ الخروج 0` داخلَ الحاويةِ المحصورة،
فيُلتقطُ خرجُها إلى `docs/audit/measurements/phase-39-T16-container.txt` ويُستكمَلُ هذا
القسمُ بالقياسِ الخامّ الفعليّ. (إن نقصَ شرطٌ يظهرُ الأحمرَ بلا التفافٍ — فهو عينُ
فحصِ T-124.)

## 6) حدودُ هذا القياس — ما لا يُدَّعى

- **لا يُدَّعى أنّ الإنتاجَ يشغّلُ هذا الحاوية**: هذا شاهدُ قابلِ الاستنساخِ على CI، يُثبتُ
  أنّ الحصرَ المُعلَنَ يتحقّقُ فعلًا داخلَ حاويةٍ مُصرَّفةٍ من `Dockerfile` المُلتزَمِ في
  المستودع. تشغيلُ الإنتاجِ حكمٌ للمراجع (RULE-004).
- **لا يُعدَّلُ `check:confinement` المحلّيُّ ولا سلسلةُ `verify`**: الشاهدُ في وظيفةٍ
  منفصلةٍ، والحاجزُ المحلّيُّ يبقى يقيسُ بيئةَ المنفّذ كما هو.
- **لا يُلمسُ `src/`**: الشاهدُ يقرأُ `src/security/confinement.ts` ولا يُغيّرُه (RULE-004).
- **حالُ البند `REVIEW` لا `VERIFIED`**: المنفّذُ (الجلسة 76) لا يُصدِّقُ عملَ نفسِه؛
  التصديقُ لمراجعٍ مستقلٍّ (RULE-016).

## 7) التحقّقُ المرافق

- `npm run build` ⇒ `dist/scripts/confinement_witness.js` مُصرَّف بلا أخطاء (tsc رمزُ 0).
- `npm test` **2261/2261** صفرُ فشل.
- `npm run verify` رمزُ الخروج **0** (أربعةَ عشرَ حاجزًا، بما فيها `check:confinement`:
  «لا انحراف — المنشورُ مولَّدٌ من الإعلان، والصورةُ متقشّفة»).
- `check:work` أخضر (النطاقُ مذكورٌ في العقدِ بالكامل).
- وظيفةُ CI `confinement-witness.yml` + `ci.yml` على `ubuntu-latest` — تُقرأُ من واجهةِ
  التشغيلات.
