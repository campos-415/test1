#!/usr/bin/env bash
#
# Start a new daycare from nothing.
#
#   ./bootstrap.sh
#
# From an empty folder to a working app: clones the source, gives it a fresh
# git history with one commit, optionally creates a private repository for it,
# installs, and hands over to npm run setup to build the database.
#
# This is the only file you need to start. Copy it anywhere - it fetches
# everything else.
#
# THE FRESH HISTORY IS THE POINT. Cloning normally would carry every commit
# from the previous client into the new business repository, including whatever
# was committed and later deleted. A new client gets commit number one.
#
# What it does not do, because nothing can:
#
#   - create your GitHub or Supabase account
#   - verify a sending domain, or point a domain at anything (DNS)
#   - register the Square callback URL
#   - enrol two-factor authentication
#
# It lists those at the end rather than pretending.
#
# Secrets are read with the echo off, are never printed, and the GitHub token
# is never written into git config - the remote is set to a clean URL and the
# token is used for one push only.

set -euo pipefail

# HTTPS, not SSH. This script is meant to be the FIRST thing run on a machine
# that has nothing on it, and an SSH clone needs a key that has been generated,
# added to GitHub and loaded into the agent. That is the chicken-and-egg this
# script exists to break: you cannot get the repository until you can clone the
# repository. The source repo is public, so https needs nothing at all.
#
# Paste an SSH URL at the prompt if you would rather; the remote below follows
# whichever style you used.
SOURCE_DEFAULT="https://github.com/campos-415/signinlistv3.git"

# ---------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------

if [ -t 1 ]; then
  BOLD=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'
  GREEN=$'\033[32m'; YELLOW=$'\033[33m'; OFF=$'\033[0m'
else
  BOLD=""; DIM=""; RED=""; GREEN=""; YELLOW=""; OFF=""
fi

step() { printf '\n%s==%s %s%s%s\n' "$BOLD" "$OFF" "$BOLD" "$1" "$OFF"; }
ok()   { printf '   %sok%s  %s\n' "$GREEN" "$OFF" "$1"; }
note() { printf '   %s--  %s%s\n' "$DIM" "$1" "$OFF"; }
warn() { printf '   %s!!%s  %s\n' "$YELLOW" "$OFF" "$1"; }
die()  { printf '\n%sStopped.%s %s\n' "$RED" "$OFF" "$1" >&2; exit 1; }

ask() {
  local prompt="$1" fallback="${2:-}" answer
  if [ -n "$fallback" ]; then
    read -r -p "$prompt ${DIM}[$fallback]${OFF} " answer
  else
    read -r -p "$prompt " answer
  fi
  printf '%s' "${answer:-$fallback}"
}

ask_secret() {
  local answer
  read -r -s -p "$1 " answer
  printf '\n' >&2
  printf '%s' "$answer"
}

confirm() {
  local answer
  answer="$(ask "$1 (y/n)" "${2:-y}")"
  [[ "$answer" =~ ^[Yy] ]]
}

# ---------------------------------------------------------------------
step "Checking what is installed"
# ---------------------------------------------------------------------

command -v git  >/dev/null 2>&1 || die "git is not installed. https://git-scm.com/downloads"
command -v node >/dev/null 2>&1 || die "node is not installed. Install Node 18 or newer from https://nodejs.org"
command -v npm  >/dev/null 2>&1 || die "npm is not installed. It comes with Node."
command -v curl >/dev/null 2>&1 || die "curl is not installed."

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 18 ]; then
  die "Node $NODE_MAJOR is too old. The setup script needs 18 or newer for built-in fetch."
fi
ok "git, node $NODE_MAJOR, npm, curl"

# ---------------------------------------------------------------------
step "The new business"
# ---------------------------------------------------------------------

CLIENT="$(ask 'Short name, lowercase, no spaces (used for the folder and the repo):' '')"
[ -n "$CLIENT" ] || die "A name is needed."
if ! [[ "$CLIENT" =~ ^[a-z0-9][a-z0-9-]*$ ]]; then
  die "Use lowercase letters, numbers and hyphens only. GitHub is fussy and so are folder names."
fi
[ -e "$CLIENT" ] && die "There is already something called $CLIENT here. Move it or pick another name."

SOURCE="$(ask 'Clone from:' "$SOURCE_DEFAULT")"

# ---------------------------------------------------------------------
step "Cloning"
# ---------------------------------------------------------------------

note "Shallow clone - the history is discarded in a moment anyway."
git clone --depth 1 --quiet "$SOURCE" "$CLIENT" || die "Could not clone $SOURCE.

The default source is public and needs no key, so a failure here is usually
no network, or a typo in the address.

If you pasted an SSH address (git@github.com:...) it needs your key loaded.
Check with: ssh -T git@github.com"
cd "$CLIENT"
ok "cloned into $CLIENT/"

rm -rf .git
ok "old history removed"

# ---------------------------------------------------------------------
step "Installing"
# ---------------------------------------------------------------------

note "Runs before the first commit so the lockfile is committed as installed."
npm install --silent || die "npm install failed. The error is above."
ok "dependencies installed"

# ---------------------------------------------------------------------
step "First commit"
# ---------------------------------------------------------------------

git init --quiet -b main
git add -A
git -c user.name="${GIT_AUTHOR_NAME:-$(git config --global user.name || echo 'Setup')}" \
    -c user.email="${GIT_AUTHOR_EMAIL:-$(git config --global user.email || echo 'setup@localhost')}" \
    commit --quiet -m "Initial commit"
ok "one commit, no inherited history"

# ---------------------------------------------------------------------
step "GitHub"
# ---------------------------------------------------------------------

if confirm "Create a private GitHub repository for this and push?" "y"; then
  echo
  note "Needs a CLASSIC token with the 'repo' scope:"
  note "https://github.com/settings/tokens  ->  Generate new token (classic)"
  echo
  note "A fine-grained token will NOT work here unless it is scoped to All"
  note "repositories with Administration: read and write. Creating a repo that"
  note "does not exist yet cannot be granted per-repository, which is the trap."
  echo
  GH_USER="$(ask 'GitHub username:' '')"
  [ -n "$GH_USER" ] || die "A username is needed."
  GH_TOKEN="$(ask_secret 'Token:')"
  [ -n "$GH_TOKEN" ] || die "A token is needed."

  HTTP_CODE="$(curl -s -o /tmp/gh-create.$$ -w '%{http_code}' \
    -X POST https://api.github.com/user/repos \
    -H "Authorization: Bearer $GH_TOKEN" \
    -H "Accept: application/vnd.github+json" \
    -d "{\"name\":\"$CLIENT\",\"private\":true,\"description\":\"Daycare app for $CLIENT\"}")"

  # Whether there is a repository at the other end to push into. Pushing when
  # there is not produces a second, more confusing error on top of the first.
  REPO_EXISTS=yes
  case "$HTTP_CODE" in
    201) ok "created github.com/$GH_USER/$CLIENT (private)" ;;
    422) warn "A repository called $CLIENT already exists. Pushing to it." ;;
    401) rm -f /tmp/gh-create.$$; die "GitHub refused that token. It may be expired, or pasted short." ;;
    403)
      REPO_EXISTS=no
      warn "That token cannot create repositories."
      echo
      note "Almost always a FINE-GRAINED token. Creating a repository is not a"
      note "permission that can be granted per-repository, because the repository"
      note "does not exist yet -- so a fine-grained token scoped to selected"
      note "repositories is refused here no matter what else it can do."
      echo
      note "Two ways on:"
      note "  1. A classic token with the 'repo' scope, and run this again"
      note "  2. Create it by hand at https://github.com/new -- private, and do"
      note "     NOT add a README, .gitignore or licence -- then push (below)"
      ;;
    *)   REPO_EXISTS=no; warn "GitHub replied $HTTP_CODE:"; cat /tmp/gh-create.$$ ;;
  esac
  rm -f /tmp/gh-create.$$

  # The remote is stored WITHOUT the token. The token is used once, below,
  # for the push itself, so it never lands in .git/config where it would sit
  # in plain text for the life of the project.
  if [[ "$SOURCE" == git@* ]]; then
    git remote add origin "git@github.com:$GH_USER/$CLIENT.git"
    note "Remote set to SSH, matching how you cloned."
  else
    git remote add origin "https://github.com/$GH_USER/$CLIENT.git"
  fi

  if [ "$REPO_EXISTS" = no ]; then
    # Nothing to push into. Saying so beats a push failure that reads like a
    # second, unrelated problem.
    echo
    note "Not pushing: there is no repository at the other end yet."
    note "The code is committed here with one commit, and the remote is set."
    note "Once the repository exists:  cd $CLIENT && git push -u origin main"
  elif git push --quiet "https://$GH_USER:$GH_TOKEN@github.com/$GH_USER/$CLIENT.git" main 2>/dev/null; then
    git branch --set-upstream-to=origin/main main >/dev/null 2>&1 || true
    ok "pushed"
  else
    warn "Push failed. The code is committed locally and the remote is set;"
    warn "push it yourself with: cd $CLIENT && git push -u origin main"
  fi
  unset GH_TOKEN
else
  note "Skipped. The code is committed locally with one commit."
fi

# ---------------------------------------------------------------------
step "The database"
# ---------------------------------------------------------------------

echo
echo "  The next part builds the Supabase database: 18 SQL files in order,"
echo "  the staff sign-ins, the storage bucket and the branding."
echo
echo "  You need a Supabase project already created, and a token from"
echo "  ${DIM}https://supabase.com/dashboard/account/tokens${OFF}"
echo

if confirm "Run it now?" "y"; then
  npm run setup
else
  note "Skipped. Run it later with: cd $CLIENT && npm run setup"
fi

# ---------------------------------------------------------------------
printf '\n%s%s  Done.%s\n\n' "$BOLD" "$GREEN" "$OFF"
echo "    cd $CLIENT"
echo "    npm run dev"
echo
echo "  ${BOLD}Still to do by hand:${OFF}"
echo "    1. Deploy: import the repository at vercel.com and add the"
echo "       variables from .env.local under Environment Variables"
echo "    2. Email: verify a domain at resend.com, then fill RESEND_API_KEY"
echo "       and EMAIL_FROM in .env.local and in the host"
echo "    3. Square: register the deployed URL as a web callback, or card"
echo "       payments fail at the counter"
echo "    4. Enrol two-factor on the owner account"
echo "    5. Check the backup settings in Supabase, and restore one once"
echo
echo "  ${DIM}Full checklist: docs/DEPLOY-NEW-CLIENT.md${OFF}"
echo
