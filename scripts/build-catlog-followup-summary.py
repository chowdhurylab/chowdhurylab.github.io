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
SOURCE_KEYS = ("paper", "brenda", "sabio_rk", "oed", "uniprot", "skid")
SOURCE_TOKENS = {"primary_paper_direct": "paper", "primary_literature": "paper", "paper": "paper", "brenda": "brenda",
                 "sabio_rk": "sabio_rk", "sabio": "sabio_rk", "sabiork": "sabio_rk", "oed": "oed",
                 "open_enzyme_database": "oed", "uniprot": "uniprot", "skid": "skid"}
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
# Browse `caution=` groups of condition_flags.
CAUTION_GROUPS = {
    "differs": ("kcat_over_km_quotient_mismatch",),
    "units": ("km_magnitude_needs_check", "kcat_magnitude_needs_check", "kcat_over_km_unit_mismatch",
              "efficiency_above_diffusion_limit"),
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


def condition_flags(row):
    """The flags a record shows (conditionFlags): a kcat/Km that agrees with kcat / Km within printed precision is not
    flagged as differing."""
    flags = {str(flag).strip() for flag in row.get("condition_flags") or [] if str(flag or "").strip()}
    if "kcat_over_km_quotient_mismatch" in flags and efficiency_matches_reported_precision(row):
        flags.discard("kcat_over_km_quotient_mismatch")
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
        count = sum(number for raw, number in raw_counts.items() if all(word in folded[raw] for word in words))
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


def top(counter, limit=OVERVIEW_TOP):
    return sorted(counter.items(), key=lambda item: (-item[1], item[0]))[:limit]


def most_common(spellings):
    return top(spellings, 1)[0][0] if spellings else ""


def summarize_overview(rows, marks=None):
    statuses = Counter()
    papers, v2_papers = set(), set()
    names = {field: set() for field in ("enzyme_display_name", "organism", "substrate_name")}
    ec_set = set()
    ec_classes = {number: {"count": 0, "accepted": 0} for number in EC_CLASS_NAMES}
    no_ec_class = multi_class = 0
    ec_counts, raw_organisms = Counter(), Counter()
    ec_names, organism_spellings = defaultdict(Counter), defaultdict(Counter)
    forms = Counter({"wild": 0, "variant": 0, "not_stated": 0})
    conditions = Counter({"temperature": 0, "ph": 0, "both": 0})
    cautions = Counter({key: 0 for key in (*CAUTION_GROUPS, "temperature", "none")})
    sources = Counter({key: 0 for key in (*SOURCE_KEYS, "other")})
    values = {metric: [] for metric in METRIC_UNITS}
    v2_records = with_paper = checked_accepted = marked = 0
    for row in rows:
        status = row.get("verification_status")
        if not isinstance(status, str):
            raise ValueError("Missing review status in public record")
        statuses[status] += 1
        accepted = status in ("verified", "corrected")
        keys = paper_keys(row)
        papers |= keys
        with_paper += bool(keys)
        if str(row.get("verification_method") or "").startswith("catlog_v2_read"):
            v2_records += 1
            v2_papers |= keys
        if marks is not None:
            mark = marks.get(str(row.get("measurement_key") or row.get("record_key") or ""))
            marked += mark is not None
            checked_accepted += bool(accepted and isinstance(mark, dict) and mark.get("checked"))
        for field, seen in names.items():
            key = name_key(row.get(field))
            if key:
                seen.add(key)
        raw_organisms[str(row.get("organism") or "")] += 1
        organism = " ".join(str(row.get("organism") or "").split())
        if name_key(organism):
            organism_spellings[name_key(organism)][organism] += 1
        numbers = ec_numbers(row)
        classes = {int(number[0]) for number in numbers if re.match(r"^[1-7]\.", number)}
        no_ec_class += not classes
        multi_class += len(classes) > 1
        for number in classes:
            ec_classes[number]["count"] += 1
            ec_classes[number]["accepted"] += accepted
        complete = {number for number in numbers if EC_NUMBER.match(number)}
        ec_set |= complete
        for number in complete:
            ec_counts[number] += 1
        if len(numbers) == 1 and complete:
            enzyme = " ".join(str(row.get("enzyme_display_name") or "").split())
            if name_key(enzyme):
                ec_names[numbers[0]][enzyme] += 1
        forms[enzyme_form(row)] += 1
        has_temperature, has_ph = temperature_c(row) is not None, ph_value(row) is not None
        conditions["temperature"] += has_temperature
        conditions["ph"] += has_ph
        conditions["both"] += has_temperature and has_ph
        found = caution_keys(row)
        cautions.update(found or {"none"})
        sources.update(source_keys(row.get("source_db")) or {"other"})
        for metric, units in METRIC_UNITS.items():
            value = _number(row.get(metric))
            if value is not None and value > 0 and unit_key(row.get(f"{metric}_unit")) in units:
                values[metric].append(value)
    total = sum(statuses.values())
    overview = {
        "records": total,
        "accepted": statuses["verified"] + statuses["corrected"],
        "accepted_as_reported": statuses["verified"],
        "corrected": statuses["corrected"],
        "from_paper": {"records": v2_records, "papers": len(v2_papers)},
        "papers": len(papers),
        "with_paper": with_paper,
        "enzymes": len(names["enzyme_display_name"]),
        "ec_numbers": len(ec_set),
        "organisms": len(names["organism"]),
        "substrates": len(names["substrate_name"]),
    }
    if marks is not None:
        overview["human_checked_accepted"] = checked_accepted
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
        "sources": dict(sources),
    })
    return overview, dict(statuses)


def build_overview(manifest, download, marks_path=None):
    """The Stats page overview, counted from the frozen public download (and the human-review marks, when given)."""
    download = Path(download)
    with download.open("rb") as handle:
        digest = hashlib.file_digest(handle, "sha256").hexdigest()
    if digest != manifest["enriched_download"]["sha256"]:
        raise ValueError("Frozen download hash does not match the manifest")
    marks = None
    marks_digest = None
    if marks_path is not None:
        payload = Path(marks_path).read_bytes()
        marks_digest = hashlib.sha256(payload).hexdigest()
        marks = json.loads(payload).get("marks")
        if not isinstance(marks, dict):
            raise ValueError("Human-review marks file has no marks")
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
