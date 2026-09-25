# Rollback — the public root

The root serves `ml-opt-d-ui11-0499a96`. Two earlier releases are kept in place, unmodified,
so a rollback never rebuilds anything:

| release | payload | shell |
| --- | --- | --- |
| `ml-opt-d-ui11-0499a96` | `live/ml-opt-d-ui11-0499a96/` | current root `index.html` |
| `ml-opt-d-ui4-32c5587` | `live/ml-opt-d-ui4-32c5587/` | `staging/ml-opt-d-ui4-32c5587/index.html` |
| `ml-edfce09-pages` (v1) | `live/ml-edfce09-pages/` | see below |

`qr.png` is never touched by any of this. The permanent QR points at the root URL, so whatever
the root serves is what the QR opens.

## Rolling back to ui4

ui11 changed the shell, not only `LC_RELEASE`, so the rollback restores the ui4 shell rather
than editing one line:

```bash
cp staging/ml-opt-d-ui4-32c5587/index.html index.html
sed -i "s/'p28d2c-optd-ui4-32c5587-staging'/'p28d2c-optd-ui4-32c5587'/" index.html
git commit -am "Roll the public root back to ml-opt-d-ui4-32c5587"
git push origin main
```

The `-staging` suffix on `PDT_ROUTER_VERSION` is the only difference between a staging shell
and the same shell published at the root.

What that gives back: the four-checkbox exit panel with the optional comment field, and the
`exit_feedback` analytics event. The Worker no longer accepts that event and the `comments`
table is gone, so those POSTs would be rejected with 400 and recorded nowhere. Visits would
still count. Nothing breaks; the feedback UI would simply collect nothing.

## Rolling back to v1

The same move with the v1 shell, which is recorded under `retired/mobile-lite-v1/` together
with `live/ml-edfce09-pages/` (tree `f7361f9d1cce8a404e1be60f9bb2c1aea1dc9ee1`, 17 files). v1
has no appearance switch, no exit panel and no analytics sink, so a v1 rollback restores it
exactly as it shipped and records nothing at all.

## Rolling forward again

Every release directory stays in place, so rolling forward is the same operation in reverse:
copy `staging/<release>/index.html` to the root, drop the `-staging` suffix, commit.

GitHub Pages redeploys in about a minute.
