# OPENCLAW HANDOFF - Research Stats follow-up

## Repo
`/Users/rizapd/Documents/Work/chowdhurylab.github.io`

## What was completed

### 1) Publication metadata enrichment is done
The previously unresolved `et al.` publications in `assets/data/publications.json` were enriched with `fullAuthors` and `labMemberAuthors`.

At last verification:
- `remaining_missing 0`

That means the publication-side metadata blocker was cleared.

### 2) Member name matching logic was improved
File updated:
- `assets/js/members-component.js`

Changes already made:
- added `normalizeMemberName(text)`
- updated `lookupAuthorId(memberName)` to compare normalized forms
- normalization strips `PhD` suffix variants, lowercases, collapses whitespace, and trims

### 3) Some author aliases/mappings were added
File updated:
- `assets/data/authors.json`

Several entries were added/expanded earlier, including examples like:
- `bibek-acharya`
- `jennifer-bruner`
- `maria-brown`
- `riza-danurdoro`
- `curwen-pei-hong-tan`

Riza spelling variants were also added, including:
- `Riza Danurdoro`
- `Riza Danudoro`
- `Danurdoro, R`
- `Danurdoro, R.`
- `Danudoro, R`
- `Danudoro, R.`

### 4) Ratul member linkage was intentionally removed
Per user request, Ratul should not have a member-linked research stats page.

File changed:
- `assets/data/authors.json`

Intentional current state:
- `id: "ratul-chowdhury"`
- `memberName: ""`

Do not restore Ratul member linkage unless the user explicitly asks.

## What is NOT done
The real remaining problem is **member-to-author coverage**, not publication metadata.

A later audit showed:
- `48` total members in `assets/data/members.json`
- only `14` matched/linkable through `assets/data/authors.json`
- `34` still missing a linkable author mapping

This means many members still do not get `Research Stats` links/pages even though publication metadata now exists.

## Critical finding
A member can still fail to get a stats page even if they appear correctly in `publications.json`, because the site first needs a matching author entry in:
- `assets/data/authors.json`

Example that exposed the bug:
- `Curwen Pei Hong Tan` existed in `assets/data/members.json`
- `Curwen Pei Hong Tan` also appeared in `publications.json`
- but there was no author entry in `assets/data/authors.json`
- therefore no member-linked stats page could be generated

This was fixed by adding:
- `id: "curwen-pei-hong-tan"`
- `displayName: "Curwen Pei Hong Tan"`
- `memberName: "Curwen Pei Hong Tan"`
- `fullNameVariants: ["Curwen Pei Hong Tan"]`

## Immediate next task for future self
You need to audit **every member** in `assets/data/members.json` and ensure each one has a corresponding linkable entry in `assets/data/authors.json` if they should have a research stats page.

This is the real unfinished work.

## Current member audit result
The following command logic was used conceptually:
- read all members from `assets/data/members.json`
- normalize names the same way as `members-component.js`
- compare against `memberName`, `displayName`, and `fullNameVariants` in `assets/data/authors.json`

Last result:
- `TOTAL_MEMBERS 48`
- `MATCHED 14`
- `MISSING 34`

Members reported missing at that time:
- `Arunraj B, PhD`
- `Sean Yang`
- `Avishek Bhattacharya`
- `Randy Aryee`
- `Biswaroop Maiti`
- `Priyanshu Gupta`
- `Madison Ellis`
- `Mahbuba Ferdaous`
- `Laura Mariana Correa`
- `Casey Zielinski`
- `Nathan Thomas`
- `Rohan Ghosh Dastidar`
- `Adele Haghighat Hoseini`
- `Yee Chuen Teoh`
- `Naimisha Venkatesh`
- `Rachana Krishnamurthy`
- `Jack Girton`
- `Zachary L Wallace`
- `Brisa Lopez Calderon`
- `Aaron Kammlah`
- `Nikhita Nallu`
- `Cris Matthews`
- `Andrew Slaughter`
- `Naomi Mauss`
- `Jack Sloyan`
- `Brooklyn Mills`
- `Jerome Chow`
- `Sophie Faga`
- `Kaelie Hainlin`
- `Evan Ingmire`
- `Ali Zahedi`
- `Joel`
- `Julia Young`
- `Shashank Koneru`

## What future self should do
1. Open and inspect:
   - `assets/data/members.json`
   - `assets/data/authors.json`
   - `assets/data/publications.json`
   - `assets/js/members-component.js`

2. For each missing member above:
   - determine whether they should have a stats page
   - if yes, add or fix an author entry in `assets/data/authors.json`
   - include:
     - stable `id`
     - `displayName`
     - `memberName`
     - `fullNameVariants`
     - `publicationNames` when abbreviated citation matching is useful

3. Re-run the member coverage audit until all intended members resolve.

4. Then verify in the UI:
   - `members.html`
   - `author.html?author=<id>&from=members`

5. Confirm first-author/co-author counts are sensible for newly linked members.

## Important caution
Do not confuse these two layers:
- `publications.json` enrichment = mostly done
- `authors.json` member linkability = still incomplete

The user was frustrated because earlier progress was overstated. Future self should be blunt and precise about which layer is done.

## Suggested quick audit script idea
Use the same normalization as the code:
- strip `PhD` suffix variants
- lowercase
- collapse whitespace
- compare against `memberName`, `displayName`, and `fullNameVariants`

That script already showed only `14 / 48` matched at the time of handoff.

## Commit status
No commit was made for this chowdhurylab research-stats work.
