# Changelog

## [0.3.0](https://github.com/plutonhq/pluton/compare/pluton-v0.2.1...pluton-v0.3.0) (2026-01-05)


### Features

* add ability to update backup title and description ([47a919b](https://github.com/plutonhq/pluton/commit/47a919b06eed6ee9d174ca337fb18e91826648fe))
* add description field to plans ([f905b9a](https://github.com/plutonhq/pluton/commit/f905b9a2a213cbc83918d7627de99ff87b76d07c))
* add desktop shortcut on install. ([291b15f](https://github.com/plutonhq/pluton/commit/291b15f198c96da9bf69c6dd6c186ce91ba00dfd))
* add headless linux install mechanism ([eb4bae3](https://github.com/plutonhq/pluton/commit/eb4bae38f3a7f7b3d0847bce804d480c5c14f860))
* add Linux Desktop OS Binary Installer creator. ([e2e2027](https://github.com/plutonhq/pluton/commit/e2e2027fdfc480dca4220035dbd38f97f5ba0b38))
* add OS specific built-in key manager for sensitive values on binary installations. ([ba05abb](https://github.com/plutonhq/pluton/commit/ba05abbab7598dfd6cf0bda646868f731bbf7168))
* add windows installer update mechanism. ([89ae883](https://github.com/plutonhq/pluton/commit/89ae88375198ce49785d03c23c4c81595e051187))
* Convert binaries to bytecode first for performance. ([2b70d59](https://github.com/plutonhq/pluton/commit/2b70d591302e2c85f709fb54996c9adefe556e44))
* Executable Binary builder and compatibility ([aea413f](https://github.com/plutonhq/pluton/commit/aea413f789381b2b0c3bf54d092fc125136bf34e))
* initial release setup ([d89e6a0](https://github.com/plutonhq/pluton/commit/d89e6a0a68126e0c5969544960e79aa814b24a2a))
* Secret and API key input made optional and auto generated. ([7f9db81](https://github.com/plutonhq/pluton/commit/7f9db81045686588550e54e6fbfef54255e73118))
* sign windows installer ([2396692](https://github.com/plutonhq/pluton/commit/239669261861aefcc943ba1f66d22b85d4205552))


### Bug Fixes

* broken data removal functionality on plan deletion. ([02cbd67](https://github.com/plutonhq/pluton/commit/02cbd67db4a5c13d9de0d595419a41b2e905acee))
* broken docs link ([c171491](https://github.com/plutonhq/pluton/commit/c17149141e3f1044efccdbb4e1d3090e94b790d5))
* broken license badge ([fea0832](https://github.com/plutonhq/pluton/commit/fea08320b3338dfca018427d8b9ff706903087a5))
* build failure due to missing environment value needed for secrets. ([8f5fed9](https://github.com/plutonhq/pluton/commit/8f5fed9b57047640950e14e0bd0100d9ed0835a7))
* direct css/scss imports fails for projects that depends on the frontend lib. ([4b190a5](https://github.com/plutonhq/pluton/commit/4b190a5e1ce510eb5860e4c57e1aa9650ee2c01d))
* duplicate advanced storage option fields. ([00cdbaf](https://github.com/plutonhq/pluton/commit/00cdbaf816a98db1df3ac906659b00d8e021cc79))
* duplicate backup job on plan creation. ([7d76f08](https://github.com/plutonhq/pluton/commit/7d76f088368487337f889e202e762a6ffec0943b))
* duplicate better-sqlite3.node, caching better-sqlite3 & completion with missing binary. ([3889f4f](https://github.com/plutonhq/pluton/commit/3889f4fd240f34f8440178d2aa3fecc83a602df1))
* enhance SidePanel full width style & responsiveness ([79bf889](https://github.com/plutonhq/pluton/commit/79bf889003d45c3d21703bb1366e8dd27689806b))
* failure to extract bz2 files on Windows. ([1756b58](https://github.com/plutonhq/pluton/commit/1756b582064cac25f834cd77f6d049e07522d281))
* font loading issue. ([c29bc25](https://github.com/plutonhq/pluton/commit/c29bc257a64a296f5aaaf96fb6df5b194d33f1cf))
* frontend app icons ([5ed9a33](https://github.com/plutonhq/pluton/commit/5ed9a33d57760b93dfe805ac5235d34bf88fd8f3))
* frontend library skipped necessary files. ([9c94ccc](https://github.com/plutonhq/pluton/commit/9c94ccce8eb929eb0dc9bb234e5ab5b1fc930939))
* handle possible hang or freeze with 30s timeout. ([a2b4893](https://github.com/plutonhq/pluton/commit/a2b48930357a0be413a974bf576a98900d292315))
* import path ([1a2986b](https://github.com/plutonhq/pluton/commit/1a2986b2d59ecd49e82a19df4afa8066b70a20af))
* incorrect AppImage version number. ([5508397](https://github.com/plutonhq/pluton/commit/5508397b1e279d354298f614e22b379e0c1e018b))
* incorrect use of encryption keys from env instead of config ([bc7b362](https://github.com/plutonhq/pluton/commit/bc7b362b1feb251a85843ba83b5d42747cb91e96))
* incorrect version number in Executable Installs. ([ddb2f2a](https://github.com/plutonhq/pluton/commit/ddb2f2a34a21e45e1f08d161e3b70f4393b31290))
* memory manufacturer undefined in Device ui ([5aa6dd2](https://github.com/plutonhq/pluton/commit/5aa6dd2c1da18a68c7b420b24d58f8a7b56f5a31))
* Minor UI issues. ([de587ab](https://github.com/plutonhq/pluton/commit/de587ab040d80db183ee6eed9e39c9a4d093072d))
* missing error messages on some input fields. ([78d8bb4](https://github.com/plutonhq/pluton/commit/78d8bb477733ad87cbae949691e02d66d0929c33))
* missing Initial migration ([d4cb1b4](https://github.com/plutonhq/pluton/commit/d4cb1b4c6101c8e623cbb517c7162a0859c6c38c))
* missing license in backend package.json ([2144b41](https://github.com/plutonhq/pluton/commit/2144b4177feb22318e0a93355dc7475369651203))
* missing warning in Plan Creation UI for local storage with no path selection. ([95d770e](https://github.com/plutonhq/pluton/commit/95d770efa9cca5ddbef6910e043dae0ca6426261))
* notification toasts being hidden by modal backdrop ([9ac2a61](https://github.com/plutonhq/pluton/commit/9ac2a61470e47bade9ad5ddda79e5809410278f2))
* package build  target nodejs version. ([fb549d6](https://github.com/plutonhq/pluton/commit/fb549d6aa22ad16e4d7b75d6c1477f1fba3156c3))
* rclone program path with space issue on windows and directly using env instead of config service. ([272a34a](https://github.com/plutonhq/pluton/commit/272a34adae13d3572ae09721138101718626b4c8))
* resolve frontend lib build files conflict with app build files. ([970ccec](https://github.com/plutonhq/pluton/commit/970ccece8d106c640f5e3716b0ce18b256264851))
* Small UI Issues ([672be6d](https://github.com/plutonhq/pluton/commit/672be6d8cf2c608697bf011cd7ef9717af4927ab))
* styling issues ([124f5fc](https://github.com/plutonhq/pluton/commit/124f5fc8dc4ed19c8d5f894c0c7847fdef597e9e))
* UI issues ([9d66d09](https://github.com/plutonhq/pluton/commit/9d66d09e5ddb0d28ecae651d73e4b74ded70401d))
* update terminology from "Snapshots" to "Backups" in Plan settings for clarity ([3dab5fa](https://github.com/plutonhq/pluton/commit/3dab5fa0a492c453aa79fc710770ed72ad7893ee))
* update UI elements and improve layout for Plan Creation. ([40ea0b0](https://github.com/plutonhq/pluton/commit/40ea0b003acc86592fbb10cf7cfa5d4c6dd26fa3))


### Documentation

* SECRET & APIKEY values are now auto-generated. ([4ce83d2](https://github.com/plutonhq/pluton/commit/4ce83d2288fd50c338dd6b4ffbf4050ca0a3fe9e))
* update readme with assets downloads count. ([fdb95b1](https://github.com/plutonhq/pluton/commit/fdb95b193b9be331dd6dc71932c86784362e769b))
* update readme with correct badge links ([6ad469d](https://github.com/plutonhq/pluton/commit/6ad469df71a3e99ab542e8245574ce994267ef0f))
* update readme with necessary links ([edeb3f3](https://github.com/plutonhq/pluton/commit/edeb3f3069337b22af890f7eb6aeb4a4c1bce492))


### Code Refactoring

* Build Docker image from built binaries instead of source code. ([0946da6](https://github.com/plutonhq/pluton/commit/0946da6e8057a1c805f5798e77039ba43b938468))


### Build System

* add support for platform specific builds for CI ([299a8e7](https://github.com/plutonhq/pluton/commit/299a8e759013a477a85e7b3420b899bb530f5d12))
* facilitate pro compatibility. ([d8288eb](https://github.com/plutonhq/pluton/commit/d8288eba144441114adcc83d13c704c3cbab0a5e))

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
