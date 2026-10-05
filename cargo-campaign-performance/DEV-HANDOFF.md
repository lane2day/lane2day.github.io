# CarGo — Product Issue Handoff

**Status:** Open · P1 + P2 items from the [Campaign Performance Report](./index.html), Section 06 (Non-Campaign Friction)
**Generated:** 2026-04-17 · **Window analyzed:** 2026-04-04 → 2026-04-17 (14 days) vs 2026-03-21 → 2026-04-03 (prior 14 days)
**Source:** Fullstory MCP on org `18PNWR` (CarGo demo environment)
**Owner to assign:** engineering / product / mobile leads per issue below

---

## TL;DR for the assignee

Five production issues are compressing the purchase funnel's conversion rate, independently of any marketing campaign. They surfaced in the last 2-week window — most are regressions versus the prior 2 weeks, which strongly suggests a recent deploy is responsible for several of them.

| # | Issue | Priority | Users (14d) | Δ vs prior 14d | Owner hint |
|---|---|---|---|---|---|
| 1 | `TypeError: n is not a function` in `main.000620b5.js` | **P1** | 48 | **+345%** | Frontend |
| 2 | Error clicks on `[SH] Purchase Complete` button | **P1** | 26 | **+100%** (was 0) | Frontend + Payments |
| 3 | Network errors on `/v2/cars/getAllCarsInOrgInCity/{city}` (Austin, St. Louis, Raleigh) | **P1** | 417 | +94–176% | Backend / Inventory |
| 4 | iOS SwiftUI `addToCartButton` error clicks (3 controller hashes) | **P2** | 16 | **+100%** (was 0) | Mobile (iOS) |
| 5 | Dead clicks on PDP Share button `<svg>` (event target hijacking) | **P2** | 968 | +22% | Frontend (5-min CSS fix) |

Each issue below is self-contained: context, Fullstory evidence (segments + session URLs you can watch), suspected cause, fix approach, validation steps, and acceptance criteria.

---

## Issue 1 — `TypeError: n is not a function` (P1)

### Symptom

A brand-new uncaught JavaScript exception is firing in the production bundle. 48 users hit it in the last 14 days — up from fewer than 10 in the prior 14-day window (**+345%**). The error appears as both a console error and an uncaught exception, so it's visible in both signal streams.

### Error signature

```
TypeError: n is not a function
    at $o (https://www.cargorentalsfs.com/static/js/main.000620b5.js:2:420461)
    at tl (https://www.cargorentalsfs.com/static/js/main.000620b5.js:2:420657)
    at Cc (https://www.cargorentalsfs.com/static/js/main.000620b5.js:2:440751)
    at https://www.cargorentalsfs.com/static/js/main.000620b5.js:2:437638
    at w  (https://www.cargorentalsfs.com/static/js/main.000620b5.js:2:42182)
    at MessagePort.R (https://www.cargorentalsfs.com/static/js/main.000620b5.js:2:42716)
```

The `MessagePort.R` at the bottom of the stack suggests this is firing from a postMessage handler — likely a web worker, iframe, or BroadcastChannel path. The `n is not a function` pattern indicates a minified identifier that was expected to be callable but arrived as undefined or a primitive.

### Evidence

- **Segment:** [DevFix | TypeError n is not a function (P1)](https://app.fullstory.com/ui/18PNWR/segments/everyone/people:search:4B3k9bGhrd0p) · id `4B3k9bGhrd0p`
- **Sessions to watch (click to load in Fullstory):**
  - [Session 1](https://app.fullstory.com/ui/18PNWR/session/396464725501698605:5868219282942068698) · `396464725501698605:5868219282942068698`
  - [Session 2](https://app.fullstory.com/ui/18PNWR/session/1103112202608335066:9039580588994806895) · `1103112202608335066:9039580588994806895`
  - [Session 3](https://app.fullstory.com/ui/18PNWR/session/4835145314769109384:6979435719169043105) · `4835145314769109384:6979435719169043105`

### Suspected cause

The bundle hash `main.000620b5.js` is specific. Correlate that hash to a deploy date — if it shipped in the last 2 weeks, this is a regression tied to that release. The combination of brand-new error + specific bundle + `MessagePort` in the stack points to either:

1. A recent change to a worker/iframe boundary where the receiver expects a function but the sender serialized something non-callable
2. A dependency update that changed the shape of an object being destructured
3. A code path that assumed a property exists on an object that's sometimes `undefined`

### Fix approach

1. Pull the source map for `main.000620b5.js` and resolve `$o` → `tl` → `Cc` to real function names
2. Identify the `MessagePort.R` handler registration — usually grep for `addEventListener('message'` or `postMessage`
3. Check git log for changes touching the resolved functions within the deploy window that matches the bundle hash
4. Ship a guard on the `n()` call site (typeof check or optional chaining) as a hotfix while the root cause is being investigated

### Validation

- [ ] Error signature does not appear in any session from the next 48 hours after deploy
- [ ] The [DevFix segment](https://app.fullstory.com/ui/18PNWR/segments/everyone/people:search:4B3k9bGhrd0p) population drops to near-zero in the 14 days after fix
- [ ] No new `TypeError: * is not a function` signatures appear as replacements (could indicate the guard is suppressing a real bug upstream)

---

## Issue 2 — `[SH] Purchase Complete` button error clicks (P1)

### Symptom

26 users clicked the final "Purchase Complete" button at the end of the checkout flow and received an error. This signal did not exist in the prior 14-day window — it went from 0 to 26 (**+100%**). Because this is the terminal click in the purchase flow, every one of these is directly lost revenue.

### Element details

- **Fullstory element name:** `[SH] Purchase Complete`
- **Fullstory element ID:** `JGrgmFpkaGKz`
- **CSS selector:** `.checkout-submit-btn[data-element="confirm-checkout"][data-action="complete-booking"]`
- **Data attributes to search code for:** `data-element="confirm-checkout"` · `data-action="complete-booking"`
- **Page context:** Checkout review / final confirm step (URL patterns in `/checkout#review` and `www.cargorentalsfs.com/checkout#review`)

### Evidence

- **Segment:** [DevFix | Purchase Complete error clicks (P1)](https://app.fullstory.com/ui/18PNWR/segments/everyone/people:search:N24T3Z3Sadgq) · id `N24T3Z3Sadgq`
- **Sessions to watch:**
  - [Session 1](https://app.fullstory.com/ui/18PNWR/session/8319155389179776448:6841045332346576412) · `8319155389179776448:6841045332346576412`
  - [Session 2](https://app.fullstory.com/ui/18PNWR/session/5741090137636211880:2657792223164572919) · `5741090137636211880:2657792223164572919`
  - [Session 3](https://app.fullstory.com/ui/18PNWR/session/5229563514110798229:5886706513433810322) · `5229563514110798229:5886706513433810322`

### Suspected cause

Error Clicks in Fullstory fire when a click triggers a console error or network error within ~2 seconds. Watch the sessions above and look for:

- A concurrent console error at the same timestamp as the click (likely related to Issue 1 above — check if `TypeError: n is not a function` fires)
- A concurrent network error on `/v2/payments/approveFunds` or similar payment endpoint (this is the Wall 2 issue from the prior [CarGo UX Report](../cargo-ux-report/) — if it's still firing, this regression may just be the same payment issue surfacing under a different signal)
- Silent failure pattern — the user clicks and nothing visible happens; they click again; then abandon

### Fix approach

This has two possible root causes that should be investigated in order:

1. **If Error Clicks here correlate with the TypeError in Issue 1:** fix Issue 1 first; this issue will resolve as a side effect
2. **If Error Clicks correlate with payment API failures:** investigate `/v2/payments/approveFunds` reliability — this was documented at 69% failure rate in the prior UX report. Confirm current rate and whether the silent-failure UX pattern is still in place (no visible error state on payment failure)

Whichever root cause it is, the button needs a visible error state on failure — "Purchase failed, please try again" with a retry affordance — so users don't rage-click or abandon silently.

### Validation

- [ ] The [DevFix segment](https://app.fullstory.com/ui/18PNWR/segments/everyone/people:search:N24T3Z3Sadgq) population drops below 5 users in the 14 days after fix (allow for residual edge cases)
- [ ] If clicking this button fails for any reason, the user sees a visible error message within 2 seconds
- [ ] A new Fullstory alert is created that fires if Error Click rate on `JGrgmFpkaGKz` exceeds 5 users in any 7-day window (so this doesn't regress silently again)

---

## Issue 3 — City inventory API network errors (P1)

### Symptom

The city-level inventory endpoint is returning network errors at significantly higher rates in three cities this 2-week window vs last. This was a known issue in the prior [CarGo UX Report](../cargo-ux-report/) — it got worse across three specific markets, suggesting either a recent deploy touched the endpoint or an upstream data source changed.

### Affected endpoints

| City | Full URL path | Users (14d) | Δ vs prior 14d |
|------|---|---|---|
| St. Louis | `/v2/cars/getAllCarsInOrgInCity/18PNWR/city/St.%20Louis,%20Missouri` | 151 (8.2% of funnel entrants) | **+176%** |
| Austin | `/v2/cars/getAllCarsInOrgInCity/18PNWR/city/Austin,%20Texas` | 146 (8.0%) | **+107%** |
| Raleigh | `/v2/cars/getAllCarsInOrgInCity/18PNWR/city/Raleigh,%20North%20Carolina` | 120 (6.5%) | **+94%** |
| New York | `/v2/cars/getAllCarsInOrgInCity/18PNWR/city/New%20York,%20New%20York` | 134 (7.3%) | +32% |
| Albuquerque | `/v2/cars/getAllCarsInOrgInCity/18PNWR/city/Albuquerque,%20New%20Mexico` | 116 (6.3%) | +9% |

Three cities with >90% jumps in 2 weeks is not coincidence — something specific changed.

### Evidence

- **Segment:** [DevFix | City inventory API errors v2 (P1)](https://app.fullstory.com/ui/18PNWR/segments/everyone/people:search:RxfZH56jFICD) · id `RxfZH56jFICD`
- **Managed funnel:** [Purchase Funnel](https://app.fullstory.com/ui/18PNWR/funnels/details/2BWVg4GQY7Uo) — these errors fire at the search/discovery stage, upstream of PDP
- **Session examples:** Segment is populated but session retrieval via MCP returned 0 in last 14d. Open the segment URL above and sort by most recent to find current examples in the Fullstory UI.

### Suspected cause

Three cities regressing together in the same 2-week window strongly suggests shared infrastructure:

1. **Regional shard or data partition** serving these three cities
2. **Upstream inventory data source** (CMS, partner feed) changed schema or availability for these markets
3. **A config change** that moved certain cities behind a different backend

### Fix approach

1. **Check server-side logs** for `/v2/cars/getAllCarsInOrgInCity` on these three specific city paths. Filter by the last 14 days and compare error rate to prior window.
2. **Identify if these cities share any infrastructure** — same database shard, same caching tier, same upstream inventory provider, same geographic region in your CDN/backend routing.
3. **Correlate with deploy history** — any backend deploys touching the inventory path in the window `2026-04-04` through `2026-04-17`?
4. **If the cities have no inventory at all**, the endpoint should return an empty 200 OK with a clear message, not a network-level error. Users are being dead-ended with no recovery path.

### Validation

- [ ] Server-side error rate on these three city paths returns to prior-window levels (3–5% of requests, not the current 7–9%)
- [ ] Empty-inventory responses return HTTP 200 with an `{ cars: [], message: "no availability" }` body, not a network error
- [ ] Fullstory alert is configured on `/v2/cars/getAllCarsInOrgInCity` error rate, threshold set so a 2× jump fires within 48 hours

---

## Issue 4 — iOS SwiftUI `addToCartButton` error clicks (P2)

### Symptom

New mobile regression on iOS. 16 users across **three distinct controller memory-address hashes** clicked the Add to Cart button in the car selection view and received an error. Zero prior-window occurrences.

Three distinct hashes (`$10253b098`, `$100a53098`, `$10297f098`) is a telltale pattern — each hash is a different in-memory instance of the view controller. This usually means the view controller is being re-instantiated (user backs out and re-enters, or app is restored from background) and the action binding on the button is breaking across those instances.

### Element details

- **Package:** `CarGo1.CarSelectionViewController`
- **Button:** `addToCartButton` (SwiftUI, wrapped in `cargo1.fsbutton`)
- **Fullstory element signatures observed:**
  ```
  uiapplication uiwindow uitransitionview uidropshadowview uiview uiview uiview[controller]
  uiimageview swiftui
  cargo1.carselectionviewcontroller.(unknown context at $10253b098).(unknown context at $10253b0a0).addtocartbutton
  [package="CarGo1.CarSelectionViewController.(unknown context at $10253b098).(unknown context at $10253b0a0)"]
  modifiedcontent swiftui swiftui.addToCartButton cargo1.fsbutton[package="CarGo1"] modifiedcontent swiftui button
  ```
- **Hashes observed:** `$10253b098`, `$100a53098`, `$10297f098` (each one a separate app build or view-controller re-instantiation)

### Evidence

- **Segment:** [DevFix | iOS addToCartButton errors v2 (P2)](https://app.fullstory.com/ui/18PNWR/segments/everyone/people:search:e0QzYGi6Tgzt) · id `e0QzYGi6Tgzt`
- **Session examples:** Sparse — 16 users across 14 days. Open the segment URL and sort by most recent, or watch the iOS mobile sessions directly in Fullstory's native-app view.

### Suspected cause

1. A recent iOS build shipped a change to `CarSelectionViewController` or its `addToCartButton` action
2. The button's SwiftUI `.onTapGesture` or `.action` closure is capturing stale state or a now-optional property
3. A shared view model or navigation coordinator is being re-initialized, invalidating a binding

### Fix approach

1. **Check App Store Connect / TestFlight** for iOS releases shipped between `2026-04-04` and `2026-04-17`. Any release touching `CarSelectionViewController.swift` or the booking/cart flow is the first suspect.
2. **Unit-test the action closure** for the button under view-controller re-entry (simulate backgrounding and resuming).
3. **Check for force-unwrapped optionals** in the cart-add code path — `n is not a function`-style bugs are common when an optional becomes nil after a navigation round-trip.

### Validation

- [ ] [DevFix segment](https://app.fullstory.com/ui/18PNWR/segments/everyone/people:search:e0QzYGi6Tgzt) drops to 0 in the 14 days after the fix ships on iOS
- [ ] No new controller memory-address hashes appear in the error-click signal for this element
- [ ] Manual test: add to cart, back out, re-enter the car selection screen, add to cart again — 5 iterations, no error

---

## Issue 5 — PDP Share button dead clicks (P2)

### Symptom

968 users on the ProductPage dead-clicked the share button in the last 14 days — a +22% increase. This isn't a new issue; it was documented in the prior [CarGo UX Report](../cargo-ux-report/). But it's the **easiest fix in the portfolio** (one CSS rule) and affects ~28% of all PDP visitors, so it's worth closing out while we're in the code.

### Root cause (confirmed)

The share button's SVG icon contains a `<line>` element that's positioned over the button surface. Browsers send `click` events to the deepest matching element — so clicks on the icon land on the `<line>` instead of the parent `<button>`, and the button's click handler never fires. Users perceive the button as broken.

### Element details

- **Button selector:** `button#share-button.social-button`
- **Offending inner element:** `svg > line` inside `#share-button`
- **Full Fullstory-observed selector:**
  ```
  body div#root div.App[data-component="App"][data-file-source="App.tsx"]
  div#product-page.modern-product-page[data-component="ProductPage"]
  div.modern-product-container div.modern-product-content
  div.product-sidebar div.sidebar-section div
  button#share-button.social-button svg line
  ```

### Evidence

- **Segment:** [DevFix | Share button dead clicks v2 (P2)](https://app.fullstory.com/ui/18PNWR/segments/everyone/people:search:pclrFeHmO3ws) · id `pclrFeHmO3ws`
- **Sessions to watch:**
  - [Session 1](https://app.fullstory.com/ui/18PNWR/session/1853505181456597556:8966398078353940322) · `1853505181456597556:8966398078353940322`
  - [Session 2](https://app.fullstory.com/ui/18PNWR/session/1883035113994282923:6755190297424698233) · `1883035113994282923:6755190297424698233`
  - [Session 3](https://app.fullstory.com/ui/18PNWR/session/8319155389179776448:6841045332346576412) · `8319155389179776448:6841045332346576412`

### Fix

One CSS rule. Put it in the stylesheet for the ProductPage or the sidebar component:

```css
#share-button svg,
#share-button svg * {
  pointer-events: none;
}
```

This tells the browser to pass click events from the SVG and its children straight through to the parent button, where the handler actually lives. This is the standard fix for icon-inside-button click hijacking and shouldn't affect any other behavior.

### Validation

- [ ] Dead-click count on `#share-button svg line` drops to near-zero in the next 14 days (target: <10 users)
- [ ] Manual test: click the share button's icon in Chrome DevTools; verify the `click` event fires on the `<button>`, not the `<line>`
- [ ] Regression test: share functionality still opens the share modal/sheet when clicking the button icon OR its surrounding area

---

## Appendix A — All Fullstory objects referenced

### Segments (user cohorts for each issue)

| Issue | Segment ID | URL |
|---|---|---|
| 1 — TypeError | `4B3k9bGhrd0p` | [open](https://app.fullstory.com/ui/18PNWR/segments/everyone/people:search:4B3k9bGhrd0p) |
| 2 — Purchase Complete errors | `N24T3Z3Sadgq` | [open](https://app.fullstory.com/ui/18PNWR/segments/everyone/people:search:N24T3Z3Sadgq) |
| 3 — City API errors | `RxfZH56jFICD` | [open](https://app.fullstory.com/ui/18PNWR/segments/everyone/people:search:RxfZH56jFICD) |
| 4 — iOS addToCart errors | `e0QzYGi6Tgzt` | [open](https://app.fullstory.com/ui/18PNWR/segments/everyone/people:search:e0QzYGi6Tgzt) |
| 5 — Share button dead clicks | `pclrFeHmO3ws` | [open](https://app.fullstory.com/ui/18PNWR/segments/everyone/people:search:pclrFeHmO3ws) |

### Funnels (for downstream impact analysis)

| Funnel | ID | URL |
|---|---|---|
| Purchase Funnel (end-to-end) | `2BWVg4GQY7Uo` | [open](https://app.fullstory.com/ui/18PNWR/funnels/details/2BWVg4GQY7Uo) |
| PDP → Checkout Start | `YiVDRnS8mILQ` | [open](https://app.fullstory.com/ui/18PNWR/funnels/details/YiVDRnS8mILQ) |
| Checkout Review → Success | `ytEwKbV4XEIq` | [open](https://app.fullstory.com/ui/18PNWR/funnels/details/ytEwKbV4XEIq) |

### Related assets

- [Campaign Performance Report](./index.html) — full context, Sections 06 and 07 cover these issues
- [Campaign Performance Field Guide](./field-guide/) — internal talk track
- [CarGo UX Report](../cargo-ux-report/) — prior deep-dive on the two "walls" (car availability, payment API). Some issues here are regressions of items from that report.

---

## Appendix B — How to verify each fix after deploy

1. Deploy the fix (web frontend / mobile / backend as applicable).
2. Wait **48 hours** for traffic to accumulate new signals.
3. For each issue, re-open the **DevFix segment URL** from Appendix A and confirm the user count over the post-deploy window.
4. Compare to the pre-deploy 14-day count listed at the top of this document. A fix is validated when post-deploy count drops by ≥80%, with no new error signatures rising to take its place.
5. If any of these regress again later, rerun the Fullstory MCP `discover_groups` call with `compare_to_previous=true` and scope to the Purchase Funnel (`2BWVg4GQY7Uo`) — the same command the analyst used to surface these issues originally.

For the Fullstory MCP command that produced this analysis, see the [Campaign Performance Field Guide](./field-guide/#investigation).

---

*Generated via Fullstory MCP · Org 18PNWR · Window 2026-04-04 → 2026-04-17 vs 2026-03-21 → 2026-04-03*
