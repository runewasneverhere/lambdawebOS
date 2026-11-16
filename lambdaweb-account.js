(() => {
  const root = document.getElementById('lambdaweb-desktop');
  const frame = root && root.closest('.lambdaweb-frame');
  if (!root || !frame || !window.bootLambdaweb) return;

  const PREFIX = 'lambdaweb';
  const LEGACY_PREFIX = 'rune-ubuntu';
  const DB_NAME = 'lambdaweb';
  const NAME = /^[a-z_][a-z0-9_-]{2,15}$/;
  const RESERVED = ['root', 'admin', 'administrator', 'runewasneverhere', 'lambdaweb', 'lambdawebos', 'system', 'daemon', 'nobody', 'guest', 'runetest'];
  const MAX_TRIES = 3;
  const LOCK_MS = 60000;
  const ITERATIONS = 200000;
  const local = /^(localhost|127(\.\d+){3})$/.test(location.hostname);
  const BASE = (window.LAMBDAWEB_RELAY || (local ? `http://${location.hostname}:8765` : 'https://relay.runewasneverhere.com')).replace(/\/$/, '');

  const esc = (text) => String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const read = (key) => {
    try {
      return localStorage.getItem(`${PREFIX}:${key}`);
    } catch (error) {
      return null;
    }
  };
  const write = (key, value) => {
    try {
      localStorage.setItem(`${PREFIX}:${key}`, value);
      return true;
    } catch (error) {
      return false;
    }
  };
  const drop = (key) => {
    try {
      localStorage.removeItem(`${PREFIX}:${key}`);
    } catch (error) {
      return;
    }
  };

  const STORE_KEYS = ['fs', 'inbox', 'sent', 'contacts', 'settings', 'installed', 'welcomed', 'announcementsSeen', 'favorites'];
  const openDatabase = () =>
    new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        reject(new Error('unsupported'));
        return;
      }
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('kv');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('blocked'));
    });
  const requestResult = (request) =>
    new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

  const createStore = async (username) => {
    const prefix = `${username}:`;
    const cache = new Map();
    let db = null;
    try {
      db = await openDatabase();
      const range = IDBKeyRange.bound(prefix, `${prefix}\uffff`);
      const table = db.transaction('kv', 'readonly').objectStore('kv');
      const [keys, values] = await Promise.all([requestResult(table.getAllKeys(range)), requestResult(table.getAll(range))]);
      keys.forEach((key, index) => cache.set(String(key).slice(prefix.length), values[index]));
    } catch (error) {
      db = null;
    }

    const commit = (key, value) =>
      new Promise((resolve, reject) => {
        try {
          const tx = db.transaction('kv', 'readwrite');
          tx.objectStore('kv').put(value, `${prefix}${key}`);
          tx.oncomplete = resolve;
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
        } catch (error) {
          reject(error);
        }
      });
    const persist = (key, value) => {
      if (!db) {
        write(`${prefix}${key}`, value);
        return;
      }
      commit(key, value).catch(() => write(`${prefix}${key}`, value));
    };
    const unpersist = (key) => {
      if (db) {
        try {
          db.transaction('kv', 'readwrite').objectStore('kv').delete(`${prefix}${key}`);
        } catch (error) {
          return;
        }
      }
      drop(`${prefix}${key}`);
    };

    STORE_KEYS.forEach((key) => {
      const legacy = read(`${prefix}${key}`);
      if (legacy === null) return;
      if (!cache.has(key)) {
        cache.set(key, legacy);
        if (db) commit(key, legacy).then(() => drop(`${prefix}${key}`)).catch(() => {});
      } else if (db) {
        drop(`${prefix}${key}`);
      }
    });

    return {
      get: (key) => (cache.has(key) ? cache.get(key) : null),
      set: (key, value) => {
        cache.set(key, value);
        persist(key, value);
      },
      remove: (key) => {
        cache.delete(key);
        unpersist(key);
      },
    };
  };

  const hex = (bytes) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
  const unhex = (text) => new Uint8Array(text.match(/../g).map((h) => parseInt(h, 16)));
  const randomHex = (length) => hex(crypto.getRandomValues(new Uint8Array(length)));

  const derive = async (password, salt) => {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
    return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unhex(salt), iterations: ITERATIONS }, key, 256));
  };
  const same = (a, b) => {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
  };

  const loadAccount = () => {
    try {
      const data = JSON.parse(read('account') || 'null');
      if (data && NAME.test(data.username) && /^[0-9a-f]{32}$/.test(data.salt) && /^[0-9a-f]{64}$/.test(data.hash) && /^[0-9a-f]{64}$/.test(data.secret) && /^data:image\/(png|jpeg|webp);base64,/.test(data.pfp || '')) return data;
    } catch (error) {
      return null;
    }
    return null;
  };

  const imageToAvatar = (source, size = 128) => {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const w = source.naturalWidth || source.width;
    const h = source.naturalHeight || source.height;
    const side = Math.min(w, h);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(source, (w - side) / 2, (h - side) / 2, side, side, 0, 0, size, size);
    return canvas.toDataURL('image/jpeg', 0.86);
  };

  const fileToAvatar = (file) =>
    new Promise((resolve, reject) => {
      if (!/^image\/(png|jpeg|webp|gif|bmp)$/.test(file.type)) {
        reject(new Error('Choose a PNG, JPEG or WebP image.'));
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        reject(new Error('That image is too large.'));
        return;
      }
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(imageToAvatar(img));
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('That image could not be read.'));
      };
      img.src = url;
    });

  const initialAvatar = (name) => {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    const hue = [...name].reduce((sum, c) => sum + c.charCodeAt(0), 0) % 360;
    ctx.fillStyle = `hsl(${hue} 45% 42%)`;
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = '#ffffff';
    ctx.font = '600 64px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(name[0].toUpperCase(), 64, 68);
    return canvas.toDataURL('image/jpeg', 0.9);
  };

  const createRelay = (account) => {
    const listeners = {};
    let users = [];
    let source = null;
    let ticket = null;
    let connected = false;
    let generation = 0;
    let delay = 2000;
    let timer = null;
    let role = 'user';

    const emit = (name, data) => (listeners[name] || []).forEach((fn) => fn(data));
    const on = (name, fn) => (listeners[name] = listeners[name] || []).push(fn);
    const setRole = (value) => {
      role = value === 'owner' || value === 'admin' ? value : 'user';
      emit('role', role);
    };

    const post = async (path, body) => {
      let response;
      try {
        response = await fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      } catch (error) {
        throw Object.assign(new Error('Could not reach the relay.'), { code: 'network' });
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw Object.assign(new Error(data.error || 'error'), { code: data.error || String(response.status), status: response.status });
      return data;
    };

    const teardown = () => {
      generation++;
      clearTimeout(timer);
      if (source) source.close();
      source = null;
      ticket = null;
      const was = connected || users.length;
      connected = false;
      users = [];
      if (was) emit('presence');
    };

    const connect = async () => {
      teardown();
      const mine = generation;
      try {
        const data = await post('/api/hello', { username: account.username, secret: account.secret, avatar: account.pfp });
        if (mine !== generation) return;
        ticket = data.ticket;
        source = new EventSource(`${BASE}/api/stream?ticket=${encodeURIComponent(ticket)}`);
        source.addEventListener('ready', (event) => {
          delay = 2000;
          connected = true;
          try {
            setRole(JSON.parse(event.data).role);
          } catch (error) {
            setRole('user');
          }
          emit('presence');
        });
        source.addEventListener('role', (event) => {
          try {
            setRole(JSON.parse(event.data).role);
          } catch (error) {
            return;
          }
        });
        source.addEventListener('retract', (event) => {
          try {
            emit('retract', JSON.parse(event.data));
          } catch (error) {
            return;
          }
        });
        source.addEventListener('removed', () => {
          wanted = false;
          teardown();
          emit('revoked');
        });
        source.addEventListener('presence', (event) => {
          try {
            users = (JSON.parse(event.data).users || []).filter((u) => u && NAME.test(u.username));
          } catch (error) {
            users = [];
          }
          emit('presence');
        });
        source.addEventListener('message', (event) => {
          try {
            emit('message', JSON.parse(event.data));
          } catch (error) {
            return;
          }
        });
        source.addEventListener('announcements', () => emit('announcements'));
        source.addEventListener('replaced', () => {
          teardown();
          wanted = false;
        });
        source.onerror = () => {
          if (mine !== generation) return;
          retry();
        };
      } catch (error) {
        if (mine !== generation) return;
        if (error.status === 403 && error.code === 'unauthorized') {
          wanted = false;
          emit('revoked');
          return;
        }
        retry();
      }
    };

    let wanted = false;
    const retry = () => {
      teardown();
      if (!wanted) return;
      timer = setTimeout(connect, delay);
      delay = Math.min(delay * 2, 30000);
    };

    const messages = {
      slow_down: 'Slow down a little.',
      no_such_user: 'That user does not exist.',
      mailbox_full: 'Their mailbox is full.',
      invalid_message: 'That message is not valid.',
      invalid_image: 'That image could not be sent. Try a smaller drawing.',
      too_large: 'That image is too large to send.',
      forbidden: 'You do not have permission to do that.',
      self: 'You cannot do that to your own account.',
      owner: 'The owner account cannot be changed.',
      no_such_message: 'That message no longer exists.',
    };

    return {
      on,
      role: () => role,
      users: () => users.slice(),
      connected: () => connected,
      avatarUrl: (name, v) => `${BASE}/api/avatar/${encodeURIComponent(name)}${v ? `?v=${encodeURIComponent(v)}` : ''}`,
      async announcements(action, body = {}) {
        if (!ticket || !connected) throw new Error('You are not connected right now.');
        try {
          return await post(`/api/announcements/${action}`, { ...body, ticket });
        } catch (error) {
          throw new Error(messages[error.code] || error.message);
        }
      },
      async admin(action, body = {}) {
        if (!ticket || !connected) throw new Error('You are not connected right now.');
        try {
          return await post(`/api/admin/${action}`, { ...body, ticket });
        } catch (error) {
          throw new Error(messages[error.code] || error.message);
        }
      },
      async send(to, text, replyTo, image) {
        if (!ticket || !connected) throw new Error('You are not connected right now.');
        try {
          return await post('/api/send', { ticket, to, text, replyTo: replyTo || null, image: image || undefined });
        } catch (error) {
          throw new Error(messages[error.code] || error.message);
        }
      },
      want(value) {
        if (value === wanted) return;
        wanted = value;
        if (value) {
          delay = 2000;
          connect();
        } else {
          teardown();
        }
      },
    };
  };

  const claim = async (username, secret) => {
    let response;
    try {
      response = await fetch(`${BASE}/api/claim`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, secret }) });
    } catch (error) {
      throw new Error('Could not reach the server to check that username. Try again in a moment.');
    }
    const data = await response.json().catch(() => ({}));
    if (response.ok) return;
    if (data.error === 'taken') throw new Error('That username is already taken.');
    if (data.error === 'slow_down') throw new Error('Too many attempts. Wait a minute and try again.');
    if (data.error === 'full') throw new Error('Sign-ups are closed right now.');
    throw new Error('Could not create that account.');
  };

  const awakeObserver = new IntersectionObserver((entries) => entries.forEach((entry) => root.classList.toggle('awake', entry.isIntersecting)), { threshold: 0.35 });
  awakeObserver.observe(frame);

  const screen = (html) => {
    root.innerHTML = `<div class="ul"><div class="ul-card">${html}</div></div>`;
    return root.querySelector('.ul-card');
  };

  const boot = async (account, curtain = null) => {
    awakeObserver.disconnect();
    const store = await createStore(account.username);
    const relay = createRelay(account);
    const session = {
      username: account.username,
      pfp: account.pfp,
      relay,
      store,
      hostname: /^[a-z][a-z0-9-]{0,30}$/.test(account.hostname || '') ? account.hostname : 'lambdaweb',
      setHostname: (value) => {
        account.hostname = value;
        write('account', JSON.stringify(account));
      },
    };
    frame.classList.add('booted');
    relay.on('revoked', () => {
      ['account', 'fails', 'lock'].forEach(drop);
      write('notice', 'Your account was removed by an administrator.');
      location.reload();
    });
    root.innerHTML = '';
    window.bootLambdaweb(session);
    if (curtain) {
      root.append(curtain);
      requestAnimationFrame(() => requestAnimationFrame(() => curtain.classList.add('lifting')));
      setTimeout(() => curtain.remove(), 2200);
    }

    let timer = null;
    const evaluate = () => {
      clearTimeout(timer);
      timer = setTimeout(() => relay.want(root.classList.contains('awake') && !root.classList.contains('off') && !root.classList.contains('wifi-off') && !document.hidden), 300);
    };
    new MutationObserver(evaluate).observe(root, { attributes: true, attributeFilter: ['class'] });
    document.addEventListener('visibilitychange', evaluate);
    evaluate();
  };

  const showCreate = () => {
    const notice = read('notice');
    if (notice) drop('notice');
    window.lambdawebSetup.run({
      root,
      notice,
      NAME,
      RESERVED,
      fileToAvatar,
      create: async ({ username, password, pfp, hostname }) => {
        const secret = randomHex(32);
        await claim(username, secret);
        const salt = randomHex(16);
        const account = { username, salt, hash: await derive(password, salt), secret, pfp: pfp || initialAvatar(username), hostname, created: new Date().toISOString() };
        if (!write('account', JSON.stringify(account))) throw new Error('Your browser would not let this site save data.');
        return account;
      },
      finish: (account, curtain) => boot(account, curtain),
    });
  };

  const readLock = () => {
    const until = Number(read('lock') || 0);
    return until > Date.now() ? until : 0;
  };

  const showUnlock = (account) => {
    const card = screen(`
      <img class="ul-avatar big" src="${esc(account.pfp)}" alt="">
      <h2>Welcome back, ${esc(account.username)}!</h2>
      <input class="ul-input" type="password" placeholder="Password" autocomplete="current-password" maxlength="128">
      <p class="ul-error" role="alert"></p>
      <button class="ul-btn" type="button">Unlock</button>`);
    const input = card.querySelector('input');
    const errorEl = card.querySelector('.ul-error');
    const button = card.querySelector('.ul-btn');
    let ticking = null;

    const lockedUi = () => {
      const until = readLock();
      if (!until) {
        clearInterval(ticking);
        ticking = null;
        input.disabled = false;
        button.disabled = false;
        errorEl.textContent = '';
        input.focus();
        return;
      }
      input.disabled = true;
      button.disabled = true;
      errorEl.textContent = `Too many attempts. Try again in ${Math.ceil((until - Date.now()) / 1000)}s.`;
    };
    const startLock = () => {
      lockedUi();
      if (!ticking) ticking = setInterval(lockedUi, 500);
    };

    const submit = async () => {
      if (readLock()) {
        startLock();
        return;
      }
      if (!input.value) return;
      button.disabled = true;
      let ok = false;
      try {
        ok = same(await derive(input.value, account.salt), account.hash);
      } catch (error) {
        errorEl.textContent = 'This browser cannot unlock accounts here.';
        button.disabled = false;
        return;
      }
      if (ok) {
        drop('fails');
        drop('lock');
        boot(account);
        return;
      }
      const fails = (Number(read('fails')) || 0) + 1;
      input.value = '';
      if (fails >= MAX_TRIES) {
        drop('fails');
        write('lock', String(Date.now() + LOCK_MS));
        startLock();
        return;
      }
      write('fails', String(fails));
      const left = MAX_TRIES - fails;
      errorEl.textContent = `Wrong password. ${left} ${left === 1 ? 'try' : 'tries'} left.`;
      button.disabled = false;
      input.focus();
    };

    button.addEventListener('click', submit);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') submit();
    });
    if (readLock()) startLock();
  };

  const migrateLegacyStorage = async () => {
    try {
      Object.keys(localStorage)
        .filter((key) => key.startsWith(`${LEGACY_PREFIX}:`))
        .forEach((key) => {
          const next = `${PREFIX}:${key.slice(LEGACY_PREFIX.length + 1)}`;
          if (localStorage.getItem(next) === null) localStorage.setItem(next, localStorage.getItem(key));
          localStorage.removeItem(key);
        });
    } catch (error) {
      return;
    }
    if (!window.indexedDB || !indexedDB.databases) return;
    try {
      const known = await indexedDB.databases();
      if (!known.some((item) => item.name === LEGACY_PREFIX)) return;
      const old = await new Promise((resolve, reject) => {
        const request = indexedDB.open(LEGACY_PREFIX);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      if (!old.objectStoreNames.contains('kv')) {
        old.close();
        indexedDB.deleteDatabase(LEGACY_PREFIX);
        return;
      }
      const table = old.transaction('kv', 'readonly').objectStore('kv');
      const [keys, values] = await Promise.all([requestResult(table.getAllKeys()), requestResult(table.getAll())]);
      old.close();
      const db = await openDatabase();
      await new Promise((resolve, reject) => {
        const tx = db.transaction('kv', 'readwrite');
        const store = tx.objectStore('kv');
        keys.forEach((key, index) => {
          const existing = store.count(key);
          existing.onsuccess = () => {
            if (!existing.result) store.put(values[index], key);
          };
        });
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
      db.close();
      indexedDB.deleteDatabase(LEGACY_PREFIX);
    } catch (error) {
      return;
    }
  };

  migrateLegacyStorage().then(() => {
    const migrated = loadAccount();
    if (migrated) showUnlock(migrated);
    else showCreate();
  });
})();
