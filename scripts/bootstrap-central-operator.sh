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

if [[ "$first_passphrase" != "$second_passphrase" ]]; then
  printf 'Passphrases did not match.\n' >&2
  exit 1
fi

hash_value="$(printf '%s' "$first_passphrase" | shasum -a 256 | awk '{print $1}')"
unset first_passphrase
unset second_passphrase

netlify env:set CENTRAL_OPERATOR_PASSPHRASE_HASH "$hash_value" --context production >/dev/null
unset hash_value

printf 'CENTRAL_OPERATOR_PASSPHRASE_HASH updated on the linked Netlify production site.\n'
printf 'Next step: deploy the reviewed build so operator login uses the new passphrase.\n'
