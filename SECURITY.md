# Security Policy

## Reporting a vulnerability

Please report vulnerabilities by email to **security@systaro.de**. Do not file
public issues for security problems.

We will acknowledge receipt within 2 business days and aim to provide a
remediation plan within 14 days for high-severity issues.

When reporting, please include:

- A clear description of the issue and its impact.
- Steps to reproduce (proof-of-concept code is welcome).
- The affected version (`git rev-parse HEAD` or `cat .docuvault-current-version`).
- Whether you've disclosed this to anyone else.

## Supported versions

We support the latest published minor release on the `main` branch. Security
fixes are backported only to the most recent minor at our discretion. There is
no commitment to support older minors.

## Design choices that are not vulnerabilities

A few behaviours look like bugs to an automated scanner but are intentional:

- **DocuVault renders user-authored HTML, including embedded JavaScript, in
  shared and preview views.** Public share links (`/api/shared/<token>/raw`,
  `/api/shared/<token>/og`) deliberately deliver document content verbatim so
  that authors can embed interactive snippets, diagrams, and rich markdown
  extensions. We rely on the share link's secret token (and optional password)
  as the access control — not on sandboxing the content. If you need an
  untrusted-author model, do not enable public shares.
- **The `prep-public` and `main` branches are public; secrets and customer
  data must not be committed.** `.gitignore` excludes `.env*` (except the
  example file) and `*.pem`/`*.key`/etc.; CI does not have access to commit on
  contributors' behalf. Contributors are responsible for ensuring their PR
  does not include sensitive data.
- **The `/api/setup-admin` endpoint is reachable without authentication on a
  fresh install.** It is gated by "no users exist yet" and is the intended way
  to bootstrap the first administrator. Once any user exists, the endpoint
  returns 409 and cannot be used for takeover.

## Out of scope

- Denial of service via expensive operations (large file uploads, large LLM
  prompts) — these are guarded by rate limits but not hardened against a
  determined adversary. Self-hosting customers are responsible for sizing
  their installation.
- Issues that require an authenticated `SUPER_ADMIN` to exploit — this role is
  trusted by design (it has root-equivalent control of the install).
- Vulnerabilities in third-party dependencies that we have not yet upgraded to
  a patched version, unless you have a working exploit against DocuVault's use
  of the dependency.
