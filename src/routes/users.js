const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const User = require('../models/User');
const auth = require('../middleware/auth');
const { onlineUsers } = require('../socket');
const router = express.Router();

// Cloudinary is optional: only configured when all three env vars are set.
// Never log keys; never invent credentials.
let cloudinary = null;
if (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET) {
  cloudinary = require('cloudinary').v2;
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '..', '..', 'uploads');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => cb(null, `${req.user._id}-${Date.now()}${path.extname(file.originalname || '.jpg')}`),
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 }, fileFilter: (req, f, cb) => cb(null, f.mimetype.startsWith('image/')) });

// Global user directory (everyone except me), with live online status.
router.get('/', auth, async (req, res) => {
  const users = await User.find({ _id: { $ne: req.user._id } }).sort({ name: 1 });
  res.json({ users: users.map((u) => ({ ...u.toJSON(), online: onlineUsers.has(String(u._id)) })) });
});

router.post('/me/avatar', auth, upload.single('avatar'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image uploaded' });
  try {
    if (cloudinary) {
      const result = await cloudinary.uploader.upload(req.file.path, { folder: 'spider/avatars' });
      fs.unlink(req.file.path, () => {});
      req.user.avatar = result.secure_url;
    } else {
      req.user.avatar = `/uploads/${req.file.filename}`;
    }
    await req.user.save();
    res.json({ user: req.user });
  } catch (e) {
    console.error('Avatar upload failed:', e.message);
    fs.unlink(req.file.path, () => {});
    res.status(500).json({ error: 'Avatar upload failed' });
  }
});

// Save the device push token for this user (no Firebase Admin SDK here).
router.post('/me/push-token', auth, async (req, res) => {
  const { pushToken } = req.body || {};
  if (!pushToken || typeof pushToken !== 'string' || !pushToken.trim()) {
    return res.status(400).json({ error: 'pushToken is required' });
  }
  req.user.pushToken = pushToken.trim();
  await req.user.save();
  res.json({ ok: true });
});

module.exports = router;
