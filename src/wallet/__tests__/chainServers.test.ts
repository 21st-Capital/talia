/**
 * Which servers a vault's data may go to (decided 2026-10-18).
 *
 * Bitcoin: "Users who use a private node from home are concerned about
 * privacy and we should never leak their vaults to any other node. Also, if
 * a user prefers a specific public node, we should never automatically fall
 * to any other public node!" Testnet4: "just have testnet vaults sync
 * automatically to public nodes? If one node is not reachable, we switch to
 * another."
 */
import {
  __forgetGoodServersForTests,
  broadcastThroughChainServers,
  broadcastWithWatchdog,
  chainServerNote,
  chainServersFor,
  chosenServer,
  NO_BITCOIN_SERVER,
  NO_TESTNET4_SERVER_ANSWERED,
  othersMayBeAsked,
  serverHold,
  serverFailed,
  serverUnreachable,
  silentServerGivesUpMs,
  syncProblemNote,
  syncThroughChainServers,
  TESTNET4_RETRY,
  TESTNET4_SYNC_ATTEMPT_MS,
  TESTNET4_TIMEOUT_S,
  SYNC_WATCHDOG_MS,
  usesBuiltInServers,
} from '../chainServers';
import { DEFAULT_ELECTRUM, defaultElectrumBackend, reportServerKey, TESTNET4_ELECTRUM_SERVERS } from '../../bitcoin/network';
import { backendFor } from '../engineProvider';
import { answerMayBeLost, notReachedWords, SERVER_NOT_REACHED } from '../broadcastAnswer';
import { EngineError, SERVER_ANSWERED } from '../../bitcoin/engine/engineError';
import { BroadcastRefusedError } from '../../bitcoin/psbt/broadcastCheck';
import { LIBRARY_CHECK_FAILED, libraryProblem, NO_WALLET_LIBRARY } from '../../bitcoin/engine/libraryProblem';
import type { BackendConfig } from '../../bitcoin/engine/types';

jest.mock('../../bitcoin', () => ({
  activeEngineFactory: () => ({}),
  fakeWalletEngineFactory: () => ({}),
}));

const HOME_NODE = 'ssl://10.0.0.20:50002';
const PICKED_PUBLIC = 'ssl://electrum.acinq.co:50002';
const RENAMED = 'ssl://mainnet.foundationdevices.com:50002';
const RETIRED = 'ssl://bitcoin.lu.ke:50002';

const saved = (bitcoin?: string, extra: Record<string, string> = {}) =>
  ({ electrumUrls: { ...(bitcoin ? { bitcoin } : {}), ...extra } }) as { electrumUrls: Record<string, string> };

/** What the operating system says when nothing answers, as bdk-rn handed it over (the old engine's bridge, until the old engine's removal); the rules read the new bridge's words the same way. */
const refused = () =>
  Object.assign(new Error('Electrum(message: "Made one or multiple attempts, all errored:\n\t- Connection refused (os error 61)\n")'), {
    code: 'BlockchainElectrum init error',
  });
/** A server that answered: the network's refusal of a transaction. */
const rejected = () =>
  Object.assign(new Error('Electrum(message: "Electrum server error: \\"min relay fee not met, 100 < 141\\"")'), {
    code: 'Broadcast transaction error',
  });

beforeEach(() => __forgetGoodServersForTests());

describe('a Bitcoin vault talks to the one server the client chose', () => {
  it('a home node, exactly as saved, and nothing else to try', () => {
    expect(chainServersFor('bitcoin', saved(HOME_NODE))).toEqual([
      expect.objectContaining({ url: HOME_NODE, validateDomain: false }),
    ]);
    expect(chainServersFor('bitcoin', saved(PICKED_PUBLIC))).toEqual([
      expect.objectContaining({ url: PICKED_PUBLIC, validateDomain: true }),
    ]);
    expect(backendFor('bitcoin', saved(HOME_NODE) as never)?.url).toBe(HOME_NODE);
  });

  it('a renamed or retired server Talia once suggested is NOT swapped for another one', () => {
    expect(chainServersFor('bitcoin', saved(RENAMED)).map((b) => b.url)).toEqual([RENAMED]);
    expect(chainServersFor('bitcoin', saved(RETIRED)).map((b) => b.url)).toEqual([RETIRED]);
    expect(backendFor('bitcoin', saved(RETIRED) as never)?.url).toBe(RETIRED);
  });

  it('with nothing saved, the default public server, as before', () => {
    expect(chainServersFor('bitcoin', saved()).map((b) => b.url)).toEqual([DEFAULT_ELECTRUM.bitcoin]);
    expect(chainServersFor('bitcoin', { electrumUrls: { bitcoin: '  ' } }).map((b) => b.url)).toEqual([
      DEFAULT_ELECTRUM.bitcoin,
    ]);
    expect(chosenServer('bitcoin', saved())).toBeNull();
  });

  it('a sync that fails there fails: no fallback to the default, no other server tried', async () => {
    const tried: string[] = [];
    await expect(
      syncThroughChainServers('bitcoin', saved(HOME_NODE), async (b) => {
        tried.push(b.url);
        throw refused();
      }),
    ).rejects.toMatchObject({ code: 'BlockchainElectrum init error' });
    expect(tried).toEqual([HOME_NODE]);
  });

  it('a broadcast that cannot reach it fails the same way, with its own error', async () => {
    const tried: string[] = [];
    await expect(
      broadcastThroughChainServers('bitcoin', saved(PICKED_PUBLIC), async (b) => {
        tried.push(b.url);
        throw refused();
      }),
    ).rejects.toThrow(/Connection refused/);
    expect(tried).toEqual([PICKED_PUBLIC]);
  });

  it('the default server, when it is the one, is not rotated either', async () => {
    const tried: string[] = [];
    await expect(
      syncThroughChainServers('bitcoin', saved(), async (b) => {
        tried.push(b.url);
        throw refused();
      }),
    ).rejects.toBeTruthy();
    expect(tried).toEqual([DEFAULT_ELECTRUM.bitcoin]);
  });

  it('a saved Testnet4 server is never a Bitcoin vault\'s, and Regtest keeps its own one', () => {
    expect(chainServersFor('bitcoin', saved(undefined, { testnet: HOME_NODE })).map((b) => b.url)).toEqual([
      DEFAULT_ELECTRUM.bitcoin,
    ]);
    expect(chainServersFor('regtest', saved(undefined, { regtest: 'tcp://127.0.0.1:60401' })).map((b) => b.url)).toEqual([
      'tcp://127.0.0.1:60401',
    ]);
  });
});

describe('a Bitcoin server held back (the client\'s own Esplora server, from before 2026-07)', () => {
  const HELD = { electrumUrls: {}, bitcoinServerHold: { reason: 'esplora' as const, host: 'umbrel.local:3006' } };

  it('means NO server, never the public default, and nothing is asked', async () => {
    expect(chainServersFor('bitcoin', HELD)).toEqual([]);
    expect(backendFor('bitcoin', HELD as never)).toBeNull();
    const run = jest.fn(async () => 1);
    await expect(syncThroughChainServers('bitcoin', HELD, run)).rejects.toThrow(NO_BITCOIN_SERVER);
    await expect(broadcastThroughChainServers('bitcoin', HELD, run)).rejects.toThrow(NO_BITCOIN_SERVER);
    expect(run).not.toHaveBeenCalled();
    expect(othersMayBeAsked('bitcoin', HELD)).toBe(false);
  });

  it('a server saved since wins, and the hold says nothing', () => {
    const saved = { ...HELD, electrumUrls: { bitcoin: HOME_NODE } };
    expect(serverHold('bitcoin', saved)).toBeNull();
    expect(chainServersFor('bitcoin', saved).map((b) => b.url)).toEqual([HOME_NODE]);
    expect(chainServerNote('bitcoin', saved, { where: 'vault' })).toBeNull();
  });

  it('holds Bitcoin alone: Testnet4 and Regtest use their own servers', () => {
    expect(serverHold('testnet', HELD)).toBeNull();
    expect(chainServersFor('testnet', HELD).map((b) => b.url)).toEqual(TESTNET4_ELECTRUM_SERVERS);
    expect(othersMayBeAsked('testnet', HELD)).toBe(true);
    expect(chainServersFor('regtest', HELD).map((b) => b.url)).toEqual([DEFAULT_ELECTRUM.regtest]);
  });

  it('the vault and Settings say so before any sync, in plain words', () => {
    expect(chainServerNote('bitcoin', HELD, { where: 'vault' })).toBe(
      'Talia can no longer use umbrel.local:3006, the server you chose, as it was set up. Enter it again in Settings → Network.',
    );
    expect(chainServerNote('bitcoin', HELD, { where: 'vault', syncFailed: true })).toBe(
      chainServerNote('bitcoin', HELD, { where: 'vault' }),
    );
    expect(chainServerNote('bitcoin', HELD, { where: 'settings' })).toBe(
      'Talia can no longer use umbrel.local:3006, the server you chose, as it was set up. Enter it again and tap Save & test.',
    );
    for (const text of [
      chainServerNote('bitcoin', HELD, { where: 'vault' })!,
      chainServerNote('bitcoin', HELD, { where: 'settings' })!,
      NO_BITCOIN_SERVER,
    ]) {
      expect(text).not.toMatch(/[—–]/);
      expect(text).not.toMatch(/fallback|electrum|esplora|backend|node/i);
    }
  });

  it('settings that could not be read hold it the same way, in words true whether or not a server was chosen', async () => {
    const unread = { electrumUrls: {}, bitcoinServerHold: { reason: 'unreadable' as const } };
    expect(chainServersFor('bitcoin', unread)).toEqual([]);
    await expect(syncThroughChainServers('bitcoin', unread, async () => 1)).rejects.toThrow(NO_BITCOIN_SERVER);
    for (const where of ['vault', 'settings'] as const) {
      const text = chainServerNote('bitcoin', unread, { where })!;
      expect(text).toMatch(/^Talia could not read its network settings/);
      expect(text).not.toMatch(/you chose|your node|[—–]/);
      expect(text).not.toMatch(/fallback|electrum|esplora|backend|node/i);
    }
  });
});

describe('the note on the vault and in Settings → Network', () => {
  it('a renamed server names its new name; a retired one says to choose another', () => {
    expect(chainServerNote('bitcoin', saved(RENAMED), { where: 'vault' })).toBe(
      'The server you chose now goes by mainnet-0.foundation.xyz. Change it in Settings → Network.',
    );
    expect(chainServerNote('bitcoin', saved(RETIRED), { where: 'vault' })).toBe(
      'The server you chose, bitcoin.lu.ke, can no longer be checked as safe. Choose another one in Settings → Network.',
    );
    expect(chainServerNote('bitcoin', saved(RENAMED), { where: 'settings' })).toBe(
      'This server now goes by mainnet-0.foundation.xyz.',
    );
    expect(chainServerNote('bitcoin', saved(RETIRED), { where: 'settings' })).toBe(
      'This server can no longer be checked as safe. Choose another one.',
    );
  });

  it('a failed sync through the chosen server says Talia uses no other', () => {
    expect(chainServerNote('bitcoin', saved(HOME_NODE), { where: 'vault', syncFailed: true })).toBe(
      'Talia could not reach 10.0.0.20, the server you chose, and uses no other. Check it in Settings → Network.',
    );
    expect(chainServerNote('bitcoin', saved(HOME_NODE), { where: 'vault' })).toBeNull();
    // Settings shows a failed test on its own status card.
    expect(chainServerNote('bitcoin', saved(HOME_NODE), { where: 'settings' })).toBeNull();
  });

  it('nothing to say with no server saved, or for a Testnet4 vault', () => {
    expect(chainServerNote('bitcoin', saved(), { where: 'vault', syncFailed: true })).toBeNull();
    expect(chainServerNote('testnet', saved(RETIRED, { testnet: RETIRED }), { where: 'vault', syncFailed: true })).toBeNull();
    expect(chainServerNote('signet', saved(), { where: 'vault', syncFailed: true })).toBeNull();
  });

  it('plain words: no em dash, no jargon', () => {
    const all = [RENAMED, RETIRED, HOME_NODE].flatMap((url) => [
      chainServerNote('bitcoin', saved(url), { where: 'vault', syncFailed: true }),
      chainServerNote('bitcoin', saved(url), { where: 'settings' }),
    ]);
    all.push(NO_TESTNET4_SERVER_ANSWERED);
    for (const text of all.filter((t): t is string => t != null)) {
      expect(text).not.toMatch(/[—–]/);
      expect(text).not.toMatch(/fallback|electrum|backend|node/i);
    }
  });
});

describe('the vault page says ONE thing about its server and its last sync (decided 2026-10-29)', () => {
  const HELD = { electrumUrls: {}, bitcoinServerHold: { reason: 'esplora' as const, host: 'umbrel.local:3006' } };
  /** What bdk-rn hands over when the server does not answer in time (a phone test, 2026-10-29). */
  const timedOut = () =>
    new Error('Electrum(message: "Electrum client error: Made one or multiple attempts, all errored:\n\t- connection timed out\n")');

  it('the chosen server not reached: the plain sentence alone, never the library text beside it', () => {
    expect(syncProblemNote('bitcoin', saved('tcp://192.0.2.10:50001'), timedOut())).toEqual({
      text: 'Talia could not reach 192.0.2.10, the server you chose, and uses no other. Check it in Settings → Network.',
      tone: 'note',
    });
    expect(syncProblemNote('bitcoin', saved(HOME_NODE), refused())?.text).toBe(
      chainServerNote('bitcoin', saved(HOME_NODE), { where: 'vault', syncFailed: true }),
    );
  });

  it('the default server not reached is named too: a failed sync is never silent', () => {
    expect(syncProblemNote('bitcoin', saved(), timedOut())).toEqual({
      text: 'Talia could not reach electrum.blockstream.info, its default server, and uses no other. Try again later, or choose another server in Settings → Network.',
      tone: 'note',
    });
  });

  it('Testnet4 with none of its servers answering says so in plain words', () => {
    expect(syncProblemNote('testnet', saved(), new Error(NO_TESTNET4_SERVER_ANSWERED))).toEqual({
      text: NO_TESTNET4_SERVER_ANSWERED,
      tone: 'note',
    });
  });

  it('Testnet4 with one server not reached, outside the list (the engine\'s own sync after a panic): plain words that claim no more than that', () => {
    for (const network of ['testnet', 'signet'] as const) {
      for (const message of ['Electrum client error: unexpected end of file', 'Electrum client error: Connection reset by peer (os error 54)']) {
        for (const e of [new EngineError('SERVER_UNREACHABLE', message), new Error(message)]) {
          const note = syncProblemNote(network, saved(), e);
          expect(note).toEqual({ text: 'Talia could not reach a Testnet4 server. Try again later.', tone: 'note' });
          expect(note?.text).not.toBe(NO_TESTNET4_SERVER_ANSWERED);
        }
      }
    }
  });

  it('a failure that is not about reaching a server keeps the library text, so it still shows', () => {
    expect(syncProblemNote('bitcoin', saved(HOME_NODE), rejected())).toEqual({
      text: `Sync failed: ${rejected().message}`,
      tone: 'error',
    });
    expect(syncProblemNote('testnet', saved(), new Error('Descriptor error'))).toEqual({
      text: 'Sync failed: Descriptor error',
      tone: 'error',
    });
  });

  it('the wallet library refusing to open the vault: its own sentence alone, as written, over any note about the server (decided 2026-11-04)', () => {
    // Decided 2026-11-04 with the old engine's removal, approved word for word.
    expect(LIBRARY_CHECK_FAILED).toBe("Talia's wallet library failed its self-check, so no vault opens. Please contact 21st Capital.");
    const settings = [saved(), saved(HOME_NODE), saved(PICKED_PUBLIC), saved(RENAMED), saved(RETIRED), HELD];
    for (const network of ['bitcoin', 'testnet', 'signet', 'regtest'] as const) {
      for (const s of settings) {
        for (const sentence of [LIBRARY_CHECK_FAILED, NO_WALLET_LIBRARY]) {
          expect(syncProblemNote(network, s, new Error(sentence))).toEqual({ text: sentence, tone: 'note' });
        }
      }
    }
    // A standing note still shows when the library is not the problem.
    expect(syncProblemNote('bitcoin', HELD, timedOut())?.text).toBe(chainServerNote('bitcoin', HELD, { where: 'vault' }));
  });

  it('libraryProblem knows the two sentences and nothing else', () => {
    expect(libraryProblem(new Error(LIBRARY_CHECK_FAILED))).toBe(LIBRARY_CHECK_FAILED);
    expect(libraryProblem(new Error(NO_WALLET_LIBRARY))).toBe(NO_WALLET_LIBRARY);
    expect(libraryProblem(LIBRARY_CHECK_FAILED)).toBe(LIBRARY_CHECK_FAILED);
    for (const e of [null, undefined, new Error(`Sync failed: ${LIBRARY_CHECK_FAILED}`), new Error('Descriptor error'), timedOut(), refused(), { message: LIBRARY_CHECK_FAILED }]) {
      expect(libraryProblem(e)).toBeNull();
    }
  });

  it('every failed sync shows a line, on every network and server', () => {
    const errors = [timedOut(), refused(), rejected(), new Error(NO_TESTNET4_SERVER_ANSWERED), new Error('anything'), 'a string'];
    const settings = [saved(), saved(HOME_NODE), saved(PICKED_PUBLIC), saved(RENAMED), saved(RETIRED), HELD];
    for (const network of ['bitcoin', 'testnet', 'signet', 'regtest'] as const) {
      for (const s of settings) {
        for (const e of errors) expect(syncProblemNote(network, s, e)?.text).toBeTruthy();
      }
    }
  });

  it('a standing note shows with or without a failed sync, and nothing shows when all is well', () => {
    expect(syncProblemNote('bitcoin', saved(RETIRED), null)?.text).toBe(chainServerNote('bitcoin', saved(RETIRED), { where: 'vault' }));
    expect(syncProblemNote('bitcoin', saved(RETIRED), timedOut())?.text).toBe(chainServerNote('bitcoin', saved(RETIRED), { where: 'vault' }));
    expect(syncProblemNote('bitcoin', HELD, new Error(NO_BITCOIN_SERVER))?.text).toBe(chainServerNote('bitcoin', HELD, { where: 'vault' }));
    expect(syncProblemNote('bitcoin', saved(HOME_NODE), null)).toBeNull();
    expect(syncProblemNote('bitcoin', saved(), null)).toBeNull();
    expect(syncProblemNote('testnet', saved(), null)).toBeNull();
  });

  it('plain words: no em dash, no jargon outside the server\'s own name', () => {
    for (const s of [saved(), saved(HOME_NODE)]) {
      const note = syncProblemNote('bitcoin', s, timedOut())!;
      const host = chainServersFor('bitcoin', s)[0].url.replace(/^[a-z]+:\/\//, '').split(':')[0];
      expect(note.text).not.toMatch(/[—–]/);
      expect(note.text.replace(host, '')).not.toMatch(/fallback|electrum|backend|node/i);
    }
  });
});

describe('a Testnet4 vault syncs through the built-in servers', () => {
  it('has no setting: a saved Testnet4 server is ignored', () => {
    expect(usesBuiltInServers('testnet')).toBe(true);
    expect(usesBuiltInServers('signet')).toBe(true);
    expect(usesBuiltInServers('bitcoin')).toBe(false);
    expect(chosenServer('testnet', saved(undefined, { testnet: HOME_NODE }))).toBeNull();
    expect(chainServersFor('testnet', saved(undefined, { testnet: HOME_NODE })).map((b) => b.url)).toEqual(
      TESTNET4_ELECTRUM_SERVERS,
    );
  });

  it('three or four verified servers, every one checked by its certificate, the old default first', () => {
    expect(TESTNET4_ELECTRUM_SERVERS.length).toBeGreaterThanOrEqual(3);
    expect(TESTNET4_ELECTRUM_SERVERS.length).toBeLessThanOrEqual(4);
    expect(TESTNET4_ELECTRUM_SERVERS[0]).toBe('ssl://blackie.c3-soft.com:57010');
    expect(DEFAULT_ELECTRUM.testnet).toBe(TESTNET4_ELECTRUM_SERVERS[0]);
    expect(new Set(TESTNET4_ELECTRUM_SERVERS).size).toBe(TESTNET4_ELECTRUM_SERVERS.length);
    for (const b of chainServersFor('testnet', saved())) {
      expect(b.url).toMatch(/^ssl:\/\/[a-z0-9.-]+:\d+$/);
      expect(b.validateDomain).toBe(true);
    }
  });

  it('tries them in order and moves on after a connection failure', async () => {
    const tried: string[] = [];
    const height = await syncThroughChainServers('testnet', saved(), async (b) => {
      tried.push(b.url);
      if (tried.length < 3) throw refused();
      return 156_912;
    });
    expect(height).toBe(156_912);
    expect(tried).toEqual(TESTNET4_ELECTRUM_SERVERS.slice(0, 3));
  });

  it('starts from the last one that answered for the rest of the session, wrapping round', async () => {
    let calls = 0;
    await syncThroughChainServers('testnet', saved(), async (b) => {
      calls += 1;
      if (b.url !== TESTNET4_ELECTRUM_SERVERS[1]) throw refused();
    });
    expect(calls).toBe(2);
    const order = chainServersFor('testnet', saved()).map((b) => b.url);
    expect(order).toEqual([
      TESTNET4_ELECTRUM_SERVERS[1],
      ...TESTNET4_ELECTRUM_SERVERS.slice(2),
      TESTNET4_ELECTRUM_SERVERS[0],
    ]);
    // A Signet vault from old data reads as Testnet4 and shares the memory.
    expect(chainServersFor('signet', saved()).map((b) => b.url)).toEqual(order);
    // The one-server questions start there too.
    expect(backendFor('testnet', saved() as never)?.url).toBe(TESTNET4_ELECTRUM_SERVERS[1]);
    // The next failure moves on from there, round to the first.
    const tried: string[] = [];
    await syncThroughChainServers('testnet', saved(), async (b) => {
      tried.push(b.url);
      if (b.url !== TESTNET4_ELECTRUM_SERVERS[0]) throw refused();
    });
    expect(tried).toEqual(order);
    expect(chainServersFor('testnet', saved())[0].url).toBe(TESTNET4_ELECTRUM_SERVERS[0]);
  });

  it('a server that answered with an error is also passed over during a sync', async () => {
    const tried: string[] = [];
    await syncThroughChainServers('testnet', saved(), async (b) => {
      tried.push(b.url);
      if (tried.length === 1) throw new Error('Sync wallet error: Electrum server error: "history too large"');
    });
    expect(tried).toEqual(TESTNET4_ELECTRUM_SERVERS.slice(0, 2));
  });

  it('says so plainly when none answered, and remembers nothing', async () => {
    const tried: string[] = [];
    await expect(
      syncThroughChainServers('testnet', saved(), async (b) => {
        tried.push(b.url);
        throw refused();
      }),
    ).rejects.toThrow(NO_TESTNET4_SERVER_ANSWERED);
    expect(tried).toEqual(TESTNET4_ELECTRUM_SERVERS);
    expect(NO_TESTNET4_SERVER_ANSWERED).toBe('None of the Testnet4 servers answered. Try again later.');
    expect(chainServersFor('testnet', saved())[0].url).toBe(TESTNET4_ELECTRUM_SERVERS[0]);
  });

  it('an error of the app\'s own comes back at once, never as "no server answered"', async () => {
    const tried: string[] = [];
    await expect(
      syncThroughChainServers('testnet', saved(), async (b) => {
        tried.push(b.url);
        throw new Error('The saved vaults have not been read yet.');
      }),
    ).rejects.toThrow('The saved vaults have not been read yet.');
    expect(tried).toHaveLength(1);
  });

  describe('a server that hangs', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('is given its share of the 90 seconds, then the next one is asked', async () => {
      expect(TESTNET4_SYNC_ATTEMPT_MS * TESTNET4_ELECTRUM_SERVERS.length).toBe(SYNC_WATCHDOG_MS);
      const tried: string[] = [];
      const done = syncThroughChainServers('testnet', saved(), (b) => {
        tried.push(b.url);
        return tried.length === 1 ? new Promise<number>(() => {}) : Promise.resolve(7);
      });
      await jest.advanceTimersByTimeAsync(TESTNET4_SYNC_ATTEMPT_MS - 1);
      expect(tried).toHaveLength(1);
      await jest.advanceTimersByTimeAsync(1);
      await expect(done).resolves.toBe(7);
      expect(tried).toEqual(TESTNET4_ELECTRUM_SERVERS.slice(0, 2));
    });

    /**
     * The wallet library's bridge runs every wallet call on ONE serial native
     * queue (TaliaBdkWalletModule.swift `walletQueue`; bdk-rn's `bdkQueue`
     * when this was found), and the watchdog giving up on a server
     * does not stop its native call: the next server's sync waits behind it
     * while its own clock runs. Modelled here: a queue that runs one job at
     * a time, a server that accepts the connection and then says nothing
     * (its call ends only when electrum-client gives up by itself, after
     * `silentServerGivesUpMs` of ITS settings), and healthy servers that
     * answer in 2 seconds.
     */
    function nativeSync(silent: string) {
      let tail: Promise<unknown> = Promise.resolve();
      const asked: string[] = [];
      const run = (b: BackendConfig): Promise<string> => {
        const job = async () => {
          asked.push(b.url);
          const stall = b.url === silent;
          await new Promise((done) => setTimeout(done, stall ? silentServerGivesUpMs(b) : 2_000));
          if (stall) throw new Error('Electrum(message: "Made one or multiple attempts, all errored:\n\t- Resource temporarily unavailable (os error 35)\n")');
          return b.url;
        };
        const p = tail.then(job, job);
        tail = p.catch(() => undefined);
        return p;
      };
      return { run, asked };
    }

    it('a silent server gives up natively inside its slot, so the next one answers (a serial native queue)', async () => {
      const [silent, next] = TESTNET4_ELECTRUM_SERVERS;
      for (const b of chainServersFor('testnet', saved())) {
        expect(b).toMatchObject({ retry: TESTNET4_RETRY, timeout: TESTNET4_TIMEOUT_S });
        // Well inside the slot, with room for the healthy server's own sync.
        expect(silentServerGivesUpMs(b)).toBeLessThanOrEqual(TESTNET4_SYNC_ATTEMPT_MS - 10_000);
      }
      const model = nativeSync(silent);
      const settled = jest.fn();
      const done = syncThroughChainServers('testnet', saved(), model.run);
      done.then(settled, settled);
      await jest.advanceTimersByTimeAsync(silentServerGivesUpMs(chainServersFor('testnet', saved())[0]) + 2_000);
      // The second server answered: the third was never needed, and it is
      // the one the next sync starts from.
      await expect(done).resolves.toBe(next);
      expect(model.asked).toEqual([silent, next]);
      expect(chainServersFor('testnet', saved())[0].url).toBe(next);
    });

    it('with the Bitcoin settings a silent server outlived its slot and starved the healthy one behind it', async () => {
      // Why Testnet4 has settings of its own: the default backend's two more
      // tries at 10 s keep a silent server's native call for over a minute.
      const bitcoinLike = defaultElectrumBackend('testnet');
      expect(silentServerGivesUpMs(bitcoinLike)).toBeGreaterThan(TESTNET4_SYNC_ATTEMPT_MS);
      const [silent, second, third] = TESTNET4_ELECTRUM_SERVERS;
      const model = nativeSync(silent);
      const done = syncThroughChainServers('testnet', saved(), (b) =>
        model.run({ ...b, retry: bitcoinLike.retry, timeout: bitcoinLike.timeout }),
      );
      const outcome = done.then((url) => url, (e: Error) => e.message);
      await jest.advanceTimersByTimeAsync(SYNC_WATCHDOG_MS + 10_000);
      // The healthy second server answered in 2 s, but only after the silent
      // call let go, by when its own 30 s were spent: it was passed over.
      expect(await outcome).not.toBe(second);
      expect([third, NO_TESTNET4_SERVER_ANSWERED]).toContain(await outcome);
    });

    it('a Bitcoin vault keeps the whole 90 seconds for its one server, and then fails', async () => {
      const done = syncThroughChainServers('bitcoin', saved(HOME_NODE), () => new Promise<number>(() => {}));
      const settled = jest.fn();
      done.then(settled, settled);
      await jest.advanceTimersByTimeAsync(SYNC_WATCHDOG_MS - 1);
      expect(settled).not.toHaveBeenCalled();
      await jest.advanceTimersByTimeAsync(1);
      await expect(done).rejects.toThrow(/Sync timed out after 90s/);
    });
  });

  it('a broadcast moves on only when a server could not be reached, never past a refusal', async () => {
    const tried: string[] = [];
    const txid = await broadcastThroughChainServers('testnet', saved(), async (b: BackendConfig) => {
      tried.push(b.url);
      if (tried.length === 1) throw refused();
      return 'ab'.repeat(32);
    });
    expect(txid).toBe('ab'.repeat(32));
    expect(tried).toEqual(TESTNET4_ELECTRUM_SERVERS.slice(0, 2));

    __forgetGoodServersForTests();
    const again: string[] = [];
    await expect(
      broadcastThroughChainServers('testnet', saved(), async (b) => {
        again.push(b.url);
        throw rejected();
      }),
    ).rejects.toThrow(/min relay fee not met/);
    expect(again).toHaveLength(1);
  });
});

describe('what counts as a server failing', () => {
  it('a connection that could not be made, the operating system\'s I/O errors, a refused certificate, a timeout', () => {
    for (const e of [
      refused(),
      new Error('Electrum(message: "Connection reset by peer (os error 54)")'),
      new Error('Electrum(message: "failed to lookup address information: nodename nor servname provided")'),
      new Error('Electrum(message: "invalid peer certificate: UnknownIssuer")'),
      new Error('Electrum(message: "Invalid domain name blackie.c3-soft.com not matching SSL certificate")'),
      new Error('Sync timed out after 30s. Check the server in Settings → Network'),
      new Error('Electrum(message: "Network is unreachable (os error 51)")'),
    ]) {
      expect(serverUnreachable(e)).toBe(true);
      expect(serverFailed(e)).toBe(true);
    }
  });

  it('a server that answered is not unreachable, though a sync still moves past its error', () => {
    expect(serverUnreachable(rejected())).toBe(false);
    expect(serverFailed(rejected())).toBe(true);
    const unreadable = new Error('Error during the deserialization of a response from the server: bad json');
    expect(serverUnreachable(unreadable)).toBe(false);
    expect(serverFailed(unreadable)).toBe(true);
  });

  it('the app\'s own checks are neither', () => {
    for (const e of [
      new Error('This is not the transaction you reviewed. Nothing was sent.'),
      new Error('Broadcasting a transaction is not available in this build.'),
      'could not be assembled for sending',
      null,
    ]) {
      expect(serverUnreachable(e)).toBe(false);
      expect(serverFailed(e)).toBe(false);
    }
  });
});

/**
 * A refused connection reads as "could not reach the server" (decided
 * 2026-10-30). The two texts are what the real new bridge gave for a server
 * that turned the connection away, 15 of 37 of them the first, and each is
 * tried as words alone (the fallback, both libraries) and as the bridge marks
 * it where it opens the connection, with a text no rule has ever read beside
 * them, so a rule that depends on the library's words cannot pass.
 */
/** A client's own node, by a documentation address. */
const OWN_NODE = 'ssl://192.0.2.7:50002';
const EOF = 'Electrum client error: unexpected end of file';
const RESET = 'Electrum client error: Connection reset by peer (os error 54)';
const NEW_WORDS = 'Electrum client error: words no rule has ever read';
const words = (m: string) => new Error(m);
const marked = (m: string) => new EngineError('SERVER_UNREACHABLE', m);

describe.each<[string, () => Error]>([
  ['the end of file, in words', () => words(EOF)],
  ['the reset, in words', () => words(RESET)],
  ['the end of file, marked', () => marked(EOF)],
  ['the reset, marked', () => marked(RESET)],
  ['words no rule knows, marked', () => marked(NEW_WORDS)],
])('a refused connection: %s', (_name, refusal) => {
  it('reads as a server that could not be reached, whose payment may have gone out', () => {
    expect(serverUnreachable(refusal())).toBe(true);
    expect(serverFailed(refusal())).toBe(true);
    expect(answerMayBeLost(refusal())).toBe(true);
  });

  it('a Testnet4 sync moves on to the next server, and remembers the one that answered', async () => {
    const tried: string[] = [];
    await syncThroughChainServers('testnet', saved(), async (b: BackendConfig) => {
      tried.push(b.url);
      if (tried.length === 1) throw refusal();
    });
    expect(tried).toEqual(TESTNET4_ELECTRUM_SERVERS.slice(0, 2));
    expect(chainServersFor('testnet', saved())[0].url).toBe(TESTNET4_ELECTRUM_SERVERS[1]);
  });

  it('a Testnet4 vault no server answered says so in plain words on its page', async () => {
    const tried: string[] = [];
    const failure = await syncThroughChainServers('testnet', saved(), async (b: BackendConfig) => {
      tried.push(b.url);
      throw refusal();
    }).catch((e: unknown) => e);
    expect(tried).toEqual([...TESTNET4_ELECTRUM_SERVERS]);
    expect(failure).toEqual(new Error(NO_TESTNET4_SERVER_ANSWERED));
    expect(syncProblemNote('testnet', saved(), failure)).toEqual({ text: NO_TESTNET4_SERVER_ANSWERED, tone: 'note' });
  });

  it('a Testnet4 broadcast moves on to the next server', async () => {
    const tried: string[] = [];
    const txid = await broadcastThroughChainServers('testnet', saved(), async (b: BackendConfig) => {
      tried.push(b.url);
      if (tried.length === 1) throw refusal();
      return 'ab'.repeat(32);
    });
    expect(txid).toBe('ab'.repeat(32));
    expect(tried).toEqual(TESTNET4_ELECTRUM_SERVERS.slice(0, 2));
  });

  it('the rescue\'s Testnet4 broadcast moves on the same way', async () => {
    const tried: string[] = [];
    await broadcastWithWatchdog('testnet', saved(), async (b: BackendConfig) => {
      tried.push(b.url);
      if (tried.length === 1) throw refusal();
      return 'ab'.repeat(32);
    });
    expect(tried).toEqual(TESTNET4_ELECTRUM_SERVERS.slice(0, 2));
  });

  it('a Bitcoin broadcast fails with its own error at the one server: nothing else is tried', async () => {
    const tried: string[] = [];
    const failure = await broadcastThroughChainServers('bitcoin', saved(OWN_NODE), async (b: BackendConfig) => {
      tried.push(b.url);
      throw refusal();
    }).catch((e: unknown) => e);
    expect(tried).toEqual([OWN_NODE]);
    expect(failure).toEqual(refusal());
    expect(answerMayBeLost(failure)).toBe(true);
  });

  it('a Bitcoin sync fails at the one server, and the vault page says so in the plain sentence', async () => {
    const tried: string[] = [];
    const failure = await syncThroughChainServers('bitcoin', saved(OWN_NODE), async (b: BackendConfig) => {
      tried.push(b.url);
      throw refusal();
    }).catch((e: unknown) => e);
    expect(tried).toEqual([OWN_NODE]);
    expect(syncProblemNote('bitcoin', saved(OWN_NODE), failure)).toEqual({
      text: 'Talia could not reach 192.0.2.7, the server you chose, and uses no other. Check it in Settings → Network.',
      tone: 'note',
    });
    const note = syncProblemNote('bitcoin', saved(), refusal());
    expect(note?.tone).toBe('note');
    expect(note?.text).toMatch(/^Talia could not reach .+, its default server, and uses no other\./);
    for (const n of [syncProblemNote('bitcoin', saved(OWN_NODE), failure), note]) {
      expect(n?.text).not.toMatch(/Electrum|os error|end of file/);
    }
  });
});

describe('a server that answered is never read as one that could not be reached (decided 2026-10-30)', () => {
  const answers = [
    'Electrum server error: "unexpected end of file"',
    'Electrum server error: "Connection reset by peer (os error 54)"',
    'Error during the deserialization of a response from the server: unexpected end of file',
  ];

  it.each(answers)('%s', (answer) => {
    for (const e of [words(answer), new EngineError('OTHER', answer), marked(answer)]) {
      expect(serverUnreachable(e)).toBe(false);
      expect(answerMayBeLost(e)).toBe(false);
      // A sync still moves past it: another server may do better.
      expect(serverFailed(e)).toBe(true);
    }
  });

  it.each(answers)('a broadcast stops at it and the vault page keeps its text: %s', async (answer) => {
    const tried: string[] = [];
    await expect(
      broadcastThroughChainServers('testnet', saved(), async (b: BackendConfig) => {
        tried.push(b.url);
        throw words(answer);
      }),
    ).rejects.toThrow(answer);
    expect(tried).toHaveLength(1);
    expect(syncProblemNote('bitcoin', saved(OWN_NODE), words(answer))).toEqual({ text: `Sync failed: ${answer}`, tone: 'error' });
  });
});

describe('an answer the JSON reader could not take, which quotes what the server sent (decided 2026-10-30)', () => {
  // What electrum-client's constructor raises when `server.version` answers
  // with a string, recorded against the library: the server's words sit inside
  // the reader's, and read alone they name a connection that failed.
  const QUOTED = [
    'Electrum client error: invalid type: string "connection refused", expected a tuple of size 2',
    'Electrum client error: invalid type: string "Connection reset by peer (os error 54)", expected a tuple of size 2',
    'Electrum client error: invalid value: string "connection timed out", expected a hex string',
    'Electrum client error: unknown variant `broken pipe`, expected one of `a`, `b`',
  ];

  it.each(QUOTED)('is an answer: %s', (answer) => {
    for (const e of [words(answer), new EngineError('OTHER', answer)]) {
      expect(SERVER_ANSWERED.test(answer)).toBe(true);
      expect(serverUnreachable(e)).toBe(false);
      expect(answerMayBeLost(e)).toBe(false);
      expect(notReachedWords(e)).toBeNull();
      // Unreadable all the same: another server may do better.
      expect(serverFailed(e)).toBe(true);
    }
  });

  it('a Bitcoin vault shows the text, never "could not reach", and a Testnet4 sync moves on', async () => {
    const answer = QUOTED[0];
    expect(syncProblemNote('bitcoin', saved(OWN_NODE), new EngineError('OTHER', answer))).toEqual({ text: `Sync failed: ${answer}`, tone: 'error' });
    const tried: string[] = [];
    await syncThroughChainServers('testnet', saved(), async (b: BackendConfig) => {
      tried.push(b.url);
      if (tried.length === 1) throw new EngineError('OTHER', answer);
    });
    expect(tried).toHaveLength(2);
  });

  it('a Testnet4 broadcast stops at it: an answer is never a server that could not be reached', async () => {
    const tried: string[] = [];
    await expect(
      broadcastThroughChainServers('testnet', saved(), async (b: BackendConfig) => {
        tried.push(b.url);
        throw new EngineError('OTHER', QUOTED[0]);
      }),
    ).rejects.toThrow(QUOTED[0]);
    expect(tried).toHaveLength(1);
  });

  it('the library\'s words for a failed connection still read as one', () => {
    for (const text of [EOF, RESET, 'Electrum client error: Made one or multiple attempts, all errored:\n']) {
      expect(serverUnreachable(words(text))).toBe(true);
    }
  });
});

describe('a broadcast that reached no server reads the same on every screen that sends (decided 2026-10-30)', () => {
  it.each([EOF, RESET, NEW_WORDS])('marked by the bridge: %s', (text) => {
    expect(notReachedWords(marked(text))).toBe(SERVER_NOT_REACHED);
  });

  it.each([EOF, RESET])('in the old library\'s words: %s', (text) => {
    expect(notReachedWords(words(text))).toBe(SERVER_NOT_REACHED);
  });

  it('the old bridge\'s rejection where the connection is opened', () => {
    expect(notReachedWords(refused())).toBe(SERVER_NOT_REACHED);
  });

  it('Testnet4 keeps its own sentence: no server of the list answered', async () => {
    const failure = await broadcastThroughChainServers('testnet', saved(), async () => {
      throw marked(EOF);
    }).catch((e: unknown) => e);
    expect(notReachedWords(failure)).toBe(NO_TESTNET4_SERVER_ANSWERED);
  });

  it('a Bitcoin vault\'s one server, as the screen receives it', async () => {
    const failure = await broadcastThroughChainServers('bitcoin', saved(OWN_NODE), async () => {
      throw marked(EOF);
    }).catch((e: unknown) => e);
    expect(notReachedWords(failure)).toBe(SERVER_NOT_REACHED);
  });

  it('leaves everything else to the screen: a refusal, an app check, a broken build', () => {
    expect(notReachedWords(rejected())).toBeNull();
    // Even in words that would read as a failed connection: nothing was sent.
    expect(notReachedWords(new BroadcastRefusedError({ code: 'high-fee', feeSats: 1 }, 'connection refused'))).toBeNull();
    expect(notReachedWords(new Error('not co-signed yet'))).toBeNull();
  });

  it('is plain words, a title with no paragraph', () => {
    expect(SERVER_NOT_REACHED).not.toMatch(/—|Electrum|error|input|output/i);
  });
});

describe('the report knows a built-in Testnet4 server by a short fixed key, and no other server (decided 2026-10-30)', () => {
  it('each built-in server has its own key', () => {
    expect(TESTNET4_ELECTRUM_SERVERS.map((url) => reportServerKey('testnet', url))).toEqual(['blackie', 'mempool', 'stagemole']);
    // Signet from old data reads as Testnet4 everywhere.
    expect(reportServerKey('signet', TESTNET4_ELECTRUM_SERVERS[1])).toBe('mempool');
  });

  it('every other server is "other", a client\'s own above all, on every network', () => {
    for (const url of [OWN_NODE, PICKED_PUBLIC, DEFAULT_ELECTRUM.bitcoin, 'ssl://mempool.space:50002', 'constructor', '', undefined]) {
      expect(reportServerKey('testnet', url)).toBe('other');
      expect(reportServerKey('bitcoin', url)).toBe('other');
    }
  });

  it('a Bitcoin or Regtest vault that uses the very same address is still "other"', () => {
    for (const url of TESTNET4_ELECTRUM_SERVERS) {
      expect(reportServerKey('bitcoin', url)).toBe('other');
      expect(reportServerKey('regtest', url)).toBe('other');
    }
  });
});
