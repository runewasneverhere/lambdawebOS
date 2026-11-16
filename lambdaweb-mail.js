window.lambdawebMail = (ctx) => {
  const { session, windows, createWindow, notify, fs, escapeHtml, apps, favorites, HOME } = ctx;
  const relay = session.relay;
  const ICON = 'mail.png';
  const MAX = 500;
  const PNG_IMAGE = /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/;
  const MAX_RECEIVED_IMAGE = 450000;
  const SEND_LIMIT = 280 * 1024;
  const KEEP_IMAGES = 20;

  const imageBytes = (dataUrl) => {
    const padding = dataUrl.endsWith('==') ? 2 : dataUrl.endsWith('=') ? 1 : 0;
    return Math.floor(((dataUrl.length - dataUrl.indexOf(',') - 1) * 3) / 4) - padding;
  };
  const validPicture = (value) => typeof value === 'string' && value.length <= MAX_RECEIVED_IMAGE && PNG_IMAGE.test(value);
  const trimImages = (list) => {
    let kept = 0;
    list.forEach((item) => {
      if (!item.image) return;
      kept += 1;
      if (kept > KEEP_IMAGES) {
        item.image = null;
        item.imageGone = true;
      }
    });
  };
  const fitImage = async (dataUrl) => {
    if (/^data:image\/png;/.test(dataUrl) && imageBytes(dataUrl) <= SEND_LIMIT) return dataUrl;
    const image = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('That picture could not be read.'));
      img.src = dataUrl;
    });
    let scale = Math.min(1, Math.sqrt(SEND_LIMIT / Math.max(1, imageBytes(dataUrl))));
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const c = canvas.getContext('2d');
      c.fillStyle = '#ffffff';
      c.fillRect(0, 0, canvas.width, canvas.height);
      c.drawImage(image, 0, 0, canvas.width, canvas.height);
      const out = canvas.toDataURL('image/png');
      if (imageBytes(out) <= SEND_LIMIT) return out;
      scale *= 0.75;
    }
    throw new Error('That picture is too large to send.');
  };

  ctx.fitSocialImage = fitImage;

  const readInbox = () => {
    try {
      const list = JSON.parse(session.store.get('inbox') || '[]');
      if (!Array.isArray(list)) return [];
      return list
        .filter((m) => m && typeof m.id === 'string' && typeof m.from === 'string' && typeof m.text === 'string')
        .map((m) => ({ ...m, image: validPicture(m.image) ? m.image : null }));
    } catch (error) {
      return [];
    }
  };
  let inbox = readInbox();
  const saveInbox = () => {
    inbox = inbox.slice(0, 300);
    trimImages(inbox);
    session.store.set('inbox', JSON.stringify(inbox));
  };
  const unread = () => inbox.filter((m) => !m.read).length;

  const readSent = () => {
    try {
      const list = JSON.parse(session.store.get('sent') || '[]');
      if (!Array.isArray(list)) return [];
      return list
        .filter((m) => m && typeof m.id === 'string' && typeof m.to === 'string' && typeof m.text === 'string')
        .map((m) => ({ ...m, image: validPicture(m.image) ? m.image : null }));
    } catch (error) {
      return [];
    }
  };
  let sent = readSent();
  const saveSent = () => {
    sent = sent.slice(0, 300);
    trimImages(sent);
    session.store.set('sent', JSON.stringify(sent));
  };

  const formatDate = (iso) => {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString(undefined, { year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  };

  const avatar = (name, v) => {
    const cached = contacts[name];
    const src = cached ? cached.pfp : relay.avatarUrl(name, v);
    return `<img class="bt-avatar" src="${escapeHtml(src)}" alt="" draggable="false">`;
  };
  const ownAvatar = () => (session.pfp ? `<img class="bt-avatar" src="${escapeHtml(session.pfp)}" alt="" draggable="false">` : '<span class="bt-avatar bt-blank"></span>');
  const personAvatar = (name) => {
    const live = relay.users().find((u) => u.username === name);
    return live || contacts[name] ? avatar(name, live && live.v) : '<span class="bt-avatar bt-blank"></span>';
  };

  const USERNAME = /^[a-z_][a-z0-9_-]{2,15}$/;
  const DATA_IMAGE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
  const MAX_CONTACTS = 60;
  const contacts = (() => {
    try {
      const raw = JSON.parse(session.store.get('contacts') || '{}');
      const clean = {};
      Object.entries(raw).forEach(([name, item]) => {
        if (USERNAME.test(name) && name !== session.username && item && DATA_IMAGE.test(item.pfp || '') && item.pfp.length < 80000) {
          clean[name] = { pfp: item.pfp, seen: Number(item.seen) || 0 };
        }
      });
      return clean;
    } catch (error) {
      return {};
    }
  })();
  const saveContacts = () => {
    const names = Object.keys(contacts).sort((a, b) => contacts[b].seen - contacts[a].seen);
    names.slice(MAX_CONTACTS).forEach((name) => delete contacts[name]);
    session.store.set('contacts', JSON.stringify(contacts));
  };

  const fetched = {};
  const rememberAvatar = async (user) => {
    if (fetched[user.username] === user.v) return;
    fetched[user.username] = user.v;
    try {
      const response = await fetch(relay.avatarUrl(user.username, user.v));
      if (!response.ok) return;
      const blob = await response.blob();
      if (blob.size > 60000) return;
      const url = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      if (!DATA_IMAGE.test(url)) return;
      contacts[user.username] = { pfp: url, seen: Date.now() };
      saveContacts();
      refresh();
    } catch (error) {
      delete fetched[user.username];
    }
  };

  const noteOnline = () => {
    let changed = false;
    relay.users().forEach((user) => {
      if (user.username === session.username) return;
      if (contacts[user.username]) {
        contacts[user.username].seen = Date.now();
        changed = true;
      }
      rememberAvatar(user);
    });
    if (changed) saveContacts();
  };

  const refresh = () => windows.filter((win) => win.app === 'mail').forEach((win) => win.render && win.render());

  const open = (id) => {
    const list = windows.filter((win) => win.app === 'mail');
    if (list.length) {
      list[0].focus();
      return list[0];
    }
    return build(id);
  };

  const receive = (message) => {
    if (!message || typeof message.id !== 'string' || typeof message.from !== 'string' || typeof message.text !== 'string') return;
    if (inbox.some((m) => m.id === message.id)) return;
    const picture = validPicture(message.image) ? message.image : null;
    inbox.unshift({
      id: message.id,
      from: message.from,
      text: message.text.slice(0, MAX),
      sent: message.sent,
      replyTo: message.replyTo || null,
      image: picture,
      imageGone: !picture && !!message.imageGone,
      read: false,
    });
    saveInbox();
    refresh();
    if (ctx.system.config('mail', ctx.system.defaults.mail).newMailNotifications) {
      notify({
        title: `${message.from} sent you a message!`,
        body: 'Read it?',
        iconName: ICON,
        duration: 12000,
        sound: 'mail',
        onClick: () => open().showMessage(message.id),
      });
    }
  };

  relay.on('message', receive);
  relay.on('retract', (data) => {
    if (!data || typeof data.id !== 'string') return;
    let changed = false;
    inbox.forEach((m) => {
      if (m.id === data.id && !m.removed) {
        Object.assign(m, { removed: true, read: true, image: null, imageGone: false, text: 'This message has been removed by an administrator.' });
        changed = true;
      }
    });
    sent.forEach((m) => {
      if (m.id === data.id && !m.removed) {
        Object.assign(m, { removed: true, image: null, imageGone: false, text: 'Your message has been removed by an administrator.' });
        changed = true;
      }
    });
    if (!changed) return;
    saveInbox();
    saveSent();
    refresh();
  });
  relay.on('presence', () => {
    noteOnline();
    refresh();
  });

  function build() {
    const win = createWindow({ app: 'mail', title: 'Mail', width: 620, height: 480, minWidth: 420, minHeight: 320, className: 'is-social' });
    win.body.innerHTML = `
      <div class="bt">
        <nav class="bt-tabs">
          <button class="bt-tab" data-tab="online">Online</button>
          <button class="bt-tab" data-tab="received">Received<b class="bt-badge"></b></button>
          <button class="bt-tab" data-tab="sent">Sent</button>
        </nav>
        <div class="bt-view"></div>
        <div class="bt-layer" hidden></div>
      </div>`;
    const view = win.body.querySelector('.bt-view');
    const layer = win.body.querySelector('.bt-layer');
    const tabs = [...win.body.querySelectorAll('.bt-tab')];
    const badge = win.body.querySelector('.bt-badge');
    let tab = 'online';
    let reading = null;
    let pending = null;

    const closeLayer = () => {
      layer.hidden = true;
      layer.innerHTML = '';
    };

    const pictureBlock = (m) => {
      if (m.image) return `<button class="bt-pic" data-act="enlarge" aria-label="Enlarge picture"><img src="${m.image}" alt="Attached picture" draggable="false"></button>`;
      if (m.imageGone) return '<p class="bt-note">The picture is no longer available.</p>';
      return '';
    };
    const previewText = (m) => `${m.image || m.imageGone ? '[picture] ' : ''}${m.text.replace(/\s+/g, ' ').slice(0, 90)}`;

    const renderOnline = () => {
      const online = relay.users().filter((u) => u.username !== session.username);
      const onlineNames = new Set(online.map((u) => u.username));
      const away = Object.keys(contacts)
        .filter((name) => !onlineNames.has(name))
        .sort((a, b) => a.localeCompare(b));
      const me = `<div class="bt-me">${ownAvatar()}<span>${escapeHtml(session.username)}</span><em>You</em></div>`;
      const banner = pending
        ? `<div class="bt-banner"><img src="${pending.dataUrl}" alt=""><span>Choose who should get <b>${escapeHtml(pending.name)}</b></span><button class="bt-btn small" data-act="cancel-send">Cancel</button></div>`
        : '';
      if (!relay.connected()) {
        view.innerHTML = `${banner}${me}<p class="bt-empty">Connecting to the relay…</p>`;
        return;
      }
      const rows = [
        ...online.map((u) => `<li><button class="bt-row" data-user="${escapeHtml(u.username)}">${avatar(u.username, u.v)}<span class="bt-name">${escapeHtml(u.username)}</span></button></li>`),
        ...away.map((name) => `<li><button class="bt-row offline" data-user="${escapeHtml(name)}">${avatar(name)}<span class="bt-name">${escapeHtml(name)}</span><span class="bt-off">(OFFLINE)</span></button></li>`),
      ];
      const empty = online.length ? '' : `<p class="bt-empty${away.length ? ' compact' : ''}">Nobody is online at the moment :c</p>`;
      view.innerHTML = `${banner}${me}${empty}${rows.length ? `<ul class="bt-list">${rows.join('')}</ul>` : ''}`;
    };

    const renderReceived = () => {
      if (reading) {
        const message = inbox.find((m) => m.id === reading);
        if (!message) {
          reading = null;
        } else {
          const fromAvatar = personAvatar(message.from);
          const extras = message.removed ? '' : `<button class="bt-btn primary" data-act="reply">Reply</button>${message.image ? '<button class="bt-btn" data-act="save-pic">Save picture</button>' : ''}<button class="bt-btn" data-act="download">Download .txt</button>`;
          view.innerHTML = `
            <div class="bt-read">
              <button class="bt-link" data-act="back">‹ Received</button>
              <div class="bt-from">${fromAvatar}<div><strong>${escapeHtml(message.from)}</strong><span>${escapeHtml(formatDate(message.sent))}</span></div></div>
              ${message.text ? `<div class="bt-text${message.removed ? ' removed' : ''}">${escapeHtml(message.text)}</div>` : ''}
              ${pictureBlock(message)}
              <div class="bt-actions">
                ${extras}
                <button class="bt-btn danger" data-act="delete">Delete</button>
              </div>
            </div>`;
          return;
        }
      }
      if (!inbox.length) {
        view.innerHTML = '<p class="bt-empty">No messages yet.</p>';
        return;
      }
      view.innerHTML = `<ul class="bt-list">${inbox
        .map(
          (m) => `<li><button class="bt-row bt-msg${m.read ? '' : ' unread'}${m.removed ? ' removed' : ''}" data-id="${escapeHtml(m.id)}">
            <span class="bt-dot"></span>
            <span class="bt-main"><span class="bt-name">${escapeHtml(m.from)}</span><span class="bt-preview">${escapeHtml(previewText(m))}</span></span>
            <span class="bt-date">${escapeHtml(formatDate(m.sent))}</span>
          </button></li>`
        )
        .join('')}</ul>`;
    };

    const renderSent = () => {
      if (reading) {
        const message = sent.find((m) => m.id === reading);
        if (!message) {
          reading = null;
        } else {
          const extras = message.removed ? '' : `<button class="bt-btn primary" data-act="again">Send another</button>${message.image ? '<button class="bt-btn" data-act="save-pic">Save picture</button>' : ''}<button class="bt-btn" data-act="download">Download .txt</button>`;
          view.innerHTML = `
            <div class="bt-read">
              <button class="bt-link" data-act="back">‹ Sent</button>
              <div class="bt-from">${personAvatar(message.to)}<div><strong>To ${escapeHtml(message.to)}</strong><span>${escapeHtml(formatDate(message.sent))}</span></div></div>
              ${message.text ? `<div class="bt-text${message.removed ? ' removed' : ''}">${escapeHtml(message.text)}</div>` : ''}
              ${pictureBlock(message)}
              <div class="bt-actions">
                ${extras}
                <button class="bt-btn danger" data-act="delete">Delete</button>
              </div>
            </div>`;
          return;
        }
      }
      if (!sent.length) {
        view.innerHTML = '<p class="bt-empty">You haven\'t sent any messages yet.</p>';
        return;
      }
      view.innerHTML = `<ul class="bt-list">${sent
        .map(
          (m) => `<li><button class="bt-row bt-msg${m.removed ? ' removed' : ''}" data-id="${escapeHtml(m.id)}">
            ${personAvatar(m.to)}
            <span class="bt-main"><span class="bt-name">To ${escapeHtml(m.to)}</span><span class="bt-preview">${escapeHtml(previewText(m))}</span></span>
            <span class="bt-date">${escapeHtml(formatDate(m.sent))}</span>
          </button></li>`
        )
        .join('')}</ul>`;
    };

    win.render = () => {
      tabs.forEach((el) => el.classList.toggle('active', el.dataset.tab === tab));
      const count = unread();
      badge.textContent = count || '';
      badge.hidden = !count;
      if (tab === 'online') renderOnline();
      else if (tab === 'sent') renderSent();
      else renderReceived();
    };

    win.showMessage = (id) => {
      tab = 'received';
      reading = id;
      const message = inbox.find((m) => m.id === id);
      if (message && !message.read) {
        message.read = true;
        saveInbox();
      }
      closeLayer();
      refresh();
    };

    const compose = (to, replyTo, preset = null) => {
      let attachment = preset;
      layer.hidden = false;
      layer.innerHTML = `
        <div class="bt-dialog" role="dialog" aria-label="Write your message">
          <h3>To ${escapeHtml(to)}</h3>
          <textarea maxlength="${MAX}" placeholder="Write your message.." spellcheck="true"></textarea>
          <div class="bt-attachrow">
            ${ctx.fileDialog ? '<button class="bt-btn small" data-act="attach">Attach picture</button>' : ''}
            <span class="bt-chip" hidden><img alt=""><span class="bt-chipname"></span><button class="bt-x" data-act="detach" aria-label="Remove picture">×</button></span>
          </div>
          <div class="bt-foot"><span class="bt-count">0 / ${MAX}</span><span class="bt-spacer"></span>
            <button class="bt-btn" data-act="cancel">Cancel</button>
            <button class="bt-btn primary" data-act="send" disabled>Send</button>
          </div>
        </div>`;
      const box = layer.querySelector('textarea');
      const send = layer.querySelector('[data-act="send"]');
      const count = layer.querySelector('.bt-count');
      const attachBtn = layer.querySelector('[data-act="attach"]');
      const chip = layer.querySelector('.bt-chip');
      const sync = () => {
        count.textContent = `${box.value.length} / ${MAX}`;
        chip.hidden = !attachment;
        if (attachment) {
          chip.querySelector('img').src = attachment.dataUrl;
          chip.querySelector('.bt-chipname').textContent = attachment.name;
        }
        if (attachBtn) attachBtn.hidden = !!attachment;
        send.disabled = !box.value.trim() && !attachment;
      };
      box.focus();
      box.addEventListener('input', sync);
      sync();
      layer.querySelector('[data-act="cancel"]').addEventListener('click', closeLayer);
      layer.querySelector('[data-act="detach"]').addEventListener('click', () => {
        attachment = null;
        sync();
      });
      if (attachBtn) {
        attachBtn.addEventListener('click', async () => {
          const pictures = `${HOME}/Pictures`;
          const path = await ctx.fileDialog({
            mode: 'open',
            title: 'Attach Picture',
            dir: fs.isDir(pictures) ? pictures : HOME,
            accept: (name, node) => ctx.isImageData(node.content),
          });
          const node = path && fs.get(path);
          if (!node) return;
          try {
            attachment = { dataUrl: await fitImage(node.content), name: fs.split(path).name };
            sync();
          } catch (error) {
            notify({ title: 'Could not attach picture', body: error.message, iconName: ICON });
          }
        });
      }
      send.addEventListener('click', async () => {
        const text = box.value.trim().slice(0, MAX);
        if (!text && !attachment) return;
        send.disabled = true;
        try {
          const result = await relay.send(to, text, replyTo, attachment ? attachment.dataUrl : null);
          sent.unshift({
            id: String(result.id || Date.now()),
            to,
            text,
            sent: result.sent || new Date().toISOString(),
            replyTo: replyTo || null,
            image: attachment ? attachment.dataUrl : null,
            imageGone: false,
          });
          saveSent();
          if (preset && pending === preset) pending = null;
          closeLayer();
          refresh();
          notify({
            title: `Message sent to: ${to}`,
            body: result.delivered ? 'Delivered.' : `${to} is away. They'll get it when they're back.`,
            iconName: ICON,
          });
        } catch (error) {
          send.disabled = false;
          notify({ title: 'Message not sent', body: error.message || 'Something went wrong.', iconName: ICON });
        }
      });
    };

    const stampOf = (message) => {
      const stamp = new Date(message.sent);
      return Number.isNaN(stamp.getTime()) ? 'unknown' : stamp.toISOString().slice(0, 10);
    };

    const saveText = async (message) => {
      const outgoing = typeof message.to === 'string';
      const other = outgoing ? message.to : message.from;
      const documents = `${HOME}/Documents`;
      const target = await ctx.fileDialog({
        mode: 'save',
        title: 'Save Message',
        dir: fs.isDir(documents) ? documents : HOME,
        name: `message-${outgoing ? 'to' : 'from'}-${other}-${stampOf(message)}.txt`,
      });
      if (!target) return;
      const note = message.image || message.imageGone ? '\n[A picture was attached to this message]\n' : '';
      try {
        fs.write(target, `From: ${outgoing ? session.username : message.from}\nTo: ${outgoing ? message.to : session.username}\nSent: ${formatDate(message.sent)}\n\n${message.text}\n${note}`);
        notify({ title: 'Message saved', body: target.replace(HOME, '~'), iconName: ICON });
      } catch (error) {
        notify({ title: 'Could not save', body: error.message, iconName: ICON });
      }
    };

    const savePicture = async (message) => {
      if (!message.image) return;
      const outgoing = typeof message.to === 'string';
      const other = outgoing ? message.to : message.from;
      const pictures = `${HOME}/Pictures`;
      let target = await ctx.fileDialog({
        mode: 'save',
        title: 'Save Picture',
        dir: fs.isDir(pictures) ? pictures : HOME,
        name: `picture-${outgoing ? 'to' : 'from'}-${other}-${stampOf(message)}.png`,
      });
      if (!target) return;
      if (!/\.png$/i.test(target)) target += '.png';
      try {
        fs.write(target, message.image);
        notify({ title: 'Picture saved', body: target.replace(HOME, '~'), iconName: ICON, onClick: () => ctx.openPath(target) });
      } catch (error) {
        notify({ title: 'Could not save', body: error.message, iconName: ICON });
      }
    };

    const enlarge = (message) => {
      if (!message.image) return;
      layer.hidden = false;
      layer.innerHTML = `<div class="bt-dialog bt-big" role="dialog" aria-label="Picture"><img src="${message.image}" alt="Attached picture" draggable="false"><div class="bt-foot"><span class="bt-spacer"></span><button class="bt-btn" data-x="close">Close</button></div></div>`;
      layer.querySelector('[data-x="close"]').addEventListener('click', closeLayer);
    };

    win.startSend = (payload) => {
      if (!payload || !PNG_IMAGE.test(payload.dataUrl)) return;
      pending = payload;
      tab = 'online';
      reading = null;
      closeLayer();
      win.render();
    };

    win.body.addEventListener('click', (event) => {
      const tabBtn = event.target.closest('.bt-tab');
      if (tabBtn) {
        tab = tabBtn.dataset.tab;
        reading = null;
        win.render();
        return;
      }
      if (event.target.closest('[data-act="cancel-send"]')) {
        pending = null;
        win.render();
        return;
      }
      const person = event.target.closest('.bt-row[data-user]');
      if (person) {
        compose(person.dataset.user, null, pending);
        return;
      }
      const msg = event.target.closest('.bt-msg');
      if (msg) {
        if (tab === 'sent') {
          reading = msg.dataset.id;
          win.render();
        } else {
          win.showMessage(msg.dataset.id);
        }
        return;
      }
      const act = event.target.closest('[data-act]');
      if (!act || !reading) return;
      const sentView = tab === 'sent';
      const message = (sentView ? sent : inbox).find((m) => m.id === reading);
      if (!message) return;
      if (act.dataset.act === 'back') {
        reading = null;
        win.render();
      } else if (act.dataset.act === 'reply') {
        compose(message.from, message.id);
      } else if (act.dataset.act === 'again') {
        compose(message.to, null);
      } else if (act.dataset.act === 'download') {
        saveText(message);
      } else if (act.dataset.act === 'save-pic') {
        savePicture(message);
      } else if (act.dataset.act === 'enlarge') {
        enlarge(message);
      } else if (act.dataset.act === 'delete') {
        if (sentView) {
          sent = sent.filter((m) => m.id !== message.id);
          saveSent();
        } else {
          inbox = inbox.filter((m) => m.id !== message.id);
          saveInbox();
        }
        reading = null;
        refresh();
      }
    });

    win.render();
    ctx.network.guard(win);
    return win;
  }

  apps.mail = { label: 'Mail', icon: ICON, launch: () => open() };
  favorites.splice(favorites.indexOf('settings'), 0, 'mail');

  ctx.mail = {
    async sendImage({ dataUrl, name }) {
      try {
        const fitted = await fitImage(dataUrl);
        open().startSend({ dataUrl: fitted, name: name || 'picture.png' });
      } catch (error) {
        notify({ title: 'Could not prepare the picture', body: error.message, iconName: ICON });
      }
    },
  };
};
