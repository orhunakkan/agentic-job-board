# Triage scoring rubric

**Rubric version: `triage-v1`** (send it as `rubricVersion` with every score). Change the version on any change to the factors, points or calibration below.

The `/find-jobs` agent ([`find-jobs.md`](find-jobs.md)) scores every unscored job from 0 to 100 against the owner's profile (`GET /api/profile`). It sees only what the alert email shows: title, company, location and two flags (actively hiring, Easy Apply). There is no description, salary or remote flag, so this is a **triage** score: how likely the job is worth opening, not a full match (PLAN.md §1.4, FR-06).

Jobs from the other sources (DEC-035) are scored with the same factors on their title, company and location, so scores on both board views compare (DEC-038). Their location is often written `Remote (United States)` or `Remote · USA`: that is remote US. The agent never reads their descriptions.

## How to score

Add the four factors, then apply the cap. Use whole numbers.

| Factor        | Points | Guidance                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role fit      | 0–40   | Title in the target family (QA, SDET, Software Engineer in Test, Test Automation, Quality Engineer, AI QA) = **30–40**, higher the closer it is to a profile `targetRoles` entry. Adjacent (DevOps or SWE with testing, QA lead/manager, release/build) = **15–29**. Unrelated (hardware or R&D test, manual-only, non-engineering, data/ML engineer without QA) = **0–14**                          |
| Seniority     | 0–20   | Senior, Staff, Lead, Principal, Architect = **16–20**. No level in the title = **10**. Mid-level ("II", "Engineer 2") = **6–12**. Junior, Associate, "I", intern = **0–5**                                                                                                                                                                                                                           |
| Stack signal  | 0–20   | Title names a core skill (Playwright, TypeScript, JavaScript, Cypress, Selenium, API testing, AI or LLM) = **15–20**. Secondary skill only (Java, Postman, SQL, AWS, Azure) = **10–14**. No technology named = **10**; words like "Automation", "Test" or "Quality" describe the role, not a stack, and score here. A conflicting stack (only C#/.NET, mobile-native only, SAP, mainframe) = **0–5** |
| Location fit  | 0–20   | The profile is **remote-US only, no relocation** (DEC-016). "Remote" in the title or location, or a US location marked remote = **20**. Plain `United States` (often remote) = **12**. Empty location = **10**. A US city, county, state or metro with no remote marker (may be hybrid or on-site) = **2–5**. Marked on-site or hybrid = **0–3**. Outside the US = **0**                             |
| Deal-breakers | cap    | Any profile `dealBreakers` hit, or a company in `excludedCompanies` → the score is **capped at 30**, and the reason names the deal-breaker                                                                                                                                                                                                                                                           |

Today's deal-breakers (from the profile; always re-read it, it can change): manual-only testing roles; hardware, embedded or device testing; junior or intern roles; requires an active security clearance (a title with "Clearance", "TS/SCI", "Secret" or "Polygraph").

The flags and the salary never change the score: "actively hiring", Easy Apply and a feed's salary are shown on the board on their own.

## Label and reason

- **Label** follows the score band exactly (FR-06): `strong` ≥ 75, `possible` 50–74, `weak` < 50. The API rejects a label that doesn't match its score.
- **Reason**: one plain sentence, at most 200 characters, naming what drove the score, for example `Senior SDET title with Playwright, remote US.` or `Capped: hardware test role (deal-breaker).` Don't repeat the title word for word, and don't invent facts the email doesn't show.

## Worked examples

| Job (title · company · location)                                                                  | Role | Seniority | Stack | Location | Cap | Score | Label    | Reason                                                                  |
| ------------------------------------------------------------------------------------------------- | ---- | --------- | ----- | -------- | --- | ----- | -------- | ----------------------------------------------------------------------- |
| Senior Quality Assurance Engineer (Playwright, TypeScript, and Postman) · 3Pillar · United States | 40   | 18        | 20    | 12       | –   | 90    | strong   | Exact stack match (Playwright/TypeScript/Postman), senior, US-wide.     |
| Senior QA Automation Test Engineer · Cboe Global Markets · Chicago, IL                            | 38   | 18        | 10    | 4        | –   | 70    | possible | Senior QA automation role, but Chicago-based and not marked remote.     |
| AI Native, QA Engineer · ConsumerAffairs · United States                                          | 38   | 10        | 17    | 12       | –   | 77    | strong   | AI-focused QA role matching the AI QA target; level not stated.         |
| QA Automation Engineer II – IntelliScript (Remote) · Milliman IntelliScript · United States       | 36   | 8         | 10    | 20       | –   | 74    | possible | Remote QA automation role, but mid-level (II) and no stack named.       |
| Senior Quality Assurance Engineer · Goosehead Insurance · Dallas-Fort Worth Metroplex             | 36   | 18        | 10    | 3        | –   | 67    | possible | Senior QA role, but Dallas-based and not marked remote.                 |
| R&D Test Engineer · Agilent Technologies · Harrisburg, PA                                         | 8    | 10        | 10    | 3        | 30  | 30    | weak     | Capped: hardware/R&D test role (deal-breaker), on-site in Pennsylvania. |
| Junior QA Tester · Example Co · Remote                                                            | 30   | 2         | 10    | 20       | 30  | 30    | weak     | Capped: junior role (deal-breaker).                                     |

## Calibration set

PLAN.md §6.5 lists real jobs from the owner's alerts with the label each should get. A rubric change must keep every row on an expected label; re-check this table whenever the version changes.

| Job                                                                                               | Expected (PLAN.md §6.5)                                           | `triage-v1` gives | On target |
| ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ----------------- | --------- |
| Senior Quality Assurance Engineer (Playwright, TypeScript, and Postman) · 3Pillar · United States | strong                                                            | 90 strong         | ✅        |
| Senior QA Automation Test Engineer · Cboe Global Markets · Chicago, IL                            | possible (re-confirmed at CP-5: remote-US only, DEC-016, DEC-028) | 70 possible       | ✅        |
| AI Native, QA Engineer · ConsumerAffairs                                                          | strong / possible                                                 | 77 strong         | ✅        |
| QA Automation Engineer II – IntelliScript (Remote) · Milliman IntelliScript                       | possible                                                          | 74 possible       | ✅        |
| Senior Quality Assurance Engineer · Goosehead Insurance · Dallas-Fort Worth Metroplex             | possible / weak                                                   | 67 possible       | ✅        |
| R&D Test Engineer · Agilent Technologies · Harrisburg, PA                                         | weak                                                              | 30 weak           | ✅        |
