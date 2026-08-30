# The Problem — For SIH Judges

**Problem Statement 26056 · Ministry of Statistics and Programme Implementation (MoSPI)**

---

## What is missing today

The SIH problem statement identifies a practical measurement gap: existing
headline consumer-price reporting does not provide a dedicated, public
domestic-airfare index with route, carrier, and booking-lead-time detail.

Aviation authorities publish traffic statistics, but the prototype is designed
to answer a different operational question:

> **Are domestic airfares rising or falling, and by how much?**

---

## Why this matters

- **Scale:** India's domestic aviation market serves millions of passenger
  journeys. Fare changes can affect large numbers of travellers.

- **Policy blindness:** Without a price index, policymakers cannot
  distinguish a genuine fare increase from a shift in booking patterns
  (more last-minute bookings raise the average even if no fare changed).

- **Consumer transparency:** Travellers and consumer advocates have no
  benchmark to evaluate whether fares on a given route are high or low
  relative to the national trend.

- **Regulatory oversight:** When airlines raise fuel surcharges or adjust
  base fares, there is no systematic way to measure the aggregate impact
  on the market.

---

## Why this is harder than it looks

A naive approach — "average all airfares and track the number over time" —
fails for three reasons:

### 1. Booking lead time is the strongest price driver

The same seat on the same flight costs ₹3,000 if booked 45 days ahead and
₹12,000 if booked the day before. If travellers shift toward last-minute
booking, the average fare rises — but no fare actually changed. A proper
index must control for this.

### 2. Fares are not one product

Economy saver, economy flex, premium economy, and business are different
products at different price points. Mixing them in one average would track
the cabin mix, not the price level.

### 3. Routes have different volumes

A 10% fare rise on a high-volume trunk corridor should count more
than the same rise on a thin regional route, because it affects more
passengers. A proper index needs traffic-proportional weighting.

---

## What the SIH problem statement asks for

Per Problem Statement 26056:

1. A **price index** for domestic airfares
2. Tracking at **T+1, T+7, T+15, T+30, T+45** lead-time anchors
3. **Route-level and airline-level** analysis
4. **Anomaly detection** for unusual fare movements
5. A methodology aligned with **international statistical standards**

---

## What "solving" this problem looks like

A working solution must:

- Define what makes two fares comparable (the **comparability cell**)
- Compute a transparent index that a statistician can verify by hand
- Weight routes by traffic volume so the headline reflects the market
- Detect fare anomalies without being fooled by booking-mix effects
- Handle missing data honestly — never invent a price
- Report data quality so users know how reliable the index is
- Provide a dashboard that presents this information clearly

This is what our APIx prototype does.
