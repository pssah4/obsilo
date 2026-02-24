#!/usr/bin/env python3
"""Merge translation batch files into a locale JSON file.

Usage: python3 _merge_batches.py <lang>
Example: python3 _merge_batches.py de

Reads:
  - <lang>.json (existing locale with UI chrome keys)
  - _batch_A_<lang>.json through _batch_D_<lang>.json (translated batches)
Writes:
  - <lang>.json (merged, sorted)
"""
import json, sys, os, glob

if len(sys.argv) < 2:
    print("Usage: python3 _merge_batches.py <lang>")
    sys.exit(1)

lang = sys.argv[1]
locale_file = f"{lang}.json"

# Read existing locale
if os.path.exists(locale_file):
    locale = json.load(open(locale_file, 'r'))
    print(f"Existing {locale_file}: {len([k for k in locale if not k.startswith('_')])} keys")
else:
    locale = {}
    print(f"No existing {locale_file}, starting fresh")

# Merge batch files
for batch_file in sorted(glob.glob(f"_batch_*_{lang}.json")):
    batch = json.load(open(batch_file, 'r'))
    locale.update(batch)
    print(f"Merged {batch_file}: {len(batch)} keys")

# Sort and write
sorted_locale = dict(sorted(locale.items()))
with open(locale_file, 'w', encoding='utf-8') as f:
    json.dump(sorted_locale, f, ensure_ascii=False, indent=2)

final_count = len([k for k in sorted_locale if not k.startswith('_')])
print(f"\nFinal {locale_file}: {final_count} keys")
