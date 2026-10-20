"use strict";

// Shared Telegram (GramJS) user-account client + per-bot request queues.
// Used by /api/ffgrp and /api/rabbitd — one connection, many bots.

const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const { NewMessage } = require("telegram/events");
const { EditedMessage } = require("telegram/events/EditedMessage");
const { TG_API_ID, TG_API_HASH, TG_SESSION } = require("../config");

let client = null;
let connecting = null;

async function getClient() {
  if (client && client.connected) return client;
  if (connecting) return connecting;
  connecting = (async () => {
    const c = new TelegramClient(new StringSession(TG_SESSION), TG_API_ID, TG_API_HASH, {
      connectionRetries: 5,
      autoReconnect: true,
    });
    c.setLogLevel("none");
    await c.connect();
    client = c;
    return c;
  })();
  try { return await connecting; }
  catch (e) { client = null; throw e; }
  finally { connecting = null; }
}

// One queue per bot: requests to the same bot run one at a time so each
// reply is matched to the right command; different bots run in parallel.
const queues = new Map();
function enqueue(key, fn) {
  const prev = queues.get(key) || Promise.resolve();
  const run = prev.then(fn, fn);
  queues.set(key, run.catch(() => {}));
  return run;
}

/**
 * Send `text` to `botUsername` and collect its replies.
 * `onMessage(message, ctx)` is called for every incoming bot message and must
 * return true when the conversation is complete. ctx = { client, finish }.
 * Resolves with whatever `onMessage` / `finish(null, value)` passes in.
 */
async function converse(botUsername, text, { timeout = 20000, onMessage, includeEdits = false }) {
  const c = await getClient();
  const bot = await c.getEntity(botUsername);

  return new Promise(async (resolve, reject) => {
    let done = false;
    const evt = new NewMessage({ incoming: true, fromUsers: [bot] });
    const evtEdit = includeEdits ? new EditedMessage({ incoming: true, fromUsers: [bot] }) : null;
    const timer = setTimeout(() => finish(new Error("Bot did not reply in time")), timeout);

    function finish(err, value) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { c.removeEventHandler(handler, evt); } catch (_) {}
      if (evtEdit) { try { c.removeEventHandler(handler, evtEdit); } catch (_) {} }
      err ? reject(err) : resolve(value);
    }

    const handler = async (event) => {
      const m = event.message;
      if (!m || m.out || done) return;
      try { await onMessage(m, { client: c, finish }); }
      catch (e) { finish(e); }
    };

    c.addEventHandler(handler, evt);
    if (evtEdit) c.addEventHandler(handler, evtEdit);
    try { await c.sendMessage(bot, { message: text }); }
    catch (e) { finish(e); }
  });
}

module.exports = { getClient, enqueue, converse };
