# Security Policy

Smart Mirror OS is designed for a private home/local-network setup.

## Secrets

Never commit local secrets or runtime state.

Ignored private files:

```text
server/secrets.local.json
server/state.json
.env
.env.local
*.local
```

Provider credentials can include:

- Jellyfin API keys
- Spotify client secrets
- Spotify refresh tokens
- Weather API keys
- Private calendar feed URLs

## Runtime state

The backend state can contain local media metadata, calendar titles, provider status, and artwork URLs. Treat runtime state as private.

Do not expose the backend port publicly without adding authentication.

## Before publishing

Run:

```bash
git status --short
git diff --cached
grep -RIn "api_key\|clientSecret\|refreshToken\|access_token\|password\|secret" . \
  --exclude-dir=node_modules \
  --exclude-dir=dist \
  --exclude=package-lock.json
```

## Reporting issues

If you find a security issue, open a private report or contact the maintainer directly instead of posting secrets in a public issue.