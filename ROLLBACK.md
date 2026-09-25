# Rollback — the public root

The root serves `ml-opt-d-ui12-0499a96`. Every earlier release is kept in place, unmodified, so
a rollback never rebuilds anything:

| release | payload | shell |
| --- | --- | --- |
| `ml-opt-d-ui12-0499a96` | `live/ml-opt-d-ui12-0499a96/` | current root `index.html` |
| `ml-opt-d-ui11-0499a96` | `live/ml-opt-d-ui11-0499a96/` | `staging/ml-opt-d-ui11-0499a96/index.html` |
| `ml-opt-d-ui4-32c5587` | `live/ml-opt-d-ui4-32c5587/` | `staging/ml-opt-d-ui4-32c5587/index.html` |
| `ml-edfce09-pages` (v1) | `live/ml-edfce09-pages/` | `retired/mobile-lite-v1/` |

`qr.png` is never touched by any of this. The permanent QR points at the root URL, so whatever
the root serves is what the QR opens.

## How a rollback is done

Each shell above is preserved as the staging copy it was qualified as. The `-staging` suffix on
`PDT_ROUTER_VERSION` is the only difference between a staging shell and the same shell published
at the root, so a rollback is: copy the shell, drop the suffix, commit.

```bash
cp staging/<release>/index.html index.html
sed -i "s/'p28d2c-optd-<tag>-staging'/'p28d2c-optd-<tag>'/" index.html
git commit -am "Roll the public root back to <release>"
git push origin main
```

GitHub Pages redeploys in about a minute. Rolling forward again is the same operation with a
different source shell.

## Read this before rolling back to ui11

**ui11 contains the Exit bug.** Its `closePage()` calls `window.close()` before the timer that
renders the finished page. Desktop browsers refuse to close a context the script did not open,
so it is invisible there — but the iPhone permits it for a context opened from the QR, so the
browsing context closes first and the visitor is dropped onto whatever page was underneath.
That is exactly the failure ui12 exists to fix.

If ui11 has to be restored for some other reason, delete this line from its `closePage()`:

```js
try { window.close(); } catch (e) {}
```

## What each further step back also gives up

* **ui4** — brings back the four-checkbox exit panel with the optional comment field and the
  `exit_feedback` event. The Worker no longer accepts that event and the `comments` table is
  gone, so those POSTs are rejected with 400 and recorded nowhere. Visits still count. Nothing
  breaks; the feedback UI simply collects nothing.
* **v1** (`ml-edfce09-pages`, tree `f7361f9d1cce8a404e1be60f9bb2c1aea1dc9ee1`, 17 files) — no
  appearance switch, no exit panel, no analytics sink. A v1 rollback restores it exactly as it
  shipped and records nothing at all.
