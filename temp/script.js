const messagesEl = document.querySelector('#messages');
const usersEl = document.querySelector('#users');
const friendsEl = document.querySelector('#friends');
const joinBtn = document.querySelector('#joinBtn');
const usernameInput = document.querySelector('#usernameInput');
const loginEl = document.querySelector('#login');
const chatEl = document.querySelector('#chat');
const messageInput = document.querySelector('#messageInput');
const imageInput = document.querySelector('#imageInput');
const imageUploadBtn = document.querySelector('#imageUploadBtn');
const sendBtn = document.querySelector('#sendBtn');
const connectionStatus = document.querySelector('#connectionStatus');
const roomLabelEl = document.querySelector('#roomLabel');
const roomSubtitleEl = document.querySelector('#roomSubtitle');
const clearDmBtn = document.querySelector('#clearDmBtn');
const profileCard = document.querySelector('#profileCard');
const profileName = document.querySelector('#profileName');
const profileAvatar = document.querySelector('#profileAvatar');
const friendsCount = document.querySelector('#friendsCount');

let socket = null;
let currentUsername = '';
let currentDM = null;
let connectedOnce = false;
let friends = [];
const FRIENDS_STORAGE_KEY = 'friends';

function normalizeName(name) {
  return String(name || '').trim();
}

function loadFriends() {
  try {
    const stored = localStorage.getItem(FRIENDS_STORAGE_KEY);
    const list = stored ? JSON.parse(stored) : [];
    if (!Array.isArray(list)) return [];
    return list.filter((name) => typeof name === 'string' && name.trim()).map((name) => normalizeName(name));
  } catch (err) {
    return [];
  }
}

function saveFriends() {
  localStorage.setItem(FRIENDS_STORAGE_KEY, JSON.stringify(friends));
}

function isFriend(username) {
  username = normalizeName(username);
  return friends.some((friend) => friend.toLowerCase() === username.toLowerCase());
}

function addFriend(username) {
  username = normalizeName(username);
  if (!username || isFriend(username) || username === currentUsername) return;
  friends.push(username);
  saveFriends();
  renderFriends();
  renderUserList(lastUserList || []);
}

function removeFriend(username) {
  username = normalizeName(username);
  friends = friends.filter((friend) => friend.toLowerCase() !== username.toLowerCase());
  saveFriends();
  renderFriends();
  renderUserList(lastUserList || []);
}

function toggleFriend(username) {
  if (isFriend(username)) {
    removeFriend(username);
  } else {
    addFriend(username);
  }
}

function updateProfileCard() {
  const avatar = getCookie('avatar');
  profileName.textContent = currentUsername || 'Unknown';
  profileAvatar.src = avatar || 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2248%22 height=%2248%22%3E%3Crect width=%2248%22 height=%2248%22 fill=%22%2309151f%22/%3E%3Ctext x=%2224%22 y=%2230%22 font-size=%2224%22 fill=%22%23ffffff%22 text-anchor=%22middle%22%3F%3C/text%3E%3C/svg%3E';
  profileAvatar.alt = `${currentUsername} avatar`;
}

function updateHeader() {
  if (currentDM) {
    roomLabelEl.textContent = `DM with ${currentDM}`;
    roomSubtitleEl.textContent = 'Direct message mode';
    clearDmBtn.classList.remove('hidden');
  } else {
    roomLabelEl.textContent = 'Public Chat Room';
    roomSubtitleEl.textContent = 'Global live chat';
    clearDmBtn.classList.add('hidden');
  }
}

function getCookie(name) {
  const matches = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return matches ? decodeURIComponent(matches[1]) : '';
}

function showChatArea() {
  loginEl.classList.add('hidden');
  chatEl.classList.remove('hidden');
  profileCard.classList.remove('hidden');
}

function showLoginArea() {
  chatEl.classList.add('hidden');
  loginEl.classList.remove('hidden');
  profileCard.classList.add('hidden');
}

function setConnectionStatus(text, status = '') {
  connectionStatus.textContent = text;
  connectionStatus.dataset.status = status;
}

function appendMessageNode(node) {
  messagesEl.appendChild(node);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function createSystemMessage(text) {
  const item = document.createElement('div');
  item.className = 'message-item system-message';
  const bubble = document.createElement('div');
  bubble.className = 'message-bubble system-bubble';
  bubble.textContent = text;
  item.appendChild(bubble);
  return item;
}

function createChatMessage(message) {
  const item = document.createElement('div');
  item.className = 'message-item';

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';

  const header = document.createElement('div');
  header.className = 'message-header';

  if (message.avatar) {
    const avatar = document.createElement('img');
    avatar.className = 'message-avatar';
    avatar.src = message.avatar;
    avatar.alt = `${message.username || message.from} avatar`;
    header.appendChild(avatar);
  }

  const author = document.createElement('div');
  author.className = 'message-author';
  const title = document.createElement('strong');
  title.textContent = message.username || message.from || 'Unknown';
  author.appendChild(title);
  if (message.private) {
    const privateTag = document.createElement('span');
    privateTag.className = 'private-tag';
    privateTag.textContent = `Private to ${message.to || 'unknown'}`;
    author.appendChild(privateTag);
  }
  header.appendChild(author);

  const timestamp = document.createElement('span');
  timestamp.className = 'message-time';
  timestamp.textContent = new Date(message.time || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  header.appendChild(timestamp);
  bubble.appendChild(header);

  if (message.text) {
    const text = document.createElement('p');
    text.className = 'message-text';
    text.textContent = String(message.text);
    bubble.appendChild(text);
  }

  if (message.image) {
    const imageWrap = document.createElement('div');
    imageWrap.className = 'message-image-wrap';
    const image = document.createElement('img');
    image.className = 'message-image';
    image.src = message.image;
    image.alt = 'Chat attachment';
    imageWrap.appendChild(image);
    bubble.appendChild(imageWrap);
  }

  item.appendChild(bubble);
  return item;
}

let lastUserList = [];

function renderUserList(users) {
  lastUserList = users;
  usersEl.innerHTML = '';
  users.forEach((user) => {
    const username = normalizeName(user.username || 'Anonymous');
    const li = document.createElement('li');
    li.className = 'user-item';
    li.dataset.username = username;
    li.addEventListener('click', () => startDM(username));

    const badge = document.createElement('span');
    badge.className = 'status-dot';
    li.appendChild(badge);

    if (user.avatar) {
      const avatar = document.createElement('img');
      avatar.className = 'user-avatar';
      avatar.src = user.avatar;
      avatar.alt = `${username} avatar`;
      li.appendChild(avatar);
    }

    const nameWrap = document.createElement('div');
    nameWrap.className = 'user-meta';
    const name = document.createElement('span');
    name.className = 'user-name';
    name.textContent = username;
    nameWrap.appendChild(name);

    if (isFriend(username)) {
      const tag = document.createElement('span');
      tag.className = 'friend-badge';
      tag.textContent = 'Friend';
      nameWrap.appendChild(tag);
    }

    li.appendChild(nameWrap);

    if (username !== currentUsername) {
      const friendBtn = document.createElement('button');
      friendBtn.type = 'button';
      friendBtn.className = 'friend-action-btn';
      friendBtn.textContent = isFriend(username) ? 'Remove' : 'Add';
      friendBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        toggleFriend(username);
      });
      li.appendChild(friendBtn);
    }

    usersEl.appendChild(li);
  });
}

function renderFriends() {
  friendsEl.innerHTML = '';
  friendsCount.textContent = friends.length ? `${friends.length}` : '';
  if (friends.length === 0) {
    const placeholder = document.createElement('li');
    placeholder.className = 'friend-placeholder';
    placeholder.textContent = 'No saved friends yet.';
    friendsEl.appendChild(placeholder);
    return;
  }

  friends.forEach((username) => {
    const li = document.createElement('li');
    li.className = 'friend-item';
    li.textContent = username;
    li.addEventListener('click', () => startDM(username));
    friendsEl.appendChild(li);
  });
}

function setupSocketListeners() {
  if (!socket) return;

  socket.on('connect', () => {
    connectedOnce = true;
    setConnectionStatus('Connected', 'online');
    if (currentUsername) {
      socket.emit('set username', currentUsername);
    }
  });

  socket.on('connect_error', () => {
    setConnectionStatus('Connection error', 'error');
    appendMessageNode(createSystemMessage('Unable to connect to chat server.')); 
  });

  socket.on('disconnect', () => {
    setConnectionStatus('Disconnected', 'offline');
    appendMessageNode(createSystemMessage('Disconnected from server.')); 
  });

  socket.on('system message', (msg) => {
    const text = (msg && msg.text) ? String(msg.text) : String(msg || 'System event');
    appendMessageNode(createSystemMessage(text));
  });

  socket.on('chat message', (message) => {
    appendMessageNode(createChatMessage(message));
  });

  socket.on('private message', (message) => {
    appendMessageNode(createChatMessage(message));
  });

  socket.on('user list', (list) => {
    renderUserList(Array.isArray(list) ? list : []);
  });

  socket.on('server status', (status) => {
    if (status && typeof status.open === 'boolean') {
      setConnectionStatus(status.open ? 'Server open' : 'Server closed', status.open ? 'online' : 'offline');
    }
  });
}

function startDM(username) {
  username = normalizeName(username);
  if (!username || username === currentUsername) return;
  currentDM = username;
  updateHeader();
  appendMessageNode(createSystemMessage(`DM mode enabled with ${username}.`));
  messageInput.focus();
}

function clearDM() {
  if (!currentDM) return;
  currentDM = null;
  updateHeader();
  appendMessageNode(createSystemMessage('Returned to public chat.'));
  messageInput.focus();
}

function connectAndJoin(username) {
  if (!username) return;
  currentUsername = username;

  if (!socket) {
    socket = io();
    setupSocketListeners();
  }

  if (socket.connected) {
    socket.emit('set username', username);
    return;
  }

  socket.emit('set username', username);
}

joinBtn.addEventListener('click', () => {
  const username = String(usernameInput.value || '').trim().slice(0, 20);
  if (!username) {
    usernameInput.focus();
    return;
  }

  showChatArea();
  connectAndJoin(username);
  messageInput.focus();
});

imageUploadBtn.addEventListener('click', () => {
  if (imageInput) {
    imageInput.click();
  }
});

imageInput.addEventListener('change', () => {
  if (!imageInput.files || !imageInput.files[0]) return;
  const file = imageInput.files[0];
  if (file.size > 5 * 1024 * 1024) {
    appendMessageNode(createSystemMessage('Image file is too large.'));
    imageInput.value = '';
  }
});

clearDmBtn.addEventListener('click', () => {
  clearDM();
});

sendBtn.addEventListener('click', async () => {
  const text = String(messageInput.value || '').trim();
  const file = imageInput.files && imageInput.files[0];

  if (!text && !file) {
    messageInput.focus();
    return;
  }

  if (!socket || !socket.connected) {
    appendMessageNode(createSystemMessage('Waiting for connection...'));
    return;
  }

  sendBtn.disabled = true;
  try {
    let payload = text;
    if (file) {
      const url = await uploadImage(file);
      payload = text ? { text, image: url } : { image: url };
      imageInput.value = '';
    }
    if (currentDM) {
      socket.emit('private message', { target: currentDM, text: payload.text || payload, image: payload.image || undefined });
    } else {
      socket.emit('chat message', payload);
    }
    messageInput.value = '';
  } catch (error) {
    appendMessageNode(createSystemMessage(error.message || 'Unable to send message.'));
  } finally {
    sendBtn.disabled = false;
    messageInput.focus();
  }
});

messageInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    sendBtn.click();
  }
});

async function uploadImage(file) {
  const form = new FormData();
  form.append('image', file);
  const response = await fetch('/upload-image', { method: 'POST', body: form });
  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.error || 'Image upload failed');
  }
  return result.url;
}

function initialize() {
  friends = loadFriends();
  renderFriends();
  const username = getCookie('username');
  if (username) {
    usernameInput.value = username;
    currentUsername = normalizeName(username);
    updateProfileCard();
    showChatArea();
    connectAndJoin(username);
    updateHeader();
    return;
  }

  showLoginArea();
}

initialize();
