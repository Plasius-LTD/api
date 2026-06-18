# Contributing to @plasius/api

Thanks for contributing to `@plasius/api`.

## Repo overview

This package is a reusable API helper package used by Plasius services and applications.

## Getting started

```bash
npm install
npm run build
```

## Development workflow

1. Create a focused branch for your change.
2. Make changes and update tests/docs as needed.
3. Run validation before opening a pull request.
4. Open a PR for review and merge review.

## Branching and commits

- Use clear commit messages (for example `feat: ...`, `fix: ...`, `docs: ...`).
- Keep changes scoped to one coherent goal.
- Squash only if required by repo policy for the final PR.

## Validation

Run these at minimum before requesting review:

```bash
npm run build
npm run lint
npm run typecheck
npm run test
npm run pack:check
```

If your changes are docs-only, run the validation commands that your change impacts.

## Coding expectations

- Keep package API stable unless explicitly changing public behavior.
- Preserve governance and security conventions in `SECURITY.md` and `CODE_OF_CONDUCT.md`.
- Keep dependency and export changes explicit and well-documented.

## Documentation

Update `README.md` when public behavior changes.
Update `CHANGELOG.md` when delivering user-visible/package-level work.

## Pull requests

- Link issue references and any related project items.
- Include evidence of validation results.
- Mention any known limitations and follow-up work.
