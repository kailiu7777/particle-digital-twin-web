# Rollback — Mobile Lite v2 to v1

One line, one commit, no rebuild. `live/ml-edfce09-pages/` is preserved byte-for-byte
(tree `f7361f9d1cce8a404e1be60f9bb2c1aea1dc9ee1`, 17 files), so v1 can be re-launched at any
time without building anything.

## The change

In the root `index.html`:

```js
var LC_RELEASE = 'ml-opt-d-ui4-32c5587';   // current
var LC_RELEASE = 'ml-edfce09-pages';       // rollback
```

```bash
sed -i "s/LC_RELEASE = 'ml-opt-d-ui4-32c5587'/LC_RELEASE = 'ml-edfce09-pages'/" index.html
git commit -am "Roll the public root back to Mobile Lite v1 (ml-edfce09-pages)"
git push origin main
```

GitHub Pages redeploys in about a minute.

## What rollback does and does not touch

* `qr.png` is never touched. The permanent QR points at the root URL, so it keeps working
  and simply opens v1 again.
* `live/ml-edfce09-pages/` is already present and unmodified — nothing is restored or rebuilt.
* `live/ml-opt-d-ui4-32c5587/` stays in place, so rolling forward again is the same one-line
  change in reverse.

## Caveat worth knowing

The v1 shell has no appearance switch, no exit issue panel and no analytics sink. Rolling back
therefore also removes those, which is intended: v1 is restored exactly as it shipped.

Analytics counters are keyed by release, so v1 traffic after a rollback simply does not
increment anything (v1 has no sink), and the v2 counters are left untouched for comparison.
