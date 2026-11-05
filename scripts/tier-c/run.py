#!/usr/bin/env python3
"""Tier C, the simulator harness (BDK upgrade, decided 2026-10-15): the app's REAL
Swift bridge and TypeScript engine, in the iOS SIMULATOR, against regtest bitcoind + electrs.

    scripts/tier-c/run.py --udid <simulator> --app <KeelWallet.app built with TALIA_HARNESS=1
                          TALIA_FULL=1> --fork-checkout <talia-3 checkout> --fork-repo <fork repo>
                          --new-ref <new side's ref> --old-ref <0.28 side's ref>
                          --work <scratch folder> --electrs <electrs binary> [--only a,b] [--testnet4]

Its report goes to scripts/tier-c/out/ (ignored by git) unless --out names another folder.

For maintainers only. It needs the library fork's private equivalence harness (the tier D runner
and corpus under talia-golden/, and its bdk 0.28 side), passed as --fork-checkout and --fork-repo.
The public library forks do not carry that harness, so this cannot run from a public clone; the
unit tests (npx jest) are what anyone can run. bitcoind (and electrs, given as --electrs) must be
installed; bitcoind is taken from PATH.

What runs:
- bitcoind -regtest (the first one on PATH) and electrs 0.12.0 built with cargo from its crates.io
  release (decided 2026-10-15), as tier D runs them (the fork's talia-golden/v3/tier-d/run.py, imported
  read only: its Node, Electrs, Chain, scenarios and comparisons);
- tier D's 20 scenarios, the new side through the APP (the tier C runner, src/harness/tierC.ts,
  answering tier D's own op protocol through BdkWalletEngineV3 and TaliaBdkWalletModule), the
  0.28 side tier D's own (talia_tier_d_028.rs, the harness's 0.28 branch), so tier D's comparisons hold the app
  against bdk 0.28 and the coverage rule (decided 2026-10-17) is proven where it lives, in the bridge;
- specials: the known-answer test, the TLS cases (a self-signed certificate refused with the
  domain checked and accepted on a LAN server with it unchecked, and a handshake signed with
  another key refused even unchecked), a real Rust panic and the wallet recreated, the network
  rules (decided 2026-10-18: a server's refusal read as its answer, a broadcast to the server
  handed in and never the last sync's, a silent server given up on by the native call itself the
  Testnet4 way, the engine's own sync after a panic asking the vault's servers then), the kept
  connection, the rescue's signed PSBT through broadcastRescue (finished by the engine's own
  library, another destination refused before anything is sent, the server handed in asked), a
  real speed-up of a waiting rescue, the address check's timing on Hermes, a Testnet4 smoke test through the app's built-in servers in
  its order, and the recording of the contract fixture
  (src/bitcoin/engine/__tests__/fixtures/bdkWalletBridgeCalls.json).
- Until the old engine's removal (decided 2026-11-04) the app also linked the old engine
  (bdk 0.28 behind the bdk-ffi 0.30 fork), and the `pair` builds, the build matrix, the shadow
  checks and the reorganisations between two syncs ran on BOTH app engines and compared them
  (timing.py timed them side by side). They went with the old engine, and with them checks that
  were not comparisons: the build matrix held the new engine alone to bitcoind (every spendable
  shape on every path, rescues included, finished and accepted by testmempoolaccept, rate-mode
  builds at or above ceil(rate x vsize), a Speed up and a Cancel of a real mempool original), and
  the reorg suite held its heights, block times and the kept connection's chainMoved to bitcoind's
  best chain. That coverage of the one engine left is lost until the matrix and the reorg suite
  are rebuilt on the new engine alone (a step of its own). Tier D's scenarios above still hold
  the app's engine against bdk 0.28 (the harness's 0.28 side, in Rust).
- the app's backend settings come from its own chain-server rule (scripts/tier-c/app_backend.cjs
  over wallet/chainServers.ts).

Writes <out>/report.txt (and the fixture with --record). Exit 1 on any failure, 0 otherwise (since
the decisions of 2026-10-17 nothing waits for a decision). Test keys only.
Python standard library only. Never touches a phone.
"""
import argparse
import base64
import collections
import importlib.util
import json
import math
import os
import re
import shutil
import socket
import subprocess
import sys
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
APP_ROOT = os.path.dirname(os.path.dirname(HERE))
BUNDLE = 'com.twentyfirstcapital.keel'

FAILS = []
NOTES = []
def log(*a):
    print(*a, flush=True)


def sh(cmd, **kw):
    return subprocess.run(cmd, check=True, capture_output=True, text=True, **kw).stdout


def load_tierd(fork_checkout):
    path = os.path.join(fork_checkout, 'talia-golden', 'v3', 'tier-d', 'run.py')
    spec = importlib.util.spec_from_file_location('tierd', path)
    rd = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(rd)
    return rd


# ---------------------------------------------------------------- the app in the simulator

class App:
    """The tier C runner in the simulator: jobs in, results out, through the app container."""

    def __init__(self, udid, app_path):
        self.udid = udid
        sh(['xcrun', 'simctl', 'bootstatus', udid, '-b'])
        subprocess.run(['xcrun', 'simctl', 'terminate', udid, BUNDLE], capture_output=True)
        sh(['xcrun', 'simctl', 'install', udid, app_path])
        container = sh(['xcrun', 'simctl', 'get_app_container', udid, BUNDLE, 'data']).strip()
        self.dir = os.path.join(container, 'Documents', 'tierc')
        shutil.rmtree(self.dir, ignore_errors=True)
        os.makedirs(self.dir, exist_ok=True)
        sh(['xcrun', 'simctl', 'launch', udid, BUNDLE])
        ready = os.path.join(self.dir, 'ready.json')
        t0 = time.time()
        while not os.path.exists(ready):
            if time.time() - t0 > 120:
                raise SystemExit('the tier C runner never started (is this a TALIA_HARNESS build?)')
            time.sleep(0.3)
        info = json.load(open(ready))
        if not info.get('native'):
            raise SystemExit('the tier C runner has no new library')
        self.n = 0
        log('tier C runner ready:', info)

    def submit(self, job):
        self.n += 1
        tmp = os.path.join(self.dir, f'{self.n}.job.tmp')
        with open(tmp, 'w') as f:
            json.dump(job, f)
        os.rename(tmp, os.path.join(self.dir, f'{self.n}.job.json'))
        return self.n

    def out_path(self, n):
        return os.path.join(self.dir, f'{n}.out.json')

    def wait(self, n, timeout=3600):
        p = self.out_path(n)
        t0 = time.time()
        while not os.path.exists(p):
            if time.time() - t0 > timeout:
                raise SystemExit(f'tier C job {n} never finished')
            time.sleep(0.2)
        data = json.load(open(p))
        if 'error' in data:
            raise SystemExit(f'tier C job {n} failed: {data["error"]}')
        return data['ok']

    def run(self, job, timeout=3600):
        return self.wait(self.submit(job), timeout)


class Engines:
    """tier D's Engines, the new side in the app (the keys mode stays tier D's Rust new side)."""

    def __init__(self, rust, app):
        self.rust, self.app = rust, app

    def start(self, side, job):
        if side == 'old' or job.get('mode') == 'keys':
            return ('rust', self.rust.start(side, job))
        return ('app', self.app.submit(dict(job, kind='tierd')))

    def finish(self, kind, handle):
        if kind == 'rust':
            return self.rust.finish(*handle)
        return self.app.wait(handle)

    def both(self, job, barrier=None):
        old_p, old_op = self.rust.start('old', job)
        n = self.app.submit(dict(job, kind='tierd'))
        new_op = self.app.out_path(n)
        for name in [o['name'] for o in job['ops'] if o['op'] == 'barrier']:
            for marker in (f'{old_op}.{name}.reached', f'{new_op}.{name}.reached'):
                t0 = time.time()
                while not os.path.exists(marker):
                    if old_p.poll() is not None and marker.startswith(old_op):
                        raise SystemExit(f'0.28 engine stopped before barrier {name}')
                    if time.time() - t0 > 900:
                        raise SystemExit(f'barrier {name} never reached ({marker})')
                    time.sleep(0.2)
            barrier(name)
            for op in (old_op, new_op):
                open(f'{op}.{name}.go', 'w').close()
        return {'old': self.rust.finish(old_p, old_op), 'new': self.app.wait(n)}


# ---------------------------------------------------------------- the new Rust side, for keys only

def build_new_rust(rd, fork_repo, ref, work):
    """tier D's Rust new side (keys mode: the test vaults' descriptors), from `ref` by git archive."""
    tree = os.path.join(work, 'new-fork')
    sha = sh(['git', '-C', fork_repo, 'rev-parse', ref]).strip()
    stamp = os.path.join(tree, '.ref')
    if not (os.path.exists(stamp) and open(stamp).read() == sha):
        shutil.rmtree(tree, ignore_errors=True)
        os.makedirs(tree)
        arch = subprocess.run(['git', '-C', fork_repo, 'archive', sha, 'rust-toolchain.toml', '.cargo', 'bdk-ffi'],
                              check=True, capture_output=True).stdout
        subprocess.run(['tar', '-x', '-C', tree], input=arch, check=True)
        with open(stamp, 'w') as f:
            f.write(sha)
    return rd.cargo_test_binary(os.path.join(tree, 'bdk-ffi'),
                                ['--locked', '--features', 'talia-golden', '--test', 'talia_tier_d']), sha


# ---------------------------------------------------------------- the golden corpus

# The golden corpus's shapes (talia-golden/v3/out/corpus.txt), read for the address check's
# timing below. Until the old engine's removal (decided 2026-11-04) the build matrix took every
# spendable shape of it through BOTH app engines, compared them, and held the new engine's builds
# to bitcoind; it went with the old engine, and its bitcoind checks of the new one with it.

def read_corpus(path):
    import re
    shapes, cur = [], None
    for line in open(path):
        line = line.rstrip('\n')
        if line.startswith('## '):
            cur = {'name': line[3:], 'keys': [], 'paths': [], 'spendable': False, 'int': None}
            shapes.append(cur)
        elif cur is None:
            continue
        elif line.startswith('spendable '):
            cur['spendable'] = line.split()[1] == 'true'
        elif line.startswith('external '):
            cur['ext'] = line[len('external '):]
        elif line.startswith('internal '):
            v = line[len('internal '):]
            cur['int'] = None if v == 'none' else v
        elif line.startswith('key '):
            _, name, fp, expr = line.split(' ', 3)
            cur['keys'].append({'name': name, 'fp': fp, 'expr': expr})
        elif line.startswith('path '):
            m = re.match(r'path (\S+) branch=(\S+) older=(\S+) after=(\S+) plans=(.*)$', line)
            num = lambda t: None if t == 'None' else int(t[len('Some('):-1])
            cur['paths'].append({'name': m[1], 'branch': None if m[2] == 'none' else m[2], 'older': num(m[3]),
                                 'after': num(m[4]), 'plans': json.loads(m[5])})
    return shapes


# ---------------------------------------------------------------- specials

def special_suite(chain, app, backend, fork_checkout, work):
    out = app.run({'kind': 'special', 'name': 'knownAnswer'})
    r = out.get('result') or {}
    (NOTES if r.get('passed') else FAILS).append(f'known-answer test: {out}')

    # TLS: a front for electrs with the fork's test certificate, signing with its key or another.
    tls = os.path.join(fork_checkout, 'bdk-ffi', 'src', 'tests', 'tls')
    proxy = build_proxy(work)
    good = subprocess.Popen([proxy, '50111', f'{tls}/server-cert.pem', f'{tls}/server-key.pem', '127.0.0.1:60401'],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    bad = subprocess.Popen([proxy, '50112', f'{tls}/server-cert.pem', f'{tls}/other-key.pem', '127.0.0.1:60401'],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    # Both fronts listening before the first case (a fixed second was not always enough:
    # every case was refused at the door, 2026-10-20, while the later sync through them worked).
    wait_listening([50111, 50112], [good, bad])
    try:
        cases = [
            {'label': 'LAN server, self-signed, validateDomain false', 'url': 'ssl://127.0.0.1:50111', 'validateDomain': False},
            {'label': 'bad certificate (self-signed), validateDomain true', 'url': 'ssl://localhost:50111', 'validateDomain': True},
            {'label': 'handshake signed with another key, validateDomain false', 'url': 'ssl://127.0.0.1:50112', 'validateDomain': False},
            {'label': 'plain tcp control', 'url': 'tcp://127.0.0.1:60401', 'validateDomain': True},
        ]
        out = app.run({'kind': 'special', 'name': 'tls', 'cases': cases})
        expect = [('ok', None), ('refused', 'certificate'), ('refused', 'signature'), ('ok', None)]
        for row, (want, word) in zip(out['cases'], expect):
            v3 = row['v3']
            got = 'ok' if 'height' in v3 else 'refused'
            fine = got == want and (word is None or word in v3.get('error', '').lower())
            (NOTES if fine else FAILS).append(f'TLS {row["label"]}: {v3}')
        # The same LAN front through a sync of a real vault (the full Electrum protocol over TLS).
        v = chain.keys['tlsv']
        chain.pay([(chain.addr('tlsv', 'external', 0), 40_000)])
        lan = {'type': 'electrum', 'url': 'ssl://127.0.0.1:50111', 'validateDomain': False, 'retry': 2, 'timeout': 10}
        res = app.run({'kind': 'tierd', 'network': 'regtest', 'backend': lan, 'ext': v['ext'], 'int': v['int'],
                       'ops': [{'op': 'sync'}, {'op': 'state', 'probes': []}]})
        coins = res[1]['result'].get('coins', []) if 'result' in res[1] else []
        (NOTES if len(coins) == 1 else FAILS).append(f'TLS LAN sync of a vault: {res[0]["result"]}, coins {len(coins)}')
        res = app.run({'kind': 'tierd', 'network': 'regtest', 'backend': dict(lan, url='ssl://127.0.0.1:50112'),
                       'ext': v['ext'], 'int': v['int'], 'ops': [{'op': 'sync'}]})
        r0 = res[0]['result']
        (NOTES if 'error' in r0 and 'signature' in r0['error'].lower() else FAILS).append(
            f'TLS sync through a handshake signed with another key: {r0}')
    finally:
        good.terminate()
        bad.terminate()

    # A real Rust panic, and the wallet recreated.
    v = chain.keys['panic']
    chain.pay([(chain.addr('panic', 'external', 0), 70_000)])
    out = app.run({'kind': 'special', 'name': 'panic', 'vault': {'ext': v['ext'], 'int': v['int'], 'network': 'regtest',
                                                                'backend': backend, 'to': chain.addr('panic', 'external', 1)}})
    # The recreated wallet answers nothing that needs the chain until it synced again (decided
    # 2026-10-17): the engine forgets its tip and its next read syncs first and gives
    # the balance; after a panic around the engine every such call of the bridge is
    # WALLET_RESYNCING, a peek still answers, and the engine's next read syncs and asks again.
    total = out['before'].get('total')
    resync = out.get('bridgeAfterPanic', {})
    ok = (out['panic'].get('code') == 'RUST_PANIC' and out.get('tipAfterPanic') is None
          and out['afterPanic'].get('total') == total and out.get('tipAfterRead') is not None
          and out.get('panic2', {}).get('code') == 'RUST_PANIC'
          and resync and all(c == 'WALLET_RESYNCING' for c in resync.values())
          and out.get('peekAfterPanic') == 3
          and out.get('afterBridgePanic', {}).get('total') == total
          and out['afterSync'].get('total') == total)
    (NOTES if ok else FAILS).append(f'panic recovery: {json.dumps(out)}')

    # A copy the finalizer refuses comes back exactly as it went in.
    v = chain.keys['finv']
    chain.pay([(chain.addr('finv', 'external', 0), 90_000)])
    out = app.run({'kind': 'special', 'name': 'finalizeRefused', 'vault': {
        'ext': v['ext'], 'int': v['int'], 'network': 'regtest', 'backend': backend,
        'to': node_foreign(chain)}})
    ok = out.get('finalized') is False and out.get('error') and out.get('unchanged') is True and out.get('derivationsBack') is False
    (NOTES if ok else FAILS).append(f'finalize refused (no non_witness_utxo, no derivations): {json.dumps(out)}')

    # RBF off where the engine read an older() the library does not find.
    v = chain.keys['rbfv']
    chain.pay([(chain.addr('rbfv', 'external', 0), 90_000)])
    out = app.run({'kind': 'special', 'name': 'rbfOffWithoutCsv', 'vault': {
        'ext': v['ext'], 'int': v['int'], 'network': 'regtest', 'backend': backend,
        'to': node_foreign(chain)}})
    ok = all(out.get(k, {}).get('sequences') == [0xFFFFFFFE] for k in ('csv-claimed', 'plain'))
    (NOTES if ok else FAILS).append(f'RBF off without a CSV the engine expected: {json.dumps(out)}')

    # The network rules (decided 2026-10-18) and the rescue's reading of a lost answer
    # (2026-10-19): a server's refusal, a dead server right after a sync with the live one, a silent
    # server asked the Testnet4 way, and the engine's own sync after a panic.
    network_rules(chain, app, backend)

    # The new engine's kept connection (decided 2026-10-25).
    kept_connection(chain, app, backend)

    # The rescue's signed PSBT through broadcastRescue (decided 2026-10-20).
    rescue_broadcast(chain, app, backend)

    # A real speed-up of a waiting rescue (decided 2026-10-31).
    rescue_speed_up(chain, app, backend)

    # The address check on Hermes, one derivation per pause.
    shapes = [s for s in read_corpus(os.path.join(fork_checkout, 'talia-golden', 'v3', 'out', 'corpus.txt'))
              if s['name'] in TIMING_SHAPES]
    out = app.run({'kind': 'special', 'name': 'addressCheckTiming',
                   'shapes': [{'name': s['name'], 'ext': s['ext'], 'int': s['int']} for s in shapes]})
    for r in out['shapes']:
        if not r.get('covered'):
            FAILS.append(f'address check timing: {r["name"]} is not covered by scure')
            continue
        line = (f'address check on Hermes, {r["name"]}: the old single block {r["oneBlockMs"]} ms; now '
                f'{r["pieces"]} pieces (making the two derivers {r.get("makeMs")} ms), the longest '
                f'{r["longestPieceMs"]} ms, {r["totalMs"]} ms in all')
        (NOTES if r['longestPieceMs'] < r['oneBlockMs'] else FAILS).append(line)


def wait_listening(ports, procs, timeout=30):
    """Until every port accepts a connection on 127.0.0.1; a front that exited stops the run."""
    t0 = time.time()
    for port in ports:
        while True:
            for p in procs:
                if p.poll() is not None:
                    raise SystemExit(f'a TLS front exited ({p.args[1]}) before it listened')
            try:
                socket.create_connection(('127.0.0.1', port), timeout=1).close()
                break
            except OSError:
                if time.time() - t0 > timeout:
                    raise SystemExit(f'the TLS front on {port} is not listening after {timeout} s')
                time.sleep(0.1)


def node_foreign(chain):
    return chain.node.rpc('getnewaddress', wallet='funder')


class SilentServer:
    """A TCP server that accepts every connection and never says a word (the server that keeps a
    native call until the client gives up by itself)."""

    def __init__(self):
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.sock.bind(('127.0.0.1', 0))
        self.sock.listen(32)
        self.port = self.sock.getsockname()[1]
        self.conns = []
        threading.Thread(target=self._accept, daemon=True).start()

    def _accept(self):
        while True:
            try:
                conn, _ = self.sock.accept()
            except OSError:
                return
            self.conns.append(conn)

    def close(self):
        self.sock.close()
        for c in self.conns:
            c.close()


def free_port():
    """A port nobody listens on (bound, then let go)."""
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.bind(('127.0.0.1', 0))
    port = s.getsockname()[1]
    s.close()
    return port


def network_rules(chain, app, backend):
    v = chain.keys['netv']
    chain.pay([(chain.addr('netv', 'external', 0), 50_000)])
    node = chain.node
    # A transaction the server refuses: it spends a coin that does not exist.
    raw = node.rpc('createrawtransaction', [{'txid': '11' * 32, 'vout': 0}], [{node_foreign(chain): 0.0001}])
    txid = node.rpc('decoderawtransaction', raw)['txid']
    silent = SilentServer()
    try:
        out = app.run({'kind': 'special', 'name': 'networkRules',
                       'vault': {'ext': v['ext'], 'int': v['int'], 'network': 'regtest'}, 'backend': backend,
                       'dead': f'tcp://127.0.0.1:{free_port()}', 'silent': f'tcp://127.0.0.1:{silent.port}',
                       'rawHex': raw, 'txid': txid, 'to': chain.addr('netv', 'external', 1)})
    finally:
        silent.close()
    limit = out['silentGivesUpMs'] + 3000
    for side in ('v3',):
        row = out[side]
        r = row['refused']
        words = r.get('error', '').lower()
        ok = ('error' in r and r['unreachable'] is False and r['failed'] is True and r['mayBeLost'] is False
              and 'electrum server error' in words and ('missing' in words or 'bad-txns' in words))
        (NOTES if ok else FAILS).append(f'network rules, {side}: a refusal is the server\'s answer: {json.dumps(r)}')
        d = row['deadAfterSync']
        # The new bridge marks a connection it could not open (decided 2026-10-30).
        ok = ('error' in d and d['unreachable'] is True and d['mayBeLost'] is True
              and (side != 'v3' or d['code'] == 'SERVER_UNREACHABLE'))
        (NOTES if ok else FAILS).append(f'network rules, {side}: a broadcast to a dead server right after a sync with the live one '
                                        f'never goes through the live one: {json.dumps(d)}')
        for k in ('silentSync', 'silentBroadcast'):
            x = row[k]
            ok = 'error' in x and x['unreachable'] is True and x['ms'] <= limit
            (NOTES if ok else FAILS).append(f'network rules, {side}: {k} on a silent server, the Testnet4 way (no second try, 8 s): '
                                            f'gave up by itself in {x.get("ms")} ms (at most {limit}): {json.dumps(x)}')
    rs = out['resync']
    ok = (rs.get('panic1') == 'RUST_PANIC' and rs.get('panic2') == 'RUST_PANIC'
          and rs['readWithOnlyADeadServer'].get('unreachable') is True
          and 'answered' in rs['readWithTheLiveServer'] and rs['readWithTheLiveServer']['answered'].get('total') == 50_000
          and rs['readWithNoServer'].get('code') == 'WALLET_RESYNCING')
    (NOTES if ok else FAILS).append(f'network rules, the new engine\'s own sync after a panic asks the vault\'s servers then: {json.dumps(rs)}')


def rescue_broadcast(chain, app, backend):
    """The rescue's signed-PSBT path (decided 2026-10-20): 21st Capital's signer returns a signed PSBT
    for a script-path spend (every spend of a tr(NUMS, ...) vault is one) and broadcastRescue finishes
    it with the engine's own library, holds it to the rescue rule and sends it to the server handed
    in. The engine spends a coin of its own; the host signs (not finalized) and says whether the
    network has the transaction after each step. (Until the old engine's removal, decided
    2026-11-04, the old engine spent a second coin the same way.)"""
    v = chain.keys['rescv']
    node = chain.node
    values = {'v3': 70_000}
    chain.pay([(chain.addr('rescv', 'external', 1), values['v3'])])
    to = node_foreign(chain)
    to_script = node.rpc('getaddressinfo', to, wallet='funder')['scriptPubKey']
    w = chain.signer('rescv')
    n = app.submit({'kind': 'special', 'name': 'rescueBroadcast',
                    'vault': {'ext': v['ext'], 'int': v['int'], 'network': 'regtest'}, 'backend': backend,
                    'dead': f'tcp://127.0.0.1:{free_port()}', 'to': to, 'toScript': to_script, 'coinValues': values})
    out_path = app.out_path(n)
    answered = set()
    t0 = time.time()
    while not os.path.exists(out_path):
        for name in sorted(os.listdir(app.dir)):
            if not name.startswith(f'{n}.out.json.x') or not name.endswith('.ask') or name in answered:
                continue
            ask = json.load(open(os.path.join(app.dir, name)))
            kind = name.split('-', 1)[1][:-4]
            if kind == 'sign':
                answer = node.rpc('walletprocesspsbt', ask['psbt'], True, 'ALL', True, False, wallet=w)['psbt']
            elif kind == 'seen':
                try:
                    node.rpc('getmempoolentry', ask['txid'])
                    answer = True
                except Exception:
                    answer = False
            else:
                raise SystemExit(f'rescueBroadcast: unknown exchange {kind}')
            base = os.path.join(app.dir, name[:-4])
            with open(base + '.answer.tmp', 'w') as f:
                json.dump(answer, f)
            os.rename(base + '.answer.tmp', base + '.answer')
            answered.add(name)
        if time.time() - t0 > 900:
            raise SystemExit('rescueBroadcast never finished')
        time.sleep(0.2)
    out = app.wait(n)
    for side in ('v3',):
        row = out.get(side, {})
        if 'error' in row:
            FAILS.append(f'rescue broadcast, {side}: {json.dumps(row)}')
            continue
        wrong, dead, sent = row['wrongDestination'], row['deadServer'], row['sent']
        ok = (row.get('hostSigned') is True
              and wrong.get('refusal') == 'wrong-destination' and row['seenAfterRefusal'] is False
              and dead.get('unreachable') is True and row['seenAfterDead'] is False
              and sent.get('answered') == row['unsignedTxid'] and row['seenAfterSend'] is True)
        (NOTES if ok else FAILS).append(
            f'rescue broadcast, {side}: the signed PSBT finished by the engine\'s library; another destination '
            f'refused before anything was sent; a dead server handed in right after a sync with the live one '
            f'unreachable; the live server took it under the txid answered: {json.dumps(row)}')


def rescue_key_alone(chain, vault, fingerprint):
    """A signer of `vault` that holds its rescue key and no other, as 21st Capital's signer does:
    the public descriptors with that one key private. Returns the signer wallet's name."""
    v = chain.keys[vault]

    def only(public, private):
        if not public:
            return None
        pairs = zip(re.findall(r'\[([0-9a-f]{8})[^\]]*\]([A-Za-z0-9]+)', public),
                    re.findall(r'\[([0-9a-f]{8})[^\]]*\]([A-Za-z0-9]+)', private))
        for (fp, xpub), (_fp, xprv) in pairs:
            if fp == fingerprint:
                public = public.replace(xpub, xprv)
        return public

    name = f'{vault}-rescue-key'
    chain.keys[name] = dict(v, ext_private=only(v['ext'], v['ext_private']), int_private=only(v['int'], v['int_private']))
    return chain.signer(name)


def rescue_speed_up(chain, app, backend):
    """A real rescue and its speed-up on the app's engine (decided 2026-10-31): the rescue path of
    older(12), the rescue key alone signing, the coins spent by the waiting rescue rebuilt through
    the app's own route, and the network taking the replacement in its place."""
    v = chain.keys['spdv']
    node = chain.node
    fingerprint = v['fingerprints'][4]
    older = 12
    values = {'v3': [71_000, 31_000]}
    chain.pay([(chain.addr('spdv', 'external', i), sats) for i, sats in enumerate(values['v3'])])
    chain.mine(older)
    to = node_foreign(chain)
    to_script = node.rpc('getaddressinfo', to, wallet='funder')['scriptPubKey']
    w = rescue_key_alone(chain, 'spdv', fingerprint)
    n = app.submit({'kind': 'special', 'name': 'rescueSpeedUp',
                    'vault': {'ext': v['ext'], 'int': v['int'], 'network': 'regtest'}, 'backend': backend,
                    'to': to, 'toScript': to_script, 'older': older, 'rescueFp': fingerprint, 'coinValues': values})
    out_path = app.out_path(n)
    answered = set()
    t0 = time.time()

    def in_mempool(txid):
        try:
            node.rpc('getmempoolentry', txid)
            return True
        except Exception:  # noqa: BLE001
            return False

    while not os.path.exists(out_path):
        for name in sorted(os.listdir(app.dir)):
            if not name.startswith(f'{n}.out.json.x') or not name.endswith('.ask') or name in answered:
                continue
            ask = json.load(open(os.path.join(app.dir, name)))
            kind = name.split('-', 1)[1][:-4]
            if kind == 'sign':
                answer = node.rpc('walletprocesspsbt', ask['psbt'], True, 'ALL', True, False, wallet=w)['psbt']
            elif kind == 'indexed':
                chain.electrs.wait_mempool(node, to, ask['txid'])
                answer = True
            elif kind == 'seen':
                answer = in_mempool(ask['txid'])
            elif kind == 'mine':
                chain.mine(1)
                answer = True
            else:
                raise SystemExit(f'rescueSpeedUp: unknown exchange {kind}')
            base = os.path.join(app.dir, name[:-4])
            with open(base + '.answer.tmp', 'w') as f:
                json.dump(answer, f)
            os.rename(base + '.answer.tmp', base + '.answer')
            answered.add(name)
        if time.time() - t0 > 900:
            raise SystemExit('rescueSpeedUp never finished')
        time.sleep(0.2)
    out = app.wait(n)
    for side in ('v3',):
        row = out.get(side, {})
        if 'error' in row:
            FAILS.append(f'rescue speed-up, {side}: {json.dumps(row)}')
            continue
        locks = {'version': 2, 'lockTime': row['speedUpLocks'].get('lockTime'), 'sequences': [older, older]}
        ok = (row['firstLocks'].get('version') == 2 and row['firstLocks'].get('sequences') == [older, older]
              and row['coinsListedWhileWaiting'] == 0 and row['state'] == 'waiting'
              and row['speedUpLocks'] == locks and row['speedUpCoins'] == row['firstCoins']
              and row['speedUpFee'] > row['origFee'] and row['speedUpFee'] == row['shownFee']
              and row['refusedWithoutTheCoins'].get('built') is not True
              and row['firstStillThere'] is False and row['replacementThere'] is True
              and row['afterABlock'] == 'confirmed')
        # The new library takes a spent coin only when the build names what spends it.
        if side == 'v3' and row['withoutNamingIt'].get('code') != 'UNKNOWN_UTXO':
            ok = False
        (NOTES if ok else FAILS).append(
            f'rescue speed-up, {side}: the coins no longer listed while it waits; rebuilt over them with the same '
            f'coins, one output, version 2, nSequence {older} on each; the network took it in the rescue\'s place '
            f'and a block confirmed it: {json.dumps(row)}')


def coverage_steps(rd, chain, eng, backend):
    """The coverage rule's loop until no keychain is short (decided 2026-10-17): six coins
    stepping between the keychains, each found only by the coverage pass the one before made
    necessary (external 100, internal 240, external 380, internal 520, external 660, internal
    800). The bridge used to stop after four extra passes and miss internal 800."""
    vault = 'cov'
    pays = [('external', 100, 41_000), ('internal', 240, 42_000), ('external', 380, 43_000),
            ('internal', 520, 44_000), ('external', 660, 45_000), ('internal', 800, 46_000)]
    probes = [(kc, i) for kc, i, _ in pays] + [('external', 950), ('internal', 950)]
    res = rd.scenario_sync(chain, eng, backend, 'coverage_steps', vault, pays, probes)
    sync = res['new'][0]['result']
    coins = res['new'][1]['result'].get('coins', [])
    old_coins = res['old'][1]['result'].get('coins', [])
    line = (f'coverage steps: the new engine found {len(coins)} of 6 stepping coins in {sync.get("passes")} passes '
            f'(0.28 found {len(old_coins)})')
    (NOTES if len(coins) == 6 and (sync.get('passes') or 0) > 5 else FAILS).append(line)


# ---------------------------------------------------------------- the kept connection

def proxy_counts(path):
    """Per connection of an rtproxy.py log that asked anything: requests by method."""
    by = collections.defaultdict(collections.Counter)
    if os.path.exists(path):
        for line in open(path):
            r = json.loads(line)
            if r.get('dir') == 'ask':
                by[r['conn']].update(r['methods'])
    return {conn: dict(c) for conn, c in sorted(by.items())}


def kept_connection(chain, app, backend):
    """The new engine keeps a vault's connection between its syncs (decided 2026-10-25). A later
    sync on the kept connection fetches no transaction and no proof again (the library's client
    holds them); a kept connection the server closed in between gives way to ONE new connection
    under Testnet4's rules (retry 0: electrum-client does not reconnect by itself), and under the
    app's regtest rules (retry 2) electrum-client reconnects inside the same client, its caches kept. Every
    coin is there either way. Counted through rtproxy.py, which is restarted (its connections
    closed) between the second and the third sync."""
    v = chain.keys['keptv']
    for i, value in enumerate([41_000, 42_000, 43_000]):
        chain.pay([(chain.addr('keptv', 'external', i), value)])
    for tag, label, rules in (('t', "Testnet4's rules (retry 0)", {'retry': 0, 'timeout': 8}),
                              ('r', f"the app's regtest rules (retry {backend.get('retry')})", {})):
        log_path = os.path.join(app.dir, f'kept-{tag}-{int(time.time())}.jsonl')
        port = free_port()

        def start(name):
            p = subprocess.Popen([sys.executable, '-I', os.path.join(HERE, 'rtproxy.py'), '--listen', f'{port}={name}',
                                  '--upstream', '127.0.0.1:60401', '--log', log_path],
                                 stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            wait_listening([port], [p])
            return p
        front = start(f'{tag}a')
        try:
            ops = [{'op': 'sync'}, {'op': 'sync'}, {'op': 'barrier', 'name': 'restart'}, {'op': 'sync'},
                   {'op': 'state', 'probes': []}]
            n = app.submit({'kind': 'tierd', 'network': 'regtest', 'ext': v['ext'], 'int': v['int'], 'ops': ops,
                            'backend': dict(backend, url=f'tcp://127.0.0.1:{port}', **rules)})
            reached = f'{app.out_path(n)}.restart.reached'
            t0 = time.time()
            while not os.path.exists(reached):
                if time.time() - t0 > 900:
                    raise SystemExit('kept connection: never reached its barrier')
                time.sleep(0.2)
            front.terminate()
            front.wait(timeout=10)
            front = start(f'{tag}b')
            open(f'{app.out_path(n)}.restart.go', 'w').close()
            out = app.wait(n)
        finally:
            if front.poll() is None:
                front.terminate()
                front.wait(timeout=10)
        syncs = [r['result'] for r in out if r['op'] == 'sync']
        state = next((r['result'] for r in out if r['op'] == 'state'), {})
        conns = proxy_counts(log_path)
        tx = {c: m.get('blockchain.transaction.get', 0) for c, m in conns.items()}
        merkle = {c: m.get('blockchain.transaction.get_merkle', 0) for c, m in conns.items()}
        before = [c for c in conns if c.startswith(f'{tag}a')]
        after = [c for c in conns if c.startswith(f'{tag}b')]
        reused = [x.get('reused') for x in syncs]
        coins = len(state.get('coins', []))
        ok = (all('error' not in x for x in syncs) and coins == 3 and len(before) == 1 and len(after) == 1
              and tx[before[0]] > 0)
        if tag == 't':
            # A new connection for the third sync: it fetched what the first did, and the second sync
            # added nothing to the first connection.
            ok = ok and reused == [False, True, False] and tx[after[0]] == tx[before[0]]
        else:
            # electrum-client reconnected inside the kept client: nothing fetched again.
            ok = ok and reused == [False, True, True] and tx[after[0]] == 0 and merkle[after[0]] == 0
        (NOTES if ok else FAILS).append(
            f'kept connection, {label}: reused {reused}, ms {[x.get("ms") for x in syncs]}, transactions fetched per '
            f'connection {tx}, proofs {merkle}, coins {coins} of 3')


def build_proxy(work):
    target = os.path.join(work, 'tls-proxy-target')
    sh(['cargo', 'build', '--release', '--offline', '--locked', '--manifest-path',
        os.path.join(HERE, 'tls-proxy', 'Cargo.toml'), '--target-dir', target])
    return os.path.join(target, 'release', 'talia-tierc-tls-proxy')


# ---------------------------------------------------------------- the contract recording

def record_protocol(chain, app, backend, fixture):
    node = chain.node
    keys = chain.keys
    for vault in ('proto1', 'proto2'):
        chain.pay([(chain.addr(vault, 'external', i), 50_000 + 1_000 * i) for i in range(3)])
    chain.pay([(chain.addr('proto1', 'internal', 0), 41_000)])
    p1, p2, p3 = keys['proto1'], keys['proto2'], keys['proto3']
    vaults = {
        'backend': backend,
        'single': {'ext': p1['ext'], 'int': p1['int']},
        'layered': {'ext': p2['ext'], 'int': p2['int'], 'rescueFp': p2['fingerprints'][4]},
        'signet': {'ext': p3['ext'], 'int': p3['int']},
        'foreign': node.rpc('getnewaddress', wallet='funder'),
        'mainnet': 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu',
    }
    n = app.submit({'kind': 'special', 'name': 'protocol', 'vaults': vaults})
    out_path = app.out_path(n)
    answered = set()
    t0 = time.time()
    while not os.path.exists(out_path):
        for name in sorted(os.listdir(app.dir)):
            if not name.startswith(f'{n}.out.json.x') or not name.endswith('.ask') or name in answered:
                continue
            ask = json.load(open(os.path.join(app.dir, name)))
            kind = name.split('-', 1)[1][:-4]
            if kind == 'sign':
                answer = node.rpc('walletprocesspsbt', ask['psbt'], True, 'ALL', True, False, wallet=chain.signer('proto1'))['psbt']
            elif kind == 'mine':
                chain.electrs.wait_mempool(node, vaults['foreign'], ask['txid'])
                chain.mine(1)
                answer = True
            elif kind == 'raw':
                w = chain.signer('proto1')
                change = chain.addr('proto1', 'internal', 5)
                funded = node.rpc('walletcreatefundedpsbt', [], [{vaults['foreign']: 0.0001}], 0,
                                  {'changeAddress': change, 'add_inputs': True}, wallet=w)['psbt']
                done = node.rpc('walletprocesspsbt', funded, True, 'ALL', True, True, wallet=w)
                fin = node.rpc('finalizepsbt', done['psbt'], True)
                tx = node.rpc('decoderawtransaction', fin['hex'])
                answer = {'hex': fin['hex'], 'unsignedTxid': tx['txid']}
            else:
                raise SystemExit(f'protocol: unknown exchange {kind}')
            base = os.path.join(app.dir, name[:-4])
            with open(base + '.answer.tmp', 'w') as f:
                json.dump(answer, f)
            os.rename(base + '.answer.tmp', base + '.answer')
            answered.add(name)
        if time.time() - t0 > 900:
            raise SystemExit('protocol recording never finished')
        time.sleep(0.2)
    out = app.wait(n)
    entries = out['log']
    calls = sorted({e['call'] for e in entries if 'call' in e})
    with open(fixture, 'w') as f:
        json.dump({'vaults': vaults, 'log': entries}, f, indent=1)
        f.write('\n')
    NOTES.append(f'contract recording: {len(entries)} entries, native calls used: {", ".join(calls)}')
    for e in entries:
        if 'step' in e:
            NOTES.append(f'  step {e["step"]}: {json.dumps(e.get("result", e.get("error")))[:160]}')


# ---------------------------------------------------------------- main

TIER_C_VAULTS = {'tlsv': 'wpkh', 'panic': 'wpkh', 'proto1': 'wpkh', 'proto2': 'tr-layered', 'proto3': 'wsh-2of3',
                 'finv': 'wsh-2of3', 'rbfv': 'wpkh', 'cov': 'wsh-2of3', 'netv': 'wpkh', 'rescv': 'tr-layered',
                 'spdv': 'tr-layered', 'keptv': 'tr-layered'}

# The address check's timing on Hermes: the heaviest shapes Talia composes, and two plain ones.
TIMING_SHAPES = ['c-layered-tr-ms21c-L6', 'c-layered-wsh-ms-L6', 'c-multi-tr-3of5-21c', 'c-multi-wsh-2of3', 'c-single-wpkh']


def testnet4_smoke(eng, servers, keys):
    """The Testnet4 smoke test, the way a Testnet4 vault syncs (decided 2026-10-18): the
    built-in servers in the app's order, each with its own setting, the next one only when one
    fails. The new engine syncs an empty test vault (read only) and must land on Testnet4's chain.
    A server that failed before another answered is a note; none answering is a failure."""
    v = keys['gap21']
    for backend in servers:
        j = {'network': 'testnet', 'backend': backend, 'ext': v['ext'], 'int': v['int'],
             'ops': [{'op': 'sync'}, {'op': 'state', 'probes': []}]}
        try:
            r = eng.finish(*eng.start('new', j))[0]['result']
        except SystemExit as e:
            r = {'error': str(e)}
        if 'error' in r:
            NOTES.append(f'testnet4 smoke: {backend["url"]} failed ({r["error"][:160]}); the next built-in server is asked')
            continue
        NOTES.append(f'testnet4 smoke: synced to tip {r["tip"]} in {r["ms"]} ms from {backend["url"]} '
                     f'(retry {backend.get("retry")}, timeout {backend.get("timeout")} s)')
        return r['tip']
    FAILS.append('testnet4 smoke: none of the built-in Testnet4 servers answered')
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--udid', required=True)
    ap.add_argument('--app', required=True)
    ap.add_argument('--fork-checkout', required=True)
    ap.add_argument('--fork-repo', required=True)
    ap.add_argument('--new-ref', required=True, help="the fork's ref for tier D's new Rust side")
    ap.add_argument('--old-ref', required=True, help="the fork's ref for tier D's bdk 0.28 side")
    ap.add_argument('--work', required=True)
    ap.add_argument('--electrs', required=True)
    ap.add_argument('--out', default=os.path.join(HERE, 'out'))
    ap.add_argument('--only', help='tier D scenarios (comma separated); none: all')
    ap.add_argument('--skip', default='', help='suites to skip: tierd,coverage,special,protocol,speedup (with special skipped, speedup still runs unless skipped too)')
    ap.add_argument('--record', action='store_true', help='write the contract fixture')
    ap.add_argument('--testnet4', action='store_true')
    args = ap.parse_args()
    if shutil.which('bitcoind') is None:
        sys.exit('bitcoind is not on PATH: install Bitcoin Core and put its bin folder on PATH.')
    skip = set(filter(None, args.skip.split(',')))
    # The tree as the run starts (a recording writes the fixture into it later).
    commit = sh(['git', '-C', APP_ROOT, 'rev-parse', 'HEAD']).strip()
    dirty = sh(['git', '-C', APP_ROOT, 'status', '--porcelain']).strip()
    os.makedirs(args.work, exist_ok=True)
    os.makedirs(args.out, exist_ok=True)

    rd = load_tierd(args.fork_checkout)
    rd.WORK = args.work
    rd.ELECTRS = args.electrs
    # The app's own backend settings, from this checkout: its chain-server rule
    # (wallet/chainServers.ts, decided 2026-10-18), read by tier C's own app_backend.cjs (tier D's
    # app_backend.mjs reproduced the old backendFor, which the rule replaced).
    settings = json.loads(sh(['node', os.path.join(HERE, 'app_backend.cjs'), APP_ROOT, args.work]))
    backend = settings['regtest']
    log('app backend settings (this checkout):', json.dumps(backend))

    log('building tier D\'s new Rust side (keys only) from', args.new_ref)
    new_exe, new_sha = build_new_rust(rd, args.fork_repo, args.new_ref, args.work)
    log('building tier D\'s 0.28 side from', args.old_ref)
    rd.ROOT = args.fork_repo
    old_exe, old_sha = rd.build_old(args.old_ref)
    base = os.path.join(args.work, f'run-{int(time.time())}')
    os.makedirs(base)
    rust = rd.Engines(new_exe, old_exe, base)
    vaults = dict(rd.VAULTS, **TIER_C_VAULTS)
    keys = rust.finish(*rust.start('new', {'mode': 'keys', 'vaults': [{'name': k, 'kind': v} for k, v in vaults.items()]}))

    app = App(args.udid, args.app)
    eng = Engines(rust, app)
    node = rd.Node(base)
    node.rpc('createwallet', 'funder')
    node.rpc('generatetoaddress', 200, node.rpc('getnewaddress', wallet='funder'))
    electrs = rd.Electrs(base, node)
    started = time.time()
    names = []
    try:
        electrs.wait_tip(node, timeout=300)
        chain = rd.Chain(node, electrs, keys)
        if 'tierd' not in skip:
            names = args.only.split(',') if args.only else list(rd.SCENARIOS)
            for name in names:
                log('tier D scenario through the app:', name)
                t0 = time.time()
                rd.SCENARIOS[name](chain, eng, backend)
                log(f'  {time.time() - t0:.1f}s, failures so far {len(rd.FAILS)}')
        if 'coverage' not in skip:
            log('coverage steps (the coverage rule)')
            coverage_steps(rd, chain, eng, backend)
        if 'special' not in skip:
            log('specials')
            special_suite(chain, app, backend, args.fork_checkout, args.work)
        elif 'speedup' not in skip:
            log('a rescue and its speed-up')
            rescue_speed_up(chain, app, backend)
        if args.testnet4:
            tip = testnet4_smoke(eng, settings['testnet_all'], keys)
            log('testnet4 smoke through the app:', tip)
        if args.record and 'protocol' not in skip:
            log('recording the contract fixture')
            record_protocol(chain, app, backend, os.path.join(APP_ROOT, 'src', 'bitcoin', 'engine', '__tests__', 'fixtures',
                                                              'bdkWalletBridgeCalls.json'))
    finally:
        electrs.stop()
        node.stop()
    fails = rd.FAILS + FAILS
    report = []
    p = report.append
    p('# Tier C: the app\'s real bridge and engine in the iOS simulator, against regtest bitcoind + electrs')
    p('')
    p(f'app commit: {commit}{" with uncommitted changes" if dirty else ", clean"} as the run started '
      f'(the harness app must be built from it: TALIA_HARNESS=1 TALIA_FULL=1 scripts/ios-sim.sh <sim> Release)')
    p(f'new library: the app\'s recorded bdkwallet (native/native-libs.sha256); tier D keys from {args.new_ref} = {new_sha}')
    p(f'0.28 side (tier D scenarios): {args.old_ref} = {old_sha}')
    p(f'bitcoind: {sh(["bitcoind", "--version"]).splitlines()[0]}')
    p(f'app backend settings: {json.dumps(backend)}')
    p(f'tier D scenarios: {", ".join(names) or "skipped"} ({time.time() - started:.0f} s in all)')
    p('')
    p(f'## Failures: {len(fails)}')
    for x in fails:
        p(f'  {x}')
    p('')
    p(f'## New engine sees more (tier D, reported): {len(rd.MORE)}')
    for x in rd.MORE:
        p(f'  {x}')
    p('')
    p(f'## Notes: {len(rd.NOTES) + len(NOTES)}')
    for x in rd.NOTES + NOTES:
        p(f'  {x}')
    p('')
    p(f'## What each engine saw at each compared sync (tier D): {len(rd.SEEN)}')
    for x in rd.SEEN:
        p(f'  {x}')
    text = '\n'.join(report) + '\n'
    with open(os.path.join(args.out, 'report.txt'), 'w') as f:
        f.write(text)
    print(text[:20000])
    return 1 if fails else 0


if __name__ == '__main__':
    sys.exit(main())
