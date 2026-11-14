const mongoose = require('mongoose');
const CallSchema = new mongoose.Schema({
  callId: { type: String, required: true, unique: true },
  caller: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  receiver: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  callType: { type: String, enum: ['audio', 'video'], required: true },
  status: { type: String, enum: ['completed', 'missed', 'rejected', 'failed', 'busy'], default: 'completed' },
  startedAt: { type: Date, default: null },
  endedAt: { type: Date, default: null },
  duration: { type: Number, default: 0 }, // seconds
}, { timestamps: true });
CallSchema.index({ caller: 1, createdAt: -1 });
CallSchema.index({ receiver: 1, createdAt: -1 });
module.exports = mongoose.model('Call', CallSchema);
