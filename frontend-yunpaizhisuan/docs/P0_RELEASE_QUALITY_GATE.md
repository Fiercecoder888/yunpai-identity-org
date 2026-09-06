# P0 release quality gate

`frontend/scripts/p0-quality-gate.mjs` is a fail-closed release gate. It runs
every required engineering gate for a frontend release candidate and then
checks the built release evidence. Any required failure or missing evidence
makes the gate exit non-zero; there is no `allow_failure` escape hatch.

Run it from the `frontend/` directory after a real build produced `dist/`:

```powershell
corepack pnpm@10.14.0 test:p0-quality-gate
```

## Inputs

| Input | Source | Default | Required |
|---|---|---|---|
| Build output | `dist/build-info.json`, `dist/index.html` | `dist/` | Yes, after `pnpm build` |
| Build info path override | `FRONTEND_BUILD_INFO` | `dist/build-info.json` | No |
| Index path override | `FRONTEND_INDEX_HTML` | `dist/index.html` | No |
| pnpm invocation | `YUNPAI_VERIFY_PNPM` | `corepack pnpm@10.14.0` | No |

## What the gate runs

1. The six aggregate steps from `scripts/verify.mjs`, in order:
   `typecheck` → `lint` → `vitest run` → `test:real-mode-gate` →
   `test:build-metadata` → `test:release-provenance`.
2. Release evidence checks on `dist/build-info.json`:
   - file exists;
   - validates against `assertReleaseMetadata` from
     `scripts/build-metadata.mjs` — commit is a 40-character lowercase SHA-1,
     `buildTime` is a UTC ISO-8601 timestamp ending in `Z`, `dirty` is `false`,
     and no field is `unknown` or a placeholder;
   - `dist/index.html` contains the build-info meta tags whose `content`
     matches the build-info fields: `yunpai-build-commit` (full SHA),
     `yunpai-build-branch`, `yunpai-build-time` (UTC ISO-8601), and
     `yunpai-build-dirty`.

The gate never builds `dist/` itself. It is a verification gate, so run it
after the candidate package has been produced with a clean source tree
(`dirty=false`).

## Output

Each check prints as `PASS`/`FAIL` with details, followed by a structured JSON
summary. A report file is written under
`scripts/test-outcomes/verify-<timestamp>.json`.

## Failure semantics

The gate exits non-zero whenever any of the following holds (all are
required, none may be waived):

- any aggregate step fails, errors, or cannot spawn;
- `dist/build-info.json` or `dist/index.html` is missing;
- build-info fails `assertReleaseMetadata` (bad SHA, non-UTC time, dirty
  tree, `unknown` or placeholder values);
- the HTML build-info meta tags are missing or disagree with build-info.

Exit code is `1` for any required failure or missing evidence. There is no
exit-code-0 path that reports failures.
