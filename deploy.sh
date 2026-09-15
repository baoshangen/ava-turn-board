#!/usr/bin/env bash
# One-command deploy for AVA Turn Board to Cloudflare Workers + D1.
#
# Prerequisites (once):
#   1. A free Cloudflare account.
#   2. Authenticate wrangler:  npx wrangler login
#      (or export CLOUDFLARE_API_TOKEN=... with Workers Scripts + D1 edit rights)
#
# Usage:
#   ./deploy.sh
#   OWNER_SETUP_KEY="my-secret" ./deploy.sh   # reuse an existing setup key
set -euo pipefail
cd "$(dirname "$0")"

DB_NAME="ava-turn-board"
WRANGLER="npx --yes wrangler"

echo "==> Installing dependencies"
npm install

echo "==> Building Worker bundle"
npm run build

echo "==> Ensuring D1 database '$DB_NAME' exists"
DB_ID=$($WRANGLER d1 list --json 2>/dev/null \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const l=JSON.parse(s);const m=(Array.isArray(l)?l:[]).find(x=>x.name===process.argv[1]);process.stdout.write(m?(m.uuid||m.database_id||""):"")}catch{process.stdout.write("")}})' "$DB_NAME" || true)

if [ -z "${DB_ID:-}" ]; then
  echo "    Creating D1 database…"
  CREATE_OUT=$($WRANGLER d1 create "$DB_NAME")
  echo "$CREATE_OUT"
  DB_ID=$(printf '%s' "$CREATE_OUT" | grep -oiE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)
fi

if [ -z "${DB_ID:-}" ]; then
  echo "!! Could not determine the D1 database_id automatically."
  echo "   Run 'npx wrangler d1 create $DB_NAME', paste the database_id into wrangler.toml, then re-run."
  exit 1
fi
echo "    D1 database_id: $DB_ID"

# Write the real database_id into wrangler.toml (replaces empty or placeholder).
sed -i.bak -E "s#^database_id = .*#database_id = \"$DB_ID\"#" wrangler.toml && rm -f wrangler.toml.bak
echo "    Wrote database_id into wrangler.toml"

echo "==> Applying database migrations (remote)"
$WRANGLER d1 migrations apply "$DB_NAME" --remote

echo "==> Configuring the owner setup key (secret)"
if [ -z "${OWNER_SETUP_KEY:-}" ]; then
  OWNER_SETUP_KEY=$(node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))")
  echo "    Generated OWNER_SETUP_KEY (SAVE THIS — you need it once at /setup):"
  echo ""
  echo "        $OWNER_SETUP_KEY"
  echo ""
fi
printf '%s' "$OWNER_SETUP_KEY" | $WRANGLER secret put OWNER_SETUP_KEY

echo "==> Deploying Worker"
$WRANGLER deploy

echo ""
echo "Done. Next steps:"
echo "  1. Open the printed *.workers.dev URL, then visit  <URL>/setup"
echo "  2. Enter a shared salon username, a password (>= 15 chars), and the OWNER_SETUP_KEY above."
echo "  3. Share the URL + username + password with the salon. Log in on phone and laptop — turns sync live."
