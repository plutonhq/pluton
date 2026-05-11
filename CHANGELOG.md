# Changelog

## [0.16.0](https://github.com/plutonhq/pluton/compare/pluton-v0.15.2...pluton-v0.16.0) (2026-05-11)


### Features

* adds file stats trend graph ([a729d58](https://github.com/plutonhq/pluton/commit/a729d58847f18e195c057ad72172074885b67a21))
* adds the ability to filter plans & persist sorting ([edb8769](https://github.com/plutonhq/pluton/commit/edb87694df71fabca6a99b4ebda95f71b4d7b856))
* adds the ability to repair repo issues from ui for some cases ([8fa84e5](https://github.com/plutonhq/pluton/commit/8fa84e51b96b5c69729c4a5ec2cacb0993ce3d71))
* adds the ability to skip first backup run on plan creation ([b588885](https://github.com/plutonhq/pluton/commit/b58888527facc1b7f8996c92cdb7f2f0f5d34465))


### Bug Fixes

* minor ui issue ([7cbe8dd](https://github.com/plutonhq/pluton/commit/7cbe8ddf9a3bf592a59038974a73c56c5dc03a1c))


### Dependencies

* bump rclone version to 1.74.1 ([37cfccf](https://github.com/plutonhq/pluton/commit/37cfccf20d6c19e6df9f4ae88d2ba105040a8124))

## [0.15.2](https://github.com/plutonhq/pluton/compare/pluton-v0.15.1...pluton-v0.15.2) (2026-05-06)


### Bug Fixes

* resolve backup error overflow on backup status hover ([c0c410d](https://github.com/plutonhq/pluton/commit/c0c410dd46b7ca5f336c1e6b70044128cc70295b))
* resolves stuck backup issue after previous backup cancellation ([4cd3217](https://github.com/plutonhq/pluton/commit/4cd3217a6642b7b8e54d580fd8a06762b17261a3))


### Dependencies

* bump rclone version ([895c1c9](https://github.com/plutonhq/pluton/commit/895c1c99ea055c79f78d2440e629e014046b3b97))

## [0.15.1](https://github.com/plutonhq/pluton/compare/pluton-v0.15.0...pluton-v0.15.1) (2026-05-04)


### Bug Fixes

* docker build was not building arm64 build ([62b61dc](https://github.com/plutonhq/pluton/commit/62b61dc2cf9cb199ad64b1de38f43a53b01c8b56))

## [0.15.0](https://github.com/plutonhq/pluton/compare/pluton-v0.14.1...pluton-v0.15.0) (2026-05-01)


### Features

* add dry run progress tracking ([e9008b1](https://github.com/plutonhq/pluton/commit/e9008b1aadecbfb26f492bc41bc7391b81a62da4))


### Bug Fixes

* backup cancel action sometimes in some cases ([113aefd](https://github.com/plutonhq/pluton/commit/113aefde9593edbc0a23e12c6b8c781cb95db210))
* don't require credentials input on re-install with data preserved on linux installation ([dee87c2](https://github.com/plutonhq/pluton/commit/dee87c24cb0d61ea7c60d3f3b993fd47e16d1cc8))
* file owner name issue on linux in File Manager ([20a155e](https://github.com/plutonhq/pluton/commit/20a155ea79350615825c795691e6bd3109cfcb01))
* missing dry run error event processing ([a64ded5](https://github.com/plutonhq/pluton/commit/a64ded595be210fadd8815d328868fb84d90ee02))
* possible memory leak issue ([f36deab](https://github.com/plutonhq/pluton/commit/f36deabe57633ffab7cb0978610476e60136819e))
* resolve source & storage field resetting issue on plan creation screen ([8946878](https://github.com/plutonhq/pluton/commit/8946878da9b7581ed033f14c4a274bf7fa9142e7))
* resolves broken device settings ([f05d704](https://github.com/plutonhq/pluton/commit/f05d704dcd8693eea2da1a8d594fb024e3c87961))
* resolves missing integrity error in plans page ([45e4407](https://github.com/plutonhq/pluton/commit/45e44078d6719322c3bfc0ae696e9c4cd6f35a67))


### Code Refactoring

* make linux installations run as a non-root pluton user ([42ad7a5](https://github.com/plutonhq/pluton/commit/42ad7a51146358f967b051d6b3b45c69cb7a568a))

## [0.14.1](https://github.com/plutonhq/pluton/compare/pluton-v0.14.0...pluton-v0.14.1) (2026-04-24)


### Bug Fixes

* incorrect cron schedule  for 12AM backup plans ([d10c022](https://github.com/plutonhq/pluton/commit/d10c02262cbf9d8eab07054695842227995d656b))
* prevent encryption setting changes after plan creation ([67cffba](https://github.com/plutonhq/pluton/commit/67cffba561e965551c06a8aee9a09bc7cd24073f))
* resolve replication frozen issue on stale lock ([5931b85](https://github.com/plutonhq/pluton/commit/5931b8579a15bf2970ef9f7033ba857985130173))
* resolves broken backup plans with disabled encryption ([342b97c](https://github.com/plutonhq/pluton/commit/342b97cbac8834d117fb6f548f678ebef30c3568))
* show missing concurrency limit message on backup now trigger ([5ecbab1](https://github.com/plutonhq/pluton/commit/5ecbab1479185ca044156e3ae6b7693a143de0ef))


### Dependencies

* bump rclone ([1123d35](https://github.com/plutonhq/pluton/commit/1123d3549601ddbc4c8eb74a3616f437d174d435))

## [0.14.0](https://github.com/plutonhq/pluton/compare/pluton-v0.13.1...pluton-v0.14.0) (2026-04-21)


### Miscellaneous Chores

* release 0.14.0 ([7bb3b62](https://github.com/plutonhq/pluton/commit/7bb3b6212865fb4ef98f99c3f3347ba8ae8e5bd5))


### Code Refactoring

* migrate from keychain usage for desktop installations ([fb1da3b](https://github.com/plutonhq/pluton/commit/fb1da3bfaaab24e87393a13e0f9dffa09dde4f08))

## [0.13.1](https://github.com/plutonhq/pluton/compare/pluton-v0.13.0...pluton-v0.13.1) (2026-04-18)


### Bug Fixes

* resolves plans in db and cron schedule drifting issue ([88ff487](https://github.com/plutonhq/pluton/commit/88ff487d4503a8e8e19e8d3eeea60872496461d7)), closes [#69](https://github.com/plutonhq/pluton/issues/69)
* resolves wrong duration & position of active backup in health bar ([0723a76](https://github.com/plutonhq/pluton/commit/0723a7692140c3b77a919f45106e4d939aec039a)), closes [#61](https://github.com/plutonhq/pluton/issues/61)

## [0.13.0](https://github.com/plutonhq/pluton/compare/pluton-v0.12.0...pluton-v0.13.0) (2026-04-17)


### Features

* adds the ability to run backups every x minutes ([fe69eed](https://github.com/plutonhq/pluton/commit/fe69eed5bb4e1014138c875b20a3335c367afed8))


### Bug Fixes

* minor ui issues ([8b6645b](https://github.com/plutonhq/pluton/commit/8b6645bd5d40ae927e824b09f01186f0c731088e))
* resolves broken global tasks ([2519fff](https://github.com/plutonhq/pluton/commit/2519fffe3b1cbd67ad512754f10e79c20a5b73f2))
* resolves broken password-reset functionality ([22a57f1](https://github.com/plutonhq/pluton/commit/22a57f1f14c6c6d9ee98808f7d71826657c41c49))
* resolves buggy interval labels in various places ([a9cd1af](https://github.com/plutonhq/pluton/commit/a9cd1af263402477bde881f877fd32c21cf02d5a))
* resolves duplicate prune option ([8bbeaf7](https://github.com/plutonhq/pluton/commit/8bbeaf7442fb4ae90da54cf15e5aadb4efb610de))
* resolves inability to edit the sync source while creating sync plans ([4ab31e0](https://github.com/plutonhq/pluton/commit/4ab31e081ba32e09fa33d7be88845a9d85efbae5))
* resolves incorrect backup count display issue ([ff81a5a](https://github.com/plutonhq/pluton/commit/ff81a5aa658acf45a98b1a33157c89706c224cf2))
* resolves incorrect duration value in plan stats for pending backups ([f8b0f69](https://github.com/plutonhq/pluton/commit/f8b0f6903ab66cc8c84257a580a590cf42882393)), closes [#61](https://github.com/plutonhq/pluton/issues/61)
* resolves incorrect sync source stats on failed syncs. ([d7b2155](https://github.com/plutonhq/pluton/commit/d7b2155c5d46ca1752b909e1508778085d192263))
* resolves missing app url on windows installer setup ([a38cd18](https://github.com/plutonhq/pluton/commit/a38cd182f869891778e0aef661565f5918932c0d))
* resolves not respecting the remove data policy on plan removal ([3f49c42](https://github.com/plutonhq/pluton/commit/3f49c42713b303d3a2717450e23912cecd09cc11))
* resolves various mobile ui issues ([54b01ed](https://github.com/plutonhq/pluton/commit/54b01edd55af842764204bb0b14a414bc998f1dc))


### Miscellaneous Chores

* release 0.13.0 ([d8b2379](https://github.com/plutonhq/pluton/commit/d8b237923f1410816b539aeabab4432935ca66da))

## [0.12.0](https://github.com/plutonhq/pluton/compare/pluton-v0.11.0...pluton-v0.12.0) (2026-04-11)


### Features

* enhance pruning mechanism. Thanks [@akleber](https://github.com/akleber) ([663d101](https://github.com/plutonhq/pluton/commit/663d10172c0977f8ed44a45f6410b868dc9e0cb5)), closes [#53](https://github.com/plutonhq/pluton/issues/53)


### Bug Fixes

* resolves missing log for failed repo unlocks ([ecef6aa](https://github.com/plutonhq/pluton/commit/ecef6aa881dd227c351c7b26ce0693eecd12fc72))
* resolves stuck backup issues caused by failed dry run ([189356b](https://github.com/plutonhq/pluton/commit/189356b512e93fa53bd21394672cfa2dcda58894))

## [0.11.0](https://github.com/plutonhq/pluton/compare/pluton-v0.10.0...pluton-v0.11.0) (2026-04-09)


### Features

* adds the ability to browse snapshot files ([d8313af](https://github.com/plutonhq/pluton/commit/d8313af6f2debd8100826348dc2688ef63f35b4c))


### Bug Fixes

* resolves broken proton drive connectivity for account with 2fa enabled. ([efff40a](https://github.com/plutonhq/pluton/commit/efff40a8c88f86c0eb54d2ce5fd304bbf334377e))
* resolves broken sync backups in pro ([977c8cf](https://github.com/plutonhq/pluton/commit/977c8cfe9c75a0d661e25600816cb8db6942ee39))
* resolves forever loading issue when sync now button was clicked ([6d5d3f6](https://github.com/plutonhq/pluton/commit/6d5d3f6feeff98c5f7d8d5294aca4042d9664f4e))
* resolves unnecessary logging ([e6806cb](https://github.com/plutonhq/pluton/commit/e6806cb03fc2d386b4ad5f546549c23384593973))

## [0.10.0](https://github.com/plutonhq/pluton/compare/pluton-v0.9.0...pluton-v0.10.0) (2026-04-06)


### Features

* adds the ability to get push notifications on backup events via ntfy ([27d81d2](https://github.com/plutonhq/pluton/commit/27d81d2cc9156ea2c74e88af3b880cf4e5aad037))


### Bug Fixes

* resolves incorrect timeout issue for user scripts ([bcc7054](https://github.com/plutonhq/pluton/commit/bcc70546e8511c75f04bf06b172b2fb3aa2dfce7)), closes [#45](https://github.com/plutonhq/pluton/issues/45)
* resolves missing sign_accept_encoding option in s3 storages. ([75f4363](https://github.com/plutonhq/pluton/commit/75f4363e273a6358c50341143fee396c0da206f0))
* resolves Proton Drive connectivity issue ([cd5ec6a](https://github.com/plutonhq/pluton/commit/cd5ec6a5e5853aad95886ace6e91f607615377c4))
* resolves storage auth options appearing twice while editing storage ([73e8d67](https://github.com/plutonhq/pluton/commit/73e8d67e7f47c4f45fe2d590ae9d6da6c5018e27))
* resolves various storage connectivity issues ([6232b9c](https://github.com/plutonhq/pluton/commit/6232b9c4ea76f3c41a61c164495fbbccc4482041))

## [0.9.0](https://github.com/plutonhq/pluton/compare/pluton-v0.8.0...pluton-v0.9.0) (2026-04-05)


### Features

* adds discord and slack notification methods ([bdbf85d](https://github.com/plutonhq/pluton/commit/bdbf85dbb4798053df01d6702f416e05758ecef9))
* adds the ability to create S3 Compatible storage ([7e93171](https://github.com/plutonhq/pluton/commit/7e93171fb5b0bb6fb860305ca7437a1011edb28c))


### Bug Fixes

* Minor Ui adjustments ([2645f16](https://github.com/plutonhq/pluton/commit/2645f16c17a388d893c256a367a23af986de0cd4))
* resolves broken linux AppImage download link ([bfe90a1](https://github.com/plutonhq/pluton/commit/bfe90a14f7a656d27e69233c21bb4279f14a9dab))
* resolves incorrect prune policy label issue ([4a6ee46](https://github.com/plutonhq/pluton/commit/4a6ee461a57cd7639c1a5e8b310dd1fdfdcb23cf))
* resolves JottaCloud connectivity issue ([644ded8](https://github.com/plutonhq/pluton/commit/644ded83a0bd7165075a5219b4ea02a88a0b3333))
* resolves missing drives in file manager on Windows 11 ([8a100de](https://github.com/plutonhq/pluton/commit/8a100de827d627b243baf2893a998b0440718fd7))
* resolves stale app settings after validating SMTP ([aaf08f2](https://github.com/plutonhq/pluton/commit/aaf08f20579587672be5292b8cf813bbca8e021b))

## [0.8.0](https://github.com/plutonhq/pluton/compare/pluton-v0.7.4...pluton-v0.8.0) (2026-04-03)


### Features

* adds the ability to connect various drives directly without external rclone ([253c659](https://github.com/plutonhq/pluton/commit/253c659af549048f229834dbfdeb4bddbd565ed9))


### Bug Fixes

* resolves Koofr storage connectivity issue ([9991568](https://github.com/plutonhq/pluton/commit/99915683097111de91a8cd16489ee9936c1158fa))
* resolves server installation issue ([15c10b9](https://github.com/plutonhq/pluton/commit/15c10b95fd59344ea1f60de83f24faf21c939be9)), closes [#37](https://github.com/plutonhq/pluton/issues/37)

## [0.7.4](https://github.com/plutonhq/pluton/compare/pluton-v0.7.3...pluton-v0.7.4) (2026-04-02)


### Bug Fixes

* resolves various storage connectivity issue ([4eedb11](https://github.com/plutonhq/pluton/commit/4eedb11f79970b07d7191c280e47131a8bac9dc8))
* resolves window close issue on removing a storage ([d2fb005](https://github.com/plutonhq/pluton/commit/d2fb0056dc2ddaf6fca974f22c223a7b3a9ebfbe))

## [0.7.3](https://github.com/plutonhq/pluton/compare/pluton-v0.7.2...pluton-v0.7.3) (2026-04-01)


### Bug Fixes

* resolves blank screens issue when a docker instance is accessed with non-https url ([063a898](https://github.com/plutonhq/pluton/commit/063a8987e408be8596b55c08ed8071d46bc555fe))

## [0.7.2](https://github.com/plutonhq/pluton/compare/pluton-v0.7.1...pluton-v0.7.2) (2026-04-01)


### Bug Fixes

* resolves incorrect password field types in Storage Auth settings ([d2ac938](https://github.com/plutonhq/pluton/commit/d2ac93802f873adc203dd63e72ece373ffd2b34d))
* resolves missing WebDav Server URL field ([1e231ec](https://github.com/plutonhq/pluton/commit/1e231ec713bcbeb2bcdb8c7242540dc46f990fe1))

## [0.7.1](https://github.com/plutonhq/pluton/compare/pluton-v0.7.0...pluton-v0.7.1) (2026-04-01)


### Bug Fixes

* resolves blank screens issue when a docker instance is accessed with non-https url ([a395f2d](https://github.com/plutonhq/pluton/commit/a395f2d29e4e18fc4bdab27c640771cc54a1971f))
* various storage integration issues ([044a0d0](https://github.com/plutonhq/pluton/commit/044a0d0074967f515fc628af3b875acd42a1c1e6))


### Dependencies

* rclone version bump ([f947d6e](https://github.com/plutonhq/pluton/commit/f947d6e529c2986c3ab78049f86d9cca513a95ac))

## [0.7.0](https://github.com/plutonhq/pluton/compare/pluton-v0.6.0...pluton-v0.7.0) (2026-03-31)


### Features

* adds the ability to check Backup Integrity ([165999b](https://github.com/plutonhq/pluton/commit/165999b1bd3f840ae91aa09c9e43e967148111d2))
* adds Two Factor Authentication ([ef9aaf6](https://github.com/plutonhq/pluton/commit/ef9aaf6f643933d9778c0d3cdcc82c7627077f88))
* adds version update notice in footer ([6c0b5ad](https://github.com/plutonhq/pluton/commit/6c0b5ad6cbead2dc40186f35760da4bfb1d521e0))


### Bug Fixes

* library build issue ([216db73](https://github.com/plutonhq/pluton/commit/216db73188baaa9de43275407eea808812d9a2b7))
* remove confusing non-existent sync and rescue feature from the ui ([a1115e6](https://github.com/plutonhq/pluton/commit/a1115e622259265f88a269383f4746d4a051fe6c))

## [0.6.0](https://github.com/plutonhq/pluton/compare/pluton-v0.5.4...pluton-v0.6.0) (2026-03-15)


### Features

* add backup replication feature ([95fe103](https://github.com/plutonhq/pluton/commit/95fe1030a3a5e6261af8db0b4a2bfc6532290803))


### Bug Fixes

* resolves app crash on backup progress parsing ([962d11b](https://github.com/plutonhq/pluton/commit/962d11bf48fe49fe5a476e1d278677d93b344421))
* resolves auto logout issue ([a58f05c](https://github.com/plutonhq/pluton/commit/a58f05c9b70cd2e92b7aa18bad86d29fe5f4f13e))
* resolves broken local storage path for remote machines ([221e571](https://github.com/plutonhq/pluton/commit/221e571cb88fcd1e70f2d7c4ec57c94098cd31c9))
* resolves broken redirect on login page ([1ef076a](https://github.com/plutonhq/pluton/commit/1ef076a41d46ec00ddfe397e7ffc7b3c4399a7a0))
* resolves broken smtp input fields ([b9c05ea](https://github.com/plutonhq/pluton/commit/b9c05ea4518478673a7f5d673086e1fb28011ab1))
* resolves frontend rate-limit error due to frequent pending setup check ([6194d4e](https://github.com/plutonhq/pluton/commit/6194d4e2b5080936f669b79d5dd61aa184ec73eb))
* resolves incorrect serving of cached frontend on new release ([61fc5f8](https://github.com/plutonhq/pluton/commit/61fc5f81bdac4ce6a8b72af84787ae41c1e07e81))
* resolves missing empty storage warning on plan creation ([9a310fd](https://github.com/plutonhq/pluton/commit/9a310fde72d0e1f74aa2578b398273bab12dd944))
* resolves sensitive data logging vulnerability ([30f5b54](https://github.com/plutonhq/pluton/commit/30f5b54b3a54e28ec364d079f04176af8eb4f0a8))


### Dependencies

* rclone version bump ([2dd3598](https://github.com/plutonhq/pluton/commit/2dd3598c98d1a417d57e6757f360f13c6c68d3b7))

## [0.5.4](https://github.com/plutonhq/pluton/compare/pluton-v0.5.3...pluton-v0.5.4) (2026-03-03)


### Bug Fixes

* resolves macOS restore/download issue ([6ba8083](https://github.com/plutonhq/pluton/commit/6ba808376d9f7c7da0903408621fd85154969162))
* resolves minor UI issues ([28ae173](https://github.com/plutonhq/pluton/commit/28ae173a95e4970162c076b7eb780651316762e9))

## [0.5.3](https://github.com/plutonhq/pluton/compare/pluton-v0.5.2...pluton-v0.5.3) (2026-02-22)


### Bug Fixes

* resolves insufficient memory issue . ([0c29177](https://github.com/plutonhq/pluton/commit/0c29177923f7f1bcf5e8f979803586279cf7f522))
* resolves macos keychain issue on install ([1df22be](https://github.com/plutonhq/pluton/commit/1df22be37d83865c42b6f0a6aaf13413d225a764))

## [0.5.2](https://github.com/plutonhq/pluton/compare/pluton-v0.5.1...pluton-v0.5.2) (2026-02-22)


### Bug Fixes

* resolves macOS build issue. ([2b5f9e6](https://github.com/plutonhq/pluton/commit/2b5f9e614eec04a373c74f9c5ef314e24944b1e8))

## [0.5.1](https://github.com/plutonhq/pluton/compare/pluton-v0.5.0...pluton-v0.5.1) (2026-02-22)


### Bug Fixes

* adds missing macOS build. ([342a33c](https://github.com/plutonhq/pluton/commit/342a33c94b60ad1c6afa0e57ef8e5d0f7ee62638))

## [0.5.0](https://github.com/plutonhq/pluton/compare/pluton-v0.4.0...pluton-v0.5.0) (2026-02-21)


### Features

* adds password hashing for harden security ([fed43a2](https://github.com/plutonhq/pluton/commit/fed43a2fe3c7f063a514da11789a409cdba9a53f))
* adds password reset mechanism ([780ced1](https://github.com/plutonhq/pluton/commit/780ced1e9a761cbb4d86ef69c41391a058ba5e21))


### Bug Fixes

* broken ALLOW_FILE_BROWSER config ([ca01522](https://github.com/plutonhq/pluton/commit/ca015222a198cfc1037321b986d577ebf7c2e7c0))
* missing content security policy ([bbb1f2d](https://github.com/plutonhq/pluton/commit/bbb1f2d61df7a23d359d6a077faf0ce68fc048dd))
* Missing device update input validation ([bb9b40a](https://github.com/plutonhq/pluton/commit/bb9b40a16849c4d91307d0dab7c827d816d65154))
* missing security headers ([6e5b153](https://github.com/plutonhq/pluton/commit/6e5b1535e8439961fc1231ad6d3129f5eaef99cf))
* resolves broken global restic and rclone settings. ([42d84c0](https://github.com/plutonhq/pluton/commit/42d84c0fe8379017ab5459ab363d0263ff463af4))
* resolves malicious command execution vulnerability ([2e0fb5f](https://github.com/plutonhq/pluton/commit/2e0fb5fe7e47a5fa623df9fd632fd5a90bfc4102))
* resolves rate limiting issue in the frontend ([efd1af0](https://github.com/plutonhq/pluton/commit/efd1af04affd3288646c3d17e6d3717c850ff1aa))
* various security issues. ([9d96362](https://github.com/plutonhq/pluton/commit/9d96362653a7249b0d45093512ae7f8a77764b92))


### Code Refactoring

* request singing method of agent/server communication ([e7ed295](https://github.com/plutonhq/pluton/commit/e7ed29546d793261bb91fc4c3582ec45f88953dd))

## [0.4.0](https://github.com/plutonhq/pluton/compare/pluton-v0.3.1...pluton-v0.4.0) (2026-02-15)


### Features

* add new remote storage integrations ([fd12166](https://github.com/plutonhq/pluton/commit/fd121665b6558f5aceb89ee262616105ec1f3be7))


### Bug Fixes

* ambiguous storage field labels. ([e3413e8](https://github.com/plutonhq/pluton/commit/e3413e8ecf9aeb79e588f6eb0337a8f3d4f95edb))
* minor ui issues. ([2f90765](https://github.com/plutonhq/pluton/commit/2f90765523938ff0f66b5d5a3e0bba4c5f0bc499))


### Code Refactoring

* remote storage selection ui in storage creation ui. ([a123951](https://github.com/plutonhq/pluton/commit/a1239518f1120c53017179670d5bd127f878f219))

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
