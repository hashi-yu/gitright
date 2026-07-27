# Contributing to GitRight

Thank you for helping improve GitRight.

## Before opening a request

Use a GitHub Issue for:

- a reproducible bug report; or
- a feature proposal that explains the user problem and expected behavior.

Open an Issue before implementing a change to the product contract, including
supported behavior, compatibility, privacy, security, or installation.
Material contract decisions are explained publicly in an Issue or pull request.

A small, self-contained correction may be submitted directly as a pull request.
Pull requests are implementation proposals, not the issue-triage queue.

Security concerns and conduct incidents do not belong in public Issues. Follow
the [Security Policy](./SECURITY.md) or
[Code of Conduct](./CODE_OF_CONDUCT.md).

## Triage labels

GitRight uses exactly these five issue-triage labels:

- `needs-triage` — maintainer evaluation is required
- `needs-info` — more information is required from the reporter
- `ready-for-agent` — the request is fully specified for implementation
- `ready-for-human` — human implementation or judgment is required
- `wontfix` — the request will not be actioned

Pull requests are reviewed through the normal code-review workflow and do not
receive triage labels.

## Develop and verify

Follow [Development](./docs/development.md) to set up the repository. Before
submitting a pull request, run the checks that match the change. At minimum:

```sh
npm run typecheck
npm test
```

Use [Verification](./docs/verification.md) for the distribution, compatibility,
security, and visual verification surfaces.

Keep each pull request focused. Explain the user-visible effect, link the
relevant Issue when one is required, and update public documentation and tests
when the contract changes.

## License and submission rights

GitRight uses an inbound-equals-outbound model: contributions are submitted
under the repository's [MIT License](./LICENSE). The beta requires neither a
Contributor License Agreement (CLA) nor a Developer Certificate of Origin
(DCO).

By submitting a contribution, you confirm that:

- you have the right to submit the work;
- the contribution may be distributed under the MIT License; and
- any third-party material is identified and compatible with that license.

## Governance and support

`hashi-yu` is the single maintainer for the beta and has final responsibility
for the roadmap, contribution acceptance, releases, security, and conduct
enforcement. A proposal may be declined, and acceptance, response, review,
merge, or release timing is not guaranteed.

Bug and feature support is best effort. GitHub Discussions, direct support,
email support, and service-level commitments are not offered.
