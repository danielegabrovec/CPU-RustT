"""Collect dependency licenses from the exact Cargo/npm lockfiles.

Run after `npm ci` and `cargo fetch --locked --target x86_64-pc-windows-msvc`.
Only repository-relative names and public package URLs enter the output.
"""
import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TARGET = "x86_64-pc-windows-msvc"


def license_files(directory, explicit=None):
    result = []
    if explicit:
        candidate = Path(explicit)
        if not candidate.is_absolute():
            candidate = directory / candidate
        if candidate.is_file():
            result.append(candidate)
    for candidate in sorted(directory.iterdir()):
        if candidate.is_file() and re.match(r"(?i)^(license|licence|copying|notice|copyright)([._-].*)?$", candidate.name):
            result.append(candidate)
        elif candidate.is_dir() and candidate.name.lower() in {"license", "licenses", "licences"}:
            result.extend(sorted(p for p in candidate.rglob("*") if p.is_file() and p.suffix.lower() in {"", ".txt", ".md"}))
    return list(dict.fromkeys(result))


def section(name, version, declared, url, files):
    lines = ["=" * 78, f"{name} {version}", f"Declared license: {declared or 'See upstream package'}", f"Source: {url}"]
    for file in files:
        lines += ["", f"--- {file.name} ---", file.read_text(encoding="utf-8-sig", errors="replace").strip()]
    if not files:
        lines += ["", "No separate license text is shipped in this package; consult the public upstream source and declared SPDX expression above."]
    return "\n".join(lines)


def main():
    metadata = json.loads(subprocess.check_output([
        "cargo", "metadata", "--format-version", "1", "--locked", "--filter-platform", TARGET
    ], cwd=ROOT, text=True, encoding="utf-8"))
    package = json.loads((ROOT / "package.json").read_text(encoding="utf-8-sig"))
    sections = [
        f"CPU-RustT {package['version']} - THIRD-PARTY NOTICES",
        "Ideazione, struttura e sviluppo dell'applicazione: Daniele Gabrovec.",
        "Copyright (c) 2026 Daniele Gabrovec. CPU-RustT is licensed under MIT; see LICENSE.",
        "Dependencies retain their own copyright and license terms below.",
        f"Cargo dependency graph for Windows x64 ({TARGET}), including build/test tools.",
        "This file contains public package metadata and shipped license/notice texts, without local paths or machine telemetry.",
    ]
    overrides = json.loads((ROOT / "scripts/license-texts/SOURCES.json").read_text(encoding="utf-8"))
    missing = []
    for dependency in sorted(metadata["packages"], key=lambda item: (item["name"], item["version"])):
        if dependency["id"] in metadata["workspace_members"]:
            continue
        directory = Path(dependency["manifest_path"]).parent
        files = license_files(directory, dependency.get("license_file"))
        if not files and dependency["name"] in overrides:
            files = [ROOT / "scripts/license-texts" / entry["file"] for entry in overrides[dependency["name"]]]
        if not files:
            missing.append(f"{dependency['name']} {dependency['version']}")
        sections.append(section(dependency["name"], dependency["version"], dependency.get("license"),
            dependency.get("repository") or f"https://crates.io/crates/{dependency['name']}/{dependency['version']}", files))
    sections.append("NPM DEVELOPMENT TOOLS (not part of the application's web runtime)")
    lock = json.loads((ROOT / "package-lock.json").read_text(encoding="utf-8-sig"))
    for location, dependency in sorted(lock["packages"].items()):
        if not location:
            continue
        directory = ROOT / location
        if not directory.is_dir():
            continue
        name = location.removeprefix("node_modules/")
        sections.append(section(name, dependency.get("version", ""), dependency.get("license"),
            f"https://www.npmjs.com/package/{name}", license_files(directory)))
    destination = ROOT / "THIRD-PARTY-NOTICES.txt"
    destination.write_text("\n\n".join(sections) + "\n", encoding="utf-8")
    print(json.dumps({"file": destination.name, "bytes": destination.stat().st_size,
        "cargo_packages": len(metadata["packages"]) - len(metadata["workspace_members"]),
        "packages_without_separate_license_text": missing}, ensure_ascii=False))
    if missing:
        raise SystemExit("License texts missing: supply the upstream license files in scripts/license-texts before publishing.")


if __name__ == "__main__":
    main()
