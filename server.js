require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const mongoose = require('mongoose');
const path = require('path');
const { Server } = require('socket.io');
const authRoutes = require('./src/routes/auth');
const userRoutes = require('./src/routes/users');
const messageRoutes = require('./src/routes/messages');
const callRoutes = require('./src/routes/calls');
const { attachSocket } = require('./src/socket');

const app = express();
app.use(helmet());
app.use(cors({ origin: process.env.CLIENT_URL || '*' }));
app.use(express.json());

// Rate limits. /health stays un-limited.
const authLimiter = rateLimit({ windowMs: 60 * 1000, max: 10, standardHeaders: 'draft-7', legacyHeaders: false });
const apiLimiter = rateLimit({ windowMs: 60 * 1000, max: 300, standardHeaders: 'draft-7', legacyHeaders: false });
app.use('/api/auth', authLimiter);
app.use('/api', apiLimiter);

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.get('/health', (req, res) => res.json({ ok: true, app: 'spider', time: new Date().toISOString() }));
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/calls', callRoutes);
app.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: 'Server error' }); });

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });
attachSocket(io);

const PORT = process.env.PORT || 5000;
mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/spider')
  .then(() => {
    console.log('MongoDB connected');
    server.listen(PORT, '0.0.0.0', () => console.log(`Spider server on http://0.0.0.0:${PORT}`));
  })
  .catch((e) => { console.error('MongoDB failed:', e.message); process.exit(1); });
