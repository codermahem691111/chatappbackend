const mongoose = require('mongoose');
const UserSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, unique: true, minlength: 2 },
  // Optional login handle. Sparse-unique so legacy users (name+password only)
  // without a username/email still work.
  username: {
    type: String, unique: true, sparse: true, lowercase: true, trim: true,
    minlength: 3, maxlength: 30, match: /^[a-z0-9._-]+$/,
    default: null,
  },
  email: {
    type: String, unique: true, sparse: true, lowercase: true, trim: true,
    match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    default: null,
  },
  password: { type: String, required: true },
  avatar: { type: String, default: null },
  pushToken: { type: String, default: null },
  lastSeen: { type: Date, default: Date.now },
}, { timestamps: true });
UserSchema.methods.toJSON = function () {
  const o = this.toObject();
  delete o.password;
  return o;
};
module.exports = mongoose.model('User', UserSchema);
