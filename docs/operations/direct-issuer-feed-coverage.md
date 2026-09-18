# Direct issuer announcement coverage

## Observed deployment versus verified defaults

Production sensor logs captured on 2026-09-18 at 08:49 UTC reported **4 registered direct issuer feeds**, 4 attempted and successful feed polls, and **4,936 exact SEC issuer identities**. The previously cited count of two matched the built-in RSS seeds (NVIDIA and AMD), not that later registry observation. These counts describe different coverage: broad SEC discovery and the per-issuer SEC-submissions rotation continue regardless of RSS availability.

This change adds five verified issuer feeds to the two existing RSS defaults, for **7 built-in RSS/Atom endpoints**, plus the existing Tredegar and TSMC website-only discovery roots. Registration still requires an exact ticker and CIK match in the current exposure index. A code change does not establish a new live registry count or successful live poll; those must be checked after deployment through `directAnnouncementMonitoring`.

## Added sources verified on 2026-09-18

Each feed URL was found on the issuer's own site, fetched successfully as XML, and bound to the issuer's SEC identity. No URL was generated from a guessed endpoint pattern.

| Ticker | SEC CIK | Issuer page advertising the feed | Verified feed | Response |
| --- | --- | --- | --- | --- |
| INTC | 0000050863 | [Intel investor relations](https://www.intc.com/) | [Press releases RSS](https://www.intc.com/news-events/press-releases/rss) | HTTP 200; RSS; 12 items |
| XOM | 0000034088 | [ExxonMobil press releases](https://investor.exxonmobil.com/company-information/press-releases) | [Press releases RSS](https://investor.exxonmobil.com/company-information/press-releases/rss) | HTTP 200; RSS; 10 items |
| AAPL | 0000320193 | [Apple Newsroom](https://www.apple.com/newsroom/) | [Newsroom feed](https://www.apple.com/newsroom/rss-feed.rss) | HTTP 200; Atom; 20 entries |
| JPM | 0000019617 | [JPMorgan Chase RSS feeds](https://jpmorganchaseco.gcs-web.com/ir/shareholder-information/rss-news-feeds) | [Press releases RSS](https://jpmorganchaseco.gcs-web.com/rss/news-releases.xml) | HTTP 200; RSS; 10 items |
| KO | 0000021344 | [Coca-Cola press releases](https://investors.coca-colacompany.com/news-events/press-releases) | [Press releases RSS](https://investors.coca-colacompany.com/news-events/press-releases/rss) | HTTP 200; RSS; 10 items |

Identity evidence: [Intel SEC 10-K](https://www.sec.gov/Archives/edgar/data/50863/000005086326000011/intc-20251227.htm), [ExxonMobil SEC 10-Q](https://www.sec.gov/Archives/edgar/data/34088/000003408826000093/xom-20260630.htm), and SEC submissions responses for [Apple](https://data.sec.gov/submissions/CIK0000320193.json), [JPMorgan Chase](https://data.sec.gov/submissions/CIK0000019617.json), and [Coca-Cola](https://data.sec.gov/submissions/CIK0000021344.json).

## Operational limits and evidence checks

- The monitor polls at most 20 due feeds per cycle, preserving the 15-minute healthy-feed cadence and progressive failure backoff.
- Discovery remains three sequential issuer lookups every 30 minutes: at most 144 per day under the existing 190-call SEC-submissions provider limit.
- Only current ticker/CIK matches may be polled or counted as current direct coverage. Retained historical registry rows cannot supply another issuer's news after ticker reuse.
- HTTP 200 HTML or malformed feed roots count as failures. Valid empty RSS or Atom responses remain valid feed checks; they do not invent announcements.
- Feeds only discover events. Source collection, exact identity, evidence, price, halt, Committee, spending, and publication requirements continue to apply.
