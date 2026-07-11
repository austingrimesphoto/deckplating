#!/usr/bin/env bash
set -euo pipefail

if ! command -v netlify >/dev/null 2>&1; then
  printf 'Netlify CLI is required.\n' >&2
  exit 1
fi

if [[ ! -f .netlify/state.json ]]; then
  printf 'Run this from the linked Deckplating repo so Netlify site state is available.\n' >&2
  exit 1
fi

prompt_secret() {
  local prompt="$1"
  local value
  read -r -s -p "$prompt" value
  printf '\n' >&2
  printf '%s' "$value"
}

first_passphrase="$(prompt_secret 'New central operator passphrase: ')"
second_passphrase="$(prompt_secret 'Confirm central operator passphrase: ')"

if [[ -z "$first_passphrase" ]]; then
  printf 'Passphrase cannot be empty.\n' >&2
  exit 1
fi

if (( ${#first_passphrase} < 12 )); then
  printf 'Passphrase must contain at least 12 characters.\n' >&2
  exit 1
fi

if [[ "$first_passphrase" != "$second_passphrase" ]]; then
  printf 'Passphrases did not match.\n' >&2
  exit 1
fi

if command -v shasum >/dev/null 2>&1; then
  hash_value="$(printf '%s' "$first_passphrase" | shasum -a 256 | awk '{print $1}')"
elif command -v sha256sum >/dev/null 2>&1; then
  hash_value="$(printf '%s' "$first_passphrase" | sha256sum | awk '{print $1}')"
else
  printf 'A SHA-256 utility (shasum or sha256sum) is required.\n' >&2
  exit 1
fi
unset first_passphrase
unset second_passphrase

netlify env:set CENTRAL_OPERATOR_PASSPHRASE_HASH "$hash_value" --context production >/dev/null
unset hash_value

printf 'CENTRAL_OPERATOR_PASSPHRASE_HASH updated on the linked Netlify production site.\n'
printf 'Existing versioned operator sessions are invalid after the function environment refreshes.\n'
printf 'Next step: deploy the reviewed build and verify operator login with the new passphrase.\n'
