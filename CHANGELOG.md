# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Standalone public package scaffold for `@plasius/api`.
- CI/CD workflows, governance docs, ADRs, and legal CLA materials.
- Public publish gate script (`npm run pack:check`) that fails when forbidden private paths are included in the npm tarball.
- ADR-0005 documenting the new public package boundary and publish gating decision.
- ADR-0006 documenting the public code namespace boundary decision.

### Changed

- Backend source moved to standalone root package layout.
- Default package build/test now targets a stable public entrypoint and package-local unit tests.
- OAuth provider start routes now issue PKCE (`S256`) parameters and callback token exchange now supplies `code_verifier` when PKCE state is present.
- OAuth state parsing now accepts both `returnTo` and legacy `decodedReturnTo`, with safer fallback handling for missing or malformed client return-state values.
- Added ADR-0003 documenting the PKCE enforcement decision for OAuth authorization code flows.
- Middleware now applies a global transport-security baseline (strict security headers + HTTPS enforcement for production traffic).
- Added ADR-0004 documenting HTTPS enforcement and anti-MITM middleware behavior.
- Repositioned package metadata/docs toward a deliberate generic-helper API package surface.
- Restricted npm published files to curated public artifacts and removed `src/**` + runtime host/openapi artifacts from package payload.
- Removed private repository-name references from public demo/docs copy.

### Fixed

- Declared required Azure SDK dependencies for standalone compilation.

### Security

- Added public security policy and contributor governance docs.
- Replaced Math.random-based OAuth state generation in provider starts with cryptographically secure random values.
- Added PKCE verifier/challenge generation and verifier validation utilities aligned with RFC 7636 (`S256`).
- Added HTTPS enforcement controls (`ENFORCE_HTTPS`) that reject insecure non-local transport with `426`.
- Added dedicated middleware tests for transport-security decision logic and header baseline.
- Added automated tarball checks to prevent accidental publication of private backend source trees and local runtime config files.
- Added automated forbidden-reference checks for public code roots (`src/**`, `tests/**`, `demo/**`).

## [1.0.0] - 2026-02-10

### Added

- Initial public release scaffold for `@plasius/api`.

[Unreleased]: https://github.com/Plasius-LTD/api/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/Plasius-LTD/api/releases/tag/v1.0.0
