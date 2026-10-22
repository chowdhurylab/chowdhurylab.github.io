#!/usr/bin/env python3
"""Count saved fields in the frozen public follow-up cohort (not review blockers), and the Stats page overview."""

from __future__ import annotations

import argparse
import gzip
import hashlib
import importlib.util
import json
import math
import re
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CATALOG = ROOT / "tools/catlog-static"
FIELD_NAMES = ("kinetic_value", "paper_id", "sequence", "smiles")


def summarize(rows):
    statuses = Counter()
    coverage = dict.fromkeys(
        ("total", "with_literature_id", "with_sequence", "with_smiles", "with_kinetic_value"), 0
    )
    for row in rows:
        status = row.get("verification_status")
        if not isinstance(status, str):
            raise ValueError("Missing review status in public record")
        statuses[status] += 1
        if status != "manual_review_required":
            continue
        coverage["total"] += 1
        coverage["with_literature_id"] += bool(row.get("supporting_pmids") or row.get("supporting_dois"))
        coverage["with_sequence"] += bool(row.get("sequence"))
        coverage["with_smiles"] += bool(row.get("smiles"))
        coverage["with_kinetic_value"] += any(row.get(key) is not None for key in ("kcat", "km", "ki", "kcat_over_km"))
    return coverage, dict(statuses)


def build(manifest, download):
    with download.open("rb") as handle:
        digest = hashlib.file_digest(handle, "sha256").hexdigest()
    if digest != manifest["enriched_download"]["sha256"]:
        raise ValueError("Frozen download hash does not match the manifest")
    with gzip.open(download, "rb") as handle:
        coverage, statuses = summarize(json.loads(line) for line in handle if line.strip())
    expected = {item["label"]: item["count"] for item in manifest["summary"]["distributions"]["verification_status"]}
    if statuses != expected or sum(statuses.values()) != manifest["total_rows"]:
        raise ValueError("Public download statuses do not match the snapshot")
    return {
        "source_sha256": manifest["source_sha256"],
        "download_sha256": digest,
        "cohort": "manual_review_required",
        "meaning": "Saved field presence; not completed checks or reasons for follow-up",
        **coverage,
    }


def build_review_details(manifest, download):
    with download.open("rb") as handle:
        digest = hashlib.file_digest(handle, "sha256").hexdigest()
    if digest != manifest["enriched_download"]["sha256"]:
        raise ValueError("Frozen download hash does not match the manifest")
    groups = {status: {"total": 0, "with_literature_id": 0, "with_sequence": 0,
                       "with_smiles": 0, "with_kinetic_value": 0,
                       "material": dict.fromkeys(("paper_excerpt", "source_note", "paper_id", "database_record"), 0),
                       "field_combinations": Counter()}
              for status in ("manual_review_required", "unverified", "mathematically_inferred")}
    statuses = Counter()
    with gzip.open(download, "rb") as handle:
        for line in handle:
            if not line.strip():
                continue
            row = json.loads(line)
            status = row.get("verification_status")
            statuses[status] += 1
            if status not in groups:
                continue
            group = groups[status]
            group["total"] += 1
            group["with_literature_id"] += bool(row.get("supporting_pmids") or row.get("supporting_dois"))
            group["with_sequence"] += bool(row.get("sequence"))
            group["with_smiles"] += bool(row.get("smiles"))
            group["with_kinetic_value"] += any(row.get(key) is not None for key in ("kcat", "km", "ki", "kcat_over_km"))
            present = (any(row.get(key) is not None for key in ("kcat", "km", "ki", "kcat_over_km")),
                       bool(row.get("supporting_pmids") or row.get("supporting_dois")),
                       bool(row.get("sequence")), bool(row.get("smiles")))
            missing = tuple(name for name, included in zip(FIELD_NAMES, present) if not included)
            group["field_combinations"][missing] += 1
            material = ("paper_excerpt" if row.get("has_proof_excerpt") else
                        "source_note" if row.get("proof_kind") == "source_note" else
                        "paper_id" if row.get("has_literature_id") else "database_record")
            group["material"][material] += 1
    expected = {item["label"]: item["count"] for item in manifest["summary"]["distributions"]["verification_status"]}
    if dict(statuses) != expected or sum(statuses.values()) != manifest["total_rows"]:
        raise ValueError("Public download statuses do not match the snapshot")
    for group in groups.values():
        group["field_combinations"] = [
            {"missing": list(missing), "count": count}
            for missing, count in sorted(group["field_combinations"].items(), key=lambda item: (len(item[0]), item[0]))
        ]
    return {"source_sha256": manifest["source_sha256"], "download_sha256": digest,
            "meaning": "Fields and attached material by status, not reasons for review decisions",
            "groups": groups}


# The Stats page overview (manifest summary.overview). Every rule below mirrors what the page itself shows for a record
# (catlog-static.js), so a count here is the count a Browse link with the same filter finds.
EC_CLASS_NAMES = {1: "Oxidoreductases", 2: "Transferases", 3: "Hydrolases", 4: "Lyases", 5: "Isomerases",
                  6: "Ligases", 7: "Translocases"}
# The record's source (Browse `source=`, rowSourceBits): each database source_db names, with paper for primary literature;
# a merged value such as "sabio_rk;brenda" counts under each source it names.
SOURCE_KEYS = ("paper", "brenda", "sabio_rk", "oed", "uniprot", "skid", "strenda")
SOURCE_TOKENS = {"primary_paper_direct": "paper", "primary_literature": "paper", "paper": "paper", "brenda": "brenda",
                 "sabio_rk": "sabio_rk", "sabio": "sabio_rk", "sabiork": "sabio_rk", "oed": "oed",
                 "open_enzyme_database": "oed", "uniprot": "uniprot", "skid": "skid", "strenda": "strenda"}
# The Browse organism filter (foldSearch, compactSearch, organismSearchText, fieldWords, fieldContains): every word of
# the name, folded, inside the record's folded organism with its short and common names.
GREEK_NAMES = {"α": "alpha", "β": "beta", "γ": "gamma", "δ": "delta", "ε": "epsilon", "ζ": "zeta", "η": "eta",
               "θ": "theta", "ι": "iota", "κ": "kappa", "λ": "lambda", "μ": "mu", "ν": "nu", "ξ": "xi", "ο": "omicron",
               "π": "pi", "ρ": "rho", "σ": "sigma", "ς": "sigma", "τ": "tau", "υ": "upsilon", "φ": "phi", "χ": "chi",
               "ψ": "psi", "ω": "omega"}
COMMON_ORGANISM_NAMES = {"homo sapiens": "human", "rattus norvegicus": "rat", "mus musculus": "mouse",
                         "oryctolagus cuniculus": "rabbit", "bos taurus": "bovine cow", "sus scrofa": "porcine pig",
                         "canis lupus": "dog", "gallus gallus": "chicken", "zea mays": "maize", "sorghum bicolor": "sorghum",
                         "saccharomyces cerevisiae": "yeast"}
LOCANT_WORD = re.compile(r"^(?:\d{1,2}'*(?:,\d{1,2}'*)*|[dlpomn](?:,[dl])?|" + "|".join(sorted(set(GREEK_NAMES.values()))) + r")$")
# Browse `caution=` groups of condition_flags: the page's CAUTION_FLAG_BITS (bit 1 differs, bit 2 units), so Stats counts
# what the Cautions filter finds (a printed unit prefix that differs is a unit caution there too).
CAUTION_GROUPS = {
    "differs": ("kcat_over_km_quotient_mismatch", "kcat_over_km_source_mismatch"),
    "units": ("km_magnitude_needs_check", "kcat_magnitude_needs_check", "kcat_over_km_unit_mismatch",
              "efficiency_above_diffusion_limit", "printed_unit_prefix_differs"),
    "unit_missing": ("unit_not_recorded_kcat", "unit_not_recorded_km"),
}
# Catalog units (normalizedUnitKey / canonicalMetricUnitKeys in the page).
METRIC_UNITS = {"kcat": {"s-1"}, "km": {"mm"}, "kcat_over_km": {"s-1mm-1", "mm-1s-1"}}
METRIC_LABELS = {"kcat": "s^-1", "km": "mM", "kcat_over_km": "s^-1 mM^-1"}
PLACEHOLDER_NAMES = {"", "unknown", "n/a", "na", "none", "not reported", "-", "—"}
EC_NUMBER = re.compile(r"^[1-7]\.\d+\.\d+\.n?\d+$")
OVERVIEW_TOP = 10


def unit_key(value):
    text = str(value or "").strip().lower().replace("−", "-")
    return re.sub(r"[\s()*^·]", "", re.sub(r"liters?", "l", text))


def has_display_value(value):
    key = str("" if value is None else value).strip().lower()
    return bool(key) and key not in ("n/a", "not reported", "not_reported", "—")


def _number(value):
    if value is None or value == "" or isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def js_number_text(value):
    """String(value) as the page writes a number: its digits and exponent decide the printed precision."""
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, float) and value.is_integer() and abs(value) < 1e21:
        return str(int(value))
    return repr(value)


def reported_interval(value):
    numeric = _number(value)
    if numeric is None:
        return None
    mantissa, _, exponent_text = js_number_text(value).lower().partition("e")
    try:
        exponent = int(exponent_text) if exponent_text else 0
    except ValueError:
        return None
    places = len(mantissa.split(".", 1)[1]) if "." in mantissa else 0
    half_step = 0.5 * 10.0 ** (exponent - places)
    return numeric - half_step, numeric + half_step


def efficiency_matches_reported_precision(row):
    fields = ("kcat", "km", "kcat_over_km")
    if not all(unit_key(row.get(f"{field}_unit")) in METRIC_UNITS[field] for field in fields):
        return False
    intervals = [reported_interval(row.get(field)) for field in fields]
    if any(interval is None for interval in intervals):
        return False
    (kcat_low, kcat_high), (km_low, km_high), (ratio_low, ratio_high) = intervals
    if kcat_high <= 0 or km_high <= 0 or ratio_high <= 0:
        return False
    low = max(kcat_low, 0) / km_high
    high = kcat_high / km_low if km_low > 0 else math.inf
    return max(ratio_low, 0) <= high and low <= ratio_high


# The magnitude cautions' bounds (website plan P8; the page's KM_LOW_BOUND_MM and KCAT_HIGH_BOUND_PER_S).
KM_LOW_BOUND_MM = 1e-6
KCAT_HIGH_BOUND_PER_S = 1e8


def catalog_value(row, field):
    """A value in the catalog unit, as the page reads it (its *_display text), or None."""
    if unit_key(row.get(f"{field}_unit")) not in METRIC_UNITS[field]:
        return None
    display = row.get(f"{field}_display")
    value = _number(display) if isinstance(display, str) and display.strip() else None
    return value if value is not None else (_number(row.get(field)) if display is None else None)


def condition_flags(row):
    """The flags a record shows (conditionFlags): a kcat/Km that agrees with kcat / Km within printed precision is not
    flagged as differing; Km below 1 nM is flagged and kcat only above 10^8 s^-1 (an older snapshot's flags brought to
    CatLog's bounds)."""
    flags = {str(flag).strip() for flag in row.get("condition_flags") or [] if str(flag or "").strip()}
    if "kcat_over_km_quotient_mismatch" in flags and efficiency_matches_reported_precision(row):
        flags.discard("kcat_over_km_quotient_mismatch")
    km = catalog_value(row, "km")
    if km is not None and 0 < km < KM_LOW_BOUND_MM:
        flags.add("km_magnitude_needs_check")
    kcat = catalog_value(row, "kcat")
    if kcat is not None and kcat <= KCAT_HIGH_BOUND_PER_S:
        flags.discard("kcat_magnitude_needs_check")
    return flags


def caution_keys(row):
    flags = condition_flags(row)
    keys = {key for key, names in CAUTION_GROUPS.items() if flags.intersection(names)}
    if any(flag.startswith("temperature_") for flag in flags):
        keys.add("temperature")
    return keys


def enzyme_form(row):
    """wild, variant or not stated, as enzymeFormLabel decides from the fields the table index carries."""
    signature = str(row.get("mutation_signature") or "").strip()
    if signature and re.sub(r"[\s_-]+", "", signature.lower()) not in ("unknown", "wt", "wildtype", "none", "na", "n/a"):
        return "variant"
    status = str(row.get("sequence_variant_status") or "").strip().lower()
    if row.get("wild_type") is False or re.search(r"variant|mutation", status):
        return "variant"
    if row.get("wild_type") is True or re.search(r"wild[ _-]?type", status):
        return "wild"
    return "not_stated"


def temperature_c(row):
    if has_display_value(row.get("temperature_display")):
        return _number(row.get("temperature_display"))
    kelvin = _number(row.get("temperature_k"))
    return kelvin - 273.15 if kelvin is not None and 170 < kelvin <= 1000 else None


def ph_value(row):
    value = _number(row.get("ph_display"))
    return value if value is not None and 0 <= value <= 14 else None


def ec_numbers(row):
    return [part for part in re.split(r"[;,\s]+", str(row.get("ec_number") or "").lower()) if part]


def paper_keys(row):
    """Digit PMIDs; a record without one counts by its DOIs, else by its stand-in id (NP + hex)."""
    pmids = {str(value).strip() for value in [*(row.get("supporting_pmids") or []), row.get("pubmed_id")]
             if str(value or "").strip().isdigit()}
    if pmids:
        return {f"pmid:{value}" for value in pmids}
    dois = {re.sub(r"^(?:https?://(?:dx\.)?doi\.org/|doi:)", "", str(value).strip().lower())
            for value in [*(row.get("supporting_dois") or []), row.get("doi")] if str(value or "").strip()}
    if dois:
        return {f"doi:{value}" for value in dois}
    standin = str(row.get("pubmed_id") or "").strip()
    return {f"id:{standin}"} if standin else set()


# Records by main source (Stats figure 2): each record once, under the source its source_db names: records read from the
# paper by CatLog apart from the earlier paper extractions, a record naming several databases under "several" and one
# naming none under "unrecorded"; each with its review statuses (verification_status counts). A source_db that names no
# database ("mixed") reads the databases the record lists as merged; "mixed" alone is several databases.
MAIN_SOURCE_KEYS = ("catlog", "earlier_paper", "brenda", "oed", "uniprot", "sabio_rk", "skid", "strenda", "several",
                    "unrecorded")


def main_source(row):
    if str(row.get("verification_method") or "").startswith("catlog_v2_read"):
        return "catlog"
    keys = source_keys(row.get("source_db")) or source_keys(";".join(map(str, row.get("source_databases_merged") or [])))
    if not keys:
        return "several" if str(row.get("source_db") or "").strip().lower() == "mixed" else "unrecorded"
    if len(keys) > 1:
        return "several"
    key = next(iter(keys))
    return "earlier_paper" if key == "paper" else key


def source_keys(value):
    keys = set()
    for part in re.split(r"[;,+/|]+", str(value or "").lower()):
        key = SOURCE_TOKENS.get(re.sub(r"[\s-]+", "_", part.strip()))
        if key:
            keys.add(key)
    return keys


def fold_search(value):
    text = str(value if value is not None else "").lower()
    if re.search(r"[^\x00-\x7f]", text):
        text = "".join(char for char in unicodedata.normalize("NFKD", text) if not unicodedata.category(char).startswith("M"))
        text = text.replace("∆", "δ")
        text = re.sub(r"[α-ω]", lambda match: GREEK_NAMES.get(match.group(0), match.group(0)), text)
        text = re.sub(r"[‐-―⁃−﹘﹣－]", "-", text)
        text = re.sub(r"[‘’‛′‵´`]", "'", text)
    return re.sub(r"(^|[^a-z0-9])(?:micro|u)(?=-)", r"\1mu", text)


def compact_search(text):
    return re.sub(r"[\s\-_,]+", "", text)


def organism_search_text(organism):
    text = str(organism or "").strip()
    if not text:
        return ""
    words = re.sub(r"[()]", " ", text).split()
    genus, species = (words + ["", ""])[:2]
    parts = []
    if re.fullmatch(r"[A-Z][a-z]+", genus) and re.fullmatch(r"[a-z][a-z-]+", species) and species != "sp.":
        parts += [f"{genus[0]}. {species}", f"{genus[0]}.{species}"]
    common = COMMON_ORGANISM_NAMES.get(f"{genus} {species}".lower())
    if common:
        parts.append(common)
    return "|".join(parts)


def folded_organism(organism):
    text = str(organism or "")
    return compact_search(fold_search(f"{text}|{organism_search_text(text)}"))


COMMON_ORGANISM_WORDS = {word for names in COMMON_ORGANISM_NAMES.values() for word in names.split()}


def organism_matches(organism, words, folded=None):
    """fieldContains for the organism: a common name (rat, pig, ...) as a whole word, any other word inside the name."""
    folded = folded_organism(organism) if folded is None else folded
    whole = None
    for word in words:
        if word in COMMON_ORGANISM_WORDS:
            if whole is None:
                text = str(organism or "")
                whole = set(filter(None, re.split(r"[^a-z0-9]+", fold_search(f"{text}|{organism_search_text(text)}"))))
            if word not in whole:
                return False
        elif word not in folded:
            return False
    return True


def field_words(text):
    words = fold_search(text).split()
    joined = []
    index = 0
    while index < len(words):
        word = words[index]
        while LOCANT_WORD.match(word) and index + 1 < len(words):
            following = words[index + 1]
            if not re.match(r"^[^\W_(]|^\(", following) or re.match(r"^(?:ec)?\d+(?:\.(?:\d+|-))*\.?$", following) \
                    or re.match(r"^\d{3,}$", following):
                break
            word += following
            index += 1
        joined.append(word)
        index += 1
    return [compact_search(word) for word in joined if compact_search(word)]


def top_organisms(spellings, raw_counts, limit=OVERVIEW_TOP):
    """The most common organisms, each counted as the Browse organism filter finds it: every record whose organism holds
    the name's words, so strains and other spellings of it count too. Names whose Browse results overlap (a strain and its
    species, "human" and Homo sapiens) are listed once, under the name more records give."""
    folded = {raw: folded_organism(raw) for raw in raw_counts}
    chosen = []
    for key, _count in top(Counter({key: sum(counter.values()) for key, counter in spellings.items()}), limit * 3):
        name = most_common(spellings[key])
        words = field_words(name)
        own = folded_organism(name)
        if not words or any(all(word in own for word in listed_words) or all(word in listed_own for word in words)
                            for _name, listed_words, listed_own, _count in chosen):
            continue
        count = sum(number for raw, number in raw_counts.items() if organism_matches(raw, words, folded[raw]))
        chosen.append((name, words, own, count))
    chosen.sort(key=lambda item: (-item[3], item[0]))
    return [{"name": name, "count": count} for name, _words, _own, count in chosen[:limit]]


def name_key(value):
    text = " ".join(str(value or "").split())
    return "" if text.lower() in PLACEHOLDER_NAMES else text.casefold()


def significant(value, figures=3):
    return float(f"{value:.{figures}g}")


def percentile(ordered, fraction):
    """Linear interpolation between order statistics."""
    position = (len(ordered) - 1) * fraction
    low = math.floor(position)
    high = min(low + 1, len(ordered) - 1)
    return ordered[low] + (ordered[high] - ordered[low]) * (position - low)


def metric_summary(values, unit):
    """n, median, 10th and 90th percentiles and a histogram in whole powers of ten (12-16 bins; the first and last bin
    also hold every value beyond them)."""
    if not values:
        return {"unit": unit, "n": 0}
    ordered = sorted(values)
    low = math.floor(math.log10(percentile(ordered, 0.001)))
    high = math.ceil(math.log10(percentile(ordered, 0.999)))
    high = max(high, low + 1)
    widen = True
    while high - low < 12:
        if widen:
            low -= 1
        else:
            high += 1
        widen = not widen
    while high - low > 16:
        if widen:
            low += 1
        else:
            high -= 1
        widen = not widen
    counts = [0] * (high - low)
    for value in ordered:
        counts[min(max(math.floor(math.log10(value)) - low, 0), len(counts) - 1)] += 1
    return {"unit": unit, "n": len(ordered), "median": significant(percentile(ordered, 0.5)),
            "p10": significant(percentile(ordered, 0.1), 2), "p90": significant(percentile(ordered, 0.9), 2),
            "log10_start": low, "counts": counts}


# Values by enzyme class (Stats section 5, small multiples): per metric, one grid of half-decade bins shared by every
# class (14-18 bins around the middle 99% of all that metric's values; the end bins also hold every value beyond them),
# and per class its values' count, median, 10th and 90th percentiles and bin counts. A record in several classes counts
# in each, as ec_classes counts it.
CLASS_BIN_WIDTH = 0.5
CLASS_BINS = (14, 18)


def class_grid(ordered):
    """(first bin's lower edge in log10, bins) for a sorted list of positive values."""
    low = math.floor(math.log10(percentile(ordered, 0.005)) / CLASS_BIN_WIDTH) * CLASS_BIN_WIDTH
    high = math.ceil(math.log10(percentile(ordered, 0.995)) / CLASS_BIN_WIDTH) * CLASS_BIN_WIDTH
    bins = max(1, round((high - low) / CLASS_BIN_WIDTH))
    widen = True
    while bins < CLASS_BINS[0] or bins > CLASS_BINS[1]:
        grow = bins < CLASS_BINS[0]
        if widen == grow:
            low += -CLASS_BIN_WIDTH if grow else CLASS_BIN_WIDTH
        bins += 1 if grow else -1
        widen = not widen
    return round(low, 1), bins


def class_summary(values, start, bins):
    ordered = sorted(values)
    counts = [0] * bins
    for value in ordered:
        counts[min(max(math.floor((math.log10(value) - start) / CLASS_BIN_WIDTH + 1e-9), 0), bins - 1)] += 1
    return {"n": len(ordered), "median": significant(percentile(ordered, 0.5)),
            "p10": significant(percentile(ordered, 0.1), 2), "p90": significant(percentile(ordered, 0.9), 2),
            "counts": counts}


def by_class(all_values, per_class):
    """The per-class summaries of one metric on one shared grid, or None without values."""
    if not all_values:
        return None
    start, bins = class_grid(sorted(all_values))
    classes = [{"class": number, **class_summary(values, start, bins)} for number, values in sorted(per_class.items()) if values]
    return {"log10_start": start, "bin_width": CLASS_BIN_WIDTH, "classes": classes} if classes else None


# CatLog v2 values per paper (Stats section 3): papers by how many kcat, Km and printed kcat/Km values CatLog v2 read
# from them (a kcat/Km calculated from kcat and Km is not a value read), in bins starting at these counts.
VALUES_PER_PAPER_BINS = (1, 2, 5, 10, 20, 50, 100, 200, 500)


def paper_values(row):
    origin = str(row.get("kcat_over_km_origin") or "")
    return sum(row.get(field) is not None for field in ("kcat", "km")) + (
        row.get("kcat_over_km") is not None and origin != "calculated")


def values_per_paper(counts):
    papers = [0] * len(VALUES_PER_PAPER_BINS)
    none = 0
    for value in counts.values():
        if value < 1:
            none += 1
            continue
        papers[max(index for index, low in enumerate(VALUES_PER_PAPER_BINS) if value >= low)] += 1
    result = {"values": sum(counts.values()), "bins": list(VALUES_PER_PAPER_BINS), "papers": papers}
    if none:
        result["no_values"] = none
    return result


def top(counter, limit=OVERVIEW_TOP):
    return sorted(counter.items(), key=lambda item: (-item[1], item[0]))[:limit]


def most_common(spellings):
    return top(spellings, 1)[0][0] if spellings else ""


# Corrections on records not yet re-read (Stats part 7, "Corrections on records not yet re-read"): each earlier record's
# corrections list in the Full data, as its record panel lists it under Compared with databases. Per value field, the
# changes of the four kinds the figure draws (more digits or rounding, a different number, unit or magnitude, added);
# every other change (another field, or another kind) is counted apart; and of the changed values (those with a value
# before), how many had before the change a number a database lists for that paper (the item names it: "listed").
# A record read from the paper carries no such list.
CORRECTION_FIELDS = ("kcat", "km", "kcat_over_km")
CORRECTION_KINDS = ("rounding", "different", "magnitude", "added")
CORRECTION_CHANGED = ("rounding", "different", "magnitude")


def new_earlier_corrections():
    return {"records": 0, "items": 0,
            "values": {field: dict.fromkeys(CORRECTION_KINDS, 0) for field in CORRECTION_FIELDS},
            "other_items": 0, "before_listed": [0, 0]}


def add_earlier_corrections(counts, row):
    corrections = row.get("corrections")
    items = [item for item in corrections if isinstance(item, dict)] if isinstance(corrections, list) else []
    if not items:
        return
    counts["records"] += 1
    counts["items"] += len(items)
    for item in items:
        field, kind = item.get("field"), item.get("kind")
        if field in CORRECTION_FIELDS and kind in CORRECTION_KINDS:
            counts["values"][field][kind] += 1
            if kind in CORRECTION_CHANGED:
                counts["before_listed"][1] += 1
                counts["before_listed"][0] += bool(str(item.get("listed") or "").strip())
        else:
            counts["other_items"] += 1


# What the values show (Stats part 5), from the records read from the paper only (CatLog's own reading: each value
# checked against its paper, wild type and variant as the paper names them).
#
# kcat against Km: the records with both a kcat and a Km in catalog units, counted on a grid of quarter decades
# (rows: log10 kcat in s^-1 from the bottom; columns: log10 Km in mM from the left), each axis the whole decades around
# the middle 99% of its values, the end bins holding every value beyond them; per enzyme class its records' median kcat
# and median Km (a record in several classes counts in each); and how many records have kcat ÷ Km at or above the
# diffusion limit, 10^5 and 10^6 mM^-1 s^-1 (10^8 and 10^9 M^-1 s^-1). `linked` is the records Browse finds with
# source=paper and metric=kcat,km (both values, in any unit), so the page links the count only where they agree.
MAP_BIN_WIDTH = 0.25
DIFFUSION_LIMIT = (1e5, 1e6)


def decade_span(ordered):
    """The whole decades (low, high) around the middle 99% of sorted positive values, at least one decade."""
    low = math.floor(math.log10(percentile(ordered, 0.005)))
    high = math.ceil(math.log10(percentile(ordered, 0.995)))
    return low, max(high, low + 1)


def grid_index(value, start, bins, width):
    return min(max(math.floor((math.log10(value) - start) / width + 1e-9), 0), bins - 1)


def kcat_km_map(pairs, linked):
    """pairs: (kcat, km, classes) per record read from the paper with both values in catalog units."""
    if not pairs:
        return None
    kcat_start, kcat_end = decade_span(sorted(kcat for kcat, _km, _classes in pairs))
    km_start, km_end = decade_span(sorted(km for _kcat, km, _classes in pairs))
    rows = round((kcat_end - kcat_start) / MAP_BIN_WIDTH)
    columns = round((km_end - km_start) / MAP_BIN_WIDTH)
    counts = [[0] * columns for _row in range(rows)]
    per_class = defaultdict(lambda: ([], []))
    ratios = []
    for kcat, km, classes in pairs:
        counts[grid_index(kcat, kcat_start, rows, MAP_BIN_WIDTH)][grid_index(km, km_start, columns, MAP_BIN_WIDTH)] += 1
        ratios.append(kcat / km)
        for number in classes:
            per_class[number][0].append(kcat)
            per_class[number][1].append(km)
    ratios.sort()
    return {
        "records": len(pairs), "linked": linked, "bin_width": MAP_BIN_WIDTH,
        "kcat_log10_start": kcat_start, "km_log10_start": km_start, "counts": counts,
        "ratio_median": significant(percentile(ratios, 0.5)),
        "at_diffusion_limit": [sum(ratio >= limit for ratio in ratios) for limit in DIFFUSION_LIMIT],
        "classes": [{"class": number, "n": len(kcats), "kcat_median": significant(percentile(sorted(kcats), 0.5)),
                     "km_median": significant(percentile(sorted(kms), 0.5))}
                    for number, (kcats, kms) in sorted(per_class.items()) if kcats],
    }


# Mutations against the wild type: each variant record paired with the one wild-type record of its paper with the same
# enzyme, organism, substrate, cosubstrate, pH and temperature (a variant record whose paper gives several such
# wild-type records, or none, is left unpaired: an ambiguous pairing is never made; a cofactor-switch paper's NADP+
# variant is never paired with its NAD+ wild type), and per parameter the log10 of the variant's value over the
# wild type's, in quarter-decade bins centred on whole quarters from 10^-4 to 10^3 (the bin at 0 holds a change under
# 1.33x either way; the end bins hold every change beyond them).
MUTATION_BIN_WIDTH = 0.25
MUTATION_RANGE = (-4, 3)


def cosubstrate_key(row):
    """The cosubstrates the record's conditions name, each as its own "cosubstrate <name>" part of
    assay_conditions_summary (a part that only mentions one, "fixed cosubstrate 1.5 mM", is not one)."""
    parts = (part.strip() for part in str(row.get("assay_conditions_summary") or "").split(";"))
    return tuple(sorted(name_key(part[len("cosubstrate "):]) for part in parts if part.lower().startswith("cosubstrate ")))


def mutation_key(row):
    return (tuple(sorted(paper_keys(row))), name_key(row.get("enzyme_display_name")), name_key(row.get("organism")),
            name_key(row.get("substrate_name")), cosubstrate_key(row), ph_value(row), temperature_c(row))


def variant_key(row):
    """One variant: its paper, enzyme, organism and mutation (a variant has a record per substrate and condition)."""
    return (tuple(sorted(paper_keys(row))), name_key(row.get("enzyme_display_name")), name_key(row.get("organism")),
            str(row.get("mutation_signature") or "").strip().casefold())


def fold_summary(changes):
    if not changes:
        return None
    ordered = sorted(changes)
    low, high = (round(edge / MUTATION_BIN_WIDTH) for edge in MUTATION_RANGE)
    counts = [0] * (high - low + 1)
    for change in ordered:
        counts[min(max(math.floor(change / MUTATION_BIN_WIDTH + 0.5) - low, 0), len(counts) - 1)] += 1
    return {"n": len(ordered), "median": significant(10 ** percentile(ordered, 0.5), 2),
            "lower": sum(change < 0 for change in ordered), "higher": sum(change > 0 for change in ordered),
            "tenfold_lower": sum(change <= -1 for change in ordered), "tenfold_higher": sum(change >= 1 for change in ordered),
            "counts": counts}


def mutation_effects(groups):
    """groups: mutation_key -> {"wild": [values], "variant": [(values, papers, variant_key)]}, values a dict of catalog
    values. variants counts the paired variant records, variant_count the variants among them (variant_key)."""
    changes = {metric: [] for metric in METRIC_UNITS}
    paired = ambiguous = no_wild_type = 0
    papers = set()
    distinct = set()
    for group in groups.values():
        variants = group["variant"]
        if not variants:
            continue
        if len(group["wild"]) != 1:
            ambiguous += len(variants) if group["wild"] else 0
            no_wild_type += 0 if group["wild"] else len(variants)
            continue
        wild = group["wild"][0]
        for values, keys, identity in variants:
            found = False
            for metric in changes:
                if values.get(metric) and wild.get(metric):
                    changes[metric].append(math.log10(values[metric] / wild[metric]))
                    found = True
            paired += found
            if found:
                papers |= keys
                distinct.add(identity)
    metrics = {metric: summary for metric, summary in ((metric, fold_summary(found)) for metric, found in changes.items()) if summary}
    if not metrics:
        return None
    return {"variants": paired, "variant_count": len(distinct), "papers": len(papers), "ambiguous": ambiguous, "no_wild_type": no_wild_type,
            "bin_width": MUTATION_BIN_WIDTH, "log10_start": MUTATION_RANGE[0], "metrics": metrics}


# Assay temperature and pH: the records read from the paper that give each, in steps of 1 °C from 0 to 100 °C and of
# 0.1 from pH 2 to 12 (each bin from its lower edge; the first also holds every value below it, the last every value at
# its edge and above), with the most decimals any value has (`decimals`, null past 3), so the page can give each bin a
# Browse range (tmin, tmax, phmin, phmax) that opens exactly its records.
CONDITION_GRIDS = {"temperature": (0, 1, 100), "ph": (2, 0.1, 100)}


def decimals_of(value):
    text = f"{round(value, 6):.6f}".rstrip("0")
    return len(text.split(".", 1)[1])


def condition_summary(values, key):
    if not values:
        return None
    start, width, steps = CONDITION_GRIDS[key]
    counts = [0] * (steps + 1)
    for value in values:
        # whole thousandths, so 7.3 falls in its own bin and not the one below it
        index = round(value * 1000) // round(width * 1000) - round(start / width)
        counts[min(max(index, 0), steps)] += 1
    places = max(decimals_of(value) for value in values)
    return {"n": len(values), "start": start, "width": width, "counts": counts, "decimals": places if places <= 3 else None}


# Stats supplement (round 14), from the records read from the paper only.
# Papers by parameter: the papers that give each parameter (a calculated kcat/Km is not given), kcat and Km together,
# and all three.
def paper_parameters(params_by_paper):
    counts = {"papers": len(params_by_paper), "kcat": 0, "km": 0, "kcat_km": 0, "kcat_over_km": 0, "all": 0}
    for params in params_by_paper.values():
        for key in ("kcat", "km", "kcat_over_km"):
            counts[key] += key in params
        counts["kcat_km"] += {"kcat", "km"} <= params
        counts["all"] += {"kcat", "km", "kcat_over_km"} <= params
    return counts if counts["papers"] else None


def given_parameters(row):
    params = {key for key in ("kcat", "km") if row.get(key) is not None}
    if row.get("kcat_over_km") is not None and str(row.get("kcat_over_km_origin") or "") != "calculated":
        params.add("kcat_over_km")
    return params


# Kinds of variant: the variant records (enzyme_form) by their mutation_type; any other type is "other".
VARIANT_KINDS = ("substitution", "multi_substitution", "deletion", "insertion", "truncation", "other")


def variant_kinds(counts):
    records = sum(counts.values())
    return {"records": records, "kinds": {kind: counts.get(kind, 0) for kind in VARIANT_KINDS}} if records else None


# Single substitutions: each variant (variant_key: paper, enzyme, organism, mutation) of mutation_type substitution whose
# signature is one standard residue, a position and another (H57A), once, by wild-type residue (rows) and new residue
# (columns), in the residue order of the BLOSUM matrices.
SUBSTITUTION_RESIDUES = "ARNDCQEGHILKMFPSTWYV"
SUBSTITUTION = re.compile(r"^([ARNDCQEGHILKMFPSTWYV])\d+([ARNDCQEGHILKMFPSTWYV])$")


def substitution_of(row):
    if row.get("mutation_type") != "substitution":
        return None
    match = SUBSTITUTION.match(str(row.get("mutation_signature") or "").strip())
    return (match.group(1), match.group(2)) if match and match.group(1) != match.group(2) else None


def substitution_matrix(variants):
    """variants: variant_key -> (wild-type residue, new residue, paper keys)."""
    if not variants:
        return None
    index = {residue: number for number, residue in enumerate(SUBSTITUTION_RESIDUES)}
    counts = [[0] * len(SUBSTITUTION_RESIDUES) for _ in SUBSTITUTION_RESIDUES]
    papers = set()
    for wild, new, keys in variants.values():
        counts[index[wild]][index[new]] += 1
        papers |= keys
    return {"variants": len(variants), "papers": len(papers), "residues": SUBSTITUTION_RESIDUES, "counts": counts}


# Units as printed: each kcat, Km and printed kcat/Km value read from the paper (its proof line) by the unit printed with it
# (raw_unit), a power of ten in it set aside: kcat per s, min or h; Km in M, mM, µM, nM or pM (mol/L spelled out too; a
# lower-case m standing alone is the molar sign, as small capitals come out of a text layer); kcat/Km per concentration and
# time. Code converts each value to s^-1, mM or mM^-1 s^-1; a unit this does not read counts as other.
PRINTED_METRICS = {"kcat": "kcat", "Km": "km", "kcat/Km": "kcat_over_km"}
PRINTED_UNITS_TOP = 8
UNIT_POWER = re.compile(r"(?:[x×]\s*)?10\s*\^?\s*\{?\s*[-+]?\s*\d+\s*\}?")
UNIT_MOLAR = re.compile(r"(?<![A-Za-z])([munp]?)mol\s*(?:/|·|\s)?\s*(?:l|L|liter|litre)(?:\s*-\s*1)?(?![A-Za-z])")
UNIT_TIME = re.compile(r"(?<![A-Za-z])(sec|s|min|hr|h)(?![A-Za-z])", re.I)
UNIT_CONCENTRATION = re.compile(r"(?<![A-Za-z])([munp]?)[Mm](?![A-Za-z])")


def printed_unit(metric, raw_unit):
    text = unicodedata.normalize("NFKC", str(raw_unit or "")).replace("μ", "u").replace("µ", "u").replace("␮", "u")
    text = re.sub(r"[‐-―−]", "-", text)
    text = UNIT_POWER.sub(" ", text)
    text = re.sub(r"[\^{}()\[\]]", "", text)
    text = re.sub(r"(?<![A-Za-z])([munp])\s+(?=[Mm](?![A-Za-z]))", r"\1", text)
    text = UNIT_MOLAR.sub(lambda match: f"{match.group(1)}M", text)
    times = {"s" if unit in ("s", "sec") else "h" if unit in ("h", "hr") else unit
             for unit in (found.lower() for found in UNIT_TIME.findall(text))}
    concentrations = set(UNIT_CONCENTRATION.findall(text))
    if len(times) > 1 or len(concentrations) > 1:
        return None
    time, concentration = next(iter(times), None), next(iter(concentrations), None)
    if metric == "kcat":
        return f"{time}-1" if time and concentration is None else None
    if metric == "km":
        return f"{concentration}M" if concentration is not None and not time else None
    return f"{concentration}M-1 {time}-1" if concentration is not None and time else None


def printed_units(counts):
    """counts: metric -> Counter of printed_unit (None: other)."""
    result = {}
    for metric in ("kcat", "km", "kcat_over_km"):
        found = counts.get(metric) or Counter()
        values = sum(found.values())
        if not values:
            continue
        named = sorted(((unit, count) for unit, count in found.items() if unit), key=lambda item: (-item[1], item[0]))
        shown = named[:PRINTED_UNITS_TOP]
        result[metric] = {"values": values, "units": [list(item) for item in shown], "other": values - sum(count for _, count in shown)}
    return result or None


# The values read from the paper compared with databases, by enzyme class: each value's own result (its proof line's
# database_status), as Stats part 7's figures count them: the same number, the same number under another label, corrects
# a database's number, a different number or in none of the databases. A record in several classes counts in each.
DATABASE_CLASS_RESULTS = {"confirmed": "same", "same_number_other_label": "other_label", "corrected": "corrects",
                          "differs": "differs", "new": "not_listed"}


def database_results(row):
    results = []
    for line in row.get("proof_lines") or []:
        if not isinstance(line, dict):
            continue
        result = DATABASE_CLASS_RESULTS.get(str(line.get("database_status") or ""))
        if result:
            results.append(result)
    return results


# Values a database lists at an exact factor from the paper's number that nothing has yet checked against the paper (a
# proof line's database_status corrected, database_found_by factor_only): Stats counts them under Different number, not
# Corrects. A comparison that still counts them among its corrections gives their split by parameter and database
# nowhere else, so the overview counts it from the Full data: {"values", "by_parameter", "by_database"} (a value counts
# for each database whose kind is corrected; by_parameter by the line's metric).
def add_factor_only(counts, row):
    for line in row.get("proof_lines") or []:
        if not isinstance(line, dict) or line.get("database_status") != "corrected" or line.get("database_found_by") != "factor_only":
            continue
        counts["values"] += 1
        counts["by_parameter"][str(line.get("metric") or "")] += 1
        for source in line.get("database_by_source") or []:
            if isinstance(source, dict) and source.get("kind") == "corrected" and source.get("db"):
                counts["by_database"][str(source["db"])] += 1


# What the wild-type values show (round 16, the user 2026-10-21: "more stats that are more scientifically insightful and
# important, even as supplementary"): five analyses of the wild-type records read from the paper (enzyme_form wild), each
# value in the catalog unit (s^-1, mM, mM^-1 s^-1; a value in another unit or without one is left out). An enzyme is a
# name and organism (name_key of each); one record's paper is its paper_keys. Each analysis says how many records, papers
# and enzymes it uses, and never pairs what it cannot match. The fold numbers are 10 to the power of a median of log10
# values, to two significant figures.
INSIGHT_METRICS = ("kcat", "km", "kcat_over_km")


def enzyme_identity(row):
    return name_key(row.get("enzyme_display_name")), name_key(row.get("organism"))


def log_median(values):
    """The median of a list of log10 values."""
    return percentile(sorted(values), 0.5)


def spread(values, low=0.25, high=0.75):
    """median, p25 and p75 (or the fractions given) of positive values, each to two significant figures."""
    ordered = sorted(values)
    return {"median": significant(percentile(ordered, 0.5), 2), "low": significant(percentile(ordered, low), 2),
            "high": significant(percentile(ordered, high), 2)}


def spread_80(values):
    """median, p10 and p90 of positive values, each to two significant figures: the middle 80% that Value ranges and
    Values by enzyme class draw as a line, so the same dot on a line means the same spread in every figure."""
    found = spread(values, 0.1, 0.9)
    return {"median": found["median"], "p10": found["low"], "p90": found["high"]}


# 1. Between papers: the same protein (its UniProt accession, primary_uniprot_id) and substrate (its SMILES, else its
# name) as wild type in two papers. Each paper's value is the median of its records for that protein and substrate
# (whatever their conditions); each pair of papers gives the fold difference between their values, counted in quarter
# decades from 1-fold (the last bin holds 100-fold and more), with how many pairs are within 2-fold and 10-fold. A pair
# whose two values are the very same number is left out and counted apart (identical_left_out): most are one lab's
# wild-type values printed again in its later paper (round 16 review: 12604236 and 15618685 share about 27 such cells),
# not two measurements that agree. The stricter subset compares two papers only at a temperature (to 1 °C) and pH (to
# 0.1) both give: per shared condition the difference of the two papers' medians, the pair's fold the median of those.
PAIR_BIN_WIDTH = 0.25
PAIR_BINS = 9
TWOFOLD = math.log10(2)


def substrate_identity(row):
    smiles = str(row.get("smiles") or "").strip()
    return ("smiles", smiles) if smiles else ("name", name_key(row.get("substrate_name")))


def pair_summary(differences, histogram=True):
    """differences: |log10 fold| per pair of papers."""
    ordered = sorted(differences)
    summary = {"pairs": len(ordered), "median": significant(10 ** percentile(ordered, 0.5), 2),
               "within_2": sum(difference <= TWOFOLD + 1e-9 for difference in ordered),
               "within_10": sum(difference <= 1 + 1e-9 for difference in ordered)}
    if histogram:
        counts = [0] * PAIR_BINS
        for difference in ordered:
            counts[min(int(difference / PAIR_BIN_WIDTH + 1e-9), PAIR_BINS - 1)] += 1
        summary["counts"] = counts
    return summary


IDENTICAL = 1e-9  # |log10 fold| below this: the two papers give the very same number


def between_papers(groups):
    """groups: (accession, substrate) -> paper key -> [(record index, catalog values, condition or None)]."""
    found = {"all": {}, "same_conditions": {}}
    used = {key: {"records": set(), "papers": set(), "proteins": set()} for key in found}
    for metric in INSIGHT_METRICS:
        loose, strict, loose_groups, strict_groups, identical = [], [], 0, 0, 0
        for (accession, _substrate), per_paper in groups.items():
            medians, cells, holders = {}, {}, {}
            for paper, records in per_paper.items():
                logs = [math.log10(values[metric]) for _index, values, _cell in records if metric in values]
                if not logs:
                    continue
                medians[paper] = log_median(logs)
                holders[paper] = [index for index, values, _cell in records if metric in values]
                by_cell = defaultdict(list)
                for _index, values, cell in records:
                    if metric in values and cell is not None:
                        by_cell[cell].append(math.log10(values[metric]))
                cells[paper] = {cell: log_median(logs) for cell, logs in by_cell.items()}
            if len(medians) < 2:
                continue
            papers = sorted(medians)
            matched, paired = False, set()
            for first, paper in enumerate(papers):
                for other in papers[first + 1:]:
                    difference = abs(medians[paper] - medians[other])
                    if difference < IDENTICAL:
                        identical += 1
                        continue
                    loose.append(difference)
                    paired.update((paper, other))
                    shared = sorted(set(cells[paper]) & set(cells[other]))
                    if not shared:
                        continue
                    matched = True
                    strict.append(abs(log_median([cells[paper][cell] - cells[other][cell] for cell in shared])))
                    used["same_conditions"]["papers"].update((paper, other))
                    for index, values, cell in per_paper[paper] + per_paper[other]:
                        if metric in values and cell in shared:
                            used["same_conditions"]["records"].add(index)
            if paired:
                loose_groups += 1
                used["all"]["proteins"].add(accession)
                used["all"]["papers"].update(paired)
                for paper in paired:
                    used["all"]["records"].update(holders[paper])
            if matched:
                strict_groups += 1
                used["same_conditions"]["proteins"].add(accession)
        if loose:
            found["all"][metric] = {**pair_summary(loose), "groups": loose_groups, "identical_left_out": identical}
        if strict:
            found["same_conditions"][metric] = {**pair_summary(strict, histogram=False), "groups": strict_groups}
    if not found["all"]:
        return None
    result = {key: len(used["all"][key]) for key in ("records", "papers", "proteins")}
    result.update({"bin_width": PAIR_BIN_WIDTH, "metrics": found["all"]})
    if found["same_conditions"]:
        result["same_conditions"] = {**{key: len(used["same_conditions"][key]) for key in ("records", "papers", "proteins")},
                                     "metrics": found["same_conditions"]}
    return result


# 2. Across substrates: one wild-type enzyme tested on three or more substrates in one paper under one assay (the same
# cosubstrate, pH and temperature: a substrate panel). Per substrate (its name) the median of its kcat/Km records; the
# panel's fold range is its best substrate's over its worst's, counted in half decades from 1-fold (the last bin holds
# 10^6-fold and more), and by how many substrates the panel holds (the range grows with them).
RANGE_BIN_WIDTH = 0.5
RANGE_BINS = 13
RANGE_GROUPS = ((3, 3), (4, 4), (5, 5), (6, 9), (10, None))


def substrate_range(panels):
    """panels: (paper keys, enzyme, organism, cosubstrates, pH, temperature) -> substrate -> [log10 kcat/Km]."""
    ranges, records, papers, enzymes = [], 0, set(), set()
    by_size = defaultdict(list)
    for (paper, enzyme, organism, *_assay), substrates in panels.items():
        if len(substrates) < 3:
            continue
        medians = [log_median(logs) for logs in substrates.values()]
        width = max(medians) - min(medians)
        ranges.append(width)
        records += sum(len(logs) for logs in substrates.values())
        papers.update(paper)
        enzymes.add((enzyme, organism))
        by_size[next(index for index, (low, high) in enumerate(RANGE_GROUPS) if len(substrates) >= low
                     and (high is None or len(substrates) <= high))].append(width)
    if not ranges:
        return None
    counts = [0] * RANGE_BINS
    for width in ranges:
        counts[min(int(width / RANGE_BIN_WIDTH + 1e-9), RANGE_BINS - 1)] += 1
    ordered = sorted(ranges)
    return {"panels": len(ranges), "records": records, "papers": len(papers), "enzymes": len(enzymes),
            "median": significant(10 ** percentile(ordered, 0.5), 2), "p25": significant(10 ** percentile(ordered, 0.25), 2),
            "p75": significant(10 ** percentile(ordered, 0.75), 2),
            "at_least_10": sum(width >= 1 - 1e-9 for width in ordered), "at_least_1000": sum(width >= 3 - 1e-9 for width in ordered),
            "bin_width": RANGE_BIN_WIDTH, "counts": counts,
            "by_substrates": [{"from": low, "to": high, "panels": len(by_size[index]),
                               "median": significant(10 ** log_median(by_size[index]), 2)}
                              for index, (low, high) in enumerate(RANGE_GROUPS) if by_size[index]]}


# 3. Km and substrate size: the size of a substrate is the number of its non-hydrogen atoms, counted from its SMILES (a
# structure of one piece: a salt or mixture, written with ".", is left out). The Km records in size bins, each with its
# median and middle 80% (p10, p90); and, within one enzyme's substrate panel (as above, four or more substrates of at least two
# sizes), the rank correlation (Spearman's rho) between size and the median Km per substrate: below 0 when Km falls as
# the substrates grow, in nine bins of 0.25 centred on -1, -0.75 ... 1 (a panel whose Km values are all one number
# counts at 0).
SIZE_BINS = ((1, 5), (6, 10), (11, 15), (16, 20), (21, 30), (31, 50), (51, None))
SMILES_ATOM = re.compile(r"\[[^\]]*\]|Cl|Br|[BCNOPSFI]|[bcnops]")
SMILES_BRACKET_ELEMENT = re.compile(r"^\[\d*([A-Z][a-z]?|[a-z]{1,2})")
RHO_BIN_WIDTH = 0.25


def heavy_atoms(smiles):
    """Non-hydrogen atoms in a one-piece SMILES (bracket atoms count once, a bracketed hydrogen not at all), or None."""
    text = str(smiles or "").strip()
    if not text or "." in text:
        return None
    count = 0
    for atom in SMILES_ATOM.findall(text):
        if atom.startswith("["):
            element = SMILES_BRACKET_ELEMENT.match(atom)
            count += bool(element and element.group(1) != "H")
        else:
            count += 1
    return count or None


def ranks(values):
    """Ranks from 1, ties sharing their mean rank."""
    order = sorted(range(len(values)), key=lambda index: values[index])
    result = [0.0] * len(values)
    start = 0
    while start < len(order):
        end = start
        while end + 1 < len(order) and values[order[end + 1]] == values[order[start]]:
            end += 1
        for position in range(start, end + 1):
            result[order[position]] = (start + end) / 2 + 1
        start = end + 1
    return result


def spearman(xs, ys):
    """Spearman's rank correlation; 0 when either list holds one value only."""
    rx, ry = ranks(xs), ranks(ys)
    mx, my = sum(rx) / len(rx), sum(ry) / len(ry)
    sx = sum((value - mx) ** 2 for value in rx)
    sy = sum((value - my) ** 2 for value in ry)
    if not sx or not sy:
        return 0.0
    return sum((a - mx) * (b - my) for a, b in zip(rx, ry)) / math.sqrt(sx * sy)


def km_by_size(records, panels):
    """records: (size, Km, paper keys, enzyme); panels: assay key -> SMILES -> (size, [log10 Km])."""
    if not records:
        return None
    bins = []
    for low, high in SIZE_BINS:
        found = [record for record in records if record[0] >= low and (high is None or record[0] <= high)]
        if found:
            bins.append({"from": low, "to": high, "n": len(found), "papers": len({key for record in found for key in record[2]}),
                         **spread_80([record[1] for record in found])})
    result = {"records": len(records), "papers": len({key for record in records for key in record[2]}),
              "enzymes": len({record[3] for record in records}), "bins": bins}
    rhos, used, papers, enzymes = [], 0, set(), set()
    for (paper, enzyme, organism, *_assay), substrates in panels.items():
        sizes = [size for size, _logs in substrates.values()]
        if len(substrates) < 4 or len(set(sizes)) < 2:
            continue
        rhos.append(spearman(sizes, [log_median(logs) for _size, logs in substrates.values()]))
        used += sum(len(logs) for _size, logs in substrates.values())
        papers.update(paper)
        enzymes.add((enzyme, organism))
    if rhos:
        counts = [0] * 9
        for rho in rhos:
            counts[min(max(round((rho + 1) / RHO_BIN_WIDTH), 0), 8)] += 1
        result["panels"] = {"panels": len(rhos), "records": used, "papers": len(papers), "enzymes": len(enzymes),
                            "falls": sum(rho < 0 for rho in rhos), "rises": sum(rho > 0 for rho in rhos),
                            "median_rho": round(percentile(sorted(rhos), 0.5), 2), "bin_width": RHO_BIN_WIDTH, "counts": counts}
    return result


# 4. Temperature: the kcat records by assay temperature in 10 °C bins (below 20, 20 to below 30 ... 80 °C and above), each with
# its median and middle 80% (p10, p90; different enzymes stand in each bin); and series, one enzyme and substrate in one paper at
# two or more temperatures with the same cosubstrate and pH: the slope of log10 kcat (the median per temperature) against
# temperature by least squares, as the fold change per 10 °C (Q10), counted in bins of 0.1 in log10 centred on -0.5 ...
# 1.0 (the end bins hold every value beyond them).
TEMPERATURE_EDGES = (20, 30, 40, 50, 60, 70, 80)
Q10_BIN_WIDTH = 0.1
Q10_LOG10_START = -0.5
Q10_BINS = 16


def temperature_bin(value):
    """0 below the first edge, then one bin per edge, each from its edge to below the next."""
    return sum(value >= edge for edge in TEMPERATURE_EDGES)


def temperature_effects(records, series):
    """records: (temperature, kcat, paper keys, enzyme); series: key -> temperature -> [log10 kcat]."""
    if not records:
        return None
    grouped = defaultdict(list)
    for record in records:
        grouped[temperature_bin(record[0])].append(record)
    result = {"records": len(records), "papers": len({key for record in records for key in record[2]}),
              "enzymes": len({record[3] for record in records}),
              "bins": [{"from": low, "below": high, "n": len(grouped[index]),
                        "papers": len({key for record in grouped[index] for key in record[2]}),
                        **spread_80([record[1] for record in grouped[index]])}
                       for index, (low, high) in enumerate(zip((None, *TEMPERATURE_EDGES), (*TEMPERATURE_EDGES, None)))
                       if grouped[index]]}
    slopes, used, papers, enzymes = [], 0, set(), set()
    for (paper, enzyme, organism, *_rest), temperatures in series.items():
        if len(temperatures) < 2:
            continue
        xs = sorted(temperatures)
        ys = [log_median(temperatures[value]) for value in xs]
        mx, my = sum(xs) / len(xs), sum(ys) / len(ys)
        slopes.append(10 * sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / sum((x - mx) ** 2 for x in xs))
        used += sum(len(logs) for logs in temperatures.values())
        papers.update(paper)
        enzymes.add((enzyme, organism))
    if slopes:
        counts = [0] * Q10_BINS
        for slope in slopes:
            counts[min(max(math.floor((slope - Q10_LOG10_START) / Q10_BIN_WIDTH + 0.5 + 1e-9), 0), Q10_BINS - 1)] += 1
        ordered = sorted(slopes)
        result["series"] = {"series": len(slopes), "records": used, "papers": len(papers), "enzymes": len(enzymes),
                            "median": significant(10 ** percentile(ordered, 0.5), 2),
                            "p25": significant(10 ** percentile(ordered, 0.25), 2),
                            "p75": significant(10 ** percentile(ordered, 0.75), 2),
                            "rising": sum(slope > 0 for slope in slopes), "falling": sum(slope < 0 for slope in slopes),
                            "bin_width": Q10_BIN_WIDTH, "log10_start": Q10_LOG10_START, "counts": counts}
    return result


# 5. The typical wild-type enzyme: each parameter's median and the middle 80% of its wild-type records read from the paper,
# with their papers and enzymes (the page sets it beside the average enzyme of Bar-Even et al., Biochemistry 2011).
def typical_values(found):
    """found: metric -> (values, papers, enzymes)."""
    result = {metric: {"n": len(values), "papers": len(papers), "enzymes": len(enzymes), **spread_80(values)}
              for metric, (values, papers, enzymes) in found.items() if values}
    return result or None


class WildTypeInsights:
    """Collects the wild-type records read from the paper for the five analyses above."""

    def __init__(self):
        self.index = 0
        self.pairs = defaultdict(lambda: defaultdict(list))
        self.panels_range = defaultdict(lambda: defaultdict(list))
        self.size_records, self.panels_size = [], defaultdict(dict)
        self.temperature_records, self.series = [], defaultdict(lambda: defaultdict(list))
        self.typical = {metric: ([], set(), set()) for metric in INSIGHT_METRICS}

    def add(self, row, own, keys):
        if not own:
            return
        self.index += 1
        enzyme = enzyme_identity(row)
        temperature, ph = temperature_c(row), ph_value(row)
        for metric, value in own.items():
            values, papers, enzymes = self.typical[metric]
            values.append(value)
            papers.update(keys)
            enzymes.add(enzyme)
        paper = tuple(sorted(keys))
        if not paper:
            return
        substrate = name_key(row.get("substrate_name"))
        assay = (paper, *enzyme, cosubstrate_key(row), ph, temperature)
        accession = str(row.get("primary_uniprot_id") or "").strip()
        identity = substrate_identity(row)
        if accession and identity[1] and len(keys) == 1:
            cell = (round(temperature), round(ph * 10)) if temperature is not None and ph is not None else None
            self.pairs[(accession, identity)][paper[0]].append((self.index, own, cell))
        if substrate and "kcat_over_km" in own:
            self.panels_range[assay][substrate].append(math.log10(own["kcat_over_km"]))
        size = heavy_atoms(row.get("smiles"))
        if size and "km" in own:
            self.size_records.append((size, own["km"], keys, enzyme))
            smiles = str(row.get("smiles")).strip()
            self.panels_size[assay].setdefault(smiles, (size, []))[1].append(math.log10(own["km"]))
        if temperature is not None and "kcat" in own:
            self.temperature_records.append((temperature, own["kcat"], keys, enzyme))
            if substrate:
                self.series[(paper, *enzyme, substrate, cosubstrate_key(row), ph)][round(temperature, 1)].append(math.log10(own["kcat"]))

    def result(self):
        found = {"between_papers": between_papers(self.pairs), "substrate_range": substrate_range(self.panels_range),
                 "km_by_size": km_by_size(self.size_records, self.panels_size),
                 "temperature": temperature_effects(self.temperature_records, self.series),
                 "typical": typical_values(self.typical)}
        return {key: value for key, value in found.items() if value}


def check_result(check):
    """A proof line's check in one word: confirmed, corrected (the second AI check changed what the reader gave), or other
    (anything else, kept apart so the two counts never take it in)."""
    word = str(check or "").strip().lower()
    return "confirmed" if word.startswith("confirmed") else "corrected" if word.startswith("corrected") else "other"


def summarize_overview(rows, marks=None):
    statuses = Counter()
    papers, v2_papers = set(), set()
    names = {field: set() for field in ("enzyme_display_name", "organism", "substrate_name")}
    ec_set = set()
    ec_classes = {number: {"count": 0, "accepted": 0, "from_paper": 0} for number in EC_CLASS_NAMES}
    no_ec_class = multi_class = 0
    ec_counts, raw_organisms = Counter(), Counter()
    ec_names, organism_spellings = defaultdict(Counter), defaultdict(Counter)
    # the same for CatLog v2 entries alone (Browse: source=paper with the organism or EC filter)
    v2_ec_counts, v2_raw_organisms, v2_organism_spellings = Counter(), Counter(), defaultdict(Counter)
    v2_paper_values = Counter()
    forms = Counter({"wild": 0, "variant": 0, "not_stated": 0})
    conditions = Counter({"temperature": 0, "ph": 0, "both": 0})
    cautions = Counter({key: 0 for key in (*CAUTION_GROUPS, "temperature", "none")})
    sources = Counter({key: 0 for key in (*SOURCE_KEYS, "other")})
    main_sources = defaultdict(Counter)
    values = {metric: [] for metric in METRIC_UNITS}
    class_values = {metric: defaultdict(list) for metric in METRIC_UNITS}
    v2_records = with_paper = checked_accepted = checked_values = marked = 0
    earlier = new_earlier_corrections()
    # What the values show: records read from the paper only
    v2_pairs, v2_linked = [], 0
    v2_groups = defaultdict(lambda: {"wild": [], "variant": []})
    v2_conditions = {"temperature": [], "ph": []}
    v2_database = defaultdict(Counter)
    v2_parameters, v2_kinds, v2_substitutions, v2_units = defaultdict(set), Counter(), {}, defaultdict(Counter)
    factor_only = {"values": 0, "by_parameter": Counter(), "by_database": Counter()}
    v2_checks = Counter()
    wild_insights = WildTypeInsights()
    for row in rows:
        add_factor_only(factor_only, row)
        status = row.get("verification_status")
        if not isinstance(status, str):
            raise ValueError("Missing review status in public record")
        statuses[status] += 1
        accepted = status in ("verified", "corrected")
        keys = paper_keys(row)
        papers |= keys
        with_paper += bool(keys)
        v2 = str(row.get("verification_method") or "").startswith("catlog_v2_read")
        if v2:
            v2_records += 1
            v2_papers |= keys
            for key in keys:
                v2_paper_values[key] += paper_values(row)
        else:
            add_earlier_corrections(earlier, row)
        if marks is not None:
            mark = marks.get(str(row.get("measurement_key") or row.get("record_key") or ""))
            marked += mark is not None
            checked = bool(accepted and isinstance(mark, dict) and mark.get("checked"))
            checked_accepted += checked
            # the values a reviewer approved on those records (the mark's approved list), said beside them on Stats
            if checked and isinstance(mark.get("approved"), list):
                checked_values += sum(1 for metric in set(mark["approved"]) if metric in ("kcat", "km", "kcat_over_km"))
        for field, seen in names.items():
            key = name_key(row.get(field))
            if key:
                seen.add(key)
        raw_organisms[str(row.get("organism") or "")] += 1
        organism = " ".join(str(row.get("organism") or "").split())
        if name_key(organism):
            organism_spellings[name_key(organism)][organism] += 1
        if v2:
            v2_raw_organisms[str(row.get("organism") or "")] += 1
            if name_key(organism):
                v2_organism_spellings[name_key(organism)][organism] += 1
        numbers = ec_numbers(row)
        classes = {int(number[0]) for number in numbers if re.match(r"^[1-7]\.", number)}
        no_ec_class += not classes
        multi_class += len(classes) > 1
        for number in classes:
            ec_classes[number]["count"] += 1
            ec_classes[number]["accepted"] += accepted
            ec_classes[number]["from_paper"] += v2
        complete = {number for number in numbers if EC_NUMBER.match(number)}
        ec_set |= complete
        for number in complete:
            ec_counts[number] += 1
            v2_ec_counts[number] += v2
        if len(numbers) == 1 and complete:
            enzyme = " ".join(str(row.get("enzyme_display_name") or "").split())
            if name_key(enzyme):
                ec_names[numbers[0]][enzyme] += 1
        form = enzyme_form(row)
        forms[form] += 1
        has_temperature, has_ph = temperature_c(row) is not None, ph_value(row) is not None
        conditions["temperature"] += has_temperature
        conditions["ph"] += has_ph
        conditions["both"] += has_temperature and has_ph
        found = caution_keys(row)
        cautions.update(found or {"none"})
        sources.update(source_keys(row.get("source_db")) or {"other"})
        main_sources[main_source(row)][status] += 1
        own = {}
        for metric, units in METRIC_UNITS.items():
            value = _number(row.get(metric))
            if value is not None and value > 0 and unit_key(row.get(f"{metric}_unit")) in units:
                own[metric] = value
                values[metric].append(value)
                for number in classes:
                    class_values[metric][number].append(value)
        if v2:
            v2_linked += row.get("kcat") is not None and row.get("km") is not None
            if "kcat" in own and "km" in own:
                v2_pairs.append((own["kcat"], own["km"], classes))
            if form == "wild":
                v2_groups[mutation_key(row)]["wild"].append(own)
                wild_insights.add(row, own, keys)
            elif form == "variant":
                v2_groups[mutation_key(row)]["variant"].append((own, keys, variant_key(row)))
            if has_temperature:
                v2_conditions["temperature"].append(temperature_c(row))
            if has_ph:
                v2_conditions["ph"].append(ph_value(row))
            for result in database_results(row):
                for number in classes:
                    v2_database[number][result] += 1
            for key in keys:
                v2_parameters[key] |= given_parameters(row)
            if form == "variant":
                kind = str(row.get("mutation_type") or "")
                v2_kinds[kind if kind in VARIANT_KINDS[:-1] else "other"] += 1
            substitution = substitution_of(row) if form == "variant" else None
            if substitution:
                v2_substitutions.setdefault(variant_key(row), (*substitution, set()))[2].update(keys)
            for line in row.get("proof_lines") or []:
                metric = PRINTED_METRICS.get(str(line.get("metric") or "")) if isinstance(line, dict) else None
                if metric:
                    v2_units[metric][printed_unit(metric, line.get("raw_unit"))] += 1
                    # what the second AI check found of each value (the proof line's check: "confirmed" or "corrected"),
                    # said as the Second AI check's result on Stats (fix pass after round 16b)
                    v2_checks[check_result(line.get("check"))] += 1
    total = sum(statuses.values())
    overview = {
        "records": total,
        "accepted": statuses["verified"] + statuses["corrected"],
        "accepted_as_reported": statuses["verified"],
        "corrected": statuses["corrected"],
        "from_paper": {"records": v2_records, "papers": len(v2_papers),
                       **({"values": sum(v2_checks.values()), "checks": {key: v2_checks[key] for key in ("confirmed", "corrected", "other")}}
                          if v2_checks else {})},
        "papers": len(papers),
        "with_paper": with_paper,
        "enzymes": len(names["enzyme_display_name"]),
        "ec_numbers": len(ec_set),
        "organisms": len(names["organism"]),
        "substrates": len(names["substrate_name"]),
    }
    if marks is not None:
        overview["human_checked_accepted"] = checked_accepted
        overview["human_checked_values"] = checked_values
        overview["human_marked"] = marked
    overview.update({
        "ec_classes": [{"class": number, "name": EC_CLASS_NAMES[number], **counts} for number, counts in ec_classes.items()],
        "ec_class_none": no_ec_class,
        "ec_class_multiple": multi_class,
        "top_organisms": top_organisms(organism_spellings, raw_organisms),
        "top_ec": [{"ec": number, "name": most_common(ec_names[number]), "count": count} for number, count in top(ec_counts)],
        "enzyme_form": dict(forms),
        "conditions": dict(conditions),
        "cautions": dict(cautions),
        "metrics": {metric: metric_summary(found, METRIC_LABELS[metric]) for metric, found in values.items()},
        "top_organisms_from_paper": top_organisms(v2_organism_spellings, v2_raw_organisms),
        "top_ec_from_paper": [{"ec": number, "name": most_common(ec_names[number]), "count": count}
                              for number, count in top(+v2_ec_counts)],
        "from_paper_values": values_per_paper(v2_paper_values),
        "from_paper_parameters": paper_parameters(v2_parameters),
        "sources": dict(sources),
        "main_sources": {key: dict(sorted(main_sources[key].items())) for key in MAIN_SOURCE_KEYS if main_sources[key]},
    })
    if overview["from_paper_parameters"] is None:
        del overview["from_paper_parameters"]
    for metric, summary in overview["metrics"].items():
        grid = by_class(values[metric], class_values[metric])
        if grid and summary.get("n"):
            summary["by_class"] = grid
    if earlier["records"]:
        overview["earlier_corrections"] = earlier
    if factor_only["values"]:
        overview["database_factor_only"] = {"values": factor_only["values"],
                                            "by_parameter": dict(factor_only["by_parameter"].most_common()),
                                            "by_database": dict(factor_only["by_database"].most_common())}
    # What the values show (records read from the paper): each only when it has values.
    insights = {
        "kcat_km": kcat_km_map(v2_pairs, v2_linked),
        "mutations": mutation_effects(v2_groups),
        "conditions": {key: summary for key, summary in ((key, condition_summary(found, key)) for key, found in v2_conditions.items()) if summary},
        "database_by_class": [{"class": number, **{result: counts[result] for result in DATABASE_CLASS_RESULTS.values()}}
                              for number, counts in sorted(v2_database.items()) if sum(counts.values())],
        "variant_kinds": variant_kinds(v2_kinds),
        "substitutions": substitution_matrix(v2_substitutions),
        "printed_units": printed_units(v2_units),
        **wild_insights.result(),
    }
    insights = {key: value for key, value in insights.items() if value}
    if insights:
        overview["from_paper_insights"] = insights
    return overview, dict(statuses)


# Audit and human-review results the CatLog side writes into the marks file's top-level "quality" object (from its audit
# record and review accuracy). The overview keeps these fields only: whole counts, and the date they were counted.
# v2_found is the reviewers' approved values CatLog v2 has as it is now, after fixes (the CatLog side changed it from the
# first comparison's count on 2026-10-13; v2_found_after_fixes is the same count), of v2_approved_total.
QUALITY_FIELDS = ("audit_values", "audit_wrong", "compared_values_v1", "compared_papers_v1", "wrong_v1",
                  "label_or_annotation_v1", "v2_found", "v2_found_after_fixes", "v2_approved_total",
                  "v2_differences_checked", "v2_wrong", "audit_wrong_papers", "audit_wrong_top2",
                  "audit_targeted_values", "audit_targeted_wrong")
# audit_targeted_values / _wrong (catlog-v2 human_review.audit_detail from 2026-10-22): the values only follow-up or
# targeted audits saw and those they found wrong; audit_values and audit_wrong are then the random audit's alone.
# The random audit's 95% Wilson interval of the share wrong, "low-high" percentages (catlog-v2 human_review.audit_detail,
# from 2026-10-21); the papers its wrong values sit in and how many sit in the two papers with the most are whole counts
# above (audit_wrong_papers, audit_wrong_top2).
QUALITY_RANGES = ("audit_wrong_ci95",)
# The papers whose reading or checking agent opened database values (catlog-v2 human_review._exposure, from 2026-10-21):
# whole counts, and the days its log spans and the blind re-reads were sent on.
EXPOSED_COUNTS = ("papers", "reader", "checker_only", "reread_blind", "reread_blind_read", "reread_blind_verify",
                  "reread_blind_done")
EXPOSED_DAYS = ("first", "last", "reread_blind_on")
DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")


AGREEMENT_FIELDS = ("papers_compared", "values_approved", "first_agree", "first_agree_pct", "agree", "agree_pct",
                    "first_catlog_errors", "first_catlog_errors_value", "first_catlog_errors_label",
                    "first_catlog_errors_missed", "fixed_after_comparison", "matched_later_other", "papers_exposed",
                    "papers_unexposed",
                    "first_agree_unexposed_pct", "first_agree_unexposed_ci95", "catlog_value_wrong",
                    "differ", "differ_catlog_right",
                    "differ_earlier_value_error", "differ_earlier_label_error", "differ_same_value_other_name",
                    "differ_rounding", "differ_catlog_wrong", "differ_not_comparable", "differ_not_adjudicated",
                    "stated_values", "stated_values_catlog_has", "rejected_values", "rejected_catlog_also_without",
                    "rejected_catlog_has_same", "rejected_kept_after_audit", "rejected_dropped_after_audit",
                    "rejected_changed_since", "rejected_cleared_by_paper_check", "rejected_pending", "rejected_not_value",
                    "direct_records_reviewed", "direct_values_reviewed",
                    "direct_values_agree", "direct_values_disagree", "direct_values_other",
                    "direct_disagree_wrong_after_audit", "direct_disagree_audit_pending")
# Agreement fields that are a range of percentages, written "low-high" (catlog-v2 human_review: f"{low:.1f}-{high:.1f}").
# The first-comparison and blind fields are copied for reference only: the page reads none of them for a headline.
AGREEMENT_RANGES = ("first_agree_unexposed_ci95",)
AGREEMENT_RANGE = re.compile(r"^\d+(?:\.\d+)?-\d+(?:\.\d+)?$")
# Stats part 7's earlier figures, when the CatLog side writes them into the quality object: nested objects of whole
# counts only (anything else in them is dropped), copied as they are; the page checks how they add up. The comparison
# with the databases is the manifest's summary.database_comparison (the page reads no db_compare), and the earlier
# version's corrections are counted from the Full data (overview.earlier_corrections), this copy being the fallback.
QUALITY_FIGURES = ("earlier_corrections", "replaced", "catlog_errors")  # catlog_errors: CatLog's own errors by route (2026-10-21)
# The human-review headline (the user, 2026-10-13): quality.review, what the reviewers' own files say, one object per
# catalog reviewed ("v1": CatLog v1 entries; "v2" once reviewers check CatLog v2 entries). Each keeps its numbers
# (entries, papers, value_correct_pct, value_missing, ...), its short strings and the other_by_kind map (a kind of other
# disagreement and its count); lists, nested objects and the definitions stay in the marks file, except "checkable":
# the same counts over the entries a reviewer could check against a paper (catlog-v2 from 2026-10-21), one level deep.
REVIEW_NAME = re.compile(r"^v\d+$")
REVIEW_MAPS = ("other_by_kind",)
REVIEW_BLOCKS = ("checkable",)


def review_counts(value, depth=0):
    """One reviewed catalog's numbers, strings and by-kind counts (see REVIEW_NAME), or None when nothing is left."""
    if not isinstance(value, dict):
        return None
    kept = {}
    for key, item in value.items():
        if not isinstance(key, str) or key == "definitions":
            continue
        if key in REVIEW_BLOCKS and not depth:
            block = review_counts(item, depth + 1)
            if block:
                kept[key] = block
        elif isinstance(item, (int, float)) and not isinstance(item, bool) and math.isfinite(item) and item >= 0:
            kept[key] = item
        elif isinstance(item, str) and item.strip() and len(item) <= 200:
            kept[key] = item
        elif key in REVIEW_MAPS and isinstance(item, dict):
            kinds = {kind: count for kind, count in item.items() if isinstance(kind, str) and kind.strip()
                     and isinstance(count, int) and not isinstance(count, bool) and count >= 0}
            if kinds:
                kept[key] = kinds
    return kept if isinstance(kept.get("entries"), int) else None


def whole_counts(value, depth=0):
    """A copy of an object of whole counts (nested objects and lists of whole counts kept), or None when nothing is left."""
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value if value >= 0 else None
    if isinstance(value, list) and depth:
        kept = [whole_counts(item, depth + 1) for item in value]
        return kept if kept and all(item is not None for item in kept) else None
    if isinstance(value, dict) and depth < 4:
        kept = {key: whole_counts(item, depth + 1) for key, item in value.items() if isinstance(key, str)}
        kept = {key: item for key, item in kept.items() if item is not None}
        return kept or None
    return None


def marks_quality(payload):
    """The marks file's quality object, reduced to its known fields (the page checks how they relate), or None."""
    quality = payload.get("quality") if isinstance(payload, dict) else None
    if not isinstance(quality, dict):
        return None
    kept = {key: quality[key] for key in QUALITY_FIELDS
            if isinstance(quality.get(key), int) and not isinstance(quality.get(key), bool) and quality[key] >= 0}
    # the agreement of CatLog with human reviewers (catlog-v2 human_review.AGREEMENT_DEFINITIONS): whole counts, its
    # percentages and the first comparison's range as the CatLog side writes it ("79.7-90.6", reference only); its
    # definitions map stays in the marks file
    agreement = quality.get("agreement")
    if isinstance(agreement, dict):
        counts = {key: value for key, value in agreement.items() if key in AGREEMENT_FIELDS
                  and ((isinstance(value, (int, float)) and not isinstance(value, bool) and value >= 0)
                       or (key in AGREEMENT_RANGES and isinstance(value, str) and AGREEMENT_RANGE.match(value)))}
        if isinstance(counts.get("values_approved"), int) and isinstance(counts.get("agree"), int):
            kept["agreement"] = counts
    for key in QUALITY_RANGES:
        if isinstance(quality.get(key), str) and AGREEMENT_RANGE.match(quality[key]):
            kept[key] = quality[key]
    for key in QUALITY_FIGURES:
        figure = whole_counts(quality.get(key)) if isinstance(quality.get(key), dict) else None
        if figure:
            kept[key] = figure
    exposed = quality.get("exposed")
    if isinstance(exposed, dict):
        counts = {key: exposed[key] for key in EXPOSED_COUNTS if isinstance(exposed.get(key), int)
                  and not isinstance(exposed.get(key), bool) and exposed[key] >= 0}
        days = {key: exposed[key] for key in EXPOSED_DAYS if isinstance(exposed.get(key), str) and DAY.match(exposed[key])}
        if counts.get("papers") is not None:
            kept["exposed"] = {**counts, **days}
    review = quality.get("review")
    if isinstance(review, dict):
        reviews = {name: counts for name, counts in ((name, review_counts(item)) for name, item in review.items()
                                                     if isinstance(name, str) and REVIEW_NAME.match(name)) if counts}
        if reviews:
            kept["review"] = reviews
    as_of = quality.get("as_of")
    if kept and isinstance(as_of, str) and re.match(r"^\d{4}-\d{2}-\d{2}", as_of):
        kept = {"as_of": as_of[:10], **kept}
    return kept or None


def build_overview(manifest, download, marks_path=None):
    """The Stats page overview, counted from the frozen public download (and the human-review marks, when given; their
    quality object is copied as overview.quality, bound like the counts by marks_sha256)."""
    download = Path(download)
    with download.open("rb") as handle:
        digest = hashlib.file_digest(handle, "sha256").hexdigest()
    if digest != manifest["enriched_download"]["sha256"]:
        raise ValueError("Frozen download hash does not match the manifest")
    marks = None
    marks_digest = None
    quality = None
    if marks_path is not None:
        payload = Path(marks_path).read_bytes()
        marks_digest = hashlib.sha256(payload).hexdigest()
        content = json.loads(payload)
        marks = content.get("marks")
        if not isinstance(marks, dict):
            raise ValueError("Human-review marks file has no marks")
        quality = marks_quality(content)
    with gzip.open(download, "rb") as handle:
        overview, statuses = summarize_overview((json.loads(line) for line in handle if line.strip()), marks)
    expected = manifest.get("summary", {}).get("distributions", {}).get("verification_status")
    if expected is not None and statuses != {item["label"]: item["count"] for item in expected}:
        raise ValueError("Public download statuses do not match the snapshot")
    if "total_rows" in manifest and overview["records"] != manifest["total_rows"]:
        raise ValueError("Public download statuses do not match the snapshot")
    binding = {"source_sha256": manifest.get("source_sha256"), "download_sha256": digest}
    if marks_digest:
        binding["marks_sha256"] = marks_digest
    if quality:
        overview["quality"] = quality
    return {**binding, **overview}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true", help="Write a new immutable manifest and update its page reference")
    parser.add_argument("--details-report", action="store_true", help="Print hash-bound follow-up and unverified counts without changing files")
    parser.add_argument("--write-details", action="store_true", help="Recount review-group fields from the frozen public download and publish an immutable manifest")
    parser.add_argument("--write-overview", action="store_true", help="Count the Stats page overview from the frozen public download and the human-review marks, and publish an immutable manifest")
    args = parser.parse_args()
    spec = importlib.util.spec_from_file_location("viewer_builder", ROOT / "scripts/build-catlog-viewer-index.py")
    builder = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(builder)
    old_path = builder.active_manifest_path()
    manifest = builder.load_manifest(old_path)
    download = (CATALOG / manifest["enriched_download"]["path"]).resolve()
    if not download.is_relative_to((CATALOG / "data").resolve()) or download.suffix != ".gz":
        raise ValueError("Expected a public compressed download under this site")
    if args.write_overview:
        marks = CATALOG / "data/human-review-marks.json"
        result = build_overview(manifest, download, marks if marks.is_file() else None)
        print(json.dumps(result, indent=2, ensure_ascii=False))
        manifest["summary"]["overview"] = result
    elif args.details_report or args.write_details:
        result = build_review_details(manifest, download)
        saved = manifest["summary"].get("review_details")
        if saved is not None and saved != result and not args.write_details:
            raise ValueError("Published review details differ from the frozen download")
        print(json.dumps(result, indent=2))
        if not args.write_details:
            return
        manifest["summary"]["review_details"] = result
    else:
        result = build(manifest, download)
        saved = manifest["summary"].get("followup_coverage")
        if saved is not None and saved != result and not args.write:
            raise ValueError("Published follow-up summary differs from the frozen download")
        print(json.dumps(result, indent=2))
        if args.write:
            manifest["summary"]["followup_coverage"] = result
    if args.write or args.write_details or args.write_overview:
        new_path = builder.write_immutable_manifest(manifest, old_path)
        page_path = CATALOG / "index.html"
        page = page_path.read_text()
        old_ref = str(old_path.relative_to(CATALOG))
        if page.count(old_ref) != 1:
            raise ValueError("Expected exactly one current manifest reference")
        page_path.write_text(page.replace(old_ref, str(new_path.relative_to(CATALOG))))


if __name__ == "__main__":
    main()
