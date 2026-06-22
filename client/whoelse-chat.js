#!/usr/bin/env node
// whoelse-chat — terminal-native ephemeral chat for the whoelse /chat backend.
//
// Rendered with Ink + React + htm so it runs with NO build / transpile step:
// views are written with htm tagged templates bound to React.createElement, not
// raw JSX. (Node parses this file directly.)
//
// Usage:
//   node whoelse-chat.js --keywords "a,b,c" [--github <login>] [--server <url>]
//   node whoelse-chat.js --plain --keywords "a,b"   # old line-based client
//
// Default server: $WHOELSE_SERVER or the live Railway deploy. For local dev pass
//   --server http://localhost:8080
//
// Slash commands (inside the UI):
//   /save   save handles of everyone present to ~/.whoelse/contacts.json
//   /who    list who is here right now
//   /lobby  list active rooms (GET /chat/lobby) with member counts
//   /quit   leave, printing a "people you met this session" summary

import http from 'node:http';
import https from 'node:https';
import process from 'node:process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { URL } from 'node:url';

const DEFAULT_SERVER =
  process.env.WHOELSE_SERVER || 'https://ohwow-mcp-production.up.railway.app';

const CONTACTS_DIR = path.join(os.homedir(), '.whoelse');
const CONTACTS_FILE = path.join(CONTACTS_DIR, 'contacts.json');

// --- arg parsing ------------------------------------------------------------
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--keywords') out.keywords = argv[++i];
    else if (a === '--github') out.github = argv[++i];
    else if (a === '--server') out.server = argv[++i];
    else if (a === '--plain') out.plain = true;
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

function usage() {
  return [
    'whoelse-chat — ephemeral terminal chat with people working on similar things',
    '',
    'Usage:',
    '  node whoelse-chat.js --keywords "a,b,c" [--github <login>] [--server <url>]',
    '  node whoelse-chat.js --plain --keywords "a,b"   # old line-based client',
    '',
    'Options:',
    '  --keywords  comma-separated keywords (required, at least 1)',
    '  --github    your GitHub login (optional; otherwise you join as anon-…)',
    '  --server    backend base URL (default: $WHOELSE_SERVER or the live deploy)',
    '  --plain     use the original line-based client (no Ink UI)',
    '',
    'In-app slash commands: /save  /who  /lobby  /quit',
  ].join('\n');
}

// --- HTTP helpers -----------------------------------------------------------
function httpLib(u) {
  return u.protocol === 'https:' ? https : http;
}

function postJSON(base, path, body) {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(path, base);
    } catch {
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

function getJSON(base, path) {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(path, base);
    } catch {
      return reject(new Error(`bad server URL: ${base}`));
    }
    const req = httpLib(u).request(u, { method: 'GET' }, (res) => {
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
        else reject(new Error(`${res.statusCode} ${res.statusMessage}`));
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// --- SSE stream -------------------------------------------------------------
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
    if (line.startsWith(':')) continue;
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

// --- contacts persistence ---------------------------------------------------
function readContacts() {
  try {
    const raw = fs.readFileSync(CONTACTS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Merge new handles into ~/.whoelse/contacts.json, de-duped by handle.
 * Each entry: { handle, roomName, keywords, firstMet, lastSeen }.
 * Returns { added, total }.
 */
function saveContacts(handles, { roomName, keywords }) {
  const now = new Date().toISOString();
  const existing = readContacts();
  const byHandle = new Map(existing.map((c) => [c.handle, c]));
  let added = 0;
  for (const handle of handles) {
    if (!handle) continue;
    if (byHandle.has(handle)) {
      byHandle.get(handle).lastSeen = now;
    } else {
      byHandle.set(handle, {
        handle,
        roomName,
        keywords,
        firstMet: now,
        lastSeen: now,
      });
      added++;
    }
  }
  fs.mkdirSync(CONTACTS_DIR, { recursive: true });
  const out = [...byHandle.values()];
  fs.writeFileSync(CONTACTS_FILE, JSON.stringify(out, null, 2));
  return { added, total: out.length };
}

// is this handle a labelled bot/seed agent? (backend tags seeds visibly)
function isBot(handle) {
  return /\bbot\b|^bot[-_]|[-_]bot$|seed/i.test(String(handle));
}

// --- time formatting (viewer-local, plus the sender's local time) ------------
const VIEWER_TZ = (() => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return ''; }
})();
function hhmm(ts, tz) {
  try {
    return new Intl.DateTimeFormat([], { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz || undefined }).format(new Date(ts));
  } catch { return ''; }
}
// "Europe/Berlin" -> "Berlin"; the human-where-are-they hint.
function cityOf(tz) {
  if (!tz) return '';
  const p = String(tz).split('/').pop();
  return p ? p.replace(/_/g, ' ') : '';
}

// drop ASCII control chars (incl. stray CR/LF and escape sequences) from input.
function stripControl(s) {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\x00-\x1f\x7f]/g, '');
}

// ---------------------------------------------------------------------------
// PLAIN code path — delegate to the preserved line-based client.
// ---------------------------------------------------------------------------
async function runPlain() {
  await import('./whoelse-chat-plain.js');
}

// ---------------------------------------------------------------------------
// INK UI
// ---------------------------------------------------------------------------
async function runInk(args) {
  const React = (await import('react')).default;
  const { render, Box, Text, useApp, useInput, useStdout } = await import('ink');
  const htmMod = (await import('htm')).default;
  const html = htmMod.bind(React.createElement);
  const { useState, useEffect, useRef, useCallback } = React;

  const server = args.server || DEFAULT_SERVER;
  const keywords = (args.keywords || '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);

  // 1. Join (or create) a room before mounting the UI, so we can fail cleanly.
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

  // collected across the whole session for the exit summary.
  const metThisSession = new Set((joined.recent || []).map((m) => m.user).filter(Boolean));

  function App() {
    const { exit } = useApp();
    const { write: writeOut } = useStdout();
    const init = joined;

    // Current room identity is mutable so we can hop rooms via /join.
    const roomRef = useRef({ roomId: init.roomId, token: init.token });
    const lobbyRef = useRef([]); // last /lobby result, for /join <n>
    const genRef = useRef(0); // stream generation — ignore errors from old streams
    const [roomName, setRoomName] = useState(init.roomName);

    const backlogAuthors = (recent) => [...new Set((recent || []).map((m) => m.user).filter(Boolean))];

    const [messages, setMessages] = useState(() =>
      (init.recent || []).map((m) => ({ ...m, kind: 'message' })),
    );
    const [members, setMembers] = useState(init.members || 1);
    // Seed "who's here" from the backlog so the room's regulars (incl. bots that
    // already posted) show up, not just whoever speaks after you arrive.
    const [present, setPresent] = useState(() => backlogAuthors(init.recent));
    const [status, setStatus] = useState('connecting');
    const [input, setInput] = useState('');
    const inputRef = useRef(''); // mirror of `input` for synchronous reads
    const streamRef = useRef(null);

    const setInputBoth = useCallback((next) => {
      inputRef.current = typeof next === 'function' ? next(inputRef.current) : next;
      setInput(inputRef.current);
    }, []);

    const pushSystem = useCallback((text) => {
      setMessages((m) => [...m, { kind: 'system', text, ts: Date.now() }]);
    }, []);

    const noteHandle = useCallback((handle) => {
      if (!handle) return;
      metThisSession.add(handle);
      setPresent((p) => (p.includes(handle) ? p : [...p, handle]));
    }, []);

    // (Re)open the SSE stream for whatever room is current in roomRef.
    const connectStream = useCallback(() => {
      try {
        streamRef.current?.destroy();
      } catch {}
      const myGen = ++genRef.current; // anything from an older stream is stale
      const { roomId, token } = roomRef.current;
      setStatus('connecting');
      streamRef.current = openStream(server, roomId, token, {
        onOpen: () => {
          if (myGen === genRef.current) setStatus('live');
        },
        onMessage: (m) => {
          if (myGen !== genRef.current) return;
          noteHandle(m.user);
          setMessages((prev) => {
            const next = [...prev, { ...m, kind: 'message' }];
            return next.length > 200 ? next.slice(next.length - 200) : next;
          });
        },
        onPresence: (p) => {
          if (myGen === genRef.current && typeof p.members === 'number') setMembers(p.members);
        },
        onError: (err) => {
          if (myGen !== genRef.current) return; // we intentionally replaced this stream
          setStatus('disconnected');
          pushSystem(`stream: ${err.message}`);
        },
      });
    }, [noteHandle, pushSystem]);

    // open the stream once on mount.
    useEffect(() => {
      connectStream();
      return () => {
        try {
          streamRef.current?.destroy();
        } catch {}
      };
    }, [connectStream]);

    // Hop into a specific existing room (from /lobby), keeping the same identity.
    const switchRoom = useCallback(
      async (roomId) => {
        try {
          const next = await postJSON(server, '/chat/join', {
            keywords,
            roomId,
            tz: VIEWER_TZ,
            ...(args.github ? { githubLogin: args.github } : {}),
          });
          roomRef.current = { roomId: next.roomId, token: next.token };
          setRoomName(next.roomName);
          setMembers(next.members || 1);
          setPresent(backlogAuthors(next.recent));
          (next.recent || []).forEach((m) => metThisSession.add(m.user));
          setMessages([
            { kind: 'system', text: `— switched to ${next.roomName} —`, ts: Date.now() },
            ...(next.recent || []).map((m) => ({ ...m, kind: 'message' })),
          ]);
          connectStream();
        } catch (err) {
          pushSystem(`/join failed: ${err.message}`);
        }
      },
      [connectStream, pushSystem],
    );

    const doExit = useCallback(() => {
      try {
        streamRef.current?.destroy();
      } catch {}
      exit();
    }, [exit]);

    const runCommand = useCallback(
      async (raw) => {
        const [cmd, ...rest] = raw.slice(1).trim().split(/\s+/);
        switch (cmd) {
          case 'quit':
          case 'q':
            doExit();
            break;
          case 'who': {
            const here = present.length ? present.join(', ') : '(no one has spoken yet)';
            pushSystem(`${members} here · seen: ${here}`);
            break;
          }
          case 'save': {
            // Handshakes are with PEOPLE — drop labeled bots (and yourself).
            const handles = present.filter((h) => !isBot(h) && h !== args.github);
            if (!handles.length) {
              pushSystem('/save: no people to save yet — just bots here so far.');
              break;
            }
            try {
              const { added, total } = saveContacts(handles, {
                roomName: init.roomName,
                keywords: init.matched && init.matched.length ? init.matched : keywords,
              });
              pushSystem(
                `/save: ${added} new handshake${added === 1 ? '' : 's'} saved → ~/.whoelse/contacts.json (${total} total)`,
              );
            } catch (err) {
              pushSystem(`/save failed: ${err.message}`);
            }
            break;
          }
          case 'lobby': {
            pushSystem('/lobby: fetching active rooms…');
            try {
              const data = await getJSON(server, '/chat/lobby');
              const rooms = Array.isArray(data.rooms) ? data.rooms : [];
              lobbyRef.current = rooms;
              if (!rooms.length) {
                pushSystem('/lobby: no active rooms right now.');
              } else {
                pushSystem('active rooms (type /join <number> to hop in):');
                rooms.forEach((r, i) => {
                  const kw = Array.isArray(r.keywords) ? r.keywords.slice(0, 4).join(', ') : '';
                  const here = r.members > 0 ? `${r.members} here` : `${r.voices ?? 0} voices`;
                  const you = r.roomId === roomRef.current.roomId ? ' ← you' : '';
                  pushSystem(`  ${i + 1}. ${r.roomName || r.roomId} — ${here}${kw ? ` [${kw}]` : ''}${you}`);
                });
              }
            } catch (err) {
              pushSystem(`/lobby failed: ${err.message}`);
            }
            break;
          }
          case 'join': {
            const n = parseInt(rest[0], 10);
            const rooms = lobbyRef.current;
            if (!rooms.length) {
              pushSystem('/join: run /lobby first to see room numbers.');
            } else if (!n || n < 1 || n > rooms.length) {
              pushSystem(`/join: pick a number 1–${rooms.length} (see /lobby).`);
            } else if (rooms[n - 1].roomId === roomRef.current.roomId) {
              pushSystem("/join: you're already in that room.");
            } else {
              await switchRoom(rooms[n - 1].roomId);
            }
            break;
          }
          default:
            pushSystem(`unknown command: /${cmd} (try /save /who /lobby /join /quit)`);
        }
      },
      [present, members, doExit, pushSystem, switchRoom],
    );

    const submit = useCallback(
      async (value) => {
        const text = value.trim();
        if (!text) return;
        if (text.startsWith('/')) {
          await runCommand(text);
          return;
        }
        try {
          const { roomId, token } = roomRef.current;
          await postJSON(server, `/chat/rooms/${encodeURIComponent(roomId)}/send`, {
            token,
            text,
          });
        } catch (err) {
          pushSystem(`send failed: ${err.message}`);
        }
      },
      [runCommand, pushSystem],
    );

    // hand-rolled input (no extra deps): collect printable chars, handle keys.
    // Note: some terminals/PTYs batch a keystroke and the Enter that follows
    // into one chunk, so we also treat an embedded newline in `ch` as submit.
    useInput((ch, key) => {
      if (key.ctrl && (ch === 'c' || ch === 'd')) {
        doExit();
        return;
      }
      if (key.backspace || key.delete) {
        setInputBoth((s) => s.slice(0, -1));
        return;
      }
      if (key.ctrl || key.meta || key.tab || key.upArrow || key.downArrow) return;

      const hasReturn = key.return || (ch && /[\r\n]/.test(ch));
      if (hasReturn) {
        // strip the newline; anything before it on this chunk is typed text.
        const typed = (ch || '').replace(/[\r\n].*/s, '');
        const value = inputRef.current + stripControl(typed);
        setInputBoth('');
        submit(value);
        return;
      }
      const printable = stripControl(ch || '');
      if (printable) setInputBoth((s) => s + printable);
    });

    // how many message rows fit (rough): keep last N.
    const visible = messages.slice(-200);

    return html`
      <${Box} flexDirection="column" height="100%">
        <${Header}
          roomName=${roomName}
          status=${status}
          members=${members}
          html=${html}
          React=${React}
          Box=${Box}
          Text=${Text}
        />
        <${Box} flexGrow=${1}>
          <${ChatPane}
            messages=${visible}
            html=${html}
            Box=${Box}
            Text=${Text}
          />
          <${PresenceSidebar}
            present=${present}
            members=${members}
            matched=${init.matched || []}
            keywords=${keywords}
            html=${html}
            Box=${Box}
            Text=${Text}
          />
        <//>
        <${InputBox} value=${input} html=${html} Box=${Box} Text=${Text} />
      <//>
    `;
  }

  function Header({ roomName, status, members, html, Box, Text }) {
    const dot = status === 'live' ? '●' : status === 'connecting' ? '◐' : '○';
    const color =
      status === 'live' ? 'green' : status === 'connecting' ? 'yellow' : 'red';
    return html`
      <${Box}
        borderStyle="round"
        borderColor="cyan"
        paddingX=${1}
        justifyContent="space-between"
      >
        <${Text} bold color="cyan">#${roomName}<//>
        <${Text} color=${color}>${dot} ${status} · ${members} here<//>
      <//>
    `;
  }

  function ChatPane({ messages, html, Box, Text }) {
    return html`
      <${Box} flexDirection="column" flexGrow=${1} paddingX=${1} overflow="hidden">
        ${messages.length === 0
          ? html`<${Text} dimColor>no messages yet — say hi 👋<//>`
          : messages.map((m, i) => {
              if (m.kind === 'system') {
                return html`<${Text} key=${i} dimColor italic>· ${m.text}<//>`;
              }
              const bot = isBot(m.user);
              const t = m.ts ? hhmm(m.ts) : ''; // viewer-local time
              // their local time, for other humans in a different timezone
              const elsewhere = !bot && m.tz && m.tz !== VIEWER_TZ
                ? ` ${hhmm(m.ts, m.tz)} their time${cityOf(m.tz) ? ` · ${cityOf(m.tz)}` : ''}`
                : '';
              return html`
                <${Text} key=${i} wrap="wrap">
                  ${t ? html`<${Text} dimColor>${t}  <//>` : ''}
                  <${Text} color=${bot ? 'magenta' : 'green'} bold>
                    ${bot ? '🤖 ' : ''}${m.user}
                  <//>
                  <${Text} dimColor> › <//>${m.text}
                  ${elsewhere ? html`<${Text} dimColor italic>  (${elsewhere.trim()})<//>` : ''}
                <//>
              `;
            })}
      <//>
    `;
  }

  function PresenceSidebar({ present, members, matched, keywords, html, Box, Text }) {
    const kws = matched.length ? matched : keywords;
    return html`
      <${Box}
        flexDirection="column"
        width=${24}
        borderStyle="single"
        borderColor="gray"
        paddingX=${1}
      >
        <${Text} bold underline>who's here<//>
        <${Text} dimColor>${members} present<//>
        ${present.length === 0
          ? html`<${Text} dimColor>(quiet so far)<//>`
          : present.map((h, i) => {
              const bot = isBot(h);
              return html`
                <${Text} key=${i} color=${bot ? 'magenta' : undefined}>
                  ${bot ? '🤖 ' : '• '}${h}
                <//>
              `;
            })}
        <${Box} marginTop=${1} flexDirection="column">
          <${Text} bold underline>keywords<//>
          ${kws.length === 0
            ? html`<${Text} dimColor>(none)<//>`
            : kws.map((k, i) => html`<${Text} key=${i} color="yellow">#${k}<//>`)}
        <//>
      <//>
    `;
  }

  function InputBox({ value, html, Box, Text }) {
    return html`
      <${Box} borderStyle="round" borderColor="blue" paddingX=${1}>
        <${Text} color="blue">› <//>
        <${Text}>${value}<//>
        <${Text} color="blue">▏<//>
        ${value.length === 0
          ? html`<${Text} dimColor>  type a message · /save /who /lobby /join /quit<//>`
          : null}
      <//>
    `;
  }

  const { waitUntilExit } = render(html`<${App} />`);
  await waitUntilExit();

  // exit summary: people you met this session.
  const met = [...metThisSession];
  if (met.length) {
    console.log(`\nPeople you met this session (${met.length}):`);
    for (const h of met) console.log(`  ${isBot(h) ? '🤖 ' : '• '}${h}`);
    console.log(`\nRun /save next time to keep handshakes in ~/.whoelse/contacts.json`);
  } else {
    console.log('\nQuiet session — no one else spoke. The room is yours next time.');
  }
}

// --- entry ------------------------------------------------------------------
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  if (args.plain) {
    await runPlain();
    return;
  }
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
  await runInk(args);
}

main().catch((err) => {
  console.error(`unexpected error: ${err.message}`);
  process.exitCode = 1;
});
