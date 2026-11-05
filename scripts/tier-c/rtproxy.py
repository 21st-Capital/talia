#!/usr/bin/env python3
"""An Electrum line proxy that counts what each connection asks, to measure a sync's round trips
(decided 2026-10-25): the app talks plain tcp to it, it talks to the real
server (plain tcp, or TLS with the server's certificate checked for its name, as the app checks it)
and writes one JSON line per message to its log, so a sync's round trips, its batches and the time
between an answer and the next question (the client's own work) can be read per connection.

    scripts/tier-c/rtproxy.py --listen 61001 --upstream blackie.c3-soft.com:57010 --tls \
                              --log <file.jsonl> [--delay-ms 150]

`--delay-ms` holds every line the server sends for that long before passing it on, which puts a
round trip's latency on a server that has none (regtest on this Mac). Several listeners in one
process: repeat `--listen PORT=LABEL`. Python standard library only; test servers and test vaults
only; nothing is stored but method names, sizes and times.
"""
import argparse
import asyncio
import json
import os
import ssl
import sys
import time

COUNTER = {'n': 0}
CA_FILE = '/etc/ssl/cert.pem'


def methods_of(line):
    try:
        msg = json.loads(line)
    except ValueError:
        return ['?']
    items = msg if isinstance(msg, list) else [msg]
    return [str(m.get('method', '?')) if isinstance(m, dict) else '?' for m in items]


def answers_of(line):
    try:
        msg = json.loads(line)
    except ValueError:
        return 1
    return len(msg) if isinstance(msg, list) else 1


async def pipe_client(reader, writer, log, conn):
    """App to server: one record per line, with its methods."""
    while True:
        line = await reader.readline()
        if not line:
            break
        log({'conn': conn, 'dir': 'ask', 't': time.time(), 'bytes': len(line), 'methods': methods_of(line)})
        writer.write(line)
        await writer.drain()
    try:
        writer.write_eof()
    except (OSError, RuntimeError):
        pass


async def pipe_server(reader, writer, log, conn, delay):
    """Server to app: one record per line, each passed on `delay` seconds after it ARRIVED. Lines
    are timed as they are read and handed on by a writer of their own, so the lines of one batch,
    which arrive together, leave together: one round trip's latency, not one per line."""
    queue = asyncio.Queue()

    async def read():
        while True:
            line = await reader.readline()
            await queue.put((time.time(), line))
            if not line:
                return

    async def write():
        while True:
            t, line = await queue.get()
            if not line:
                break
            wait = t + delay - time.time()
            if wait > 0:
                await asyncio.sleep(wait)
            log({'conn': conn, 'dir': 'answer', 't': t, 'sent': time.time(), 'bytes': len(line), 'answers': answers_of(line)})
            writer.write(line)
            await writer.drain()
        try:
            writer.close()
        except (OSError, RuntimeError):
            pass

    await asyncio.gather(read(), write())


def make_handler(label, host, port, use_tls, delay, log):
    async def handle(client_reader, client_writer):
        COUNTER['n'] += 1
        conn = f'{label}#{COUNTER["n"]}'
        t0 = time.time()
        try:
            if use_tls:
                # The system's roots (python.org's Python ships none of its own on macOS).
                ctx = ssl.create_default_context(cafile=CA_FILE if os.path.exists(CA_FILE) else None)
                server_reader, server_writer = await asyncio.open_connection(host, port, ssl=ctx, server_hostname=host,
                                                                            limit=1 << 24)
            else:
                server_reader, server_writer = await asyncio.open_connection(host, port, limit=1 << 24)
        except (OSError, ssl.SSLError) as e:
            log({'conn': conn, 'dir': 'open-failed', 't': t0, 'error': str(e)[:200]})
            client_writer.close()
            return
        log({'conn': conn, 'dir': 'open', 't': t0, 'upstreamMs': round((time.time() - t0) * 1000)})
        try:
            await asyncio.gather(pipe_client(client_reader, server_writer, log, conn),
                                 pipe_server(server_reader, client_writer, log, conn, delay))
        except (OSError, ConnectionError, asyncio.IncompleteReadError, ssl.SSLError) as e:
            log({'conn': conn, 'dir': 'error', 't': time.time(), 'error': str(e)[:200]})
        finally:
            log({'conn': conn, 'dir': 'close', 't': time.time()})
            for w in (server_writer, client_writer):
                try:
                    w.close()
                except (OSError, RuntimeError):
                    pass
    return handle


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--listen', action='append', required=True, help='PORT or PORT=LABEL (repeatable)')
    ap.add_argument('--upstream', required=True, help='host:port')
    ap.add_argument('--tls', action='store_true')
    ap.add_argument('--delay-ms', type=float, default=0)
    ap.add_argument('--log', required=True)
    args = ap.parse_args()
    host, port = args.upstream.rsplit(':', 1)
    out = open(args.log, 'a', buffering=1)

    def log(rec):
        out.write(json.dumps(rec) + '\n')

    servers = []
    for spec in args.listen:
        p, _, label = spec.partition('=')
        handler = make_handler(label or p, host, int(port), args.tls, args.delay_ms / 1000.0, log)
        servers.append(await asyncio.start_server(handler, '127.0.0.1', int(p), limit=1 << 24))
    print('listening', ' '.join(args.listen), flush=True)
    await asyncio.gather(*(s.serve_forever() for s in servers))


if __name__ == '__main__':
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        sys.exit(0)
