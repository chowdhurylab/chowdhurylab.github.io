openPTM

Website: https://chowdhurylab.github.io/tools/openptm/
Release: 2026-10-19

Browse measurements, PTM families, sites, disease studies and methods. The page contains its data,
styles and scripts; it does not need external fonts or JavaScript libraries.
Open index.html locally, or keep it beside the Excel file when publishing.

Design update, 18 October
- Measurements opens first, with compact protein, measurement, state-value and
  source columns. Exact state labels remain beside their values.
- Measured comparisons and All findings have separate tabs. Filters and counts
  stay within the chosen collection; clearing filters keeps that collection.
- PTM directory counts link directly to records. Family pages show measurement
  previews before database coverage and audit details.
- Record details show all values first, with study limits visible below them.
  Assay preparation and original source fields remain available in disclosures.
- System typography, shorter headings, quieter spacing and phone controls
  replace the longer, more repetitive presentation.
- This interface is retained in reading round 24. The original Excel is unchanged.

Included in this release
- 111 operational PTM families in the original audit.
- 27,165 site records and 14,399 function/regulation records.
- 63 source summaries: six original comparisons and 57 later additions.
- 224 selected paper comparisons, containing 272 measurement entries from
  83 primary papers across 81 families with numeric measurements.
- 69 selected disease-study connections.
- All nine original audit worksheets, with source records and methods.

Counts retain their original units. Site records from different sources may
overlap and must not be summed as unique biological sites. The 111 families
are a defined working set, not a universal count of all PTMs. Paper comparisons
are selected examples, not a systematic review. Upper bounds, uncertainty,
study conditions and source links are retained in the record details.

New paper measurements, reading round 24
- One comparison and one measurement entry from one additional paper,
  adding numerical coverage for protein splicing (PMID34235541).
- Concanavalin A: printed methyl-alpha-D-mannose binding association constants
  of 8240 +/- 74.0 M^-1 for mature conA and 8270 +/- 74.0 M^-1 for pro-conA.
  The source reports similar binding; this does not establish equivalence.
- Native circular-permutation maturation includes segment excision and peptide
  ligation. The recombinant precursor and commercial plant-purified mature
  material differ in origin; mature material includes a small unquantified
  two-chain fraction. These limits remain attached to the comparison.
- Uncertainty kind and replicate count are unspecified. No thermal-stability
  number, calculated ratio, inferred zero or canonical site was added.
- Two readers independently checked the original PDF. The linked commentary
  was separately classified through the existing publication-notice gate.
- Eight new primary papers were read in selected relevant sections across
  seven families outside the previous pass. One prior-citation revisit, one
  access-only lead and one metadata-only lead are counted separately. No SI
  was read. Other reviewed papers remain documented holds.
- 30 of 111 audit families remain without a numerical comparison in this
  selection; this is not evidence of absence from the literature.
- Existing records, the interface and the original audit workbook are preserved.

New paper measurements, reading round 23
- One comparison and one measurement entry from one additional paper,
  adding numerical coverage for phosphopantetheinylation (PMID18770515).
- Actinorhodin acyl carrier protein: printed binding Kd values of
  1.1 +/- 0.1 micromolar for apo and 2.1 +/- 0.1 micromolar for holo.
  This is binding to S. coelicolor ACPS, the installing enzyme, not a
  measurement of catalytic activity or phosphopantetheine-transfer rate.
- Both preparations share the C17S engineered background. Source uncertainty
  type and replicate count are unspecified. Preparation and occupancy limits
  remain explicit, with no canonical site assignment or calculated fold change.
- Two readers independently checked the original publisher PDF, including
  Table 2 and the relevant methods. A labeled manual source excerpt is retained
  locally; its checksum is not a raw-PDF checksum.
- Seven new primary papers were read in selected relevant sections across six
  families outside the previous pass. A secondary self-summary, two access-only
  leads and one metadata-only lead are counted separately; no SI was read.
- Other reviewed papers remain documented holds.
- That publication left 31 of 111 audit families without a numerical
  comparison in its selection.
- Existing records, the interface and the original audit workbook are preserved.

New paper measurements, reading round 22
- Two comparisons with two measurement entries from one additional paper,
  adding numerical coverage for lipoylation (PMID10209517).
- Lipoylated and unlipoylated human PDC-E2 domain and peptide preparations
  were compared using patient PBMC T-cell stimulation indices. Both comparisons
  were reported as not statistically significant. This is an antigen-response
  assay, not enzyme activity, and it does not establish equivalence.
- Printed means and accompanying uncertainty values are retained. The source
  does not define the uncertainty type beside these means; exact pair-specific
  patient counts are left unassigned. Subgroup wording limits remain visible.
- Two readers independently checked the original HTML. A manual source excerpt
  is retained locally and labeled as such; its checksum is not a raw article hash.
- Nine new primary papers were read in selected relevant sections across six
  families not covered in the preceding pass. Two supporting documents and one
  linked correction were read separately. Other leads remain documented holds.
- That publication left 32 of 111 audit families without a numerical
  comparison in its selection.
- Existing records, the interface and the original audit workbook are preserved.

New paper measurements, reading round 19
- Two comparisons with 22 measurement entries from two additional papers,
  adding numerical coverage for FAT10ylation and covalent porphyrin attachment.
- Whole horse-heart cytochrome c: two Table I endpoints from PMID2557914,
  comparing covalently heme-bearing and chemically heme-depleted preparations.
  Lipid/protein stoichiometry is not affinity. The printed spectral zero,
  chemical preparation, folding and surface-adsorption limits remain explicit.
- JunB FAT10ylation: 20 author-supplied residual-protein observations at two
  chase time points from PMID31575873, grouped as one comparison. The source
  states five experiments but supplies four values per target state at 2.5 h
  and six at 5 h. This discrepancy remains visible; no observation was discarded,
  no replicate pairing or means were inferred, and no half-life was fitted.
- Original values, state assignments and notice metadata were independently
  reviewed. Source workbook cell locations and checksums remain in provenance.
- That publication left 33 of 111 audit families without a numerical
  comparison in its selection.
- Existing records, the interface and the original audit workbook are preserved.

New paper measurements, reading round 18
- Three comparisons with eight measurement entries from three additional papers,
  adding numerical coverage for biotinylation, glycylation and UFMylation.
- Yeast Arc1p: approximately 37 and 47 degrees C melting temperatures, PMID
  27330079. The same-sequence preparations differ in growth conditions; the
  biotinylated preparation has approximately 15% occupancy. Causality is unresolved.
- Tubulin glycylation: source-printed 79% decrease in katanin-mediated severing,
  PMID 36347241. This is a relative endpoint, not two absolute rates. Mixed
  tubulin preparations, cross-species assay and unavailable SI spectra are explicit.
- CYB5R3 UFMylation: six author-supplied raw activity observations, PMID36543799,
  grouped as one comparison without paired-replicate assumptions or calculated
  means. Source units, nonzero background, tags/truncation, equal-mass inputs
  and the unquantified FAD-occupancy interpretation remain attached.
- Original sources and numerical transcription were independently checked.
  Thirteen newly obtained main originals were read in selected relevant sections;
  three were recovered prior access-held leads. Other papers remain documented holds.
- That publication left 35 of 111 audit families without a numerical comparison
  in its selection.
- Existing records, the clean interface and the original audit workbook are preserved.

New paper measurements, reading round 17
- Two comparisons with six measurement entries from two additional papers.
- Fast-FT blue/red chromophore maturation: five optical entries from Subach
  et al. (2009), PMID 19136976, DOI 10.1038/nchembio.138. Both states are
  already modified. Later chemistry (PMID 20121102) is corroboration, not
  another numerical paper. Calibration and preparation limits are retained.
- Silk-fibroin hydrogels: one water-content comparison from Mu et al. (2022),
  PMID 35074913, DOI 10.1073/pnas.2115523119. Both preparations are already
  crosslinked; the response after three days in saline is not proven equilibrium
  or an isolated dityrosine-bond effect. Source SD and replication limits remain.
- Original values, chemical assignments and notice metadata were independently
  reviewed. Earlier records, the interface and the audit workbook are preserved.
- That publication left 38 of 111 audit families without a numerical
  comparison in its selection.

New paper measurements, reading round 16
- One comparison with two optical measurements from Subach et al. (2009),
  PMID 19169259, DOI 10.1038/nmeth.1298, adds decarboxylation coverage.
- Same engineered PAmCherry1 sequence before and after photoactivation:
  absorption maxima 404 and 564 nm; extinction coefficients 6500 and 18000
  M^-1 cm^-1 at each state's own peak. These are not fixed-wavelength brightness.
- Later structural/MS evidence (PMID 19934036) supports decarboxylation with
  coupled chromophore oxidation; it is not counted as another numerical study.
- Calibration assumptions, absent n and errors, and the affiliation-only
  publisher erratum remain explicit. No canonical site or occupancy inferred.
- Independent review verified original table values, chemistry and notices.
- That publication left 40 of the 111 audit families without a numerical
  comparison in its selection.

New paper measurements, reading round 15
- Two deamination comparisons and four measurement entries from one additional
  paper: Roth and Hurley (1966), PMID 5971772, DOI 10.1042/bj1010112.
- Ordinary-RNA activity retains the source's 100% modified value and explicit
  100% native reference, without a statistical equivalence claim.
- Three paired absorbance endpoints use the same chemically deaminated RNA
  substrate at matched enzyme quantities; they are not kinetic constants.
- Preparation-level chemistry, unresolved sites and occupancy, and absent
  statistical uncertainties remain explicit. No species or accession inferred.
- Original-source extraction and independent source review support both rows.
- That publication left 41 of the 111 audit families without a numerical
  comparison in its selection.

New paper measurements, reading round 14
- Five comparisons and nine measurement entries from three additional papers.
- Human PP2C-alpha S-glutathionylation kinetics retain the near-null result,
  activity-aliquot occupancy limits and unspecified fitted-error basis.
- Tubulin peptide binding to engineered A1aY1 retains the >60 micromolar
  bound, shared control and peptide/reader scope.
- Human ARSA preparations add the first numerical formylglycine entries.
  Raw slopes retain shared controls, mixed occupancy and preparation limits;
  conflicting normalized-activity units are excluded.
- Source values and admissions were independently reviewed.
- That publication left 42 of the 111 audit families without a numerical
  comparison in its selection.

Measurements published earlier on 16 October
- 41 additional comparisons with 47 measurement entries, adding 37 primary
  papers and numerical coverage for 38 more PTM families.
- That addition contains four Rab1b phosphocholination comparisons and
  one anhydrotrypsin comparison with two ligand-specific binding entries.
  Source uncertainty, nucleotide analogues, processing differences, weaker
  effects and unresolved construct labels remain attached to the values.
- Later breadth batches include independent source reviews recorded per batch.
  Source checking does not reproduce experiments or isolate chemical-bond effects.
- That publication left 43 of the 111 audit families without a numerical
  comparison in its selection.

Earlier measured additions (retained)
- Citrullination: the complete Table 1 panel of four matched peptides against
  28 HLA molecules. Two comparisons were already present; 110 are new. These
  are one paper's results, not independent studies. Dashes remain >30,000 nM;
  two bounds do not establish a difference. Alpha/beta partners follow S1.
- Methacrylation: two AF9 binding comparisons against crotonylated H3 peptides,
  with source SE and n=3. Neither state is unmodified histone. The original
  main article was checked; separate SI purity traces were not reviewed.
- Osteocalcin carboxylation: two calcium conditions from the original Table II.
  The source's inconsistent units remain flagged beside the values; K is not
  converted to Kd. These are grouped Gla states, not three separate site effects.
- Engineered thiocarboxylation: thioredoxin and DTNB kinetics from Tables 4–5.
  Engineered material, conflicting Table 4 footnote letters and the reporter
  substrate are labelled explicitly. These are not native PTM samples.
The earlier 13 October panel and recovered-paper additions were checked by
one reviewer against original articles and tables. This is source checking,
not experimental validation.

Source records retained
- PTMPhaSe: 855 qualitative annotations, not 855 independent experiments.
  Five rows from four selected papers have been checked against the studies;
  the remaining 850 are marked unreviewed. The RPS23 direction conflict stays
  visible. The paper's 733 sites and the deposit's 737 literal site keys differ.
- AMPylation: 240 original ORF/residue/position keys from 310 observations.
  Four lower-localization assignments and two coordinate conflicts are flagged.
- Citrullination: 2,242 human and 199 plant accession/residue keys. Spectral
  angles and log10 MS1 intensities are separate measurements, not occupancy.
- Succination: 71 observations covering 67 original RefSeq/site keys. Fifty-five
  observations have one repeat detection. Native versus fumarate-treated sample
  attribution remains unresolved; spectral ratios are not molecular occupancy.

The website presents attributed factual records and source annotations, not
publisher workbooks, PDFs or original supplementary archives. Source-specific
reuse terms remain attached; repository CC0 is not transferred to publisher
files. Earlier local-import wording in Original source fields is retained as
capture history, not an unrestricted source-file reuse license. Transient signed
download URLs are omitted; stable source URLs and file checksums are retained.

Download
PTM_family_database_audit_final_2026-08-14.xlsx is the original nine-sheet
August audit. It is unchanged and does not include the later site, function,
paper-measurement or disease additions shown on the website. The page has one
Excel download. Keep this workbook in the same directory as index.html.

The September 24 disease CSV and JSON files in this folder are historical
exports, not the current website dataset. They are retained for old links.

Release checksums (SHA-256)
index.html
287f68a43746fc56c8f1d9cc96b5687485720431e2edad283dd3a8957592a7ac
PTM_family_database_audit_final_2026-08-14.xlsx
ddaa9ec6227fcfdaa12bb1a4a99ffaf7d28adb7c701f4ce8a7815038bbe81a8a

Source rights, excluded resources, audit dates and individual study limits
are described under Methods and in each record. A model experiment or an
association is not clinical validation or evidence of treatment benefit.
