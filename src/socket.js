const jwt = require('jsonwebtoken');
const User = require('./models/User');
const Message = require('./models/Message');

// userId -> Set<socket.id> (multiple devices/tabs per user).
// onlineUsers is a Map<userId, Set<socketId>>; a user is online while the set is non-empty.
const onlineUsers = new Map();
const socketsByUser = new Map(); // userId -> Set<socket> (kept for compat)

function addSocket(uid, socket) {
  if (!onlineUsers.has(uid)) onlineUsers.set(uid, new Set());
  onlineUsers.get(uid).add(socket.id);
  if (!socketsByUser.has(uid)) socketsByUser.set(uid, new Set());
  socketsByUser.get(uid).add(socket);
  return onlineUsers.get(uid).size === 1; // true only on first socket
}
function removeSocket(uid, socket) {
  const ids = onlineUsers.get(uid);
  if (ids) { ids.delete(socket.id); if (!ids.size) onlineUsers.delete(uid); }
  const socks = socketsByUser.get(uid);
  if (socks) { socks.delete(socket); if (!socks.size) socketsByUser.delete(uid); }
  return !onlineUsers.has(uid); // true only when the last socket left
}
function isOnline(uid) { return onlineUsers.has(String(uid)); }

// --- Active call tracking (in-memory only; client records call history) ---
// callId -> { caller, receiver, startedAt }
const activeCalls = new Map();
// userId -> callId
const userToCall = new Map();
function registerCall(callId, caller, receiver) {
  activeCalls.set(callId, { caller, receiver, startedAt: new Date() });
  userToCall.set(caller, callId);
  userToCall.set(receiver, callId);
}
function clearCall(callId) {
  const c = activeCalls.get(callId);
  if (!c) return null;
  activeCalls.delete(callId);
  if (userToCall.get(c.caller) === callId) userToCall.delete(c.caller);
  if (userToCall.get(c.receiver) === callId) userToCall.delete(c.receiver);
  return c;
}
function clearCallForUser(uid) {
  const callId = userToCall.get(uid);
  return callId ? clearCall(callId) : null;
}

function attachSocket(io) {
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      const d = jwt.verify(token, process.env.JWT_SECRET || 'spider-dev-secret');
      socket.userId = d.id;
      const u = await User.findById(d.id);
      socket.userName = u?.name || 'User';
      next();
    } catch { next(new Error('unauthorized')); }
  });

  io.on('connection', (socket) => {
    const uid = String(socket.userId);
    const firstSocket = addSocket(uid, socket);
    socket.join(uid);
    if (firstSocket) io.emit('presence', { userId: uid, online: true });
    User.findByIdAndUpdate(uid, { lastSeen: new Date() }).catch(() => {});

    socket.on('message:send', async ({ to, text, clientId }, ack) => {
      if (!to || !String(text || '').trim()) { if (typeof ack === 'function') ack({ error: 'Missing recipient or text' }); return; }
      try {
        // Idempotent resend: same sender + clientId returns the original message.
        if (clientId) {
          const existing = await Message.findOne({ sender: uid, clientId: String(clientId) });
          if (existing) {
            const payload = existing.toObject();
            socket.emit('message:receive', payload);
            if (typeof ack === 'function') ack(payload);
            return;
          }
        }
        const msg = await Message.create({
          sender: uid,
          receiver: to,
          text: String(text).trim().slice(0, 5000),
          clientId: clientId ? String(clientId) : null,
          status: isOnline(to) ? 'delivered' : 'sent',
        });
        const payload = msg.toObject();
        io.to(String(to)).emit('message:receive', payload);
        socket.emit('message:receive', payload);
        if (typeof ack === 'function') ack(payload);
      } catch (e) {
        console.error('message:send failed:', e.message);
        if (typeof ack === 'function') ack({ error: 'Failed to send message' });
      }
    });

    // Typing indicators (relay only).
    socket.on('typing:start', (d) => { if (d?.to) io.to(String(d.to)).emit('typing:start', { from: uid, fromName: socket.userName }); });
    socket.on('typing:stop', (d) => { if (d?.to) io.to(String(d.to)).emit('typing:stop', { from: uid, fromName: socket.userName }); });

    // Delivery / read receipts. Accepts {messageId} or {peerId}.
    async function markReceipt(kind, data) {
      const isRead = kind === 'read';
      try {
        if (data?.messageId) {
          const msg = await Message.findById(data.messageId);
          if (!msg || String(msg.receiver) !== uid) return;
          if (isRead) {
            if (msg.status !== 'read') { msg.status = 'read'; msg.readAt = new Date(); await msg.save(); }
          } else if (msg.status === 'sent') {
            msg.status = 'delivered'; await msg.save();
          }
          io.to(String(msg.sender)).emit(`message:${kind}`, { messageId: String(msg._id) });
        } else if (data?.peerId) {
          const peerId = String(data.peerId);
          const update = isRead
            ? { $set: { status: 'read', readAt: new Date() } }
            : { $set: { status: 'delivered' } };
          const filter = isRead
            ? { sender: peerId, receiver: uid, status: { $ne: 'read' } }
            : { sender: peerId, receiver: uid, status: 'sent' };
          await Message.updateMany(filter, update);
          io.to(peerId).emit(`message:${kind}`, { peerId: uid });
        }
      } catch (e) { console.error(`message:${kind} failed:`, e.message); }
    }
    socket.on('message:delivered', (d) => markReceipt('delivered', d));
    socket.on('message:read', (d) => markReceipt('read', d));

    // --- WebRTC signalling: relay only, media stays peer-to-peer ---
    const relay = (event, data) => {
      if (!data?.to) return;
      io.to(String(data.to)).emit(event, { ...data, from: uid, fromName: socket.userName });
    };

    socket.on('call:offer', (d) => {
      if (!d?.to) return;
      const to = String(d.to);
      if (userToCall.has(to)) {
        // Receiver is already in a call — tell the caller, don't relay.
        socket.emit('call:busy', { to, from: to });
        return;
      }
      const callId = d.callId || `${uid}-${to}-${Date.now()}`;
      registerCall(callId, uid, to);
      const payload = { ...d, callId, from: uid, fromName: socket.userName };
      // Emit both 'call:invite' (new clients) and 'call:offer' (existing clients).
      io.to(to).emit('call:invite', payload);
      io.to(to).emit('call:offer', payload);
    });
    socket.on('call:answer', (d) => relay('call:answer', d));
    socket.on('call:ice-candidate', (d) => relay('call:ice-candidate', d));
    socket.on('call:reject', (d) => {
      if (d?.callId) clearCall(String(d.callId));
      else if (d?.to) clearCallForUser(String(d.to));
      relay('call:reject', d);
    });
    socket.on('call:end', (d) => {
      if (d?.callId) clearCall(String(d.callId));
      else if (d?.to) clearCallForUser(String(d.to));
      relay('call:end', d);
    });
    socket.on('call:busy', (d) => {
      if (d?.callId) clearCall(String(d.callId));
      else if (d?.to) clearCallForUser(String(d.to));
      relay('call:busy', d);
    });
    // Callee opened the call screen and is ready to receive the offer again.
    socket.on('call:ready', (d) => { if (d?.to) io.to(String(d.to)).emit('call:ready', { from: uid, fromName: socket.userName }); });

    socket.on('disconnect', () => {
      const lastSocket = removeSocket(uid, socket);
      // If this user was mid-call, tell the other side the call ended.
      const callId = userToCall.get(uid);
      const call = clearCallForUser(uid);
      if (call) {
        const other = call.caller === uid ? call.receiver : call.caller;
        io.to(String(other)).emit('call:end', { from: uid, fromName: socket.userName, callId, reason: 'disconnect' });
      }
      if (lastSocket) {
        io.emit('presence', { userId: uid, online: false });
        User.findByIdAndUpdate(uid, { lastSeen: new Date() }).catch(() => {});
      }
    });
  });
}
module.exports = { attachSocket, onlineUsers, socketsByUser, isOnline, activeCalls, userToCall };
