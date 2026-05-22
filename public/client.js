const socket = io();
const form = document.getElementById('chat-form');
const input = document.getElementById('message-input');
const messages = document.getElementById('messages');
const usernameOverlay = document.getElementById('username-overlay');
const usernameForm = document.getElementById('username-form');
const usernameInput = document.getElementById('username-input');
const welcomeText = document.getElementById('welcome-text');
const chatTitle = document.getElementById('chat-title');
const backPublicButton = document.getElementById('back-public');
const adminPanelButton = document.getElementById('admin-panel-button');
const adminPanel = document.getElementById('admin-panel');
const adminClose = document.getElementById('admin-close');
const adminTabMessages = document.getElementById('admin-tab-messages');
const adminTabFeedback = document.getElementById('admin-tab-feedback');
const adminMessagesSection = document.getElementById('admin-messages-section');
const adminFeedbackSection = document.getElementById('admin-feedback-section');
const adminMessagesList = document.getElementById('admin-messages-list');
const adminFeedbackList = document.getElementById('admin-feedback-list');
const adminShutdown = document.getElementById('admin-shutdown');
const adminReopen = document.getElementById('admin-reopen');
const serverStatus = document.getElementById('server-status');
const feedbackWidget = document.getElementById('feedback-widget');
const feedbackToggle = document.getElementById('feedback-toggle');
const feedbackForm = document.getElementById('feedback-form');
const feedbackText = document.getElementById('feedback-text');
const feedbackSend = document.getElementById('feedback-send');
const sendButton = form.querySelector('button');
const usersList = document.getElementById('users');
const imageInput = document.getElementById('image-input');

let username = '';
let avatar = '';
let currentChat = 'public';
let isAdmin = false;
let serverOpen = true;
const messagesState = [];
const adminFeedbacks = [];
let onlineUsers = [];

function createAvatarDataURL(name) {
  const initial = (name && name[0]) ? name[0].toUpperCase() : '?';
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='64' height='64'><rect width='100%' height='100%' fill='%23222'/><text x='50%' y='50%' fill='%23fff' font-family='sans-serif' font-size='32' dominant-baseline='middle' text-anchor='middle'>${initial}</text></svg>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

function parseCookies() {
  return document.cookie.split(';').map(c => c.trim()).filter(Boolean).reduce((acc, cur) => {
    const [k, ...v] = cur.split('=');
    acc[decodeURIComponent(k)] = decodeURIComponent(v.join('='));
    return acc;
  }, {});
}

// Auto-login if server set cookies on redirect
const cookies = parseCookies();
if (cookies.username) {
  username = cookies.username;
  avatar = cookies.avatar || '';
  // show chat UI immediately and send auth to socket
  enableChat();
  socket.emit('set username', { username, avatar });
}

function addMessage(message, shouldScroll = true) {
  if (typeof message === 'string') {
    message = { text: message, system: false, time: new Date().toISOString() };
  }
  if (message && typeof message.text === 'object') {
    message.text = JSON.stringify(message.text);
  }
  if (!message.avatar && message.username) message.avatar = '';
  const item = document.createElement('li');
  item.className = message.system ? 'system' : '';
  if (message.private) item.classList.add('private');

  if (message.system) {
    item.textContent = message.text;
  } else {
    const meta = document.createElement('div');
    meta.className = 'meta';
    const timeLabel = new Date(message.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    meta.textContent = `${timeLabel} • ${message.username}`;
    if (message.private) {
      const tag = document.createElement('span');
      tag.className = 'meta-private';
      tag.textContent = `Private to ${message.to === username ? message.from : message.to}`;
      meta.appendChild(tag);
    }
    const img = document.createElement('img');
    img.style.width = '28px';
    img.style.height = '28px';
    img.style.objectFit = 'cover';
    img.style.borderRadius = '50%';
    img.style.marginRight = '8px';
    img.style.verticalAlign = 'middle';
    img.alt = message.username || '';
    img.src = message.avatar || createAvatarDataURL(message.username || '');
    img.onerror = () => { img.src = createAvatarDataURL(message.username || ''); };
    item.appendChild(img);
    item.appendChild(meta);
    // render text with mentions highlighted
    const textNode = document.createElement('div');
    textNode.style.marginTop = '6px';
    const escapeHtml = (s) => s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
    let rendered = escapeHtml(message.text || '');
    if (message.mentions && message.mentions.length) {
      message.mentions.forEach(m => {
        const re = new RegExp('(@' + m.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&') + ')', 'gi');
        rendered = rendered.replace(re, '<span class="mention">$1</span>');
      });
    }
    textNode.innerHTML = rendered;
    item.appendChild(textNode);

    // image attachment
    if (message.image) {
      const img2 = document.createElement('img');
      img2.src = message.image;
      img2.className = 'message-image';
      img2.alt = 'attachment';
      img2.onerror = () => { img2.style.display = 'none'; };
      item.appendChild(img2);
    }
  }

  messages.appendChild(item);
  if (shouldScroll) messages.scrollTop = messages.scrollHeight;
}

function enableChat() {
  usernameOverlay.hidden = true;
  usernameOverlay.classList.add('hidden');
  usernameOverlay.style.display = 'none';
  input.disabled = false;
  sendButton.disabled = false;
  input.focus();
  welcomeText.textContent = `You are chatting as ${username}.`;
  if (username === 'ADMIN / OWNER') {
    isAdmin = true;
    adminPanelButton.hidden = false;
    feedbackWidget.classList.add('hidden');
  } else {
    isAdmin = false;
    adminPanelButton.hidden = true;
    feedbackWidget.classList.remove('hidden');
  }
  adminShutdown.classList.toggle('hidden', !isAdmin || !serverOpen);
  adminReopen.classList.toggle('hidden', !isAdmin || serverOpen);
}

function updateChatTitle() {
  if (currentChat === 'public') {
    chatTitle.textContent = 'Public Chat';
    backPublicButton.hidden = true;
  } else {
    chatTitle.textContent = `Chat with ${currentChat}`;
    backPublicButton.hidden = false;
  }
}

function updateServerStatus(open) {
  serverOpen = Boolean(open);
  serverStatus.textContent = `Server status: ${serverOpen ? 'Open' : 'Closed'}`;
  adminShutdown.classList.toggle('hidden', !isAdmin || !serverOpen);
  adminReopen.classList.toggle('hidden', !isAdmin || serverOpen);
}

function renderAdminMessages() {
  adminMessagesList.innerHTML = '';
  messagesState.slice().reverse().forEach(message => {
    if (message.system) return;
    const item = document.createElement('div');
    item.className = 'admin-item';
    const header = document.createElement('header');
    const title = document.createElement('div');
    title.textContent = `${message.private ? 'Private' : 'Public'} • ${message.username}`;
    const controls = document.createElement('div');
    const deleteButton = document.createElement('button');
    deleteButton.textContent = 'Delete';
    deleteButton.addEventListener('click', () => {
      socket.emit('admin command', { action: 'delete-message', target: message.id });
    });
    controls.appendChild(deleteButton);
    header.appendChild(title);
    header.appendChild(controls);
    item.appendChild(header);
    const body = document.createElement('div');
    body.textContent = message.text || '';
    item.appendChild(body);
    if (message.image) {
      const img = document.createElement('img');
      img.className = 'message-image';
      img.src = message.image;
      img.alt = 'attachment';
      item.appendChild(img);
    }
    adminMessagesList.appendChild(item);
  });
}

function renderAdminFeedback() {
  adminFeedbackList.innerHTML = '';
  adminFeedbacks.slice().reverse().forEach(feedback => {
    const item = document.createElement('div');
    item.className = 'admin-item';
    const header = document.createElement('header');
    const title = document.createElement('div');
    title.textContent = `From ${feedback.username}`;
    const time = document.createElement('div');
    time.textContent = new Date(feedback.time).toLocaleString();
    header.appendChild(title);
    header.appendChild(time);
    item.appendChild(header);
    const body = document.createElement('div');
    body.textContent = feedback.text;
    item.appendChild(body);
    adminFeedbackList.appendChild(item);
  });
}

function openAdminPanel() {
  if (!isAdmin) return;
  adminPanel.classList.remove('hidden');
  renderAdminMessages();
  renderAdminFeedback();
}

function closeAdminPanel() {
  adminPanel.classList.add('hidden');
}

function shouldRenderMessage(message) {
  if (message.system) return currentChat === 'public';
  if (!message.private) {
    return currentChat === 'public';
  }
  if (currentChat === 'public') return false;
  return (
    (message.from === currentChat && message.to === username) ||
    (message.from === username && message.to === currentChat)
  );
}

function renderMessages() {
  messages.innerHTML = '';
  messagesState.forEach(message => {
    if (shouldRenderMessage(message)) addMessage(message, false);
  });
  messages.scrollTop = messages.scrollHeight;
}

usernameForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const value = usernameInput.value.trim();
  if (!value) return;
  username = value.slice(0, 20);
  socket.emit('set username', username);
  enableChat();
});

socket.on('chat message', (message) => {
  message.private = false;
  messagesState.push(message);
  if (currentChat === 'public') addMessage(message);
});

socket.on('private message', (message) => {
  message.private = true;
  messagesState.push(message);
  if (shouldRenderMessage(message)) addMessage(message);
});

socket.on('system message', (message) => {
  messagesState.push(message);
  if (currentChat === 'public') addMessage(message);
});

socket.on('delete message', (payload) => {
  const messageId = typeof payload === 'string' ? payload : (payload && (payload.messageId || payload.id));
  const index = messagesState.findIndex(m => m.id === messageId);
  if (index !== -1) {
    messagesState.splice(index, 1);
    renderMessages();
  }
});

socket.on('admin data', (data) => {
  if (!isAdmin || !data) return;
  if (Array.isArray(data.messages)) {
    messagesState.length = 0;
    data.messages.forEach(message => messagesState.push(message));
  }
  if (Array.isArray(data.feedbacks)) {
    adminFeedbacks.length = 0;
    data.feedbacks.forEach(item => adminFeedbacks.push(item));
  }
  if (!adminPanel.classList.contains('hidden')) {
    renderAdminMessages();
    renderAdminFeedback();
  }
});

socket.on('admin feedback', (feedback) => {
  if (!isAdmin) return;
  adminFeedbacks.push(feedback);
  if (!adminPanel.classList.contains('hidden') && !adminFeedbackSection.classList.contains('hidden')) {
    renderAdminFeedback();
  }
});

socket.on('user list', (list) => {
  onlineUsers = list;
  // render online users
  usersList.innerHTML = '';
  list.forEach(u => {
    const li = document.createElement('li');
    li.className = 'online';
    const img = document.createElement('img');
    img.className = 'avatar';
    img.alt = u.username;
    img.src = u.avatar || createAvatarDataURL(u.username || '');
    img.onerror = () => { img.src = createAvatarDataURL(u.username || ''); };
    li.appendChild(img);
    const span = document.createElement('span');
    span.textContent = u.username;
    li.appendChild(span);
    if (u.username !== username) {
      li.style.cursor = 'pointer';
      li.addEventListener('click', () => {
        currentChat = u.username;
        updateChatTitle();
        renderMessages();
      });
    }
    usersList.appendChild(li);
  });
});

form.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!username || !serverOpen) {
    addMessage({ system: true, text: 'The server is closed. Please wait until it reopens.', time: new Date().toISOString() });
    return;
  }
  (async () => {
    const value = input.value.trim();
    const file = imageInput.files && imageInput.files[0];
    if (!value && !file) return;

    let imageUrl = '';
    if (file) {
      const fd = new FormData();
      fd.append('image', file);
      try {
        const res = await fetch('/upload-image', { method: 'POST', body: fd });
        const data = await res.json();
        if (!res.ok) {
          addMessage({ system: true, text: `Image upload failed: ${data && data.error ? data.error : res.statusText}` , time: new Date().toISOString() });
          return;
        } else if (data && data.url) {
          imageUrl = data.url;
        }
      } catch (e) {
        addMessage({ system: true, text: 'Image upload failed.' , time: new Date().toISOString() });
        return;
      }
    }

    const payload = { text: value || '', image: imageUrl || '' };
    if (currentChat === 'public') {
      socket.emit('chat message', payload);
    } else {
      socket.emit('private message', { target: currentChat, ...payload });
    }
    input.value = '';
    imageInput.value = '';
    input.focus();
  })();
});

backPublicButton.addEventListener('click', () => {
  currentChat = 'public';
  updateChatTitle();
  renderMessages();
});

adminPanelButton.addEventListener('click', openAdminPanel);
adminClose.addEventListener('click', closeAdminPanel);
adminTabMessages.addEventListener('click', () => {
  adminTabMessages.classList.add('active');
  adminTabFeedback.classList.remove('active');
  adminMessagesSection.classList.remove('hidden');
  adminFeedbackSection.classList.add('hidden');
});
adminTabFeedback.addEventListener('click', () => {
  adminTabFeedback.classList.add('active');
  adminTabMessages.classList.remove('active');
  adminFeedbackSection.classList.remove('hidden');
  adminMessagesSection.classList.add('hidden');
});

adminShutdown.addEventListener('click', () => {
  if (!isAdmin || !serverOpen) return;
  if (confirm('Shutdown the server for new messages?')) {
    socket.emit('admin command', { action: 'shutdown-server' });
  }
});

adminReopen.addEventListener('click', () => {
  if (!isAdmin || serverOpen) return;
  socket.emit('reopen server');
});

feedbackToggle.addEventListener('click', () => {
  feedbackForm.classList.toggle('hidden');
});

feedbackSend.addEventListener('click', () => {
  const text = feedbackText.value.trim();
  if (!text) return;
  socket.emit('feedback', { text });
  feedbackText.value = '';
  feedbackForm.classList.add('hidden');
  addMessage({ system: true, text: 'Feedback sent to admin.', time: new Date().toISOString() });
});

socket.on('server status', (status) => {
  updateServerStatus(status && typeof status.open === 'boolean' ? status.open : true);
});

socket.on('connect_error', (error) => {
  addMessage({ system: true, text: 'Connection error. Please refresh the page.', time: new Date().toISOString() });
});

updateChatTitle();
