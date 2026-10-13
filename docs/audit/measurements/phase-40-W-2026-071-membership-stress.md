# قياسٌ خامّ — عضويّةُ القوائم تحت pipefail في حاجز الإعلان (W-2026-071)

> خامٌّ لا تفسير. البيئة: Node v20.20.2 · GNU bash 5.3.9(1)-release · لينكس (sandbox) · المنفّذ: Perplexity Computer (الجلسة 114).
> الشجرةُ قبل العلاج: `7f81defb22b10edeb6a6d35394dfb3aec7c72ab3` (رأس main) · بعده: الشجرةُ نفسُها + فرقُ `scripts/check_declaration.sh` في هذا البند.
> زمنُ القياس: 2026-10-13 بين 23:20 و23:45 UTC تقريبًا.

## 1) أداةُ القياس (بحرفها)

```bash
#!/usr/bin/env bash
# usage: stress.sh OUTDIR ROUNDS PAR
out=$1; rounds=$2; par=$3; mkdir -p "$out"
for r in $(seq 1 $rounds); do
  for p in $(seq 1 $par); do
    ( bash scripts/check_declaration.sh > "$out/r${r}p${p}.txt" 2>&1; echo $? > "$out/r${r}p${p}.rc" ) &
  done
  wait
done
total=$(ls "$out"/*.rc | wc -l); fails=$(grep -L '^0$' "$out"/*.rc | wc -l)
dc03=$(grep -l 'DC-03' "$out"/*.txt | xargs -r grep -l '✗ \[DC-03\]' | wc -l)
dc04=$(grep -l '✗ \[DC-04\]' "$out"/*.txt | wc -l)
echo "total=$total nonzero=$fails files_with_DC03_fail=$dc03 files_with_DC04_fail=$dc04"
```

تُشغَّل من جذر المستودع: `stress.sh OUTDIR 25 8` ⇒ 25 جولة × 8 نسخ متوازية = 200 تشغيل لكلّ دفعة.

## 2) قبل العلاج — `7f81defb` (دفعةٌ واحدة · 200 تشغيل)

```text
total=200 nonzero=32 files_with_DC03_fail=9 files_with_DC04_fail=24
```

تصنيفُ التشغيلات الـ32 غير الصفريّة (رمز · عددُ أسطر ✗[DC-03] · عددُ أسطر ✗[DC-04] · سطرُ phases_partial):

```text
     21 1 0 1 0
      2 1 0 2 0
      8 1 1 0 0
      1 1 1 1 0
```

لا تشغيلَ غيرُ صفريّ بغير DC-03 أو DC-04 — لا إجهاضَ بالرمز 141 في هذه الدفعة.

معرّفاتُ التشغيلات غير الصفريّة: r12p1 r14p1 r14p7 r14p8 r15p1 r15p7 r15p8 r16p1 r17p1 r18p8 r19p4 r19p6 r22p1 r22p5 r23p2 r23p4 r23p6 r24p3 r2p2 r2p8 r3p1 r3p2 r3p4 r4p6 r5p6 r5p7 r6p1 r7p1 r8p2 r8p4 r8p5 r9p8 

### نموذجان بحرفهما (أسطرُ ✗ فقط)

`r14p1` (DC-03 — السطر 153 قبل العلاج):

```text
✗ [DC-03] C-08: حكمُ التدقيق في docs/audit/criteria/C-08.md يذكر T-27 وخانةُ «البند المفتوح» لا تذكره
✗ حاجزُ الإعلان يرفض: دعوى الإصدار لا تطابق حال الدولة (T-127)
```

`r12p1` (DC-04 — السطر 172 قبل العلاج):

```text
✗ [DC-04] C-09 يسمّي T-16 ولا صفَّ له في PROGRESS.md §2: لا مفتوحًا ولا مشطوبًا مُغلقًا
✗ حاجزُ الإعلان يرفض: دعوى الإصدار لا تطابق حال الدولة (T-127)
```

## 3) بعد العلاج (دفعتان · 400 تشغيل)

```text
total=200 nonzero=0 files_with_DC03_fail=0 files_with_DC04_fail=0
total=200 nonzero=0 files_with_DC03_fail=0 files_with_DC04_fail=0
```

تطابقُ الخرج: `md5sum` لملفّات الخرج الـ400 ⇒ بصمةٌ واحدة (`1534b4c59becbd8a0b196fe016ba1cc1` × 400)، وخرجُ تشغيلٍ نظيفٍ قبل العلاج (`r1p1`) مطابقٌ حرفًا لخرجِ تشغيلٍ بعده.

## 4) مواضعُ النمط في السكربت قبل العلاج (`grep -n '| *grep -q'` على 7f81defb)

```text
153:        if ! printf '%s\n' "$cell_ids" | grep -qx "$v"; then
172:    elif printf '%s\n' "$closed_ids" | grep -qx "$t"; then
369:  if printf '%s\n' "$complete_phases" | grep -qx "$p"; then
```

## 5) طفرةُ الإرجاع (الملفُّ القديمُ مكانَ العلاج، واختبارُ البند مبنيًّا)

```text
not ok 1 - السكربتُ تحت pipefail ولا يسأل عن العضويّة بـ«| grep -q» في سطرٍ منفَّذ
not ok 2 - in_lines مساواةٌ حرفيّةٌ … (لا تعريفَ لـin_lines)
not ok 3 - الحاجزُ على شجرةٍ واحدة يعطي رمزًا واحدًا تحت 8 نسخٍ متوازية × 3 جولات
ok 4 - مرحلةٌ في phases_partial وphases_complete معًا تُسقط الحاجزَ برسالتها
# pass 1 · # fail 3
وأُعيد الاختبارُ 3 وحده على الملفّ القديم ثلاثَ مرّاتٍ أخرى ⇒ not ok × 3
```
