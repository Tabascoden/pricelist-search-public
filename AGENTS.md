# AGENTS.md

## Branches & deploy
- staging -> staging.search.iirest.ru
- main -> search.iirest.ru

## Rules
- Never commit secrets. `.env` is server-only. Only `.env.example` is allowed in the repo.
- Work only via PRs (no direct pushes to main/staging).
- Keep `/health` stable.
- Keep changes small and focused.
