# Cookie Banner Rule List

Rules List for Firefox's automated cookie banner handling feature.

> [!IMPORTANT]  
> Pull requests for cookie banner rules are currently not being accepted since
> Cookie Banner Handling is currently not enabled in Firefox.

## How to Add or Update Rules

### Test Rules

You can test rules locally in Firefox before adding them to the repository with the `cookiebanners.listService.testRules` pref. It accepts a JSON array of rules. Test rules will take precedence over rules from the global list.

Since the feature is still in development, please use the latest version of [Firefox Nightly](https://nightly.mozilla.org) for testing. You need to set the following prefs to enable the feature:

- `cookiebanners.service.mode` = `1` (reject all) or `2` (reject all or fall back to accept all).
- `cookiebanners.bannerClicking.enabled` = `true` - Enables the clicking feature.
- `cookiebanners.cookieInjector.enabled` = `true` - Enables the cookie injection feature.

### Submit Rules

Once you have confirmed that your updated / added rules work in Nightly, you can add them to the rules file [cookie-banner-rules-list.json](./cookie-banner-rules-list.json) so they can be deployed to all Firefox clients.

When adding rules to the array in the file, make sure that you don't add duplicates rules or rules with invalid JSON. Each rule needs to have a unique `id` field containing a UUID. You can generate one in your terminal with `uuidgen`.

See [CookieBannerRuleList.schema.json](./CookieBannerRuleList.schema.json) and [CookieBannerRule.schema.json](https://hg.mozilla.org/mozilla-central/raw-file/tip/toolkit/components/cookiebanners/schema/CookieBannerRule.schema.json) for the exact rule format required.

Before submitting run the following commands to ensure the rule list is well formatted and valid:

Install dependencies:

```
npm install
```

Run tests:

```
npm test
```

You can correct any prettier formatting issues automatically with

```
npm run prettier
```

To submit your rule list change please create a pull request. Include the list of affected domains in the description.

### Example Rule

Here is an example rule that both defines cookies to set and a cookie banner to click on:

```json
{
  "domains": ["example.com", "example.org"],
  "click": {
    "hide": "#bannerParent",
    "optIn": "#accept-btn",
    "optOut": "#reject-btn",
    "presence": ".cookie-banner"
  },
  "cookies": {
    "optOut": [
      {
        "name": "cookieBannerConsent",
        "value": "0"
      }
    ]
  },
  "id": "706cca25-cea5-49e8-9179-ff3f55c9c1d3"
}
```

Not all fields are mandatory. See [CookieBannerRule.schema.json](https://hg.mozilla.org/mozilla-central/raw-file/tip/toolkit/components/cookiebanners/schema/CookieBannerRule.schema.json) for details.

If a rule defines both click rules and cookies the implementation will first try to set cookies and only attempt to handle the banner if it still shows up.

<!-- TODO: add instructions for what kind of selectors or cookies to select and when to use injection or clicking. -->

## Deployment

The [rs-publish.py](./rs-publish.py) script from this repo publishes the latest cookie-banner-rules-list.json and updates the associated collection in RemoteSettings:

When running the script, logs are emitted to stdout indicate if the collection was updated, and if so, provide a short summary of the modifications, and ultimately ask for a data review of those changes (unless `ENVIRONMENT` is set to `dev`, in which case changes are automatically published)
