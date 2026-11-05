/**
 * TRUE real-time BTC price (decided 2026-07-18: "real time means every second").
 *
 * A single shared WebSocket to Binance's miniTicker stream — pushes a fresh
 * BTC/USDT price every second, no polling. Non-USD currencies multiply the
 * live USD price by a fiat ratio refreshed once a minute from the existing
 * spot feed (fiat pairs move far slower than bitcoin does).
 *
 * The socket lives only while someone is subscribed and reconnects itself
 * with a short backoff.
 */

const STREAM_URL = 'wss://stream.binance.com:9443/ws/btcusdt@miniTicker';
const RECONNECT_MS = 3000;

type Listener = (usd: number) => void;

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let lastUsd: number | null = null;
const listeners = new Set<Listener>();

function connect(): void {
  if (ws || listeners.size === 0) return;
  try {
    // Node's global WebSocket typing (pulled in by the UR codec's
    // declarations) shadows React Native's; the runtime object is RN's.
    ws = new WebSocket(STREAM_URL) as unknown as WebSocket;
  } catch {
    scheduleReconnect();
    return;
  }
  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(String(event.data)) as { c?: string };
      const price = Number(data.c);
      if (Number.isFinite(price) && price > 0) {
        lastUsd = price;
        listeners.forEach((l) => l(price));
      }
    } catch {
      // malformed frame — ignore
    }
  };
  ws.onerror = () => {
    ws?.close();
  };
  ws.onclose = () => {
    ws = null;
    scheduleReconnect();
  };
}

function scheduleReconnect(): void {
  if (reconnectTimer || listeners.size === 0) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, RECONNECT_MS);
}

/**
 * Subscribe to per-second USD prices. The callback fires immediately with
 * the last known price when one exists. Returns an unsubscribe function;
 * the socket closes when the last subscriber leaves.
 */
export function subscribeLiveUsdPrice(listener: Listener): () => void {
  listeners.add(listener);
  if (lastUsd != null) listener(lastUsd);
  connect();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      ws?.close();
      ws = null;
    }
  };
}
