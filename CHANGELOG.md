# Changelog

## [0.3.1](https://github.com/plutonhq/pluton/compare/pluton-v0.3.0...pluton-v0.3.1) (2026-02-08)


### Bug Fixes

* download cleaning cron task ([6350866](https://github.com/plutonhq/pluton/commit/6350866a84dad88e46330c3ce7c14c98e7e5460c))
* minor ui issues ([e47c602](https://github.com/plutonhq/pluton/commit/e47c602ed5f42f4a3ac0eb0ed7b333809186e354))


### Code Refactoring

* http polling agent communication instead of mqtt ([f3f7f4e](https://github.com/plutonhq/pluton/commit/f3f7f4e1c9636cfa69eb28bb9b3107468d144058))

## [0.3.0](https://github.com/plutonhq/pluton/compare/pluton-v0.2.2...pluton-v0.3.0) (2026-02-02)


### Features

* add ability to create new storage in Add plan screen. ([301d08f](https://github.com/plutonhq/pluton/commit/301d08fc75bd11d6a2ede9a2e2013dd079432246))
* add caching for snapshot data loading ([ac286fc](https://github.com/plutonhq/pluton/commit/ac286fc654d5e6afc97298131cbafcfdb4d55cf1))


### Bug Fixes

* backup and restore success toast box appears twice. ([cc2a1e6](https://github.com/plutonhq/pluton/commit/cc2a1e6c628ca857c5234f7c13ce3b414d030926))
* broken links in notification emails. ([3a42910](https://github.com/plutonhq/pluton/commit/3a42910ff02590b5239b9597c158a4bc99f05a87))
* inaccessibility of windows keyring due to missing vcredist dependency. ([1b758f9](https://github.com/plutonhq/pluton/commit/1b758f9b2017ebc13e512b1126b9323f0c4bb015))
* incorrect version number in the ui. ([8aa8cea](https://github.com/plutonhq/pluton/commit/8aa8cea6bcdea29bab736f8cd8245b8fb2d22b7b))
* minor ui issues. ([59c1e92](https://github.com/plutonhq/pluton/commit/59c1e921cc84e545c9251d3a58ada13ce77107d0))
* missing database migration. ([8596e10](https://github.com/plutonhq/pluton/commit/8596e10e8a8a45fe10928244aa92767f6c0a2c97))
* plan description could not be updated ([87edc5a](https://github.com/plutonhq/pluton/commit/87edc5ad4cd704fb1916373a0cbbc0a3ba343434))
* resolve incomplete restore process on windows build. ([df303eb](https://github.com/plutonhq/pluton/commit/df303ebd01ede4468cef5e903477e08d0097a601))
* resolve logs not appearing when log viewer is opened. ([75984f7](https://github.com/plutonhq/pluton/commit/75984f77dbbfdf4c507e0f74c7cb47b75baf79d6))
* resolve missing progress display in manual backup ([d80dbb0](https://github.com/plutonhq/pluton/commit/d80dbb05c1cf87042b35185e1f0fbfe1b74db9bb))
* Restore Wizard ui issues. ([791cb2d](https://github.com/plutonhq/pluton/commit/791cb2d07837b19987a277340ba51736bb8acdae))
* unstyled email notifications in desktop installations. ([cc4a807](https://github.com/plutonhq/pluton/commit/cc4a807c68e736f59816901c1bd832f58d658787))
* unstyled notification email issue. ([a28017c](https://github.com/plutonhq/pluton/commit/a28017cbdaa577bbd411283ee24a44e3d9b7f1a6))
* viewing long running backup locks users with rate limit. ([7497df1](https://github.com/plutonhq/pluton/commit/7497df19aeee6d8ef2710bb71e4b8575c6b6668d))


### Code Refactoring

* frontend library css export. ([9cf2dd4](https://github.com/plutonhq/pluton/commit/9cf2dd42c997062c571e5c19a0cbcaa78058a993))

## [0.2.2](https://github.com/plutonhq/pluton/compare/pluton-v0.2.1...pluton-v0.2.2) (2026-01-21)


### Bug Fixes

* broken UI in some instance. ([7c144c2](https://github.com/plutonhq/pluton/commit/7c144c269c84ce4593525969c2332da8a10f120b))
* styling issues. ([94e4196](https://github.com/plutonhq/pluton/commit/94e4196fbd6733817c26e3d9c5fec4134425f104))


### Build System

* bump jsign version ([8318bf7](https://github.com/plutonhq/pluton/commit/8318bf75019831f592f79df3928993ac65d27680))

## [0.2.1](https://github.com/plutonhq/pluton/compare/pluton-v0.2.0...pluton-v0.2.1) (2026-01-05)


### Bug Fixes

* build failure due to missing environment value needed for secrets. ([8f5fed9](https://github.com/plutonhq/pluton/commit/8f5fed9b57047640950e14e0bd0100d9ed0835a7))

## [0.2.0](https://github.com/plutonhq/pluton/compare/pluton-v0.1.0...pluton-v0.2.0) (2026-01-05)


### Features

* sign windows installer ([2396692](https://github.com/plutonhq/pluton/commit/239669261861aefcc943ba1f66d22b85d4205552))

## [0.1.0](https://github.com/plutonhq/pluton/compare/pluton-v0.0.9...pluton-v0.1.0) (2026-01-02)


### Features

* add ability to update backup title and description ([47a919b](https://github.com/plutonhq/pluton/commit/47a919b06eed6ee9d174ca337fb18e91826648fe))
* add description field to plans ([f905b9a](https://github.com/plutonhq/pluton/commit/f905b9a2a213cbc83918d7627de99ff87b76d07c))


### Bug Fixes

* broken data removal functionality on plan deletion. ([02cbd67](https://github.com/plutonhq/pluton/commit/02cbd67db4a5c13d9de0d595419a41b2e905acee))
* duplicate advanced storage option fields. ([00cdbaf](https://github.com/plutonhq/pluton/commit/00cdbaf816a98db1df3ac906659b00d8e021cc79))
* enhance SidePanel full width style & responsiveness ([79bf889](https://github.com/plutonhq/pluton/commit/79bf889003d45c3d21703bb1366e8dd27689806b))
* missing error messages on some input fields. ([78d8bb4](https://github.com/plutonhq/pluton/commit/78d8bb477733ad87cbae949691e02d66d0929c33))
* missing warning in Plan Creation UI for local storage with no path selection. ([95d770e](https://github.com/plutonhq/pluton/commit/95d770efa9cca5ddbef6910e043dae0ca6426261))
* notification toasts being hidden by modal backdrop ([9ac2a61](https://github.com/plutonhq/pluton/commit/9ac2a61470e47bade9ad5ddda79e5809410278f2))
* Small UI Issues ([672be6d](https://github.com/plutonhq/pluton/commit/672be6d8cf2c608697bf011cd7ef9717af4927ab))
* styling issues ([124f5fc](https://github.com/plutonhq/pluton/commit/124f5fc8dc4ed19c8d5f894c0c7847fdef597e9e))
* UI issues ([9d66d09](https://github.com/plutonhq/pluton/commit/9d66d09e5ddb0d28ecae651d73e4b74ded70401d))
* update terminology from "Snapshots" to "Backups" in Plan settings for clarity ([3dab5fa](https://github.com/plutonhq/pluton/commit/3dab5fa0a492c453aa79fc710770ed72ad7893ee))
* update UI elements and improve layout for Plan Creation. ([40ea0b0](https://github.com/plutonhq/pluton/commit/40ea0b003acc86592fbb10cf7cfa5d4c6dd26fa3))
