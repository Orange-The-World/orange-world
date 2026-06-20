# Third-party notices

This document aggregates the licenses of NPM dependencies shipped or linked by `orange-world`. Each component is governed by the license stated in its own source distribution.

Total packages: **1**
Distinct license strings: **1**

## NPM dependencies (production)

| Package | Version | License | Repository |
|---------|---------|---------|------------|
| @orange-the-world/orange-world | 0.1.0 | UNLICENSED | https://github.com/Orange-The-World/orange-world |

## Regenerating this file

```bash
bunx license-checker --production --json > /tmp/licenses.json
python3 scripts/gen-third-party-notices.py /tmp/licenses.json THIRD_PARTY_NOTICES.md
```

If `bunx` is not available, `npx license-checker` works the same way.
