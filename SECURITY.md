# Security policy

Talia handles Bitcoin vaults, so we take reports seriously and thank everyone
who makes one.

## Reporting a vulnerability

Report it privately through GitHub: open this repository's **Security** tab and
choose **Report a vulnerability**. Only the maintainers see the report, and we
answer there.

Please do not open a public issue, pull request or discussion for a
vulnerability, and do not post details anywhere else until a fix has shipped.

A useful report says:

- which build you used (App Store, TestFlight, or a build of your own and its
  flags), the iPhone and iOS version, and the commit if you built it;
- what an attacker can do, and what they need first (a stolen phone, a network
  position, a malicious file or QR code, a compromised server);
- the steps to reproduce it, on Testnet4 where coins are involved.

Never send a seed phrase or a private key, yours or anyone's. Use test vaults.

## In scope

- The app's code in this repository: descriptor and PSBT handling, the wallet
  engine and its Swift bridge, the hardware signing flows (Ledger, BitBox,
  Passport), backups and invites (`src/crypto/`), storage of secrets and sealed
  records, the app lock, link handling (`talia://`, `tiam://`), and how the app
  talks to chain servers and other services.
- Anything that could make a phone show a wrong address or amount, sign or send
  something other than what the owner approved, leak a vault's keys, addresses
  or history to a party the owner did not choose, or lose access to coins.
- The build and release tooling here (`scripts/`, `native/`), where it could let
  a build ship code other than the reviewed source.

## Out of scope here

- The native libraries' own code: report those to their repositories,
  [talia-bdk-ffi](https://github.com/21st-Capital/talia-bdk-ffi) and
  [talia-bitbox-ffi](https://github.com/21st-Capital/talia-bitbox-ffi), through
  the same GitHub form. If you are not sure which repository a problem belongs
  to, report it here.
- Bugs in third-party projects the app uses (React Native, BDK upstream, device
  firmware): report them to those projects. Tell us too if Talia is affected.
- 21st Capital's website and backend: report them here through the same form
  and we will pass them on.
- Attacks that need an unlocked phone in the attacker's hands with the app open,
  denial of service against public servers, and missing hardening with no
  attack behind it.

## What happens next

We confirm a report, work on a fix in the private development repository, and
publish it with the next release of the app; this repository is refreshed with
every App Store release. We are happy to credit you in the release notes if you
wish.
