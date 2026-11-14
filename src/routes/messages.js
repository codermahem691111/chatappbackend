const express = require('express');
const Message = require('../models/Message');
const User = require('../models/User');
const auth = require('../middleware/auth');
const router = express.Router();

// GET /conversations — must be defined BEFORE /:peerId or it gets swallowed.
router.get('/conversations', auth, async (req, res) => {
  const me = req.user._id;
  const peers = await Message.aggregate([
    { $match: { $or: [{ sender: me }, { receiver: me }] } },
    { $sort: { createdAt: -1 } },
    {
      $group: {
        _id: { $cond: [{ $eq: ['$sender', me] }, '$receiver', '$sender'] },
        lastMessageId: { $first: '$_id' },
        lastMessageText: { $first: '$text' },
        lastMessageSender: { $first: '$sender' },
        lastMessageAt: { $first: '$createdAt' },
        unreadCount: {
          $sum: {
            $cond: [
              { $and: [{ $eq: ['$receiver', me] }, { $ne: ['$status', 'read'] }] },
              1, 0,
            ],
          },
        },
      },
    },
    { $sort: { lastMessageAt: -1 } },
  ]);
  const peerIds = peers.map((p) => p._id);
  const users = await User.find({ _id: { $in: peerIds } });
  const { onlineUsers } = require('../socket');
  const byId = new Map(users.map((u) => [String(u._id), u]));
  const conversations = peers
    .filter((p) => byId.has(String(p._id)))
    .map((p) => {
      const peer = byId.get(String(p._id));
      return {
        peer: { ...peer.toJSON(), online: onlineUsers.has(String(peer._id)) },
        lastMessage: { _id: p.lastMessageId, text: p.lastMessageText, sender: p.lastMessageSender, createdAt: p.lastMessageAt },
        lastMessageAt: p.lastMessageAt,
        unreadCount: p.unreadCount,
      };
    });
  res.json({ conversations });
});

router.get('/:peerId', auth, async (req, res) => {
  const me = req.user._id;
  const peer = req.params.peerId;
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);
  const q = { $or: [{ sender: me, receiver: peer }, { sender: peer, receiver: me }] };
  if (req.query.before) {
    const before = new Date(req.query.before);
    if (!Number.isNaN(before.getTime())) q.createdAt = { $lt: before };
  }
  // Fetch newest-first for the page, then return chronological (oldest first).
  const page = await Message.find(q).sort({ createdAt: -1 }).limit(limit);
  res.json({ messages: page.reverse() });
});

router.post('/:peerId/read', auth, async (req, res) => {
  const me = req.user._id;
  const peer = req.params.peerId;
  const result = await Message.updateMany(
    { sender: peer, receiver: me, status: { $ne: 'read' } },
    { $set: { status: 'read', readAt: new Date() } },
  );
  res.json({ updated: result.modifiedCount ?? result.nModified ?? 0 });
});

module.exports = router;
