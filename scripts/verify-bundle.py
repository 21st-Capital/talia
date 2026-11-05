#!/usr/bin/env python3
"""
Is a given change actually IN the app we just installed?

A green build is not proof the code shipped, so we check the bundle. But
`grep -a` on the bundle is not proof either, and it produced a false alarm on
2026-07-29: a guard was reported missing from two consecutive builds when it had
been there the whole time.

WHY GREP LIES HERE. Hermes keeps string literals in tables. Anything that fits
Latin1 goes in the ASCII table and greps normally. A string containing ANY
character outside Latin1 — an em-dash, a curly quote, an accent — goes in a
UTF-16 table, where "Two of" is stored as T\\0w\\0o\\0 \\0o\\0f\\0 and matches
nothing. Our user-facing copy is full of em-dashes, so the strings most worth
checking are exactly the ones grep cannot see.

    scripts/verify-bundle.py                       # default checks
    scripts/verify-bundle.py "some string" ...     # ad-hoc

Exit code 1 if anything is missing, so it can gate a release.
"""

import sys
import os

BUNDLE = (
    "ios/build-device/Build/Products/Release-iphoneos/"
    "KeelWallet.app/main.jsbundle"
)

# One distinctive string per shipped change. Prefer a phrase the user would
# actually see — that is the thing whose absence matters.
DEFAULT_CHECKS = [
    ("registration prompt asks once per vault", "Yes, the vault is registered"),
    ("same-seed key guard", "Two of these keys come from the same wallet backup"),
    ("finaliser maturity guard", "the network would reject it"),
    ("duplicate-pending merge", "unsignedTxid"),
    ("sign-out keeps parked partials", "isCosignRequest"),
]


def find(blob: bytes, needle: str) -> str | None:
    """Which string table is it in — or None if genuinely absent."""
    if blob.find(needle.encode("utf-8")) >= 0:
        return "ascii"
    if blob.find(needle.encode("utf-16-le")) >= 0:
        return "utf-16"
    return None


def main() -> int:
    path = os.environ.get("TALIA_BUNDLE", BUNDLE)
    if not os.path.exists(path):
        print(f"no bundle at {path} — build Release for the device first")
        return 1

    blob = open(path, "rb").read()
    mtime = os.path.getmtime(path)
    import datetime

    print(f"bundle {len(blob):,} bytes, built "
          f"{datetime.datetime.fromtimestamp(mtime):%Y-%m-%d %H:%M:%S}\n")

    checks = (
        [(s, s) for s in sys.argv[1:]] if len(sys.argv) > 1 else DEFAULT_CHECKS
    )
    missing = 0
    for label, needle in checks:
        where = find(blob, needle)
        if where:
            print(f"  ✅ {label:44} ({where})")
        else:
            print(f"  ❌ {label:44} NOT IN THE BUILD")
            missing += 1

    print()
    if missing:
        print(f"{missing} change(s) did not ship. Clear the Metro cache and "
              f"rebuild:\n  find \"$TMPDIR\" -maxdepth 1 -name 'metro-*' "
              f"-exec rm -rf {{}} +")
        return 1
    print("everything checked is in the build.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
