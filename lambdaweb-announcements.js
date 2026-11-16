window.lambdawebAnnouncements = (ctx) => {
  const { session, windows, createWindow, notify, escapeHtml: esc, apps, favorites, renderDock } = ctx;
  const relay = session.relay;
  const ICON = 'announcements.svg';
  let seen = Math.max(0, Number(session.store.get('announcementsSeen')) || 0);
  let dismissed = null;
  let lastNotice = '';
  let checking = false;
  let checkAgain = false;
  const admin = () => relay.role() !== 'user';
  const active = () => windows.find((w) => w.app === 'announcements');
  const markSeen = (latest) => {
    seen = Math.max(seen, latest);
    session.store.set('announcementsSeen', String(seen));
    if (dismissed) dismissed();
    dismissed = null;
    lastNotice = '';
  };
  const author = (item) => {
    const picture = item.author.avatar;
    const safe = typeof picture === 'string' && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(picture);
    return `<div class="bt-from">${safe ? `<img class="bt-avatar" src="${esc(picture)}" alt="">` : '<span class="bt-avatar bt-blank"></span>'}<div><strong>${esc(item.author.username)}</strong><span>${esc(new Date(item.sent).toLocaleString())}</span></div></div>`;
  };
  async function check() {
    if (!relay.connected()) return;
    if (checking) { checkAgain = true; return; }
    checking = true;
    try {
      const data = await relay.announcements('list', { seen });
      const win = active();
      if (win && win.announcementReading()) {
        await win.announcementChanged();
      } else if (data.notify && data.unread) {
        const key = `${data.latest}:${data.unread}`;
        if (key !== lastNotice) {
          if (dismissed) dismissed();
          lastNotice = key;
          dismissed = notify({ title: 'Announcements', body: `There are ${data.unread} announcements since you last opened the announcements application. View announcements?`, iconName: ICON, onClick: open, duration: 12000 });
        }
      } else {
        if (dismissed) dismissed();
        dismissed = null;
        lastNotice = '';
      }
    } catch (error) {
      notify({ title: 'Announcements', body: error.message, iconName: ICON });
    } finally {
      checking = false;
      if (checkAgain) { checkAgain = false; check(); }
    }
  }
  function open() {
    const existing = active();
    if (existing) { existing.focus(); existing.announcementRefresh(); return existing; }
    const win = createWindow({ app: 'announcements', title: 'Announcements', width: 720, height: 560, minWidth: 400, minHeight: 340, className: 'is-social' });
    win.body.innerHTML = `<div class="bt an"><nav class="bt-tabs"><strong>Announcements</strong><span class="bt-spacer"></span><button class="bt-btn small" data-refresh>Refresh</button><button class="bt-btn primary small" data-create>Create Announcement</button></nav><p class="an-status" role="status"></p><div class="bt-view an-feed"></div><div class="bt-layer" hidden></div></div>`;
    const feed = win.body.querySelector('.an-feed');
    const status = win.body.querySelector('.an-status');
    const layer = win.body.querySelector('.bt-layer');
    const create = win.body.querySelector('[data-create]');
    let composing = false;
    let closed = false;
    let generation = 0;
    let loading = false;
    let refreshAgain = false;
    let next = null;
    let confirmResolve = null;
    let draftImage = null;
    let publishing = false;
    const error = (e) => { if (!closed) status.textContent = e.message; };
    const button = (text, fn, primary = false) => {
      const b = document.createElement('button');
      b.className = `bt-btn${primary ? ' primary' : ''}`;
      b.textContent = text;
      b.onclick = fn;
      return b;
    };
    const confirm = (message) => new Promise((resolve) => {
      confirmResolve = resolve;
      layer.hidden = false;
      layer.innerHTML = `<div class="bt-dialog an-confirm" role="dialog" aria-modal="true" aria-label="Confirm announcement"><p>${esc(message)}</p><div class="bt-actions"></div></div>`;
      const finish = (yes) => { layer.hidden = true; confirmResolve = null; resolve(yes); };
      layer.querySelector('.bt-actions').append(button('No', () => finish(false)), button('Yes', () => finish(true), true));
      layer.querySelector('button').focus();
    });
    async function details(item, card) {
      const box = card.querySelector('.an-details');
      if (!box.hidden) { box.hidden = true; return; }
      box.hidden = false;
      box.innerHTML = '';
      const comments = document.createElement('div');
      const more = button('More comments', () => loadComments(more.dataset.next));
      const form = document.createElement('form');
      form.className = 'an-comment-form';
      form.innerHTML = '<label>Write a comment<textarea maxlength="1000" required rows="2"></textarea></label><button class="bt-btn primary" type="submit">Comment</button>';
      box.append(comments, more, form);
      async function loadComments(offset = 0) {
        more.disabled = true;
        try {
          const data = await relay.announcements('detail', { id: item.id, offset: Number(offset) });
          if (closed || !box.isConnected) return;
          for (const comment of data.comments) {
            const row = document.createElement('section');
            row.className = 'an-comment';
            row.innerHTML = `${author(comment)}<p class="an-text">${esc(comment.text)}</p>`;
            comments.append(row);
          }
          more.hidden = data.next === null;
          more.dataset.next = String(data.next);
        } catch (e) { error(e); } finally { more.disabled = false; }
      }
      form.onsubmit = async (event) => {
        event.preventDefault();
        const submit = form.querySelector('button');
        submit.disabled = true;
        try {
          await relay.announcements('comment', { id: item.id, text: form.querySelector('textarea').value });
          form.querySelector('textarea').value = '';
          comments.innerHTML = '';
          await loadComments();
        } catch (e) { error(e); } finally { submit.disabled = false; }
      };
      await loadComments();
    }
    function add(item) {
      const card = document.createElement('article');
      card.className = 'an-post';
      card.innerHTML = `${author(item)}${item.title ? `<h2 class="an-title">${esc(item.title)}</h2>` : ''}<p class="an-text">${esc(item.text)}</p><div class="bt-actions"></div><div class="an-details" hidden></div>`;
      const actions = card.querySelector('.bt-actions');
      actions.append(button(`Comments (${item.commentCount})`, () => details(item, card)));
      if (item.image) {
        const image = document.createElement('img');
        image.className = 'an-photo';
        image.alt = 'Announcement photo';
        image.hidden = true;
        card.insertBefore(image, actions);
        relay.announcements('photo', { id: item.id }).then((data) => {
          if (closed || !image.isConnected) return;
          if (!data.image || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(data.image)) throw new Error('The announcement photo could not be loaded.');
          image.src = data.image;
          image.hidden = false;
        }).catch((e) => { if (image.isConnected) error(e); });
      }
      if (admin()) actions.append(button('Delete', async () => {
        if (!await confirm('Delete this announcement and all its comments?')) return;
        try { await relay.announcements('delete', { id: item.id }); await refresh(); } catch (e) { error(e); }
      }));
      feed.append(card);
    }
    async function refresh(older = false, automatic = false) {
      if (closed || composing || (older && loading)) return;
      const mine = ++generation;
      loading = true;
      status.textContent = '';
      create.hidden = !admin();
      try {
        const target = older ? 0 : feed.querySelectorAll('.an-post').length;
        const data = await relay.announcements('list', { seen, before: older ? next : 0 });
        while (!older && data.next !== null && data.items.length < target) {
          const page = await relay.announcements('list', { seen, before: data.next });
          data.items.push(...page.items);
          data.next = page.next;
        }
        if (closed || composing || mine !== generation) return;
        if (automatic && (!layer.hidden || [...feed.querySelectorAll('textarea')].some((t) => t.value))) {
          status.textContent = 'New activity is available. Refresh when you have finished your comment.';
          return;
        }
        const scroll = feed.scrollTop;
        const openDetails = new Set([...feed.querySelectorAll('.an-post')].filter((c) => !c.querySelector('.an-details').hidden).map((c) => c.dataset.id));
        if (!older) feed.innerHTML = '';
        feed.querySelector('[data-older]')?.remove();
        data.items.forEach((item) => {
          add(item);
          const card = feed.lastElementChild;
          card.dataset.id = item.id;
          if (openDetails.has(item.id)) details(item, card);
        });
        next = data.next;
        if (next !== null) {
          const more = button('Older announcements', () => refresh(true));
          more.dataset.older = '';
          feed.append(more);
        }
        if (!feed.children.length) feed.textContent = 'No announcements yet.';
        feed.scrollTop = scroll;
        if (win.announcementReading()) markSeen(data.latest);
      } catch (e) { error(e); } finally {
        if (mine === generation) {
          loading = false;
          if (refreshAgain) { refreshAgain = false; win.announcementChanged(); }
        }
      }
    }
    function compose() {
      if (!admin() || composing) return;
      composing = true;
      create.hidden = true;
      generation++;
      draftImage = null;
      status.textContent = '';
      feed.innerHTML = `<form class="an-compose"><label>Title<input type="text" name="title" maxlength="120" required placeholder="Announcement title"></label><label>Description<textarea rows="7" maxlength="4000" required placeholder="What would you like to announce?"></textarea></label><label>Add a photo<input type="file" accept="image/png,image/jpeg,image/webp"></label><img class="an-photo" hidden alt="Photo preview"><button class="bt-btn" type="button" data-remove hidden>Remove photo</button><label class="an-check"><input type="checkbox"> Notify everyone</label><p>Titles: up to 120 characters. Descriptions: up to 4000 characters. Photos are resized to PNG, up to 280 KiB.</p><div class="bt-actions"><button class="bt-btn" type="button" data-cancel>Cancel</button><button class="bt-btn primary" type="submit">Publish Announcement</button></div></form>`;
      const form = feed.querySelector('form');
      const file = form.querySelector('[type=file]');
      const preview = form.querySelector('img');
      const remove = form.querySelector('[data-remove]');
      const publish = form.querySelector('[type=submit]');
      let photoGeneration = 0;
      remove.onclick = () => { photoGeneration++; draftImage = null; preview.hidden = true; preview.removeAttribute('src'); remove.hidden = true; file.value = ''; publish.disabled = false; };
      file.onchange = async () => {
        const selected = file.files[0];
        const mine = ++photoGeneration;
        draftImage = null;
        preview.hidden = true;
        publish.disabled = true;
        try {
          if (!selected) return;
          if (!['image/png', 'image/jpeg', 'image/webp'].includes(selected.type) || selected.size > 10 * 1024 * 1024) throw new Error('Choose a PNG, JPEG or WebP photo under 10 MiB.');
          const source = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error('Could not read that photo.'));
            reader.readAsDataURL(selected);
          });
          const fitted = await ctx.fitSocialImage(source);
          if (mine !== photoGeneration || closed || !composing) return;
          draftImage = fitted;
          preview.src = fitted;
          preview.hidden = false;
          remove.hidden = false;
        } catch (e) { error(e); } finally { if (mine === photoGeneration) publish.disabled = false; }
      };
      form.querySelector('[data-cancel]').onclick = () => { composing = false; photoGeneration++; refresh(); };
      form.onsubmit = async (event) => {
        event.preventDefault();
        if (publishing) return;
        publishing = true;
        publish.disabled = true;
        file.disabled = true;
        const text = form.querySelector('textarea').value.trim();
        const title = form.querySelector('[name=title]').value.trim();
        const broadcast = form.querySelector('[type=checkbox]').checked;
        const image = draftImage;
        try {
          if (!title) throw new Error('Add an announcement title first.');
          if (!text) throw new Error('Write an announcement description first.');
          if (!await confirm('Are you sure you would like to send this announcement?')) return;
          if (broadcast && !await confirm('Are you sure you want to send this announcement? It will notify every single user registered.')) return;
          await relay.announcements('create', { title, text, image, notify: broadcast });
          composing = false;
          await refresh();
        } catch (e) { error(e); } finally { publishing = false; publish.disabled = false; file.disabled = false; }
      };
    }
    create.onclick = compose;
    win.body.querySelector('[data-refresh]').onclick = () => { if (!composing) refresh(); };
    win.announcementReading = () => !composing && !win.minimized && document.visibilityState === 'visible';
    win.announcementChanged = () => {
      if (loading) { refreshAgain = true; return; }
      if (!layer.hidden || [...feed.querySelectorAll('textarea')].some((t) => t.value)) {
        status.textContent = 'New activity is available. Refresh when you have finished your comment.';
        return;
      }
      return refresh(false, true);
    };
    win.announcementRefresh = refresh;
    win.announcementRole = () => {
      create.hidden = !admin();
      if (composing && !admin()) {
        if (confirmResolve) { confirmResolve(false); confirmResolve = null; layer.hidden = true; }
        composing = false;
      }
      if (!composing) refresh();
    };
    win.onClose = () => { closed = true; generation++; if (confirmResolve) confirmResolve(false); };
    refresh();
    ctx.network.guard(win);
    return win;
  }
  apps.announcements = { label: 'Announcements', icon: ICON, launch: open };
  favorites.splice(favorites.indexOf('settings'), 0, 'announcements');
  renderDock();
  relay.on('announcements', check);
  relay.on('presence', check);
  relay.on('role', () => { const win = active(); if (win) win.announcementRole(); });
  check();
};
