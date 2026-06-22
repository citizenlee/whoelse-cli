#!/usr/bin/env node
// whoelse-chat — line-based terminal chat client for the whoelse /chat backend.
//
// Node built-ins ONLY (node:http / node:https / node:readline / node:process).
// No npm install required. SSE is parsed by hand from the raw HTTP response.
//
// Usage:
//   node client/whoelse-chat.js --keywords "a,b,c" [--github <login>] [--server <url>]
//
// Default server: $WHOELSE_SERVER or the live Railway deploy. For local dev pass
//   --server http://localhost:8080

import http from 'node:http';
import https from 'node:https';
import readline from 'node:readline';
import process from 'node:process';
import { URL } from 'node:url';

const DEFAULT_SERVER =
  process.env.WHOELSE_SERVER || 'https://ohwow-mcp-production.up.railway.app';

// --- tiny ANSI helpers (dim for presence/system lines) ----------------------
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;

// --- arg parsing ------------------------------------------------------------
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--keywords') out.keywords = argv[++i];
    else if (a === '--github') out.github = argv[++i];
    else if (a === '--server') out.server = argv[++i];
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

function usage() {
  return [
    'whoelse-chat — ephemeral terminal chat with people working on similar things',
    '',
    'Usage:',
    '  node client/whoelse-chat.js --keywords "a,b,c" [--github <login>] [--server <url>]',
    '',
    'Options:',
    '  --keywords  comma-separated keywords (required, at least 1)',
    '  --github    your GitHub login (optional; otherwise you join as anon-…)',
    '  --server    backend base URL (default: $WHOELSE_SERVER or the live deploy)',
  ].join('\n');
}

// --- HTTP helpers (promise-based JSON POST) ---------------------------------
function httpLib(u) {
  return u.protocol === 'https:' ? https : http;
}

function postJSON(base, path, body) {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(path, base);
    } catch (err) {
      return reject(new Error(`bad server URL: ${base}`));
    }
    const payload = Buffer.from(JSON.stringify(body));
    const req = httpLib(u).request(
      u,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': payload.length,
        },
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          let parsed;
          try {
            parsed = data ? JSON.parse(data) : {};
          } catch {
            parsed = { raw: data };
          }
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(parsed);
          else
            reject(
              new Error(
                `${res.statusCode} ${res.statusMessage}: ${
                  parsed.error || data || '(no body)'
                }`,
              ),
            );
        });
      },
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// --- SSE stream: open a GET, parse event:/data: frames by hand ---------------
function openStream(base, roomId, token, { onMessage, onPresence, onError, onOpen }) {
  const u = new URL(
    `/chat/rooms/${encodeURIComponent(roomId)}/stream?token=${encodeURIComponent(token)}`,
    base,
  );
  const req = httpLib(u).request(
    u,
    { method: 'GET', headers: { accept: 'text/event-stream' } },
    (res) => {
      if (res.statusCode !== 200) {
        onError(new Error(`stream failed: HTTP ${res.statusCode}`));
        res.resume();
        return;
      }
      onOpen?.();
      res.setEncoding('utf8');
      let buf = '';
      res.on('data', (chunk) => {
        buf += chunk;
        // SSE frames are separated by a blank line.
        let idx;
        while ((idx = buf.indexOf('\n\n')) !== -1) {
          const frame = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          dispatchFrame(frame, { onMessage, onPresence });
        }
      });
      res.on('end', () => onError(new Error('stream closed by server')));
      res.on('error', onError);
    },
  );
  req.on('error', onError);
  req.end();
  return req;
}

function dispatchFrame(frame, { onMessage, onPresence }) {
  let event = 'message';
  const dataLines = [];
  for (const line of frame.split('\n')) {
    if (line.startsWith(':')) continue; // keep-alive comment
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
  }
  if (!dataLines.length) return;
  let payload;
  try {
    payload = JSON.parse(dataLines.join('\n'));
  } catch {
    return;
  }
  if (event === 'message') onMessage(payload);
  else if (event === 'presence') onPresence(payload);
}

// --- time formatting --------------------------------------------------------
const VIEWER_TZ = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return ''; } })();
const hhmm = (ts, tz) => { try { return new Intl.DateTimeFormat([], { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz || undefined }).format(new Date(ts)); } catch { return ''; } };
const cityOf = (tz) => { const p = tz ? String(tz).split('/').pop() : ''; return p ? p.replace(/_/g, ' ') : ''; };
const isBotHandle = (h) => /[-_]bot$|\bbot\b|seed/i.test(String(h));
function msgLine(m) {
  const t = m.ts ? hhmm(m.ts) + ' ' : '';
  let where = '';
  if (!isBotHandle(m.user) && m.tz && m.tz !== VIEWER_TZ) {
    where = dim(`  (${hhmm(m.ts, m.tz)} their time${cityOf(m.tz) ? ' · ' + cityOf(m.tz) : ''})`);
  }
  return `${dim(t)}[${m.user}] ${m.text}${where}`;
}

// --- main -------------------------------------------------------------------
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  const server = args.server || DEFAULT_SERVER;
  const keywords = (args.keywords || '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);

  if (!keywords.length) {
    console.error('error: --keywords is required (at least one keyword)\n');
    console.error(usage());
    process.exitCode = 1;
    return;
  }

  // 1. Join (or create) a room.
  let joined;
  try {
    joined = await postJSON(server, '/chat/join', {
      keywords,
      tz: VIEWER_TZ,
      ...(args.github ? { githubLogin: args.github } : {}),
    });
  } catch (err) {
    console.error(`Could not reach the whoelse backend at ${server}`);
    console.error(`  ${err.message}`);
    console.error('\nIs the server running? For local dev: --server http://localhost:8080');
    process.exitCode = 1;
    return;
  }

  const { roomId, roomName, token, matched = [], members = 0, recent = [] } = joined;

  // 2. Header + backlog.
  console.log(bold(`\n# ${roomName}`));
  if (matched.length) console.log(dim(`matched on: ${matched.join(', ')}`));
  else console.log(dim('new room — no one else here yet on these keywords'));
  console.log(dim(`${members} here · ephemeral room, permanent handshakes`));
  if (recent.length) {
    console.log(dim('--- recent ---'));
    for (const m of recent) console.log(msgLine(m));
    console.log(dim('--------------'));
  }
  console.log(dim('type to chat · Ctrl-C to leave\n'));

  // 3. Readline loop on stdin.
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  // 4. Open the live SSE stream.
  const stream = openStream(server, roomId, token, {
    onMessage: (m) => {
      // Re-render cleanly above the prompt.
      console.log(msgLine(m));
    },
    onPresence: (p) => {
      console.log(dim(`· ${p.members} here`));
    },
    onError: (err) => {
      console.error(dim(`(stream: ${err.message})`));
    },
    onOpen: () => {},
  });

  rl.on('line', async (line) => {
    const text = line.trim();
    if (!text) return;
    try {
      await postJSON(server, `/chat/rooms/${encodeURIComponent(roomId)}/send`, {
        token,
        text,
      });
    } catch (err) {
      console.error(dim(`(send failed: ${err.message})`));
    }
  });

  const shutdown = () => {
    try {
      stream.destroy();
    } catch {}
    rl.close();
    console.log(dim('\nleft the room. handles you collected are yours to keep.'));
    process.exit(0);
  };
  rl.on('SIGINT', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error(`unexpected error: ${err.message}`);
  process.exitCode = 1;
});
