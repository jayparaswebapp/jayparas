# Jay Paras — Business Context

## What the business does
Jay Paras is a Valsad-based manufacturer of custom rakhis (the thread-bracelet exchanged during the Indian festival of Raksha Bandhan). Production is seasonal, peaking in July–August. The main centre in Valsad designs the products and prepares raw material packets; the actual assembly is done by women's groups in six surrounding villages on a contract-labour basis.

## The job-work model
Each village has one or more "lead ladies" (lead lady = ગ્રુપ લીડર). The lead lady visits the Valsad centre, collects a raw-material packet (weighed in grams), the design specs, and a target quantity. She returns to her village, distributes the work among the group's ladies, oversees execution, collects the finished rakhis, and brings them back to Valsad. For her coordination, she earns 15% of her group's total annual labour, paid every August.

A job has a 20-day SLA from packet issue.

## Locations
Main centre: **Valsad**.
Job-work locations: **Atgam, Khergam, Arnala, Ambheti, Jashoda, Vaghchhipa**.
A lead lady can serve multiple locations; a location can have multiple lead ladies.

## Units of finished goods
- **Guss (ગુસ)** = 144 pieces
- **Dozen (ડઝન)** = 12 pieces
- **Nang (નંગ)** = 1 piece

## Labour calculation
`labour = guss × rate_per_guss + dozen × dozen_multiplier (default 1.5)`
- `rate_per_guss` is per design, locked at job issue.
- Nang carries no labour value (rounding remainder).

## Weight loss
At receive time, finished weight is compared to issued raw weight. Loss > 5% (configurable) is soft-flagged.

## Outcomes at receive
1. **Accepted full** — standard.
2. **Partial — redo** — some pieces sent back; job stays open, SLA clock keeps ticking.
3. **Partial — reduced rate** — defective pieces accepted at a % discount.
4. **Partial — discarded** — defective pieces written off, no labour for them.

## Roles
- **Super-admin** (Jay Shah): everything, including settings and audit log.
- **Supervisor**: full operational access across all locations.
- **Centre manager**: operational access only for assigned locations.
- **Accountant**: read-only + exports.

## Login
Mobile number + 6-digit PIN. PIN reset by super-admin only.

## Out of scope for v1
Lead-lady self-login, raw material decomposition, inventory, photos, WhatsApp reminders.
