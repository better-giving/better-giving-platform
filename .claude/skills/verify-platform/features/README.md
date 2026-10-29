# verify-platform feature map

One file per user-facing feature; each names the drive.mjs flow that proves it. A listed entry point the drive does not take is not verified: a click counts only when `entry.clicked` names it, and a direct load counts only when `entry.loaded` names that URL. Reaching the same screen the other way does not verify the path that was skipped.

| feature | flow | file |
|---|---|---|
| Landing page | `home` | [home.md](home.md) |
| Sign in | `login` | [login.md](login.md) |
| Marketplace | `marketplace` | [marketplace.md](marketplace.md) |
| Donate (card) | `donate-card` | [donate-card.md](donate-card.md) |
| Deploy smoke paths | `smoke-paths` | [smoke-paths.md](smoke-paths.md) |
| Connector allow | `connector-allow` | [connector-allow.md](connector-allow.md) |
| Agent nonprofit lookup | `agents-find` | [agents-find.md](agents-find.md) |
| Agent donation amounts | `agents-quote` | [agents-quote.md](agents-quote.md) |
| Organization slug | `org-slug` | [org-slug.md](org-slug.md) |
| Campaign admin | `campaign-admin` | [campaign-admin.md](campaign-admin.md) |
| Campaign page | `campaign-page` | [campaign-page.md](campaign-page.md) |
| Campaign donate | `campaign-donate` | [campaign-donate.md](campaign-donate.md) |

`scripts/doctor.sh` runs `drive.mjs --check-map` and fails when a `features/*.md` file (other than this index), a link to one from this file, and a `FLOWS` key in `drive.mjs` are not the same set.

Not mapped yet (candidates): signup, register (npo onboarding steps 1–5), donate via bank/DAF/stocks/crypto, form-embed widget on a third-party page.
