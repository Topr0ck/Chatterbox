console.log("SERVER FILE LOADED");
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');
const session = require('express-session');
const multer = require('multer');
const cookieParser = require('cookie-parser');

const USERS_FILE = path.join(__dirname, 'users.json');
const MESSAGES_FILE = path.join(__dirname, 'messages.json');
const MESSAGE_HISTORY_LIMIT = 1000;
const MESSAGE_SEND_LIMIT = 100;

function readUsers() {
  try {
    const raw = fs.readFileSync(USERS_FILE, 'utf8');
    return JSON.parse(raw || '[]');
  } catch (e) {
    return [];
  }
}

function writeUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

function readMessages() {
  try {
    const raw = fs.readFileSync(MESSAGES_FILE, 'utf8');
    return JSON.parse(raw || '[]');
  } catch (e) {
    return [];
  }
}

function writeMessages(messagesData) {
  fs.writeFile(MESSAGES_FILE, JSON.stringify(messagesData, null, 2), (err) => {
    if (err) console.error('Failed to save messages:', err);
  });
}

function isValidUserCookie(name) {
  if (!name) return false;
  const users = readUsers();
  return users.some(u => String(u.username || '').toLowerCase() === String(name).toLowerCase());
}

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const upload = multer({ dest: path.join(__dirname, 'public', 'uploads') });
const uploadImage = multer({ dest: path.join(__dirname, 'public', 'uploads'), limits: { fileSize: 5 * 1024 * 1024 }, fileFilter: (req, file, cb) => {
  if (!file.mimetype.startsWith('image/')) return cb(new Error('Not an image'), false);
  cb(null, true);
}});

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
app.use(session({ secret: 'dev-secret', resave: false, saveUninitialized: false }));

app.get('/', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.cookies && isValidUserCookie(req.cookies.username)) {
    return res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
  res.sendFile(path.join(__dirname, 'public', 'home.html'));
});

app.get('/index.html', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  return res.redirect('/');
});

app.get('/home.html', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  return res.redirect('/');
});

app.get('/auth', (req, res) => {
  res.redirect('/login');
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/signup', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'signup.html'));
});

app.get('/chat', (req, res) => {
  if (req.cookies && isValidUserCookie(req.cookies.username)) {
    return res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
  return res.redirect('/');
});

app.use(express.static(path.join(__dirname, 'public'), { index: false }));

app.post('/signup', upload.single('avatar'), async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).send('Missing');
  const users = readUsers();
  if (users.find(u => u.username.toLowerCase() === username.toLowerCase())) {
    return res.status(400).send('Username taken');
  }
  const hash = await bcrypt.hash(password, 10);
  const user = { id: Date.now().toString(36), username: username.slice(0,20), passwordHash: hash };
  if (req.file) {
    // keep original extension
    const ext = path.extname(req.file.originalname) || '';
    const name = `${user.id}${ext}`;
    const dest = path.join(__dirname, 'public', 'uploads', name);
    fs.renameSync(req.file.path, dest);
    user.avatar = `/uploads/${name}`;
  }
  users.push(user);
  writeUsers(users);
  // set simple cookies for client to pick up
  res.cookie('username', user.username, { maxAge: 1000*60*60*24*7 });
  if (user.avatar) res.cookie('avatar', user.avatar, { maxAge: 1000*60*60*24*7 });
  res.redirect('/');
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).send('Missing');
  const users = readUsers();
  const user = users.find(u => u.username.toLowerCase() === username.toLowerCase());
  if (!user) return res.status(400).send('Invalid');
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(400).send('Invalid');
  res.cookie('username', user.username, { maxAge: 1000*60*60*24*7 });
  if (user.avatar) res.cookie('avatar', user.avatar, { maxAge: 1000*60*60*24*7 });
  res.redirect('/');
});

app.post('/upload-image', (req, res) => {
  uploadImage.single('image')(req, res, (err) => {
    if (err) {
      console.error('upload error', err);
      return res.status(400).json({ error: err.message || 'Upload error' });
    }
    if (!req.file) return res.status(400).json({ error: 'No file' });
    try {
      console.log('upload received:', { originalname: req.file.originalname, size: req.file.size, mimetype: req.file.mimetype });
      const ext = path.extname(req.file.originalname) || '';
      const id = Date.now().toString(36);
      const name = `${id}${ext}`;
      const dest = path.join(__dirname, 'public', 'uploads', name);
      fs.renameSync(req.file.path, dest);
      const url = `/uploads/${name}`;
      console.log('upload saved ->', url);
      return res.json({ url });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: 'Upload failed' });
    }
  });
});

app.get('/logout', (req, res) => {
  res.clearCookie('username');
  res.clearCookie('avatar');
  res.redirect('/login');
});

const usernames = new Map();
const messages = readMessages().slice(-MESSAGE_HISTORY_LIMIT);
const feedbacks = [];
const timeouts = new Map();
const messageRates = new Map();
let serverOpen = true;

function generateId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;
}

function getUserRoom(username) {
  return `user:${String(username).toLowerCase()}`;
}

function persistMessage(message) {
  messages.push(message);
  while (messages.length > MESSAGE_HISTORY_LIMIT) {
    messages.shift();
  }
  writeMessages(messages);
}

function emitUserList() {
  const list = Array.from(usernames.entries()).map(([id, u]) => ({ id, username: u.username, avatar: u.avatar }));
  io.emit('user list', list);
}

function isAdminSocket(socket) {
  const user = usernames.get(socket.id);
  return user && user.username === 'ADMIN / OWNER';
}

function emitAdminFeedback(feedback) {
  for (const [id, u] of usernames.entries()) {
    if (u.username === 'ADMIN / OWNER') {
      io.to(id).emit('admin feedback', feedback);
    }
  }
}

function emitAdminData(socket) {
  socket.emit('admin data', { messages, feedbacks });
}

function createSystemMessage(text) {
  return {
    system: true,
    text,
    time: new Date().toISOString(),
  };
}

function isUserSpamming(user) {
  const key = user.username.toLowerCase();
  const now = Date.now();
  const windowMs = 5000;
  const limit = 10;
  const timeoutMs = 30000;
  const history = (messageRates.get(key) || []).filter((ts) => ts > now - windowMs);
  history.push(now);
  messageRates.set(key, history);
  if (history.length > limit) {
    const until = now + timeoutMs;
    timeouts.set(key, until);
    const found = findSocketByUsername(user.username);
    if (found) {
      const [socketId] = found;
      io.to(socketId).emit('system message', createSystemMessage('Too many messages. You are timed out for 30 seconds.'));
      io.to(socketId).disconnectSockets(true);
    }
    return true;
  }
  return false;
}

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('set username', (payload) => {
    let username = '';
    let avatar = '';
    if (typeof payload === 'string') username = payload.trim().slice(0,20);
    else if (payload && typeof payload === 'object') {
      username = String(payload.username || '').trim().slice(0,20);
      avatar = String(payload.avatar || '').trim();
    }
    if (!username) return;
    const timeoutUntil = timeouts.get(username.toLowerCase());
    if (timeoutUntil && timeoutUntil > Date.now()) {
      socket.emit('system message', createSystemMessage(`You are timed out until ${new Date(timeoutUntil).toLocaleString()}.`));
      return socket.disconnect(true);
    }
    usernames.set(socket.id, { username, avatar });
    socket.join(getUserRoom(username));
    io.emit('system message', createSystemMessage(`${username} joined the chat.`));
    emitUserList();
    // send current list to the newly connected client as well
    const usersList = Array.from(usernames.entries()).map(([id, u]) => ({ id, username: u.username, avatar: u.avatar }));
    socket.emit('user list', usersList);
    socket.emit('server status', { open: serverOpen });
    const historyMessages = messages.filter((msg) => !msg.private).slice(-MESSAGE_SEND_LIMIT);
    historyMessages.forEach((historyMessage) => socket.emit('chat message', historyMessage));
    if (username === 'ADMIN / OWNER') {
      emitAdminData(socket);
    }
  });

  socket.on('chat message', (msg) => {
    const user = usernames.get(socket.id);
    if (!user || !serverOpen) {
      if (user) {
        socket.emit('system message', createSystemMessage('Server is closed. Please wait until it reopens.'));
      }
      return;
    }
    if (isUserSpamming(user)) return;

    let text = '';
    let image = '';
    if (typeof msg === 'string') text = msg.trim();
    else if (msg && typeof msg === 'object') {
      text = msg.text !== undefined ? msg.text : '';
      image = String(msg.image || '').trim();
    }
    if (!text && !image) return;

    // normalize text to string
    try {
      if (typeof text === 'object') {
        text = JSON.stringify(text);
      } else {
        text = String(text).trim();
      }
    } catch (e) {
      text = String(text || '');
    }

    // mention detection
    function escapeRegExp(string) {
      return string.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&');
    }
    const mentions = [];
    for (const [, u] of usernames.entries()) {
      const uname = u.username;
      if (!uname) continue;
      const re = new RegExp(`@${escapeRegExp(uname)}\\b`, 'i');
      if (re.test(text)) mentions.push(uname);
    }

    const message = {
      id: generateId(),
      username: user.username,
      avatar: user.avatar,
      text: (typeof text === 'string') ? text : JSON.stringify(text),
      image: image || undefined,
      mentions,
      time: new Date().toISOString(),
      private: false,
    };
    persistMessage(message);
    io.emit('chat message', message);
  });

  function findSocketByUsername(target) {
    return Array.from(usernames.entries()).find(([, u]) => u.username.toLowerCase() === target.toLowerCase());
  }

  socket.on('private message', (payload) => {
    const user = usernames.get(socket.id);
    if (!user || !payload || !serverOpen) {
      if (user && !serverOpen) {
        socket.emit('system message', createSystemMessage('Server is closed. Please wait until it reopens.'));
      }
      return;
    }
    if (isUserSpamming(user)) return;
    const targetName = String(payload.target || '').trim();
    if (!targetName || targetName.toLowerCase() === user.username.toLowerCase()) return;
    const found = findSocketByUsername(targetName);
    if (!found) return;
    const [targetId, targetUser] = found;

    let text = payload.text !== undefined ? payload.text : '';
    let image = String(payload.image || '').trim();
    if (!text && !image) return;

    try {
      if (typeof text === 'object') text = JSON.stringify(text);
      else text = String(text).trim();
    } catch (e) {
      text = String(text || '');
    }

    const mentions = [];
    for (const [, u] of usernames.entries()) {
      const uname = u.username;
      if (!uname) continue;
      const re = new RegExp(`@${uname.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\b`, 'i');
      if (re.test(text)) mentions.push(uname);
    }

    const message = {
      id: generateId(),
      private: true,
      from: user.username,
      to: targetUser.username,
      avatar: user.avatar,
      text,
      image: image || undefined,
      mentions,
      time: new Date().toISOString(),
    };
    persistMessage(message);
    const targetRoom = getUserRoom(targetUser.username);
    io.to(targetRoom).emit('private message', message);
    socket.emit('private message', message);
  });

  socket.on('feedback', (payload) => {
    const user = usernames.get(socket.id);
    if (!user || user.username === 'ADMIN / OWNER') return;
    const entry = {
      id: generateId(),
      username: user.username,
      text: String((payload && payload.text) || '').trim(),
      time: new Date().toISOString(),
    };
    if (!entry.text) return;
    feedbacks.push(entry);
    emitAdminFeedback(entry);
    socket.emit('feedback submitted', { success: true });
  });

  socket.on('admin command', (command) => {
    if (!isAdminSocket(socket) || !command || typeof command !== 'object') return;
    const { action, target, message: cmdMessage } = command;
    if (action === 'delete-message') {
      const msgIndex = messages.findIndex((m) => m.id === target);
      if (msgIndex !== -1) {
        const [deleted] = messages.splice(msgIndex, 1);
        io.emit('system message', createSystemMessage(`Admin deleted a message from ${deleted.username || deleted.from}.`));
        io.emit('delete message', target);
      }
    } else if (action === 'timeout-user' && target) {
      const existing = Array.from(usernames.entries()).find(([, u]) => u.username.toLowerCase() === target.toLowerCase());
      const timeoutSeconds = Number(cmdMessage) || 60;
      const until = Date.now() + timeoutSeconds * 1000;
      timeouts.set(target.toLowerCase(), until);
      if (existing) {
        const [socketId] = existing;
        io.to(socketId).emit('system message', createSystemMessage(`You have been timed out by admin until ${new Date(until).toLocaleString()}.`));
        io.to(socketId).disconnectSockets(true);
      }
      io.emit('system message', createSystemMessage(`Admin timed out user ${target} for ${timeoutSeconds} seconds.`));
    } else if (action === 'shutdown-server') {
      serverOpen = false;
      io.emit('system message', createSystemMessage('Admin closed the server for new messages.'));
      io.emit('server status', { open: serverOpen });
    }
  });

  socket.on('reopen server', () => {
    if (!isAdminSocket(socket) || serverOpen) return;
    serverOpen = true;
    io.emit('system message', createSystemMessage('Admin reopened the server.'));
    io.emit('server status', { open: serverOpen });
  });

  socket.on('disconnect', () => {
    const user = usernames.get(socket.id);
    if (user) {
      io.emit('system message', createSystemMessage(`${user.username} left the chat.`));
      usernames.delete(socket.id);
      emitUserList();
    }
    console.log('User disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Public chat running on http://localhost:${PORT}`);
});

app.get('/test', (req, res) => {
  res.send(__dirname);
});

