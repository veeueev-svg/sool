/**
 * src/agents/spawn_reservations.ts — دفترُ الحجز: نصيبٌ يُخصم عند الحكم لا بعده
 * المالك: وزارة الداخلية | المرحلة: 39 (البند T-25 — إكمالُ C-11)
 * المدخلات: معرّفُ مخطط + عددٌ + لحظة | المخرجات: حجزٌ مُخصَّصٌ أو رفضٌ بسببه
 * التبعيات: **لا شيء** — دفترٌ محاسبيٌّ لا يُسجّل ولا يقرأ تهيئةً ولا وقتًا
 * الصلاحيات: المحاسبةُ وحدها؛ لا ينشئ هذا الدفتر وكيلًا ولا يمنعه بسببٍ آخر
 *
 * ثوابتُ هذه الوحدة:
 *   1) **الخصمُ لحظةَ الحكم**: كان `evaluate()` يحكم و`recordSpawn()` يخصم
 *      بعده، فبين الاثنين نافذةٌ يمرّ فيها حكمٌ ثانٍ على نصيبٍ لم يُخصم بعد.
 *      القياسُ قبل الإصلاح: سقفٌ خمسُ نسخٍ وأربعُ دفعاتٍ متزامنةٍ سُمح لها
 *      كلُّها ⇒ **عشرون نسخة، خرقٌ خمسةَ عشر**. فالحجزُ يخصم أولًا ثم يُثبَّت.
 *   2) **الحجزُ ينتهي**: ما لم يُثبَّت ولم يُفرَج عنه خلال مهلته يسقط ويُعاد
 *      نصيبُه. بلا ذلك يصير كلُّ مُنادٍ انقطع تسريبًا دائمًا في النصيب المتاح،
 *      فيُمنع التوالدُ المشروع بحجوزٍ موتى — رفضٌ مغلقٌ صار حجرًا دائمًا.
 *   3) **معرّفُ الحجز يُستهلك مرّةً**: تثبيتٌ أو إفراجٌ ثانٍ على المعرّف نفسه
 *      مرفوضٌ — وإلا صار الإفراجُ المكرَّر بابًا لزيادة النصيب.
 *   4) **الدفترُ لا يقرأ الساعة**: اللحظةُ تُمرَّر إليه دائمًا، فما يُقاس في
 *      الاختبار هو ما يجري في التشغيل.
 * حالات الفشل (كلها مغلقة): معرّفٌ مجهولٌ أو مستهلكٌ ⇒ رفضٌ بسببه لا صمت
 * اختبار القبول: tests/agents/spawn_reservations.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0027-measured-lineage.md
 */

export interface SpawnReservation {
  readonly reservationId: string;
  readonly blueprintId: string;
  readonly count: number;
  readonly reservedAt: number;
  readonly expiresAt: number;
}

export type ReservationOutcome =
  | { readonly ok: true; readonly reservation: SpawnReservation }
  | { readonly ok: false; readonly reason: string };

export type ReservationSettlement =
  | { readonly ok: true; readonly reservation: SpawnReservation }
  | { readonly ok: false; readonly reason: string };

export interface ReservationLedgerLimits {
  readonly reservationTtlMs: number;
  readonly maxOutstandingReservations: number;
}

/**
 * دفترُ الحجز: النصيبُ المحسوبُ لمخططٍ = المُثبَّتُ + المحجوزُ المعلَّق.
 * ولا يُسأل عن سببِ الرفض غيرِ النصيب — تلك مهمّةُ السياسة.
 */
export class SpawnReservationLedger {
  private readonly committed = new Map<string, number>();
  private readonly outstanding = new Map<string, SpawnReservation>();
  private readonly settled = new Set<string>();
  private serial = 0;
  private expiredCount = 0;

  constructor(private readonly limits: ReservationLedgerLimits) {}

  /** المُثبَّتُ فعلًا — نسخٌ وُلدت ولم تُلغَ */
  committedOf(blueprintId: string): number {
    return this.committed.get(blueprintId) ?? 0;
  }

  /** المحجوزُ المعلَّق لمخططٍ بعد إسقاط ما انتهت مهلتُه */
  pendingOf(blueprintId: string, now: number): number {
    this.sweep(now);
    let total = 0;
    for (const r of this.outstanding.values()) {
      if (r.blueprintId === blueprintId) total += r.count;
    }
    return total;
  }

  /** النصيبُ المشغولُ كلُّه: مُثبَّتٌ + معلَّق — وهو ما تُقاس السقوفُ عليه */
  chargedOf(blueprintId: string, now: number): number {
    return this.committedOf(blueprintId) + this.pendingOf(blueprintId, now);
  }

  outstandingCount(now: number): number {
    this.sweep(now);
    return this.outstanding.size;
  }

  expired(): number {
    return this.expiredCount;
  }

  /** إسقاطُ كلِّ حجزٍ انتهت مهلتُه — يُنادى قبل أي قراءةٍ للنصيب */
  sweep(now: number): number {
    let dropped = 0;
    for (const [id, r] of [...this.outstanding]) {
      if (r.expiresAt <= now) {
        this.outstanding.delete(id);
        this.settled.add(id);
        this.expiredCount += 1;
        dropped += 1;
      }
    }
    return dropped;
  }

  /**
   * حجزُ نصيبٍ **قبل** الإنشاء. الخصمُ فوريٌّ فلا يمرّ حكمٌ ثانٍ على النصيب
   * نفسه، والسقفُ يُقاس على `chargedOf` لا على المُثبَّت وحده.
   */
  reserve(blueprintId: string, count: number, cap: number, now: number): ReservationOutcome {
    this.sweep(now);
    if (!Number.isInteger(count) || count <= 0) {
      return { ok: false, reason: 'عددُ حجزٍ غير صالح' };
    }
    if (this.outstanding.size >= this.limits.maxOutstandingReservations) {
      return {
        ok: false,
        reason: `حجوزٌ معلَّقةٌ بلغت الحدَّ (${this.limits.maxOutstandingReservations}) — لا حجزَ جديدٌ حتى يُثبَّت أو يسقط ما قبله`,
      };
    }
    const charged = this.chargedOf(blueprintId, now);
    if (charged + count > cap) {
      return {
        ok: false,
        reason: `تجاوز سقف نسخ المخطط: ${charged} + ${count} > ${cap}`,
      };
    }
    this.serial += 1;
    const reservation: SpawnReservation = Object.freeze({
      reservationId: `reservation:${blueprintId}#${this.serial}`,
      blueprintId,
      count,
      reservedAt: now,
      expiresAt: now + this.limits.reservationTtlMs,
    });
    this.outstanding.set(reservation.reservationId, reservation);
    return { ok: true, reservation };
  }

  /** تثبيتُ الحجز: النصيبُ المعلَّق يصير مُثبَّتًا — بلا تغييرٍ في المجموع */
  commit(reservationId: string, now: number): ReservationSettlement {
    const reservation = this.take(reservationId, now);
    if (!reservation.ok) return reservation;
    this.committed.set(
      reservation.reservation.blueprintId,
      this.committedOf(reservation.reservation.blueprintId) + reservation.reservation.count,
    );
    return reservation;
  }

  /** الإفراجُ عن الحجز: النصيبُ يعود متاحًا — والرجوعُ لا يُترك ضمنيًّا */
  release(reservationId: string, now: number): ReservationSettlement {
    return this.take(reservationId, now);
  }

  /** إعادةُ بناءِ المُثبَّت من مصدرٍ خارجيّ (استعادةُ لقطة) — لا حجوزَ تُستعاد */
  restoreCommitted(counts: ReadonlyMap<string, number>): void {
    this.committed.clear();
    for (const [blueprintId, count] of counts) {
      if (count > 0) this.committed.set(blueprintId, count);
    }
  }

  /** إسقاطُ نسخٍ مُثبَّتةٍ بعد إنهاءٍ أو إلغاءٍ لاحق */
  discardCommitted(blueprintId: string, count: number): void {
    this.committed.set(blueprintId, Math.max(0, this.committedOf(blueprintId) - count));
  }

  snapshot(): Readonly<Record<string, number>> {
    return Object.fromEntries(this.committed);
  }

  private take(reservationId: string, now: number): ReservationSettlement {
    this.sweep(now);
    const reservation = this.outstanding.get(reservationId);
    if (!reservation) {
      const reason = this.settled.has(reservationId)
        ? 'حجزٌ مُسوًّى أو منتهي المهلة — لا تسويةَ ثانية على المعرّف نفسه'
        : 'معرّفُ حجزٍ مجهول — لا تسويةَ لما لم يُحجَز';
      return { ok: false, reason };
    }
    this.outstanding.delete(reservationId);
    this.settled.add(reservationId);
    return { ok: true, reservation };
  }
}
