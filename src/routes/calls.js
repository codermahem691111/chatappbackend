const express = require('express');
const Call = require('../models/Call');
const User = require('../models/User');
const auth = require('../middleware/auth');
const router = express.Router();

const CALL_TYPES = ['audio', 'video'];
const CALL_STATUSES = ['completed', 'missed', 'rejected', 'failed', 'busy'];

// GET / — my call history, newest first.
router.get('/', auth, async (req, res) => {
  const me = req.user._id;
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);
  const q = { $or: [{ caller: me }, { receiver: me }] };
  if (req.query.before) {
    const before = new Date(req.query.before);
    if (!Number.isNaN(before.getTime())) q.createdAt = { $lt: before };
  }
  const calls = await Call.find(q)
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate('caller', 'name username avatar')
    .populate('receiver', 'name username avatar');
  res.json({ calls });
});

// POST / — record (or update, by callId) one call. The caller is always me.
router.post('/', auth, async (req, res) => {
  const { callId, receiver, callType, status, startedAt, endedAt, duration } = req.body || {};
  if (!callId || !String(callId).trim()) return res.status(400).json({ error: 'callId is required' });
  if (!receiver) return res.status(400).json({ error: 'receiver is required' });
  if (String(receiver) === String(req.user._id)) return res.status(400).json({ error: 'Cannot call yourself' });
  if (!CALL_TYPES.includes(callType)) return res.status(400).json({ error: 'callType must be audio or video' });
  if (status !== undefined && !CALL_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of ${CALL_STATUSES.join(', ')}` });
  }
  const other = await User.findById(receiver);
  if (!other) return res.status(400).json({ error: 'Receiver not found' });

  const fields = {
    caller: req.user._id,
    receiver: other._id,
    callType,
    status: status || 'completed',
    startedAt: startedAt ? new Date(startedAt) : null,
    endedAt: endedAt ? new Date(endedAt) : null,
    duration: Number(duration) || 0,
  };
  // Upsert by callId, but only if the existing record is between the same
  // two parties — a callId must never be hijacked to rewrite someone else's call.
  const existing = await Call.findOne({ callId: String(callId).trim() });
  let call;
  if (existing) {
    const samePair =
      (String(existing.caller) === String(req.user._id) && String(existing.receiver) === String(other._id)) ||
      (String(existing.caller) === String(other._id) && String(existing.receiver) === String(req.user._id));
    if (!samePair) return res.status(403).json({ error: 'callId belongs to a different call' });
    Object.assign(existing, fields);
    call = await existing.save();
  } else {
    call = await Call.create({ callId: String(callId).trim(), ...fields });
  }
  await call.populate('caller', 'name username avatar');
  await call.populate('receiver', 'name username avatar');
  res.json({ call });
});

module.exports = router;
