# Changelog

All notable changes to `@kraty/sdk` (Kraty TypeScript SDK) live here.
Follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) +
[SemVer](https://semver.org/).

## [0.10.0](https://github.com/PedroTrincheiras/Kraty/compare/sdk-client-typescript-v0.9.0...sdk-client-typescript-v0.10.0) (2026-07-12)


### ⚠ BREAKING CHANGES

* **sdk:** the finalization MembershipKind wire/persisted values are now 'leaderboard' and 'event_leaderboard' (were 'shared_board' / 'event_board'). Client apps that persisted membership refs across an upgrade should clear them.
* **leaderboards:** the cross-event ("shared") leaderboard id in SDK/API responses is now `leaderboardId` (was `sharedLeaderboardId`). Physical DB tables were renamed; migration 0012 must run.
* **api:** API responses and SDK types now use `avatar` instead of `avatarUrl` for leaderboard entries and the player synthetic identity. Client code reading `entry.avatarUrl` or `syntheticIdentity.avatarUrl` must switch to `avatar`.
* **api,sdks:** rename leaderboard URLs to match v0.4.0 client split
* **sdks:** split Leaderboards into Leaderboards (by key) + EventLeaderboards (by UUID)

### Features

* **api,sdks:** rename leaderboard URLs to match v0.4.0 client split ([53897ca](https://github.com/PedroTrincheiras/Kraty/commit/53897ca4cc245569dc86353de72fda3df8b925b9))
* **api:** leaderboard join + flexible multi-segment standings ([7a9f11f](https://github.com/PedroTrincheiras/Kraty/commit/7a9f11f2598fa6bed8c6036863172b666e1ebce4))
* **api:** rename identity/leaderboard avatarUrl field to avatar ([76971be](https://github.com/PedroTrincheiras/Kraty/commit/76971be73e6313d8b54c1a947c1b82557885a702))
* finish an attempt now (player "end my run") across API + all SDKs ([f1ba2a0](https://github.com/PedroTrincheiras/Kraty/commit/f1ba2a0fa56a51a513bdbc865dd4ea9d854a8a65))
* **portal:** pool detail page + create-flow polish; release SDKs v0.3.0 ([cf7231d](https://github.com/PedroTrincheiras/Kraty/commit/cf7231d697bbb3485440c21f99578fd288ebf787))
* **sdks:** leaderboard submitScore (client TS/Unity/Flutter) + server scoring/progress ([02f4e69](https://github.com/PedroTrincheiras/Kraty/commit/02f4e6944813639ca19349ff1a9c28c92e6aa62f))
* **sdks:** split Leaderboards into Leaderboards (by key) + EventLeaderboards (by UUID) ([96116ac](https://github.com/PedroTrincheiras/Kraty/commit/96116acf7eb90ff32f2f5e9e7cf5617dc7610ec7))
* **sdk:** subscribe() helper + lazy-eval publishes bot deltas ([099d15d](https://github.com/PedroTrincheiras/Kraty/commit/099d15dc959c0619210319d343dc380c8b74c02d))
* **sdk:** surface synthetic identity + align progress verb across SDKs ([6e346f7](https://github.com/PedroTrincheiras/Kraty/commit/6e346f7328a3f58dd08d51f5f7d15c93e013aba6))
* session events — sudden-death sessions, convergence, promotion/relegation ([#5](https://github.com/PedroTrincheiras/Kraty/issues/5)) ([c3d698f](https://github.com/PedroTrincheiras/Kraty/commit/c3d698f8f73816a63a9ae799841d8d8eef3e1d4f))


### Bug Fixes

* **backend:** lobby fill gap + bot kind TTL race + leaderboard isSelf flag ([4122793](https://github.com/PedroTrincheiras/Kraty/commit/4122793ee5ac02b10de88f74fea244dd2d6d650c))
* **ci:** repair all workflows after SDK restructure to client/server/ ([85f0524](https://github.com/PedroTrincheiras/Kraty/commit/85f0524ef1777240e04d96dd34dee3ec37ed7315))


### Documentation

* rewrite root README + point every SDK README at kraty.io/docs ([0bb9b13](https://github.com/PedroTrincheiras/Kraty/commit/0bb9b1385ef8803aaf2f67a3a63ea746ca4b6e12))
* **sdks:** bump SCHEMA.md headers to v0.4.1 + add wire-endpoint refs ([c2bc5eb](https://github.com/PedroTrincheiras/Kraty/commit/c2bc5eb24afecf61bb22cec0be9a234615a25877))
* **sdks:** bump SCHEMA.md to v0.6.0 + document join + standings ([ccb57c3](https://github.com/PedroTrincheiras/Kraty/commit/ccb57c38bb4954277cf86780b7afd172f889c21c))


### Refactors

* **leaderboards:** rename shared leaderboards to "leaderboards", event boards to "event leaderboards" ([ec27f8e](https://github.com/PedroTrincheiras/Kraty/commit/ec27f8ecbc83c8381ec732e3540dbfc6099f99e5))
* **sdk:** rename finalization board kinds to leaderboard terminology ([cd1c007](https://github.com/PedroTrincheiras/Kraty/commit/cd1c007c2ba71b81de3ef64168bd7a847aab890d))

## [0.8.0](https://github.com/PedroTrincheiras/Kraty/compare/sdk-client-typescript-v0.7.0...sdk-client-typescript-v0.8.0) (2026-07-09)


### ⚠ BREAKING CHANGES

* **api,sdks:** rename leaderboard URLs to match v0.4.0 client split
* **sdks:** split Leaderboards into Leaderboards (by key) + EventLeaderboards (by UUID)

### Features

* **api,sdks:** rename leaderboard URLs to match v0.4.0 client split ([53897ca](https://github.com/PedroTrincheiras/Kraty/commit/53897ca4cc245569dc86353de72fda3df8b925b9))
* **api:** leaderboard join + flexible multi-segment standings ([7a9f11f](https://github.com/PedroTrincheiras/Kraty/commit/7a9f11f2598fa6bed8c6036863172b666e1ebce4))
* **portal:** pool detail page + create-flow polish; release SDKs v0.3.0 ([cf7231d](https://github.com/PedroTrincheiras/Kraty/commit/cf7231d697bbb3485440c21f99578fd288ebf787))
* **sdks:** leaderboard submitScore (client TS/Unity/Flutter) + server scoring/progress ([02f4e69](https://github.com/PedroTrincheiras/Kraty/commit/02f4e6944813639ca19349ff1a9c28c92e6aa62f))
* **sdks:** split Leaderboards into Leaderboards (by key) + EventLeaderboards (by UUID) ([96116ac](https://github.com/PedroTrincheiras/Kraty/commit/96116acf7eb90ff32f2f5e9e7cf5617dc7610ec7))
* **sdk:** subscribe() helper + lazy-eval publishes bot deltas ([099d15d](https://github.com/PedroTrincheiras/Kraty/commit/099d15dc959c0619210319d343dc380c8b74c02d))
* session events — sudden-death sessions, convergence, promotion/relegation ([#5](https://github.com/PedroTrincheiras/Kraty/issues/5)) ([c3d698f](https://github.com/PedroTrincheiras/Kraty/commit/c3d698f8f73816a63a9ae799841d8d8eef3e1d4f))


### Bug Fixes

* **backend:** lobby fill gap + bot kind TTL race + leaderboard isSelf flag ([4122793](https://github.com/PedroTrincheiras/Kraty/commit/4122793ee5ac02b10de88f74fea244dd2d6d650c))
* **ci:** repair all workflows after SDK restructure to client/server/ ([85f0524](https://github.com/PedroTrincheiras/Kraty/commit/85f0524ef1777240e04d96dd34dee3ec37ed7315))


### Documentation

* rewrite root README + point every SDK README at kraty.io/docs ([0bb9b13](https://github.com/PedroTrincheiras/Kraty/commit/0bb9b1385ef8803aaf2f67a3a63ea746ca4b6e12))
* **sdks:** bump SCHEMA.md headers to v0.4.1 + add wire-endpoint refs ([c2bc5eb](https://github.com/PedroTrincheiras/Kraty/commit/c2bc5eb24afecf61bb22cec0be9a234615a25877))
* **sdks:** bump SCHEMA.md to v0.6.0 + document join + standings ([ccb57c3](https://github.com/PedroTrincheiras/Kraty/commit/ccb57c38bb4954277cf86780b7afd172f889c21c))

## [0.7.0](https://github.com/PedroTrincheiras/Kraty/compare/sdk-client-typescript-v0.6.0...sdk-client-typescript-v0.7.0) (2026-07-06)


### ⚠ BREAKING CHANGES

* **api,sdks:** rename leaderboard URLs to match v0.4.0 client split
* **sdks:** split Leaderboards into Leaderboards (by key) + EventLeaderboards (by UUID)

### Features

* **api,sdks:** rename leaderboard URLs to match v0.4.0 client split ([53897ca](https://github.com/PedroTrincheiras/Kraty/commit/53897ca4cc245569dc86353de72fda3df8b925b9))
* **api:** leaderboard join + flexible multi-segment standings ([7a9f11f](https://github.com/PedroTrincheiras/Kraty/commit/7a9f11f2598fa6bed8c6036863172b666e1ebce4))
* **portal:** pool detail page + create-flow polish; release SDKs v0.3.0 ([cf7231d](https://github.com/PedroTrincheiras/Kraty/commit/cf7231d697bbb3485440c21f99578fd288ebf787))
* **sdks:** leaderboard submitScore (client TS/Unity/Flutter) + server scoring/progress ([02f4e69](https://github.com/PedroTrincheiras/Kraty/commit/02f4e6944813639ca19349ff1a9c28c92e6aa62f))
* **sdks:** split Leaderboards into Leaderboards (by key) + EventLeaderboards (by UUID) ([96116ac](https://github.com/PedroTrincheiras/Kraty/commit/96116acf7eb90ff32f2f5e9e7cf5617dc7610ec7))
* **sdk:** subscribe() helper + lazy-eval publishes bot deltas ([099d15d](https://github.com/PedroTrincheiras/Kraty/commit/099d15dc959c0619210319d343dc380c8b74c02d))
* session events — sudden-death sessions, convergence, promotion/relegation ([#5](https://github.com/PedroTrincheiras/Kraty/issues/5)) ([c3d698f](https://github.com/PedroTrincheiras/Kraty/commit/c3d698f8f73816a63a9ae799841d8d8eef3e1d4f))


### Bug Fixes

* **backend:** lobby fill gap + bot kind TTL race + leaderboard isSelf flag ([4122793](https://github.com/PedroTrincheiras/Kraty/commit/4122793ee5ac02b10de88f74fea244dd2d6d650c))
* **ci:** repair all workflows after SDK restructure to client/server/ ([85f0524](https://github.com/PedroTrincheiras/Kraty/commit/85f0524ef1777240e04d96dd34dee3ec37ed7315))


### Documentation

* rewrite root README + point every SDK README at kraty.io/docs ([0bb9b13](https://github.com/PedroTrincheiras/Kraty/commit/0bb9b1385ef8803aaf2f67a3a63ea746ca4b6e12))
* **sdks:** bump SCHEMA.md headers to v0.4.1 + add wire-endpoint refs ([c2bc5eb](https://github.com/PedroTrincheiras/Kraty/commit/c2bc5eb24afecf61bb22cec0be9a234615a25877))
* **sdks:** bump SCHEMA.md to v0.6.0 + document join + standings ([ccb57c3](https://github.com/PedroTrincheiras/Kraty/commit/ccb57c38bb4954277cf86780b7afd172f889c21c))

## [0.6.0](https://github.com/PedroTrincheiras/Kraty/compare/sdk-client-typescript-v0.5.0...sdk-client-typescript-v0.6.0) (2026-07-02)


### ⚠ BREAKING CHANGES

* **api,sdks:** rename leaderboard URLs to match v0.4.0 client split
* **sdks:** split Leaderboards into Leaderboards (by key) + EventLeaderboards (by UUID)

### Features

* **api,sdks:** rename leaderboard URLs to match v0.4.0 client split ([53897ca](https://github.com/PedroTrincheiras/Kraty/commit/53897ca4cc245569dc86353de72fda3df8b925b9))
* **api:** leaderboard join + flexible multi-segment standings ([7a9f11f](https://github.com/PedroTrincheiras/Kraty/commit/7a9f11f2598fa6bed8c6036863172b666e1ebce4))
* **portal:** pool detail page + create-flow polish; release SDKs v0.3.0 ([cf7231d](https://github.com/PedroTrincheiras/Kraty/commit/cf7231d697bbb3485440c21f99578fd288ebf787))
* **sdks:** leaderboard submitScore (client TS/Unity/Flutter) + server scoring/progress ([02f4e69](https://github.com/PedroTrincheiras/Kraty/commit/02f4e6944813639ca19349ff1a9c28c92e6aa62f))
* **sdks:** split Leaderboards into Leaderboards (by key) + EventLeaderboards (by UUID) ([96116ac](https://github.com/PedroTrincheiras/Kraty/commit/96116acf7eb90ff32f2f5e9e7cf5617dc7610ec7))
* **sdk:** subscribe() helper + lazy-eval publishes bot deltas ([099d15d](https://github.com/PedroTrincheiras/Kraty/commit/099d15dc959c0619210319d343dc380c8b74c02d))


### Bug Fixes

* **backend:** lobby fill gap + bot kind TTL race + leaderboard isSelf flag ([4122793](https://github.com/PedroTrincheiras/Kraty/commit/4122793ee5ac02b10de88f74fea244dd2d6d650c))
* **ci:** repair all workflows after SDK restructure to client/server/ ([85f0524](https://github.com/PedroTrincheiras/Kraty/commit/85f0524ef1777240e04d96dd34dee3ec37ed7315))


### Documentation

* rewrite root README + point every SDK README at kraty.io/docs ([0bb9b13](https://github.com/PedroTrincheiras/Kraty/commit/0bb9b1385ef8803aaf2f67a3a63ea746ca4b6e12))
* **sdks:** bump SCHEMA.md headers to v0.4.1 + add wire-endpoint refs ([c2bc5eb](https://github.com/PedroTrincheiras/Kraty/commit/c2bc5eb24afecf61bb22cec0be9a234615a25877))
* **sdks:** bump SCHEMA.md to v0.6.0 + document join + standings ([ccb57c3](https://github.com/PedroTrincheiras/Kraty/commit/ccb57c38bb4954277cf86780b7afd172f889c21c))

## [0.5.0](https://github.com/PedroTrincheiras/Kraty/compare/sdk-client-typescript-v0.1.0...sdk-client-typescript-v0.5.0) (2026-06-29)


### ⚠ BREAKING CHANGES

* **api,sdks:** rename leaderboard URLs to match v0.4.0 client split
* **sdks:** split Leaderboards into Leaderboards (by key) + EventLeaderboards (by UUID)

### Features

* **api,sdks:** rename leaderboard URLs to match v0.4.0 client split ([53897ca](https://github.com/PedroTrincheiras/Kraty/commit/53897ca4cc245569dc86353de72fda3df8b925b9))
* **portal:** pool detail page + create-flow polish; release SDKs v0.3.0 ([cf7231d](https://github.com/PedroTrincheiras/Kraty/commit/cf7231d697bbb3485440c21f99578fd288ebf787))
* **sdks:** leaderboard submitScore (client TS/Unity/Flutter) + server scoring/progress ([02f4e69](https://github.com/PedroTrincheiras/Kraty/commit/02f4e6944813639ca19349ff1a9c28c92e6aa62f))
* **sdks:** split Leaderboards into Leaderboards (by key) + EventLeaderboards (by UUID) ([96116ac](https://github.com/PedroTrincheiras/Kraty/commit/96116acf7eb90ff32f2f5e9e7cf5617dc7610ec7))
* **sdk:** subscribe() helper + lazy-eval publishes bot deltas ([099d15d](https://github.com/PedroTrincheiras/Kraty/commit/099d15dc959c0619210319d343dc380c8b74c02d))


### Bug Fixes

* **backend:** lobby fill gap + bot kind TTL race + leaderboard isSelf flag ([4122793](https://github.com/PedroTrincheiras/Kraty/commit/4122793ee5ac02b10de88f74fea244dd2d6d650c))
* **ci:** repair all workflows after SDK restructure to client/server/ ([85f0524](https://github.com/PedroTrincheiras/Kraty/commit/85f0524ef1777240e04d96dd34dee3ec37ed7315))


### Documentation

* rewrite root README + point every SDK README at kraty.io/docs ([0bb9b13](https://github.com/PedroTrincheiras/Kraty/commit/0bb9b1385ef8803aaf2f67a3a63ea746ca4b6e12))
* **sdks:** bump SCHEMA.md headers to v0.4.1 + add wire-endpoint refs ([c2bc5eb](https://github.com/PedroTrincheiras/Kraty/commit/c2bc5eb24afecf61bb22cec0be9a234615a25877))

## [Unreleased]

### Added

- **`leaderboards.submitScore(key, value, opts?)`** — submit a score
  for the active player directly to a dashboard-configured board,
  outside an event attempt. Wraps
  `POST /sdk/v1/players/:externalId/leaderboards/:key/score`. Returns
  a new `LeaderboardScoreResult` (`{ leaderboardId, score, rank }`,
  where `rank` is `number | null`). `opts`:
  `{ segment?, idempotencyKey?, as? }`. Errors:
  `client_scoring_disabled` (403), `score_not_supported` (400),
  `not_found` (404), `validation_failed` (400).

### Changed

- `leaderboards.read` — `LeaderboardReadOptions.segment` is now
  required only for `context` segmentation. For
  `progression`-segmented boards omit it and the server derives the
  caller's division. Signature unchanged.
