#!/usr/bin/env bash
# The public copy of the app (decided 2026-11-05): the tree of one reviewed
# commit, minus the files that never leave the private repository, scanned,
# and committed only when asked: with --init as a new repository's one commit,
# with --onto as one more commit in a clone of the public repository. It never
# pushes and never adds a remote; publishing is a separate, manual step.
#
#   scripts/public-export.sh <commit> <outdir> [--markers <file>]
#                [--init | --onto <clone>] [--author "Name <email>"] [--repo <dir>]
#
#   <commit>   the reviewed commit to export (any name git resolves).
#   <outdir>   a new or empty folder outside the repository.
#   --markers  a file of values that must appear nowhere in the copy, one per
#              line (blank lines and lines starting with # are skipped). The
#              scan never prints a value, only its line number in the file.
#   --init     make <outdir> a git repository holding the copy as one commit,
#              dated as <commit> (in UTC) and titled "Talia <version>". It
#              needs --author: a role identity, never a person's. This makes
#              the FIRST public copy.
#   --onto     the refresh at each App Store release: <clone> is a clone of
#              the public repository with a clean work tree. Its files are
#              replaced by the copy, so a file deleted since goes too, and the
#              change is committed once on top of its history, dated, titled
#              and authored as with --init. Its remote is never used.
#   --repo     the repository to export from (default: the one holding this
#              script).
#
# Left out of the copy: CLAUDE.md, ROADMAP.md, RELEASE_NOTES.md, .claude/ and
# private/. The copy comes from `git archive`, never from a folder copy, so
# ignored and untracked files (local settings, build output) cannot reach it.
# scripts/public-export-scan.js then scans it: the left-out files are absent,
# no email address is outside the example domains (apart from the few
# addresses the app itself shows, listed there), no review or audit finding
# number is left, and, with --markers, no marker value appears in any form the
# scanner knows. Any problem stops the export with exit status 1, before
# anything is committed. scripts/__tests__/publicExport.test.ts runs it on
# throwaway repositories.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
EXCLUDED="CLAUDE.md ROADMAP.md RELEASE_NOTES.md .claude private"

die() {
  echo "public-export: $*" >&2
  exit 2
}

usage() {
  sed -n '8,9p' "${BASH_SOURCE[0]}" | sed 's/^#  *//' >&2
  exit 2
}

COMMIT=""
OUT=""
MARKERS=""
INIT=0
ONTO=""
AUTHOR=""
REPO=""
while [ $# -gt 0 ]; do
  case "$1" in
    --markers) [ $# -ge 2 ] || usage; MARKERS="$2"; shift 2 ;;
    --init) INIT=1; shift ;;
    --onto) [ $# -ge 2 ] || usage; ONTO="$2"; shift 2 ;;
    --author) [ $# -ge 2 ] || usage; AUTHOR="$2"; shift 2 ;;
    --repo) [ $# -ge 2 ] || usage; REPO="$2"; shift 2 ;;
    -h|--help) usage ;;
    --*) die "unknown option $1" ;;
    *)
      if [ -z "$COMMIT" ]; then COMMIT="$1"
      elif [ -z "$OUT" ]; then OUT="$1"
      else usage
      fi
      shift ;;
  esac
done
[ -n "$COMMIT" ] && [ -n "$OUT" ] || usage

if [ -z "$REPO" ]; then REPO="$HERE"; fi
REPO="$(git -C "$REPO" rev-parse --show-toplevel 2>/dev/null)" || die "not a git repository: $REPO"
REPO="$(cd "$REPO" && pwd -P)"
ID="$(git -C "$REPO" rev-parse --verify --quiet "${COMMIT}^{commit}")" || die "not a commit: $COMMIT"

if [ -n "$MARKERS" ]; then
  [ -f "$MARKERS" ] || die "no markers file: $MARKERS"
fi
if [ "$INIT" = 1 ] && [ -n "$ONTO" ]; then
  die "--init makes the first copy and --onto the ones after it: give one"
fi
if [ "$INIT" = 1 ] || [ -n "$ONTO" ]; then
  case "$AUTHOR" in
    *" <"*@*">") ;;
    *) die '--init and --onto need --author "Name <email>" (a role identity)' ;;
  esac
fi
if [ -n "$ONTO" ]; then
  ONTO="$(git -C "$ONTO" rev-parse --show-toplevel 2>/dev/null)" || die "not a git repository: $ONTO"
  ONTO="$(cd "$ONTO" && pwd -P)"
  case "$ONTO/" in
    "$REPO"/*) die "$ONTO is inside the repository; give a clone of the public one" ;;
  esac
  [ "$(git -C "$ONTO" rev-parse --path-format=absolute --git-common-dir)" != \
    "$(git -C "$REPO" rev-parse --path-format=absolute --git-common-dir)" ] ||
    die "$ONTO shares this repository's history; give a clone of the public one"
  git -C "$ONTO" rev-parse --verify --quiet HEAD >/dev/null ||
    die "$ONTO has no commit yet; make the first copy with --init"
  [ -z "$(git -C "$ONTO" status --porcelain --ignored --untracked-files=all)" ] ||
    die "$ONTO has changes, untracked or ignored files; start from a fresh clone"
fi

if [ -e "$OUT" ]; then
  [ -d "$OUT" ] || die "$OUT is not a folder"
  [ -z "$(ls -A "$OUT")" ] || die "$OUT is not empty"
else
  mkdir -p "$OUT"
fi
OUT="$(cd "$OUT" && pwd -P)"
case "$OUT/" in
  "$REPO"/*) die "$OUT is inside the repository; export outside it" ;;
esac

git -C "$REPO" archive --format=tar "$ID" | tar -x -f - -C "$OUT"
for p in $EXCLUDED; do
  rm -rf "${OUT:?}/$p"
done

if [ -n "$MARKERS" ]; then
  node "$HERE/public-export-scan.js" "$OUT" --markers "$MARKERS"
else
  node "$HERE/public-export-scan.js" "$OUT"
fi

# One commit of the work tree in $1, by --author, dated as the source commit.
commit_copy() {
  local dir="$1" name email version when
  name="${AUTHOR% <*}"
  email="${AUTHOR##* <}"
  email="${email%>}"
  version="$(node -e 'try { process.stdout.write(String(require(process.argv[1]).version || "")) } catch (e) {}' "$OUT/package.json")"
  # In UTC: the source commit's own offset would tell where it was made.
  when="$(TZ=UTC git -C "$REPO" show -s --date=iso-strict-local --format=%cd "$ID")"
  git -C "$dir" add -A -f
  GIT_AUTHOR_NAME="$name" GIT_AUTHOR_EMAIL="$email" GIT_AUTHOR_DATE="$when" \
    GIT_COMMITTER_NAME="$name" GIT_COMMITTER_EMAIL="$email" GIT_COMMITTER_DATE="$when" \
    git -C "$dir" -c commit.gpgsign=false commit -q --no-verify -m "Talia${version:+ $version}"
}

# Every file of the work tree in $1 is in its last commit.
count_tracked() {
  local files
  files="$(cd "$1" && find . -path ./.git -prune -o \( -type f -o -type l \) -print | wc -l | tr -d ' ')"
  TRACKED="$(git -C "$1" ls-files | wc -l | tr -d ' ')"
  [ "$files" = "$TRACKED" ] || die "the commit holds $TRACKED files, the copy $files"
}

if [ "$INIT" = 1 ]; then
  git -C "$OUT" init -q -b main
  commit_copy "$OUT"
  [ "$(git -C "$OUT" rev-list --count HEAD)" = 1 ] || die "the copy does not hold exactly one commit"
  [ -z "$(git -C "$OUT" remote)" ] || die "the copy has a remote"
  count_tracked "$OUT"
  echo "public-export: $OUT holds one commit, $TRACKED files, no remote"
fi

if [ -n "$ONTO" ]; then
  BEFORE="$(git -C "$ONTO" rev-parse HEAD)"
  find "$ONTO" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
  (cd "$OUT" && tar -cf - .) | tar -xf - -C "$ONTO"
  git -C "$ONTO" add -A -f
  if git -C "$ONTO" diff --cached --quiet; then
    die "the copy equals the last commit of $ONTO; nothing to commit"
  fi
  commit_copy "$ONTO"
  [ "$(git -C "$ONTO" rev-parse HEAD~1)" = "$BEFORE" ] || die "the new commit is not on top of $BEFORE"
  count_tracked "$ONTO"
  echo "public-export: one commit added on top of $ONTO's history, $TRACKED files, nothing pushed"
fi
echo "public-export: done"
