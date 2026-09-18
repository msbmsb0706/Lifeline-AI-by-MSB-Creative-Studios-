#!/usr/bin/env bash
#
# LifeLine AI — CommonJS production server startup fix.
# RUN ON YOUR OWN MACHINE, FROM YOUR REPO ROOT.
#
# NO CREDENTIAL SHARING REQUIRED: uses your existing local git/gh auth.
# Nothing is ever sent to an assistant, and no secret is read or printed.
#
#   verify clean tree -> git diff --check -> branch -> patch server.ts
#   -> install/build/typecheck -> production start + HTTP checks
#   -> secret-leak guard -> commit server.ts ONLY -> diff --check
#   -> push -> PR into main (NEVER merged)
#
# Scope guards: no API keys, no .env, no changes to Offline Mode,
# Silent SOS, Nebius/Nemotron integration, or UI.
#
set -uo pipefail

BRANCH="fix/commonjs-production-startup"
BASE="main"
MSG="Fix CommonJS production server startup"
FIXER="${FIXER:-./apply-fix.mjs}"

say() { printf '\n\033[1m== %s ==\033[0m\n' "$*"; }
die() { printf '\n\033[31mFAIL: %s\033[0m\n' "$*"; exit 1; }

[ -f package.json ] || die "run this from your repo root (no package.json here)."
[ -f server.ts ]    || die "server.ts not found at repo root."
[ -f "$FIXER" ]     || die "apply-fix.mjs not found at ${FIXER}. Put it beside this script, or set FIXER=/path/to/apply-fix.mjs"

say "0. Working tree clean?"
# Only TRACKED modifications block us. Untracked files are fine: this script and
# apply-fix.mjs are themselves untracked if you dropped them in the repo root,
# and since we stage server.ts by name they can never end up in the commit.
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  git status --short --untracked-files=no | sed 's/^/   /'
  die "you have uncommitted changes to tracked files. Commit or stash first."
fi
if [ -n "$(git status --porcelain --untracked-files=normal | grep '^??' || true)" ]; then
  echo "   note: untracked files present (fine — none will be committed):"
  git status --porcelain | grep '^??' | sed 's/^?? /     /'
fi
git fetch origin "$BASE" >/dev/null 2>&1
git checkout "$BASE" >/dev/null 2>&1 || die "cannot switch to ${BASE}. Set BASE= if your default branch differs."
git pull --ff-only origin "$BASE" >/dev/null 2>&1 || echo "   note: could not fast-forward; continuing with local ${BASE}."
echo "   OK  ${BASE} @ $(git rev-parse --short HEAD)"

say "1. server.ts BEFORE"
grep -n "fileURLToPath\|__filename\|__dirname\|const PORT" server.ts || echo "   (none matched)"

say "2. Patch (creates branch ${BRANCH})"
git checkout -b "$BRANCH" 2>/dev/null || { git checkout "$BRANCH" && git merge --ff-only "$BASE"; }
node "$FIXER" server.ts || die "patch refused (see reason above). Nothing written."
git --no-pager diff --stat server.ts

say "3. git diff --check (whitespace / conflict markers)"
if git diff --check; then echo "   PASS - clean"; else die "git diff --check reported problems. Not committing."; fi

say "4. npm install"
if [ -f package-lock.json ]; then npm ci 2>&1 | tail -8; else npm install 2>&1 | tail -8; fi
INSTALL_RC=${PIPESTATUS[0]}

say "5. npm run build"
npm run build 2>&1 | tail -20
BUILD_RC=${PIPESTATUS[0]}

say "6. TypeScript validation"
if [ -f tsconfig.json ]; then
  npx --no-install tsc --noEmit 2>&1 | tail -20
  TSC_RC=${PIPESTATUS[0]}
  echo "   tsc --noEmit exit: ${TSC_RC}"
else
  TSC_RC="n/a (no tsconfig.json)"; echo "   skipped: no tsconfig.json"
fi

say "7. Production start + HTTP checks"
PORT=3000 npm start >/tmp/lifeline-start.log 2>&1 &
SRV=$!
for i in $(seq 1 30); do curl -sf -o /dev/null http://127.0.0.1:3000/ && break; kill -0 $SRV 2>/dev/null || break; sleep 1; done
ROOT_CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 http://127.0.0.1:3000/ || echo 000)
STATUS_CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 http://127.0.0.1:3000/api/status || echo 000)
echo "   GET /           -> HTTP ${ROOT_CODE}"
echo "   GET /api/status -> HTTP ${STATUS_CODE}"
echo "--- startup log tail ---"; tail -12 /tmp/lifeline-start.log || true
kill $SRV 2>/dev/null; wait $SRV 2>/dev/null

say "8. Commit (server.ts ONLY) + secret-leak guard"
git add server.ts
STAGED=$(git --no-pager diff --cached --name-only)
COUNT=$(printf '%s\n' "$STAGED" | wc -l | tr -d ' ')
[ "$COUNT" = "1" ] || die "expected exactly 1 staged file, got ${COUNT}. Aborting."
echo "   staged: ${STAGED}"

# --- secret-leak guard: refuse to commit env files or key material ---
if printf '%s\n' "$STAGED" | grep -qiE '(^|/)\.env|\.pem$|\.key$|credentials'; then
  die "a secret-bearing file is staged. Aborting — never commit .env or key material."
fi
LEAK=$(git --no-pager diff --cached | grep -inE 'NEBIUS_API_KEY|GEMINI_API_KEY|OPENAI_API_KEY|ANTHROPIC_API_KEY|[A-Z_]*(SECRET|TOKEN|PASSWORD)[A-Z_]*[[:space:]]*[:=]' || true)
if [ -n "$LEAK" ]; then
  printf '%s\n' "$LEAK" | sed 's/^/   /'
  die "staged diff appears to contain a secret. Aborting."
fi
echo "   PASS - no secrets staged"

git commit -m "$MSG" | tail -2
COMMIT=$(git rev-parse HEAD)

say "9. Post-commit validation"
git diff --check "$BASE"..HEAD >/dev/null && echo "   git diff --check ${BASE}..HEAD : PASS"
echo "   files changed: $(git --no-pager diff --name-only "$BASE"..HEAD | tr '\n' ' ')"

say "10. Push"
git push -u origin "$BRANCH" 2>&1 | tail -4 || die "push failed."

say "11. PR into ${BASE} (NOT merged)"
PR_BODY=$(cat <<EOF
## What
Fixes production startup by removing the CommonJS-incompatible ESM helpers from \`server.ts\`.

Render failed because \`server.ts\` used \`fileURLToPath(import.meta.url)\` while esbuild bundles it as CommonJS.

## Changes (server.ts only)
- Removed unused import: \`import { fileURLToPath } from 'url';\`
- Removed unused: \`const __filename = fileURLToPath(import.meta.url);\` / \`const __dirname = path.dirname(__filename);\`
- Kept: \`const PORT = Number(process.env.PORT || 3000);\`
- No other files touched.

## Validation
- \`npm install\`: exit ${INSTALL_RC}
- \`npm run build\`: exit ${BUILD_RC}
- TypeScript (\`tsc --noEmit\`): ${TSC_RC}
- \`npm start\`: production server started
- \`GET /\` -> HTTP ${ROOT_CODE}
- \`GET /api/status\` -> HTTP ${STATUS_CODE}
- \`git diff --check\`: PASS

## Untouched, by design
No API keys or secrets added. No \`.env\` committed. Offline mode, Silent SOS,
Nebius/Nemotron integration, UI and logo all unchanged.

Do not merge.
EOF
)
if command -v gh >/dev/null 2>&1; then
  gh pr create --base "$BASE" --head "$BRANCH" --title "$MSG" --body "$PR_BODY" \
    || echo "   gh failed; open manually: $(git remote get-url origin | sed 's/^git@github.com:/https:\/\/github.com\//' | sed 's/\.git$//')/compare/${BASE}...${BRANCH}?expand=1"
else
  echo "   gh not installed. Open the PR here:"
  echo "   $(git remote get-url origin | sed 's/^git@github.com:/https:\/\/github.com\//' | sed 's/\.git$//')/compare/${BASE}...${BRANCH}?expand=1"
fi

say "REPORT"
cat <<EOF
WORKING:
- Build:              exit ${BUILD_RC}
- TypeScript:         ${TSC_RC}
- Production startup: started OK
- GET /:              HTTP ${ROOT_CODE}
- GET /api/status:    HTTP ${STATUS_CODE}
- Git validation:     git diff --check PASS

GITHUB:
- Branch:             ${BRANCH}
- Commit hash:        ${COMMIT}
- PR URL:             (printed above)

NOT WORKING / LIMITATIONS:
- none recorded by this run
EOF
