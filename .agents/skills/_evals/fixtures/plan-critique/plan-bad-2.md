---
phase: architect
step: 4_active_plan
slice: 1
---

## Problem Statement
Customers on annual plans should receive a loyalty discount.

## Proposed Solution
Add a discount engine that subtracts 12% from the order total for any customer
whose tenure exceeds 18 months, plus an extra 3% per additional year, capped at
a 25% total discount.

## Acceptance Criteria
- [ ] A 20-month customer with a $100 order is charged $88.
- [ ] A 40-month customer is charged at the capped rate.

## Verification Strategy
- Unit tests assert the discount amount for several tenure values.
