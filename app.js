// app.js
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
const bodyParser = require('body-parser');
const multer = require('multer');
const QRCode = require('qrcode');
const PDFDocument = require('pdfkit');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const shortid = require('shortid');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

/* ================= CONFIG ================= */
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret';
const MONGO_URI =
  process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/qr_studio';

/* ================= DATABASE ================= */
mongoose
  .connect(MONGO_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('❌ MongoDB error:', err));

const User = mongoose.model(
  'User',
  new mongoose.Schema(
    {
      name: String,
      email: { type: String, unique: true },
      passwordHash: String,
      provider: String,
      providerId: String
    },
    { timestamps: true }
  )
);

const QRModel = mongoose.model(
  'QRCode',
  new mongoose.Schema(
    {
      userId: mongoose.Schema.Types.ObjectId,
      title: String,
      targetUrl: String,
      shortId: { type: String, unique: true },
      qrImage: String,
      scans: { type: Number, default: 0 },
      scanHistory: [{ timestamp: Date }]
    },
    { timestamps: true }
  )
);

/* ================= MIDDLEWARE ================= */
app.use(express.static('public'));
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));
app.use(passport.initialize());

/* ================= HELPERS ================= */
function getUserId(req) {
  if (!req.headers.authorization) return null;
  try {
    const token = req.headers.authorization.split(' ')[1];
    return jwt.verify(token, JWT_SECRET).userId;
  } catch {
    return null;
  }
}

function ensureUploadsDir() {
  const dir = path.join(__dirname, 'public', 'uploads');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/* ================= GOOGLE AUTH ================= */
passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: `${BASE_URL}/auth/google/callback`
    },
    async (_, __, profile, done) => {
      const email = profile.emails[0].value;
      let user = await User.findOne({ email });
      if (!user) {
        user = await User.create({
          name: profile.displayName,
          email,
          provider: 'google',
          providerId: profile.id
        });
      }
      done(null, user);
    }
  )
);

/* ================= AUTH ROUTES ================= */
app.get('/login', (_, res) => {
  res.sendFile(path.join(__dirname, 'public', 'auth.html'));
});

app.post('/api/signup', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({ name, email, passwordHash });
    const token = jwt.sign({ userId: user._id }, JWT_SECRET, {
      expiresIn: '7d'
    });
    res.json({ token, user: { name, email } });
  } catch {
    res.status(400).json({ error: 'Email already exists' });
  }
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email });
  if (!user || !user.passwordHash) {
    return res.status(400).json({ error: 'Invalid credentials' });
  }
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(400).json({ error: 'Invalid credentials' });

  const token = jwt.sign({ userId: user._id }, JWT_SECRET, {
    expiresIn: '7d'
  });
  res.json({ token, user: { name: user.name, email: user.email } });
});

/* ================= GOOGLE OAUTH ================= */
app.get(
  '/auth/google',
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

app.get(
  '/auth/google/callback',
  passport.authenticate('google', { session: false, failureRedirect: '/login' }),
  (req, res) => {
    const token = jwt.sign({ userId: req.user._id }, JWT_SECRET, {
      expiresIn: '7d'
    });
    res.redirect(
      `/auth-complete.html?token=${token}&name=${encodeURIComponent(
        req.user.name
      )}&email=${encodeURIComponent(req.user.email)}`
    );
  }
);

/* ================= QR SCAN TRACKING ================= */
app.get('/r/:shortId', async (req, res) => {
  const qr = await QRModel.findOne({ shortId: req.params.shortId });
  if (!qr) return res.status(404).send('QR not found');

  qr.scans += 1;
  qr.scanHistory.push({ timestamp: new Date() });
  await qr.save();

  res.redirect(qr.targetUrl);
});

/* ================= QR GENERATION ================= */
app.post('/generate', upload.single('file'), async (req, res) => {
  try {
    const userId = getUserId(req);
    const mode = req.body.mode || 'text';
    const title = (req.body.title || '').trim() || 'Untitled';

    let targetUrl = '';

    if (mode === 'text') {
      if (!req.body.content) {
        return res.status(400).json({ error: 'Content missing' });
      }
      targetUrl = req.body.content.trim();
    }

    if (mode === 'file') {
      if (!req.file) {
        return res.status(400).json({ error: 'File missing' });
      }
      const filename =
        Date.now() +
        '_' +
        req.file.originalname.replace(/[^a-zA-Z0-9.]/g, '_');
      fs.writeFileSync(
        path.join(ensureUploadsDir(), filename),
        req.file.buffer
      );
      targetUrl = `${BASE_URL}/uploads/${filename}`;
    }

    let finalPayload = targetUrl;
    let shortId = null;
    let qrImage = null;

    if (userId) {
      shortId = shortid.generate();
      finalPayload = `${BASE_URL}/r/${shortId}`;
      qrImage = await QRCode.toDataURL(finalPayload, { width: 300 });

      await QRModel.create({
        userId,
        title,
        targetUrl,
        shortId,
        qrImage
      });
    }

    const pngDataUrl = await QRCode.toDataURL(finalPayload, {
      width: parseInt(req.body.size || 400),
      margin: 4,
      color: {
        dark: req.body.color || '#000000',
        light: req.body.bgcolor || '#ffffff'
      }
    });

    const doc = new PDFDocument({ autoFirstPage: false });
    const buffers = [];

    doc.on('data', b => buffers.push(b));
    doc.on('end', () => {
      res.json({
        pngDataUrl,
        pdfDataUrl:
          'data:application/pdf;base64,' +
          Buffer.concat(buffers).toString('base64')
      });
    });

    doc.addPage({ size: 'A4' });
    doc.image(Buffer.from(pngDataUrl.split(',')[1], 'base64'), 50, 50, {
      width: 400
    });
    doc.end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

/* ================= DASHBOARD ================= */
app.get('/api/dashboard-stats', async (req, res) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const qrs = await QRModel.find({ userId }).sort({ createdAt: -1 });
  const totalScans = qrs.reduce((s, q) => s + q.scans, 0);

  const graphData = Array(7).fill(0);
  const now = new Date();

  qrs.forEach(qr =>
    qr.scanHistory.forEach(s => {
      const diff = Math.floor((now - s.timestamp) / 86400000);
      if (diff >= 0 && diff < 7) graphData[6 - diff]++;
    })
  );

  res.json({ totalQRs: qrs.length, totalScans, graphData, qrList: qrs });
});

/* ================= DELETE QR ================= */
app.delete('/api/qr/:id', async (req, res) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const qr = await QRModel.findOne({
    _id: req.params.id,
    userId
  });
  if (!qr) return res.status(404).json({ error: 'QR not found' });

  await qr.deleteOne();
  res.json({ success: true });
});

/* ================= STATIC FALLBACK ================= */
app.get(/.*/, (req, res) => {
  const filePath =
    req.path === '/' || req.path === '/index.html'
      ? path.join(__dirname, 'public', 'index.html')
      : path.join(__dirname, 'public', req.path);

  if (fs.existsSync(filePath)) return res.sendFile(filePath);
  res.status(404).send('Page not found');
});

/* ================= START ================= */
app.listen(PORT, () => {
  console.log(`🚀 Server running at ${BASE_URL}`);
});
