// Tier C's chain-backend settings, from the app's own rule (wallet/chainServers.ts
// `chainServersFor`, decided 2026-10-18), the servers a vault on each network may talk to:
//
//   node scripts/tier-c/app_backend.cjs <app checkout> <scratch folder>
//
// The tier D driver's app_backend.mjs reproduced the old `backendFor` and refuses since the
// network rules replaced it, so tier C reads the rule itself: the five source files it needs
// (bitcoin/network.ts, bitcoin/electrumTls.ts, bitcoin/engine/engineError.ts,
// wallet/chainServers.ts, wallet/withTimeout.ts) are transpiled as they are, with the checkout's
// own TypeScript, into the scratch folder and loaded there. Type-only imports vanish; nothing else
// is touched. Prints JSON:
//   regtest              a fresh install's Regtest server (the tier D scenarios' backend)
//   regtest_saved_local  a Regtest server saved by hand on this machine
//   testnet              the first built-in Testnet4 server, as a vault asks it
//   testnet_all          every built-in Testnet4 server, in the order a vault tries them
'use strict';
const fs = require('fs');
const path = require('path');

const [app, work] = process.argv.slice(2);
if (!app || !work) {
  console.error('usage: node scripts/tier-c/app_backend.cjs <app checkout> <scratch folder>');
  process.exit(64);
}
const ts = require(path.join(app, 'node_modules', 'typescript'));
const out = path.join(work, 'app-backend');
const FILES = [
  'src/bitcoin/network.ts',
  'src/bitcoin/electrumTls.ts',
  'src/bitcoin/engine/engineError.ts',
  'src/wallet/chainServers.ts',
  'src/wallet/withTimeout.ts',
];
for (const f of FILES) {
  const js = ts.transpileModule(fs.readFileSync(path.join(app, f), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: f,
  }).outputText;
  const dest = path.join(out, f.replace(/\.ts$/, '.js'));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, js);
}
const { chainServersFor } = require(path.join(out, 'src/wallet/chainServers.js'));
const none = { electrumUrls: {} };
const one = (network, settings) => {
  const servers = chainServersFor(network, settings);
  if (servers.length !== 1) throw new Error(`${network}: ${servers.length} servers, expected one`);
  return servers[0];
};
console.log(
  JSON.stringify({
    regtest: one('regtest', none),
    regtest_saved_local: one('regtest', { electrumUrls: { regtest: 'tcp://127.0.0.1:60401' } }),
    testnet: chainServersFor('testnet', none)[0],
    testnet_all: chainServersFor('testnet', none),
  }),
);
