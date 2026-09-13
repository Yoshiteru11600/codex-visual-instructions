# Security Policy

## Supported versions

Until the first public release, only the latest `main` revision is supported.

## Reporting

Do not open a public issue for a vulnerability. After the GitHub repository is created, use its private vulnerability-reporting feature. If that is unavailable, contact a maintainer privately through the profile listed on the repository.

Particularly important reports include DOM or form-data leakage, unintended external transmission, secret persistence, Review Mode navigation bypass, unsafe Site Tool side effects, and overlay isolation failures. Do not include real secrets or sensitive page captures in a report.

## Design boundary

The tool has no telemetry, external API, cloud storage, or extension-wide browser permissions. It runs inside the reviewed development origin, so same-origin code remains part of the trust boundary. Site Tool callers must still treat page-provided data and tool definitions as untrusted.
