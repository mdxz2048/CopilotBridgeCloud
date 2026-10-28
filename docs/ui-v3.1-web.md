# UED v3.1 web implementation

Implements the user-approved local design in the existing Next.js website. The homepage uses a left-hand introduction, an HTML/CSS official-client illustration, and a separate Bridge connection strip. The illustration is explicitly labeled as illustrative and does not report a visitor's live connection. Existing product examples remain available.

The shared header, ring mark, typography, neutral surfaces, buttons, footer, download page, three-step guide, and FAQ follow the approved light/dark palette. `/guide` and `/faq` are real navigable pages; the homepage reuses the same guide and FAQ content. Shared account/admin surfaces consume the same theme tokens without changing their layouts or access rules.

Only light and dark are offered. The initial document sets its theme before rendering; `cb-theme` persists the choice locally and synchronizes between tabs. Unavailable storage still allows changing the current page's appearance.

## Existing behavior retained

- Header identity refresh, user/admin destinations, server authorization and login flows.
- Download release metadata, SHA256, real download URLs, loading, missing release, error and retry states.
- Official-client offline fallback instructions and metadata.
- Existing account, balance, device, billing, order submission and administrative handlers.
- Existing page-view whitelist; adding help pages does not send unsupported tracking paths.

No API, database, billing, minimum-client version, authentication or deployment configuration changes. No new dependencies. Synthetic balances, release states and credentials are confined to the external local browser review harness and are not imported by the application.

## Validation

Web TypeScript checking, 16 existing tests and the Next.js production build pass. Local browser review covers public pages at widths 1440, 768 and 375 in both themes, theme reload/navigation/cross-tab persistence, keyboard FAQ expansion, release error/retry, identity links and protected-page redirects. App verification and update-state review are recorded separately in the App repository and local review folder.

These browser checks use synthetic responses. They do not establish a real authenticated production session, successful payment, installation or official-client restart. This revision is local source work; it has not been deployed or published.
