const mongoose = require('mongoose');
const MessageSchema = new mongoose.Schema({
  sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  receiver: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  text: { type: String, required: true, maxlength: 5000 },
  status: { type: String, enum: ['sent', 'delivered', 'read'], default: 'sent' },
  readAt: { type: Date, default: null },
  // Client-generated idempotency key: lets the client safely retry a send
  // without creating duplicates. Sparse-unique so legacy messages stay valid.
  clientId: { type: String, unique: true, sparse: true, default: null },
}, { timestamps: true });
MessageSchema.index({ sender: 1, receiver: 1, createdAt: 1 });
module.exports = mongoose.model('Message', MessageSchema);
