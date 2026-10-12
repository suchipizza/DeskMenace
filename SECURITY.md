# Security policy

gary.js runs on other people's websites, so we take anything that could hurt a host page or its visitors seriously: script or HTML injection through lines, configuration or manifests, clicks or keystrokes leaking to the wrong element, unexpected network requests, or a way to make the character impossible to remove.

## Reporting

Please **don't open a public issue** for a vulnerability. Use GitHub's private vulnerability reporting on this repository (**Security → Report a vulnerability**) with steps to reproduce and the affected version. You'll get an acknowledgement within a few days.

## Supported versions

Fixes are released for the latest minor version. Pin versions in production and update when a security release is announced.

## Hardening tips for site owners

- Pin an exact version in your script URL, or self-host the files.
- Use Subresource Integrity (`integrity="sha384-…"`) when loading from a CDN.
- Load characters only from origins you trust, and list them in your CSP `connect-src`.
