window.lambdawebAdmin = (ctx) => {
  const { session, windows, createWindow, notify, escapeHtml, apps, favorites, renderDock } = ctx;
  const relay = session.relay;
  const ICON = 'admin-panel.png';

  const formatDate = (iso) => {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  };

  const adminWindows = () => windows.filter((win) => win.app === 'admin');

  const open = () => {
    const existing = adminWindows();
    if (existing.length) {
      existing[0].focus();
      return existing[0];
    }
    return build();
  };

  const sync = () => {
    const allowed = relay.role() !== 'user';
    if (allowed && !apps.admin) {
      apps.admin = { label: 'Admin Panel', icon: ICON, launch: () => open() };
      if (!favorites.includes('admin')) favorites.splice(Math.max(0, favorites.indexOf('settings')), 0, 'admin');
      renderDock();
    } else if (!allowed && apps.admin) {
      adminWindows().forEach((win) => win.close());
      delete apps.admin;
      renderDock();
    }
  };

  relay.on('role', () => {
    sync();
    adminWindows().forEach((win) => win.render());
  });
  relay.on('presence', () => adminWindows().forEach((win) => win.render()));
  sync();

  function build() {
    const win = createWindow({ app: 'admin', title: 'Admin Panel', width: 720, height: 520, minWidth: 460, minHeight: 340, className: 'is-social' });
    win.body.innerHTML = `
      <div class="bt">
        <nav class="bt-tabs">
          <button class="bt-tab" data-tab="users">Users</button>
          <button class="bt-tab" data-tab="messages">Messages</button>
          <span class="bt-spacer"></span>
          <button class="bt-btn small" data-act="refresh">Refresh</button>
        </nav>
        <div class="bt-view"></div>
        <div class="bt-layer" hidden></div>
      </div>`;
    const view = win.body.querySelector('.bt-view');
    const layer = win.body.querySelector('.bt-layer');
    const tabs = [...win.body.querySelectorAll('.bt-tab')];
    let tab = 'users';
    let users = null;
    let messages = null;
    let busy = false;
    let problem = '';
    let filter = '';

    const closeLayer = () => {
      layer.hidden = true;
      layer.innerHTML = '';
    };

    const renderUsers = () => {
      const me = relay.role();
      const live = new Set(relay.users().map((u) => u.username));
      live.add(session.username);
      const rows = (users || []).map((u) => {
        const tags = [];
        if (live.has(u.username)) tags.push('<span class="ad-tag on">ONLINE</span>');
        if (u.role === 'owner') tags.push('<span class="ad-tag owner">OWNER</span>');
        if (u.role === 'admin') tags.push('<span class="ad-tag admin">ADMIN</span>');
        const mine = u.username === session.username;
        const buttons = [];
        if (me === 'owner' && u.role !== 'owner') {
          buttons.push(`<button class="bt-btn small" data-act="${u.role === 'admin' ? 'demote' : 'promote'}" data-user="${escapeHtml(u.username)}">${u.role === 'admin' ? 'Remove admin' : 'Make admin'}</button>`);
        }
        if (!mine && u.role !== 'owner' && (u.role === 'user' || me === 'owner')) {
          buttons.push(`<button class="bt-btn small danger" data-act="delete-user" data-user="${escapeHtml(u.username)}">Delete</button>`);
        }
        return `<li class="ad-row"><span class="ad-name">${escapeHtml(u.username)}${mine ? ' <em>(you)</em>' : ''}</span><span class="ad-tags">${tags.join('')}</span><span class="bt-spacer"></span>${buttons.join('')}</li>`;
      });
      view.innerHTML = `<p class="ad-count">${users.length} registered ${users.length === 1 ? 'account' : 'accounts'}</p><ul class="bt-list">${rows.join('')}</ul>`;
    };

    const renderMessages = () => {
      const query = filter.trim().toLowerCase();
      const shown = (messages || []).filter((m) => !query || `${m.from} ${m.to} ${m.text}`.toLowerCase().includes(query));
      const items = shown.map((m) => {
        const buttons = [];
        if (m.image) buttons.push(`<button class="bt-btn small" data-act="view-image" data-id="${escapeHtml(m.id)}">View picture</button>`);
        if (!m.removed) buttons.push(`<button class="bt-btn small danger" data-act="delete-message" data-id="${escapeHtml(m.id)}">Delete message</button>`);
        const note = m.image ? '<em class="ad-pic">Picture attached</em>' : m.imageGone ? '<em class="ad-pic">Picture no longer stored</em>' : '';
        const body = m.removed ? '<em>Removed by an administrator</em>' : `${m.text ? escapeHtml(m.text) : ''}${m.text && note ? '<br>' : ''}${note}`;
        return `<li class="ad-msg${m.removed ? ' gone' : ''}">
          <div class="ad-msg-head"><strong>${escapeHtml(m.from)}</strong><span>→</span><strong>${escapeHtml(m.to)}</strong><span class="bt-spacer"></span><span class="bt-date">${escapeHtml(formatDate(m.sent))}</span></div>
          <div class="ad-msg-text">${body}</div>
          ${buttons.length ? `<div class="ad-msg-actions">${buttons.join('')}</div>` : ''}
        </li>`;
      });
      view.innerHTML = `<input class="ad-search" type="search" placeholder="Search messages" value="${escapeHtml(filter)}" spellcheck="false">${
        items.length ? `<ul class="bt-list ad-msgs">${items.join('')}</ul>` : '<p class="bt-empty compact">No messages to show.</p>'
      }`;
      const search = view.querySelector('.ad-search');
      search.addEventListener('input', () => {
        filter = search.value;
        const start = search.selectionStart;
        renderMessages();
        const again = view.querySelector('.ad-search');
        again.focus();
        again.setSelectionRange(start, start);
      });
    };

    win.render = () => {
      tabs.forEach((el) => el.classList.toggle('active', el.dataset.tab === tab));
      if (relay.role() === 'user') {
        view.innerHTML = '<p class="bt-empty">You do not have access to this panel.</p>';
        return;
      }
      if (problem) {
        view.innerHTML = `<p class="bt-empty">${escapeHtml(problem)}</p>`;
        return;
      }
      if (tab === 'users') {
        if (users) renderUsers();
        else view.innerHTML = `<p class="bt-empty">${busy ? 'Loading…' : 'Nothing loaded yet.'}</p>`;
      } else if (messages) {
        renderMessages();
      } else {
        view.innerHTML = `<p class="bt-empty">${busy ? 'Loading…' : 'Nothing loaded yet.'}</p>`;
      }
    };

    const load = async (which = tab) => {
      busy = true;
      problem = '';
      win.render();
      try {
        if (which === 'users') users = (await relay.admin('users')).users;
        else messages = (await relay.admin('messages')).messages;
      } catch (error) {
        problem = error.message;
      }
      busy = false;
      win.render();
    };

    const confirm = (title, body, label, run) => {
      layer.hidden = false;
      layer.innerHTML = `
        <div class="bt-dialog" role="dialog" aria-label="${escapeHtml(title)}">
          <h3>${escapeHtml(title)}</h3>
          <p class="ad-note">${escapeHtml(body)}</p>
          <div class="bt-foot"><span class="bt-spacer"></span>
            <button class="bt-btn" data-x="cancel">Cancel</button>
            <button class="bt-btn destructive" data-x="ok">${escapeHtml(label)}</button>
          </div>
        </div>`;
      layer.querySelector('[data-x="cancel"]').addEventListener('click', closeLayer);
      layer.querySelector('[data-x="ok"]').addEventListener('click', async (event) => {
        event.currentTarget.disabled = true;
        try {
          await run();
          closeLayer();
        } catch (error) {
          closeLayer();
          notify({ title: 'Action failed', body: error.message, iconName: ICON });
        }
      });
    };

    win.body.addEventListener('click', async (event) => {
      const tabBtn = event.target.closest('.bt-tab');
      if (tabBtn) {
        tab = tabBtn.dataset.tab;
        closeLayer();
        if ((tab === 'users' && !users) || (tab === 'messages' && !messages)) load(tab);
        else win.render();
        return;
      }
      const act = event.target.closest('[data-act]');
      if (!act) return;
      const name = act.dataset.user;
      if (act.dataset.act === 'refresh') {
        load(tab);
      } else if (act.dataset.act === 'delete-user') {
        confirm(`Delete ${name}?`, 'This removes the account from the relay and signs them out. Their undelivered messages are discarded. The username becomes available again.', 'Delete account', async () => {
          await relay.admin('delete-user', { username: name });
          notify({ title: 'Account deleted', body: name, iconName: ICON });
          await load('users');
        });
      } else if (act.dataset.act === 'promote' || act.dataset.act === 'demote') {
        const grant = act.dataset.act === 'promote';
        try {
          await relay.admin('set-admin', { username: name, admin: grant });
          notify({ title: grant ? 'Administrator added' : 'Administrator removed', body: name, iconName: ICON });
          await load('users');
        } catch (error) {
          notify({ title: 'Action failed', body: error.message, iconName: ICON });
        }
      } else if (act.dataset.act === 'view-image') {
        try {
          const { image } = await relay.admin('image', { id: act.dataset.id });
          if (typeof image !== 'string' || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(image)) throw new Error('That picture could not be loaded.');
          layer.hidden = false;
          layer.innerHTML = `<div class="bt-dialog bt-big" role="dialog" aria-label="Picture"><img src="${image}" alt="Attached picture" draggable="false"><div class="bt-foot"><span class="bt-spacer"></span><button class="bt-btn" data-x="close">Close</button></div></div>`;
          layer.querySelector('[data-x="close"]').addEventListener('click', closeLayer);
        } catch (error) {
          notify({ title: 'Could not load the picture', body: error.message, iconName: ICON });
        }
      } else if (act.dataset.act === 'delete-message') {
        const id = act.dataset.id;
        confirm('Delete this message?', 'It is removed for the sender and the recipient, who will see that it was removed by an administrator.', 'Delete message', async () => {
          await relay.admin('delete-message', { id });
          notify({ title: 'Message removed', body: 'Both people have been told.', iconName: ICON });
          await load('messages');
        });
      }
    });

    load('users');
    return win;
  }
};
