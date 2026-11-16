window.bootLambdaweb = (session) => {
  const root = document.getElementById('lambdaweb-desktop');
  const frame = root && root.closest('.lambdaweb-frame');
  if (!root || !frame) return;

  const USER = session.username;
  const HOME = `/home/${USER}`;
  const HOSTNAME = session.hostname || 'lambdaweb';

  const asset = (path) => `lambdaweb/${path}`;
  const sym = (name) => `<i class="sym" style="--m:url('${asset(`symbolic/${name}-symbolic.svg`)}')"></i>`;
  const setSym = (node, name) => node.style.setProperty('--m', `url('${asset(`symbolic/${name}-symbolic.svg`)}')`);
  const lambda = (cls = '', alt = '') =>
    `<img class="${cls} lw-on-dark" src="${asset('lambda-white.png')}" alt="${alt}" draggable="false"><img class="${cls} lw-on-light" src="${asset('lambda-black.png')}" alt="${alt}" draggable="false">`;
  const icon = (dir, name, cls = '') => {
    if (name === 'lambda') return lambda(cls);
    const file = /\.(?:svg|png)$/.test(name) ? name : `${name}.svg`;
    return `<img class="${cls}" src="${asset(`${dir}/${file}`)}" alt="" draggable="false">`;
  };
  const escapeHtml = (text) => text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const isImageData = (content) => typeof content === 'string' && /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(content);

  const fs = (() => {
    const listeners = new Set();
    const dirty = new Set();
    const markDirty = () => dirty.forEach((fn) => fn());
    const emit = () => {
      listeners.forEach((fn) => fn());
      markDirty();
    };
    const newDir = () => ({ type: 'dir', children: {}, mtime: new Date() });
    const newFile = (content = '') => ({ type: 'file', content, mtime: new Date() });
    const tree = newDir();
    const trash = [];
    const recent = [];

    const parts = (path) => path.split('/').filter(Boolean);
    const join = (dir, name) => `${dir === '/' ? '' : dir}/${name}`;
    const split = (path) => {
      const segments = parts(path);
      const name = segments.pop() || '';
      return { dir: `/${segments.join('/')}`, name };
    };
    const resolve = (input, cwd = HOME) => {
      const path = input === '~' ? HOME : input.startsWith('~/') ? HOME + input.slice(1) : input;
      const stack = path.startsWith('/') ? [] : parts(cwd);
      parts(path).forEach((segment) => {
        if (segment === '..') stack.pop();
        else if (segment !== '.') stack.push(segment);
      });
      return `/${stack.join('/')}`;
    };
    const get = (path) => parts(path).reduce((node, segment) => (node && node.type === 'dir' ? node.children[segment] : null) || null, tree);
    const fail = (message) => {
      throw new Error(message);
    };
    const writable = (path) => path === HOME || path.startsWith(`${HOME}/`) || path === '/tmp' || path.startsWith('/tmp/');
    const guard = (path) => {
      if (!writable(path)) fail('Permission denied');
    };
    const parentOf = (path) => {
      const { dir, name } = split(path);
      const parent = get(dir);
      if (!parent || parent.type !== 'dir') fail('No such file or directory');
      return { parent, name };
    };

    const unique = (dir, name, copy = false) => {
      const parent = get(dir);
      if (!parent || !parent.children[name]) return name;
      const dot = name.lastIndexOf('.');
      const stem = dot > 0 ? name.slice(0, dot) : name;
      const ext = dot > 0 ? name.slice(dot) : '';
      for (let n = 2; ; n++) {
        const candidate = copy ? `${stem} (copy${n > 2 ? ` ${n - 1}` : ''})${ext}` : `${stem} ${n}${ext}`;
        if (!parent.children[candidate]) return candidate;
      }
    };

    const api = {
      parts,
      join,
      split,
      resolve,
      get,
      unique,
      recent,
      trash,
      onChange: (fn) => {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
      isDir: (path) => !!get(path) && get(path).type === 'dir',
      entries(path) {
        const node = get(path);
        if (!node) fail('No such file or directory');
        if (node.type !== 'dir') fail('Not a directory');
        if (node.restricted) fail('Permission denied');
        return Object.entries(node.children)
          .map(([name, child]) => ({ name, node: child, path: join(path, name) }))
          .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }));
      },
      read(path) {
        const node = get(path);
        if (!node) fail('No such file or directory');
        if (node.type === 'dir') fail('Is a directory');
        if (node.restricted) fail('Permission denied');
        return node.content;
      },
      size(node) {
        if (node.type === 'dir') return 4096;
        const data = node.content;
        if (data.startsWith('data:image/')) {
          const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
          return Math.floor(((data.length - data.indexOf(',') - 1) * 3) / 4) - padding;
        }
        return new Blob([data]).size;
      },
      write(path, content, append = false) {
        if (path === '/dev/null') return;
        const existing = get(path);
        if (existing && existing.type === 'dir') fail('Is a directory');
        guard(path);
        if (existing) {
          existing.content = append ? existing.content + content : content;
          existing.mtime = new Date();
        } else {
          const { parent, name } = parentOf(path);
          parent.children[name] = newFile(content);
          parent.mtime = new Date();
        }
        emit();
      },
      setContent(path, content) {
        const node = get(path);
        if (node && node.type === 'file') {
          node.content = content;
          node.mtime = new Date();
          markDirty();
        }
      },
      onDirty: (fn) => dirty.add(fn),
      markDirty,
      seedDir(path, { restricted = false, mtime } = {}) {
        let current = tree;
        parts(path).forEach((segment) => {
          if (!current.children[segment]) current.children[segment] = newDir();
          current = current.children[segment];
          if (mtime) current.mtime = mtime;
        });
        if (restricted) current.restricted = true;
        return current;
      },
      seedFile(path, content, { overwrite = false, mtime, restricted = false } = {}) {
        const { dir, name } = split(path);
        const parent = api.seedDir(dir);
        const existing = parent.children[name];
        if (existing && !(overwrite && existing.type === 'file')) return false;
        const node = newFile(typeof content === 'function' ? '' : content);
        if (typeof content === 'function') Object.defineProperty(node, 'content', { get: content, enumerable: true });
        if (mtime) node.mtime = mtime;
        if (restricted) node.restricted = true;
        parent.children[name] = node;
        return true;
      },
      seedAlias(path, target) {
        const { dir, name } = split(path);
        api.seedDir(dir).children[name] = get(target);
      },
      dump() {
        const pack = (node) =>
          node.type === 'dir'
            ? { t: 'd', m: node.mtime.getTime(), c: Object.fromEntries(Object.entries(node.children).map(([name, child]) => [name, pack(child)])) }
            : { t: 'f', m: node.mtime.getTime(), c: node.content };
        const persisted = newDir();
        persisted.children.home = tree.children.home;
        persisted.children.tmp = tree.children.tmp;
        return JSON.stringify({ tree: pack(persisted), trash: trash.map((item) => ({ name: item.name, from: item.from, node: pack(item.node) })), recent });
      },
      load(json) {
        const unpack = (data) => {
          if (!data || typeof data !== 'object') return null;
          const mtime = new Date(Number(data.m) || Date.now());
          if (data.t === 'f') return { type: 'file', content: String(data.c ?? ''), mtime };
          const node = { type: 'dir', children: {}, mtime };
          Object.entries(data.c || {}).forEach(([name, child]) => {
            const value = unpack(child);
            if (value) node.children[name] = value;
          });
          return node;
        };
        const data = JSON.parse(json);
        const saved = unpack(data.tree);
        if (!saved || saved.type !== 'dir') return;
        ['home', 'tmp'].forEach((name) => {
          if (saved.children[name] && saved.children[name].type === 'dir') tree.children[name] = saved.children[name];
        });
        tree.mtime = saved.mtime;
        const home = tree.children.home;
        if (!home.children[USER]) home.children[USER] = newDir();
        trash.length = 0;
        (data.trash || []).forEach((item) => {
          const node = unpack(item.node);
          if (node) trash.push({ name: String(item.name), from: String(item.from), node });
        });
        recent.length = 0;
        (data.recent || []).forEach((path) => recent.push(String(path)));
      },
      touch(path) {
        const node = get(path);
        if (node) {
          guard(path);
          node.mtime = new Date();
          emit();
        } else {
          api.write(path, '');
        }
      },
      mkdir(path, parents = false) {
        if (parents) {
          let current = '/';
          parts(path).forEach((segment) => {
            current = join(current, segment);
            const node = get(current);
            if (!node) {
              guard(current);
              parentOf(current).parent.children[segment] = newDir();
            } else if (node.type !== 'dir') {
              fail('Not a directory');
            }
          });
          emit();
          return;
        }
        guard(path);
        const { parent, name } = parentOf(path);
        if (parent.children[name]) fail('File exists');
        parent.children[name] = newDir();
        parent.mtime = new Date();
        emit();
      },
      remove(path) {
        const node = get(path);
        if (!node) fail('No such file or directory');
        guard(path);
        if (path === HOME) fail('Permission denied');
        const { parent, name } = parentOf(path);
        delete parent.children[name];
        parent.mtime = new Date();
        emit();
      },
      move(src, dst) {
        const node = get(src);
        if (!node) fail('No such file or directory');
        guard(src);
        if (src === HOME) fail('Permission denied');
        const target = api.isDir(dst) ? join(dst, split(src).name) : dst;
        if (target === src) return;
        if (target.startsWith(`${src}/`)) fail('cannot move a directory into itself');
        guard(target);
        const to = parentOf(target);
        const from = parentOf(src);
        const existing = to.parent.children[to.name];
        if (existing && existing.type === 'dir' && node.type !== 'dir') fail('cannot overwrite directory with non-directory');
        delete from.parent.children[from.name];
        to.parent.children[to.name] = node;
        emit();
      },
      copy(src, dst) {
        const node = get(src);
        if (!node) fail('No such file or directory');
        const target = api.isDir(dst) ? join(dst, split(src).name) : dst;
        if (target === src || target.startsWith(`${src}/`)) fail('cannot copy a directory into itself');
        guard(target);
        const to = parentOf(target);
        const clone = structuredClone(node);
        clone.mtime = new Date();
        to.parent.children[to.name] = clone;
        emit();
      },
      trashPath(path) {
        const node = get(path);
        if (!node) fail('No such file or directory');
        guard(path);
        if (path === HOME) fail('Permission denied');
        const { parent, name } = parentOf(path);
        delete parent.children[name];
        trash.push({ name, node, from: path });
        emit();
      },
      restore(index) {
        const item = trash[index];
        if (!item) return;
        const { dir, name } = split(item.from);
        const targetDir = api.isDir(dir) ? dir : HOME;
        get(targetDir).children[unique(targetDir, name)] = item.node;
        trash.splice(index, 1);
        emit();
      },
      purge(index) {
        trash.splice(index, 1);
        emit();
      },
      emptyTrash() {
        trash.length = 0;
        emit();
      },
      touchRecent(path) {
        const at = recent.indexOf(path);
        if (at >= 0) recent.splice(at, 1);
        recent.unshift(path);
        recent.length = Math.min(recent.length, 30);
      },
    };

    ['bin', 'boot', 'dev', 'etc', 'home', 'lib', 'mnt', 'opt', 'proc', 'root', 'run', 'sbin', 'srv', 'sys', 'tmp', 'usr', 'var'].forEach((name) => {
      tree.children[name] = newDir();
    });
    tree.children.home.children[USER] = newDir();
    ['Desktop', 'Documents', 'Downloads', 'Music', 'Pictures', 'Public', 'Templates', 'Videos'].forEach((name) => {
      tree.children.home.children[USER].children[name] = newDir();
    });
    tree.children.etc.children.hostname = newFile(`${HOSTNAME}\n`);
    tree.children.etc.children['os-release'] = newFile(
      [
        'PRETTY_NAME="lambdawebOS"',
        'NAME="lambdawebOS"',
        'VERSION_ID="1.0"',
        'VERSION="1.0"',
        'ID=lambdaweb',
        'HOME_URL="https://runewasneverhere.com/"',
        '',
      ].join('\n')
    );

    return api;
  })();

  root.innerHTML = `
    <div class="wallpaper"></div>
    <div class="desk-mark" aria-hidden="true"><img class="lw-on-dark" src="${asset('wordmark-white.png')}" alt="" draggable="false"><img class="lw-on-light" src="${asset('wordmark-black.png')}" alt="" draggable="false"></div>
    <div class="workarea"></div>
    <aside class="dock">
      <div class="dock-apps"></div>
      <div class="dock-bottom"></div>
    </aside>
    <div class="overview">
      <input class="overview-search" type="text" placeholder="Type to search" spellcheck="false" autocomplete="off">
      <div class="overview-grid"></div>
    </div>
    <header class="panel">
      <div class="panel-left"><button class="panel-btn panel-activities" data-act="activities" aria-label="Activities"><i class="pill"></i><i class="pdot"></i></button></div>
      <div class="panel-clock-wrap"><span class="panel-clock"></span>${sym('notification')}</div>
      <div class="panel-right">
        <button class="panel-btn panel-sys" data-act="quick" aria-label="System menu">${sym('network-wireless')}${sym('audio-volume-high')}${sym('system-shutdown')}</button>
      </div>
    </header>
    <div class="qs" hidden>
      <div class="qs-main">
        <div class="qs-top">
          <button class="qs-round" data-act="settings" aria-label="Settings">${sym('emblem-system')}</button>
          <button class="qs-round" data-act="poweroff" aria-label="Power Off">${sym('system-shutdown')}</button>
        </div>
        <label class="qs-volume">${sym('audio-volume-high')}<input type="range" min="0" max="100" value="60" aria-label="Volume"></label>
        <div class="qs-tiles">
          <button class="qs-tile on" data-tile="wifi">${sym('network-wireless')}<span>Wi-Fi</span></button>
          <button class="qs-tile" data-tile="bluetooth">${sym('bluetooth')}<span>Bluetooth</span><i class="qs-more" data-more="bluetooth" aria-label="Bluetooth devices">›</i></button>
          <button class="qs-tile" data-tile="dark">${sym('preferences-desktop-appearance')}<span>Dark Style</span></button>
          <button class="qs-tile" data-tile="fullscreen">${sym('view-fullscreen')}<span>Full Screen</span></button>
        </div>
      </div>
      <div class="qs-panel" hidden></div>
    </div>
    <div class="notifications"></div>
    <div class="poweroff"></div>`;

  const wallpaperEl = root.querySelector('.wallpaper');
  const workarea = root.querySelector('.workarea');
  const dockApps = root.querySelector('.dock-apps');
  const dockBottom = root.querySelector('.dock-bottom');
  const overview = root.querySelector('.overview');
  const overviewGrid = root.querySelector('.overview-grid');
  const notifications = root.querySelector('.notifications');
  const overviewSearch = root.querySelector('.overview-search');
  const quick = root.querySelector('.qs');
  const clock = root.querySelector('.panel-clock');
  const fsButton = frame.querySelector('.lambdaweb-fs-btn');

  const state = { theme: 'dark', accent: '#7764d8', wallpaper: 'default', customWallpaper: '', showTrash: true, wifi: true, bluetooth: true, sounds: true, volume: 60, dockPosition: 'left', dockIcon: 40, clock24: true, showSeconds: false, showDate: true, animations: true };
  let settingsReady = false;
  const persistSettings = () => {
    if (!settingsReady) return;
    session.store.set('settings', JSON.stringify(state));
    if (ctx.desktopConfig) ctx.desktopConfig.toFile();
  };
  try {
    const saved = JSON.parse(session.store.get('settings') || 'null');
    if (saved && typeof saved === 'object') {
      if (saved.theme === 'light' || saved.theme === 'dark') state.theme = saved.theme;
      if (/^#[0-9a-f]{6}$/i.test(saved.accent)) state.accent = saved.accent;
      if (typeof saved.wallpaper === 'string') state.wallpaper = saved.wallpaper;
      if (typeof saved.customWallpaper === 'string' && (saved.customWallpaper === '' || isImageData(saved.customWallpaper))) state.customWallpaper = saved.customWallpaper;
      ['showTrash', 'wifi', 'bluetooth', 'sounds', 'clock24', 'showSeconds', 'showDate', 'animations'].forEach((key) => {
        if (typeof saved[key] === 'boolean') state[key] = saved[key];
      });
      if (['left', 'right', 'bottom'].includes(saved.dockPosition)) state.dockPosition = saved.dockPosition;
      if (Number.isFinite(saved.volume)) state.volume = Math.min(100, Math.max(0, Math.round(saved.volume)));
      if (Number.isFinite(saved.dockIcon)) state.dockIcon = Math.min(64, Math.max(32, Math.round(saved.dockIcon)));
    }
  } catch (error) {
    session.store.remove('settings');
  }

  const portraitPhone = window.matchMedia('(max-width: 768px) and (orientation: portrait)');
  const defaultWallpaper = () => `url('${asset(state.theme === 'light' ? 'wallpaper-light.svg' : 'wallpaper-dark.svg')}') center / cover no-repeat, ${state.theme === 'light' ? '#dfe4f1' : '#14172b'}`;

  const wallpapers = [
    { id: 'default', label: 'lambdawebOS', get css() { return defaultWallpaper(); } },
    { id: 'midnight', label: 'Midnight', css: '#14172b' },
    { id: 'slate', label: 'Slate', css: '#2b2f3a' },
    { id: 'charcoal', label: 'Charcoal', css: '#2b2b2b' },
    { id: 'navy', label: 'Navy', css: '#1c3d6e' },
    { id: 'forest', label: 'Forest', css: '#1f4d3a' },
    { id: 'plum', label: 'Plum', css: '#3b2149' },
    { id: 'ocean', label: 'Ocean', css: 'linear-gradient(135deg, #0f2027, #203a43 50%, #2c5364)' },
    { id: 'aurora', label: 'Aurora', css: 'linear-gradient(135deg, #1d2671, #c33764)' },
    { id: 'dawn', label: 'Dawn', css: 'linear-gradient(135deg, #ff9a8b, #ff6a88 55%, #ff99ac)' },
  ];

  const accents = [
    { name: 'Orange', color: '#e95420' },
    { name: 'Bark', color: '#787859' },
    { name: 'Sage', color: '#657b69' },
    { name: 'Olive', color: '#4b8501' },
    { name: 'Viridian', color: '#03875b' },
    { name: 'Prussian Green', color: '#308280' },
    { name: 'Blue', color: '#0073e5' },
    { name: 'Purple', color: '#7764d8' },
    { name: 'Magenta', color: '#b34cb3' },
    { name: 'Red', color: '#da3450' },
  ];

  const wallpaperCss = (id) => {
    if (id === 'custom' && state.customWallpaper) return `url('${state.customWallpaper}') center / cover no-repeat, #14172b`;
    return (wallpapers.find((item) => item.id === id) || wallpapers[0]).css;
  };

  const applyWallpaper = () => {
    wallpaperEl.style.background = wallpaperCss(state.wallpaper);
    root.classList.toggle('custom-wallpaper', state.wallpaper === 'custom');
    persistSettings();
  };

  portraitPhone.addEventListener('change', applyWallpaper);

  const applyTheme = () => {
    root.dataset.theme = state.theme;
    root.style.setProperty('--accent', state.accent);
    quick.querySelector('[data-tile="dark"]').classList.toggle('on', state.theme === 'dark');
    if (state.wallpaper === 'default') applyWallpaper();
    persistSettings();
  };

  const compact = () => workarea.clientWidth < 640;

  const windows = [];
  let focused = null;
  let zIndex = 10;
  let cascade = 0;

  const EASE_OUT = 'cubic-bezier(0.25, 0.46, 0.45, 0.94)';
  const visibleWindows = () => windows.filter((win) => !win.minimized).sort((a, b) => Number(b.el.style.zIndex) - Number(a.el.style.zIndex));

  const setFocused = (win) => {
    focused = win;
    windows.forEach((item) => item.el.classList.toggle('focused', item === win));
    renderDock();
  };

  function createWindow({ app, title, width = 720, height = 480, minWidth = 300, minHeight = 200, className = '' }) {
    const el = document.createElement('div');
    el.className = `uwin ${className}`.trim();
    el.dataset.app = app;
    el.innerHTML = `
      <header class="uwin-header">
        <div class="uwin-heading"><span class="uwin-title">${escapeHtml(title)}</span></div>
        <div class="uwin-controls">
          <button class="uwin-btn" data-act="minimize" aria-label="Minimize">${sym('window-minimize')}</button>
          <button class="uwin-btn" data-act="maximize" aria-label="Maximize">${sym('window-maximize')}</button>
          <button class="uwin-btn uwin-close" data-act="close" aria-label="Close">${sym('window-close')}</button>
        </div>
      </header>
      <div class="uwin-body"></div>
      ${['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'].map((dir) => `<i class="rz rz-${dir}" data-dir="${dir}"></i>`).join('')}`;

    const w = Math.min(width, workarea.clientWidth - 16);
    const h = Math.min(height, workarea.clientHeight - 16);
    const offset = (cascade++ % 6) * 28;
    el.style.width = `${w}px`;
    el.style.height = `${h}px`;
    el.style.left = `${Math.max(8, Math.min(40 + offset, workarea.clientWidth - w - 8))}px`;
    el.style.top = `${Math.max(8, Math.min(24 + offset, workarea.clientHeight - h - 8))}px`;

    const win = {
      el,
      app,
      heading: el.querySelector('.uwin-heading'),
      body: el.querySelector('.uwin-body'),
      minimized: false,
      maximized: false,
    };
    const maxIcon = el.querySelector('[data-act="maximize"] .sym');

    const play = (frames, duration) => {
      if (win.anim) win.anim.cancel();
      win.anim = el.animate(frames, { duration: state.animations ? duration : 0, easing: EASE_OUT, fill: 'forwards' });
      return win.anim;
    };
    const dockPose = () => {
      const target = dockApps.querySelector(`[data-app="${win.app}"]`) || dockApps;
      const from = el.getBoundingClientRect();
      const to = target.getBoundingClientRect();
      const x = to.left + to.width / 2 - (from.left + from.width / 2);
      const y = to.top + to.height / 2 - (from.top + from.height / 2);
      return { opacity: 0, transform: `translate(${x}px, ${y}px) scale(0.1)` };
    };

    win.focus = () => {
      if (win.minimized) {
        win.minimized = false;
        if (win.anim) win.anim.cancel();
        el.classList.remove('minimized');
        const pose = dockPose();
        play([pose, { opacity: 1, transform: 'none' }], 200).onfinish = () => win.anim.cancel();
      }
      zIndex += 1;
      el.style.zIndex = zIndex;
      setFocused(win);
    };
    win.minimize = () => {
      win.minimized = true;
      if (focused === win) setFocused(visibleWindows()[0] || null);
      else renderDock();
      const pose = dockPose();
      play([{ opacity: 1, transform: 'none' }, pose], 200).onfinish = () => {
        if (win.minimized) el.classList.add('minimized');
        win.anim.cancel();
      };
    };
    win.toggleMaximize = (animate = true) => {
      const before = el.getBoundingClientRect();
      win.maximized = !win.maximized;
      el.classList.toggle('maximized', win.maximized);
      setSym(maxIcon, win.maximized ? 'window-restore' : 'window-maximize');
      const after = el.getBoundingClientRect();
      if (!animate || !after.width || !after.height) return;
      const start = `translate(${before.left - after.left}px, ${before.top - after.top}px) scale(${before.width / after.width}, ${before.height / after.height})`;
      el.style.transformOrigin = '0 0';
      play([{ transform: start }, { transform: 'none' }], 250).onfinish = () => {
        win.anim.cancel();
        el.style.transformOrigin = '';
      };
    };
    win.close = () => {
      windows.splice(windows.indexOf(win), 1);
      if (win.minimized) {
        el.remove();
      } else {
        el.style.pointerEvents = 'none';
        play([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(0.8)' }], 150).onfinish = () => el.remove();
        setTimeout(() => el.remove(), 250);
      }
      if (win.onClose) win.onClose();
      if (focused === win) setFocused(visibleWindows()[0] || null);
      else renderDock();
    };

    el.addEventListener('pointerdown', () => {
      if (focused !== win) win.focus();
    });

    el.querySelector('.uwin-controls').addEventListener('click', (event) => {
      const act = event.target.closest('[data-act]');
      if (!act) return;
      if (act.dataset.act === 'minimize') win.minimize();
      else if (act.dataset.act === 'maximize') win.toggleMaximize();
      else win.close();
    });

    const header = el.querySelector('.uwin-header');
    header.addEventListener('dblclick', (event) => {
      if (!event.target.closest('button, input, textarea, a') && !compact()) win.toggleMaximize();
    });
    header.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || win.maximized || event.target.closest('button, input, textarea, a')) return;
      const origin = { x: event.clientX, y: event.clientY, left: el.offsetLeft, top: el.offsetTop };
      header.setPointerCapture(event.pointerId);
      const move = (ev) => {
        el.style.left = `${clamp(origin.left + ev.clientX - origin.x, 80 - el.offsetWidth, workarea.clientWidth - 80)}px`;
        el.style.top = `${clamp(origin.top + ev.clientY - origin.y, 0, workarea.clientHeight - 40)}px`;
      };
      const stop = () => {
        header.removeEventListener('pointermove', move);
        header.removeEventListener('pointerup', stop);
        header.removeEventListener('pointercancel', stop);
      };
      header.addEventListener('pointermove', move);
      header.addEventListener('pointerup', stop);
      header.addEventListener('pointercancel', stop);
    });

    el.querySelectorAll('.rz').forEach((handle) => {
      handle.addEventListener('pointerdown', (event) => {
        if (event.button !== 0 || win.maximized) return;
        event.stopPropagation();
        const dir = handle.dataset.dir;
        const origin = { x: event.clientX, y: event.clientY, left: el.offsetLeft, top: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
        handle.setPointerCapture(event.pointerId);
        const move = (ev) => {
          const dx = ev.clientX - origin.x;
          const dy = ev.clientY - origin.y;
          let { left, top, w: nextW, h: nextH } = origin;
          if (dir.includes('e')) nextW = Math.max(minWidth, origin.w + dx);
          if (dir.includes('s')) nextH = Math.max(minHeight, origin.h + dy);
          if (dir.includes('w')) {
            nextW = Math.max(minWidth, origin.w - dx);
            left = origin.left + origin.w - nextW;
          }
          if (dir.includes('n')) {
            nextH = Math.max(minHeight, origin.h - dy);
            top = Math.max(0, origin.top + origin.h - nextH);
            nextH = origin.top + origin.h - top;
          }
          el.style.width = `${nextW}px`;
          el.style.height = `${nextH}px`;
          el.style.left = `${left}px`;
          el.style.top = `${top}px`;
        };
        const stop = () => {
          handle.removeEventListener('pointermove', move);
          handle.removeEventListener('pointerup', stop);
          handle.removeEventListener('pointercancel', stop);
        };
        handle.addEventListener('pointermove', move);
        handle.addEventListener('pointerup', stop);
        handle.addEventListener('pointercancel', stop);
      });
    });

    workarea.append(el);
    windows.push(win);
    if (compact()) win.toggleMaximize(false);
    win.focus();
    play([{ opacity: 0, transform: 'scale(0.8)' }, { opacity: 1, transform: 'none' }], 150).onfinish = () => win.anim.cancel();
    return win;
  }

  const closeMenus = () => root.querySelectorAll('.umenu').forEach((menu) => menu.remove());

  function showMenu(event, items) {
    closeMenus();
    const menu = document.createElement('div');
    menu.className = 'umenu';
    items.forEach((item) => {
      if (item === '-') {
        menu.append(document.createElement('hr'));
        return;
      }
      const button = document.createElement('button');
      button.textContent = item.label;
      button.disabled = !!item.disabled;
      button.addEventListener('click', () => {
        closeMenus();
        item.run();
      });
      menu.append(button);
    });
    root.append(menu);
    const rect = root.getBoundingClientRect();
    const x = Math.min(event.clientX - rect.left, rect.width - menu.offsetWidth - 6);
    const y = Math.min(event.clientY - rect.top, rect.height - menu.offsetHeight - 6);
    menu.style.left = `${Math.max(6, x)}px`;
    menu.style.top = `${Math.max(6, y)}px`;
  }

  const apps = {
    firefox: { label: 'Firefox', icon: 'firefox', launch: () => openBrowser() },
    files: { label: 'Files', icon: 'files', launch: () => openFiles() },
    center: { label: 'App Center', icon: 'app-center', launch: () => openStore() },
    help: { label: 'Help', icon: 'help', launch: () => openAbout() },
    terminal: { label: 'Terminal', icon: 'org.gnome.Ptyxis.png', launch: () => openTerminal() },
    editor: { label: 'Text Editor', icon: 'text-editor', launch: () => openNewDocument() },
    settings: { label: 'Settings', icon: 'settings', launch: () => openSettings() },
  };
  const favorites = ['firefox', 'files', 'center', 'help', 'settings'];

  const fileOpeners = [];
  const registerOpener = (test, open) => fileOpeners.push({ test, open });
  function openPath(path) {
    const node = fs.get(path);
    if (!node || node.type !== 'file') return null;
    const opener = fileOpeners.find((entry) => entry.test(path, node));
    return opener ? opener.open(path) : openEditor(path);
  }

  const catalog = [
    {
      id: 'fastfetch',
      name: 'fastfetch',
      command: 'fastfetch',
      icon: 'lambda',
      author: 'Linus Dierheimer',
      maintainer: 'Carter Li',
      description: "A terminal application that prints your system's specs and operating system.",
      launch: () => openTerminal({ run: 'fastfetch', width: 940, height: 500 }),
    },
    {
      id: 'pipes',
      name: 'pipes.sh',
      command: 'pipes.sh',
      icon: 'pipes',
      author: 'Matthew Simpson',
      maintainer: 'Pipeseroni',
      description: 'A recreation of the classic Windows Pipes screensaver, now in your terminal!',
      launch: () => openTerminal({ run: 'pipes.sh', closeOnExit: true }),
    },
    {
      id: 'lavat',
      name: 'lavat',
      command: 'lavat',
      icon: 'lavat',
      author: 'AngelJumbo',
      description: 'Cool looking lava lamp effect in your terminal.',
      launch: () => openTerminal({ run: 'lavat', closeOnExit: true }),
    },
    {
      id: 'music',
      name: 'Music Player',
      icon: 'rhythmbox.png',
      author: 'rune_wasneverhere',
      description: 'Lets you listen to a very fine hand-picked catalogue of Aphex Twin. Nothing else though because I am an asshole.',
      launch: () => ctx.media.openMusic(),
    },
    {
      id: 'paint',
      name: 'Paint',
      icon: 'paint.png',
      author: 'rune_wasneverhere',
      description: 'Sketch! Draw! Paint! Make absolutely disgusting creations that I do not want to see! The choice is yours!',
      launch: () => ctx.media.openPaint(),
    },
    {
      id: 'cmatrix',
      name: 'cmatrix',
      command: 'cmatrix',
      icon: 'cli-terminal.png',
      author: 'Chris Allegretta',
      maintainer: 'Abishek V Ashok',
      description: 'Makes your terminal look like the falling green code from The Matrix. Try -C red, -r for rainbow or -u 9 for speed.',
      launch: () => openTerminal({ run: 'cmatrix', closeOnExit: true }),
    },
    {
      id: 'peaclock',
      name: 'peaclock',
      command: 'peaclock',
      icon: 'cli-terminal.png',
      author: 'octobanana',
      description: 'A big, customizable clock for your terminal. Tweak it in ~/.config/peaclock/config.',
      launch: () => openTerminal({ run: 'peaclock', closeOnExit: true }),
    },
    {
      id: 'nano',
      name: 'nano',
      command: 'nano',
      icon: 'nano.png',
      author: 'Chris Allegretta',
      description: 'A small, friendly text editor that lives in your terminal. Settings go in ~/.nanorc.',
      launch: () => openTerminal({ run: 'nano', closeOnExit: true, width: 760, height: 480 }),
    },
    {
      id: 'calculator',
      name: 'Calculator',
      icon: 'calculator.png',
      author: 'rune_wasneverhere',
      description: 'Crunch some numbers! Basic and scientific modes, with full keyboard support.',
      launch: () => ctx.guiApps.openCalculator(),
    },
    {
      id: 'clocks',
      name: 'Clocks',
      icon: 'clocks.png',
      author: 'rune_wasneverhere',
      description: 'World clocks, an alarm, a stopwatch and a timer, all in one place.',
      launch: () => ctx.guiApps.openClocks(),
    },
    {
      id: 'system-monitor',
      name: 'System Monitor',
      icon: 'system-monitor.png',
      author: 'rune_wasneverhere',
      description: 'See which apps are running and how much of your browser they are using. End the ones that misbehave.',
      launch: () => ctx.guiApps.openMonitor(),
    },
  ];
  const installed = new Set();
  const installs = new Map();
  const installedCommands = () => catalog.filter((item) => item.command && installed.has(item.id)).map((item) => item.command);
  const installStages = ['Downloading', 'Installing', 'Finishing up'];
  let installTimer = null;

  const saveInstalled = () => session.store.set('installed', JSON.stringify([...installed]));
  const registerInstalled = (item) => {
    installed.add(item.id);
    apps[item.id] = { label: item.name, icon: item.icon, launch: item.launch };
  };
  try {
    const saved = JSON.parse(session.store.get('installed') || '[]');
    if (Array.isArray(saved)) {
      saved.forEach((id) => {
        const item = catalog.find((entry) => entry.id === id);
        if (item) registerInstalled(item);
      });
    }
  } catch (error) {
    session.store.remove('installed');
  }

  function notify({ title, body, iconName, onClick, duration = 7000, sound = 'message' }) {
    if (sound) ctx.sound.play(sound);
    const el = document.createElement('div');
    el.className = 'notification';
    if (onClick) el.classList.add('actionable');
    el.innerHTML = `${icon('apps', iconName)}<div><strong>${escapeHtml(title)}</strong><span>${escapeHtml(body)}</span></div>`;
    notifications.append(el);
    const dismiss = () => {
      if (!el.isConnected || el.classList.contains('leaving')) return;
      el.classList.add('leaving');
      setTimeout(() => el.remove(), 250);
    };
    el.addEventListener('click', () => {
      dismiss();
      if (onClick) onClick();
    });
    setTimeout(dismiss, duration);
    return dismiss;
  }

  const refreshStore = (full = true) => windows.filter((win) => win.app === 'center').forEach((win) => win.renderStore(full));
  const refreshOverview = () => {
    if (overview.classList.contains('open')) renderOverview();
  };

  function startInstall(id) {
    if (installed.has(id) || installs.has(id)) return;
    if (!ctx.network.online()) {
      ctx.sound.play('error');
      notify({ title: 'No connection', body: 'Please check your Wi-Fi connection.', iconName: 'app-center.svg' });
      return;
    }
    installs.set(id, { start: performance.now(), stages: installStages.map(() => 2500 + Math.random() * 6500), stage: 0, progress: 0 });
    refreshStore();
    if (!installTimer) installTimer = setInterval(stepInstalls, 100);
  }

  let lastInstallStep = 0;
  function stepInstalls() {
    const now = performance.now();
    const delta = lastInstallStep ? now - lastInstallStep : 0;
    lastInstallStep = now;
    if (!ctx.network.online()) {
      installs.forEach((job) => {
        job.start += delta;
        job.stalled = true;
      });
      refreshStore(false);
      return;
    }
    installs.forEach((job, id) => {
      job.stalled = false;
      let elapsed = now - job.start;
      let stage = 0;
      while (stage < job.stages.length && elapsed >= job.stages[stage]) {
        elapsed -= job.stages[stage];
        stage += 1;
      }
      if (stage >= job.stages.length) {
        finishInstall(id);
        return;
      }
      job.stage = stage;
      job.progress = (stage + elapsed / job.stages[stage]) / job.stages.length;
    });
    refreshStore(false);
    if (!installs.size) {
      clearInterval(installTimer);
      installTimer = null;
      lastInstallStep = 0;
    }
  }

  function finishInstall(id) {
    const item = catalog.find((entry) => entry.id === id);
    installs.delete(id);
    registerInstalled(item);
    saveInstalled();
    refreshStore();
    refreshOverview();
    ctx.system.syncEntries();
    ctx.sound.play('complete');
    notify({ title: `${item.name} has finished downloading`, body: 'You can find it in the app menu.', iconName: item.icon });
  }

  function uninstall(id) {
    installed.delete(id);
    delete apps[id];
    saveInstalled();
    [...windows].filter((win) => win.app === id).forEach((win) => win.close());
    renderDock();
    refreshStore();
    refreshOverview();
    ctx.system.syncEntries();
  }

  function openStore() {
    const found = windows.find((win) => win.app === 'center');
    if (found) {
      found.focus();
      return found;
    }
    const win = createWindow({ app: 'center', title: 'App Center', width: 820, height: 580, minWidth: 340 });
    win.body.innerHTML = `
      <div class="store">
        <div class="store-scroll">
          <h1>Explore</h1>
          <div class="store-list"></div>
          <p class="store-more">More will be added soon :)</p>
        </div>
        <div class="store-progress"></div>
      </div>`;
    const list = win.body.querySelector('.store-list');
    const progress = win.body.querySelector('.store-progress');

    const actionsFor = (item) => {
      if (installs.has(item.id)) return '<button class="store-btn" disabled>Installing…</button>';
      if (installed.has(item.id)) return '<button class="store-btn primary" data-do="open">Open</button><button class="store-btn danger" data-do="remove">Uninstall</button>';
      return '<button class="store-btn primary" data-do="install">Install</button>';
    };

    win.renderStore = (full) => {
      if (full) {
        list.innerHTML = catalog
          .map(
            (item) => `
          <article class="store-card" data-id="${item.id}">
            ${icon('apps', item.icon)}
            <div class="store-info">
              <h2>${escapeHtml(item.name)}</h2>
              <div class="store-author">Original author: ${escapeHtml(item.author)}${item.maintainer ? ` · Maintained by ${escapeHtml(item.maintainer)}` : ''}</div>
              <p>${escapeHtml(item.description)}</p>
            </div>
            <div class="store-actions">${actionsFor(item)}</div>
          </article>`
          )
          .join('');
      }
      progress.hidden = !installs.size;
      progress.innerHTML = [...installs]
        .map(([id, job]) => {
          const item = catalog.find((entry) => entry.id === id);
          return `<div class="store-job">${icon('apps', item.icon)}<div class="store-job-info"><div><strong>${escapeHtml(item.name)}</strong><span>${job.stalled ? 'Waiting for network' : installStages[job.stage]}…</span></div><div class="store-bar"><i style="width:${(job.progress * 100).toFixed(1)}%"></i></div></div></div>`;
        })
        .join('');
    };

    list.addEventListener('click', (event) => {
      const button = event.target.closest('[data-do]');
      if (!button) return;
      const id = button.closest('.store-card').dataset.id;
      if (button.dataset.do === 'install') startInstall(id);
      else if (button.dataset.do === 'remove') uninstall(id);
      else apps[id].launch();
    });

    win.renderStore(true);
    return win;
  }

  function renderDock() {
    const running = [...new Set(windows.map((win) => win.app))];
    const extras = running.filter((id) => !favorites.includes(id) && apps[id]);
    dockApps.innerHTML = [...favorites, ...extras]
      .filter((id) => apps[id])
      .map((id) => {
        const list = windows.filter((win) => win.app === id);
        const isFocused = focused && focused.app === id;
        const dots = list.length ? `<span class="dock-dots">${'<i></i>'.repeat(Math.min(list.length, 3))}</span>` : '';
        return `<button class="dock-item${isFocused ? ' focused' : ''}" data-app="${id}" data-label="${apps[id].label}" aria-label="${apps[id].label}">${dots}${icon('apps', apps[id].icon)}</button>`;
      })
      .join('');
    dockBottom.innerHTML = `${state.showTrash ? `<button class="dock-item" data-act="trash" data-label="Trash" aria-label="Trash">${icon('apps', 'trash')}</button>` : ''}
      <button class="dock-item${overview.classList.contains('open') ? ' focused' : ''}" data-act="apps" data-label="Show Apps" aria-label="Show Apps"><i class="sym show-logo" style="--m:url('${asset('apps/show-apps.svg')}')"></i></button>`;
  }

  function activate(id) {
    const list = windows.filter((win) => win.app === id);
    if (!list.length) {
      apps[id].launch();
      return;
    }
    const ordered = [...list].sort((a, b) => Number(b.el.style.zIndex) - Number(a.el.style.zIndex));
    if (focused && focused.app === id && !focused.minimized) {
      if (list.length === 1) focused.minimize();
      else ordered[ordered.length - 1].focus();
    } else {
      ordered[0].focus();
    }
  }

  function setOverview(open) {
    overview.classList.toggle('open', open);
    if (open) {
      overviewSearch.value = '';
      renderOverview();
      if (!compact()) overviewSearch.focus();
    }
    renderDock();
  }

  function renderOverview() {
    const query = overviewSearch.value.trim().toLowerCase();
    overviewGrid.innerHTML = Object.entries(apps)
      .filter(([, app]) => app.label.toLowerCase().includes(query))
      .sort(([, a], [, b]) => a.label.localeCompare(b.label))
      .map(([id, app]) => `<button class="overview-app" data-app="${id}">${icon('apps', app.icon)}<span>${app.label}</span></button>`)
      .join('');
  }

  overviewSearch.addEventListener('input', renderOverview);
  overviewSearch.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      const first = overviewGrid.querySelector('[data-app]');
      if (first) first.click();
    }
  });
  let suppressClick = false;
  overview.addEventListener('click', (event) => {
    if (suppressClick) return;
    const app = event.target.closest('[data-app]');
    if (app) {
      setOverview(false);
      apps[app.dataset.app].launch();
    } else if (!event.target.closest('input')) {
      setOverview(false);
    }
  });

  dockApps.addEventListener('click', (event) => {
    if (suppressClick) return;
    const item = event.target.closest('[data-app]');
    if (!item) return;
    if (overview.classList.contains('open')) setOverview(false);
    activate(item.dataset.app);
  });
  dockBottom.addEventListener('click', (event) => {
    const item = event.target.closest('[data-act]');
    if (!item) return;
    if (item.dataset.act === 'apps') {
      setOverview(!overview.classList.contains('open'));
    } else {
      setOverview(false);
      openFiles('trash:///');
    }
  });

  const favoriteDefaults = [];
  function saveFavorites() {
    session.store.set('favorites', JSON.stringify({ list: favorites, known: favoriteDefaults }));
  }
  const addFavorite = (id, index) => {
    if (!apps[id]) return;
    const current = favorites.indexOf(id);
    if (current >= 0) favorites.splice(current, 1);
    if (index === undefined || index < 0 || index > favorites.length) favorites.push(id);
    else favorites.splice(index, 0, id);
    saveFavorites();
    renderDock();
  };
  const removeFavorite = (id) => {
    const current = favorites.indexOf(id);
    if (current < 0) return;
    favorites.splice(current, 1);
    saveFavorites();
    renderDock();
  };

  const desktopEntryOf = (content) => {
    if (typeof content !== 'string' || !content.startsWith('[Desktop Entry]')) return null;
    const read = (key) => (content.match(new RegExp(`^${key}=(.*)$`, 'm')) || [])[1];
    return { name: read('Name') || 'Launcher', icon: read('Icon') || '', app: read('X-Lambdaweb-App') || '' };
  };
  const launchDesktopFile = (path) => {
    const entry = desktopEntryOf(fs.get(path) && fs.get(path).content);
    if (entry && apps[entry.app]) apps[entry.app].launch();
    else notify({ title: 'Could not launch application', body: 'This launcher points to an app that is not installed.', iconName: 'about.svg' });
  };
  const createLauncher = (id) => {
    const app = apps[id];
    const desktop = `${HOME}/Desktop`;
    if (!app || !fs.isDir(desktop)) return;
    const taken = fs.entries(desktop).some((entry) => entry.node.type === 'file' && (desktopEntryOf(entry.node.content) || {}).app === id);
    if (taken) {
      notify({ title: app.label, body: 'A launcher for this app is already on your desktop.', iconName: app.icon });
      return;
    }
    fs.write(fs.join(desktop, fs.unique(desktop, `${app.label}.desktop`)), ctx.system.desktopEntry(id, app));
  };

  dockApps.addEventListener('contextmenu', (event) => {
    const item = event.target.closest('[data-app]');
    if (!item) return;
    event.preventDefault();
    const id = item.dataset.app;
    const running = windows.some((win) => win.app === id);
    showMenu(event, [
      { label: 'Open', run: () => apps[id].launch() },
      '-',
      favorites.includes(id) ? { label: 'Remove from Favorites', run: () => removeFavorite(id) } : { label: 'Add to Favorites', run: () => addFavorite(id) },
      { label: 'Add to Desktop', run: () => createLauncher(id) },
      ...(running ? ['-', { label: 'Quit', run: () => [...windows].filter((win) => win.app === id).forEach((win) => win.close()) }] : []),
    ]);
  });
  overview.addEventListener('contextmenu', (event) => {
    const item = event.target.closest('.overview-app');
    if (!item) return;
    event.preventDefault();
    const id = item.dataset.app;
    showMenu(event, [
      {
        label: 'Open',
        run: () => {
          setOverview(false);
          apps[id].launch();
        },
      },
      '-',
      favorites.includes(id) ? { label: 'Remove from Favorites', run: () => removeFavorite(id) } : { label: 'Add to Favorites', run: () => addFavorite(id) },
      { label: 'Add to Desktop', run: () => createLauncher(id) },
    ]);
  });

  function beginDrag(event, id, from) {
    if (event.button !== 0 || event.pointerType === 'touch' || !apps[id]) return;
    const startX = event.clientX;
    const startY = event.clientY;
    let ghost = null;
    const place = (moveEvent) => {
      const bounds = root.getBoundingClientRect();
      ghost.style.transform = `translate(${moveEvent.clientX - bounds.left - 28}px, ${moveEvent.clientY - bounds.top - 28}px)`;
    };
    const move = (moveEvent) => {
      if (!ghost) {
        if (Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < 8) return;
        ghost = document.createElement('div');
        ghost.className = 'drag-ghost';
        ghost.innerHTML = icon('apps', apps[id].icon);
        root.append(ghost);
        root.classList.add('dragging-app');
        if (from === 'overview') setOverview(false);
      }
      place(moveEvent);
    };
    const finish = (upEvent) => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', finish);
      document.removeEventListener('pointercancel', finish);
      if (!ghost) return;
      ghost.remove();
      root.classList.remove('dragging-app');
      suppressClick = true;
      setTimeout(() => {
        suppressClick = false;
      }, 0);
      const target = document.elementFromPoint(upEvent.clientX, upEvent.clientY);
      if (!target) return;
      if (target.closest('.dock')) {
        const vertical = state.dockPosition !== 'bottom';
        const items = [...dockApps.querySelectorAll('[data-app]')].filter((node) => node.dataset.app !== id);
        const before = items.find((node) => {
          const rect = node.getBoundingClientRect();
          return (vertical ? rect.top + rect.height / 2 : rect.left + rect.width / 2) > (vertical ? upEvent.clientY : upEvent.clientX);
        });
        const index = before ? favorites.indexOf(before.dataset.app) : favorites.length;
        addFavorite(id, index < 0 ? favorites.length : index);
      } else if (target.closest('.workarea') && !target.closest('.uwin')) {
        createLauncher(id);
      }
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', finish);
    document.addEventListener('pointercancel', finish);
  }
  overviewGrid.addEventListener('pointerdown', (event) => {
    const item = event.target.closest('.overview-app');
    if (item) beginDrag(event, item.dataset.app, 'overview');
  });
  dockApps.addEventListener('pointerdown', (event) => {
    const item = event.target.closest('[data-app]');
    if (item) beginDrag(event, item.dataset.app, 'dock');
  });

  const isFullscreen = () => document.fullscreenElement === root || root.classList.contains('pseudo-full');

  function syncFullscreen() {
    const active = isFullscreen();
    document.documentElement.classList.toggle('lambdaweb-locked', root.classList.contains('pseudo-full'));
    quick.querySelector('[data-tile="fullscreen"]').classList.toggle('on', active);
    const name = active ? 'view-restore' : 'view-fullscreen';
    setSym(fsButton.firstElementChild, name);
    setSym(quick.querySelector('[data-tile="fullscreen"] .sym'), name);
    fsButton.setAttribute('aria-label', active ? 'Exit full screen' : 'Enter full screen');
  }

  function toggleFullscreen() {
    if (isFullscreen()) {
      if (document.fullscreenElement) document.exitFullscreen();
      root.classList.remove('pseudo-full');
      syncFullscreen();
      return;
    }
    if (root.requestFullscreen) {
      root.requestFullscreen().catch(() => {
        root.classList.add('pseudo-full');
        syncFullscreen();
      });
    } else {
      root.classList.add('pseudo-full');
      syncFullscreen();
    }
  }

  fsButton.addEventListener('click', toggleFullscreen);
  document.addEventListener('fullscreenchange', syncFullscreen);

  const tick = () => {
    const now = new Date();
    const date = state.showDate ? `${now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ` : '';
    const time = now.toLocaleTimeString(state.clock24 ? 'en-GB' : 'en-US', { hour: state.clock24 ? '2-digit' : 'numeric', minute: '2-digit', second: state.showSeconds ? '2-digit' : undefined, hour12: !state.clock24 });
    clock.textContent = `${date}${time}`;
  };

  const setQuick = (open) => {
    quick.hidden = !open;
    root.querySelector('.panel-sys').classList.toggle('active', open);
  };

  root.querySelector('.panel').addEventListener('click', (event) => {
    const act = event.target.closest('[data-act]');
    if (!act) return;
    if (act.dataset.act === 'activities') setOverview(!overview.classList.contains('open'));
    else setQuick(quick.hidden);
  });

  quick.addEventListener('click', (event) => {
    const round = event.target.closest('[data-act]');
    const more = event.target.closest('[data-more]');
    const tile = event.target.closest('[data-tile]');
    if (more) {
      ctx.network.openPanel(more.dataset.more);
    } else if (round) {
      setQuick(false);
      if (round.dataset.act === 'settings') openSettings();
      else powerOff();
    } else if (tile) {
      const kind = tile.dataset.tile;
      if (kind === 'dark') {
        state.theme = state.theme === 'dark' ? 'light' : 'dark';
        applyTheme();
        windows.forEach((win) => win.refresh && win.refresh());
      } else if (kind === 'fullscreen') {
        setQuick(false);
        toggleFullscreen();
      } else if (kind === 'wifi') {
        ctx.network.setWifi(!state.wifi);
      } else if (kind === 'bluetooth') {
        ctx.network.setBluetooth(!state.bluetooth);
      }
    }
  });
  const volumeInput = quick.querySelector('.qs-volume input');
  volumeInput.addEventListener('input', () => {
    state.volume = Number(volumeInput.value);
    persistSettings();
  });
  volumeInput.addEventListener('change', () => ctx.sound.play('volume'));

  function powerOff() {
    ctx.sound.play('logout');
    root.classList.add('off');
  }
  root.querySelector('.poweroff').addEventListener('click', () => root.classList.remove('off'));

  root.addEventListener('pointerdown', (event) => {
    if (!event.target.closest('.qs, .panel-sys')) setQuick(false);
    if (!event.target.closest('.umenu')) closeMenus();
  });
  root.addEventListener('contextmenu', (event) => {
    if (event.target.closest('input, textarea')) return;
    event.preventDefault();
    if (event.target.closest('.uwin, .dock, .panel, .overview, .qs, .umenu, .desk-icon, .notification, .poweroff')) return;
    showMenu(event, [
      { label: 'New Folder', run: () => createOnDesktop('dir') },
      { label: 'New Text File', run: () => createOnDesktop('file') },
      '-',
      { label: 'Open Terminal', run: () => openTerminal() },
      { label: 'Customize Desktop', run: () => openSettings('background') },
    ]);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (root.classList.contains('pseudo-full')) toggleFullscreen();
    setQuick(false);
    closeMenus();
    if (overview.classList.contains('open')) setOverview(false);
  });

  const frameObserver = new IntersectionObserver(
    (entries) => {
      if (isFullscreen()) return;
      entries.forEach((entry) => root.classList.toggle('awake', entry.isIntersecting));
    },
    { threshold: 0.35 }
  );
  frameObserver.observe(frame);

  const longFlagMap = { all: 'a', 'almost-all': 'A', recursive: 'r', 'ignore-case': 'i', 'line-number': 'n', count: 'c', 'invert-match': 'v' };
  const parseFlags = (args) => {
    const flags = new Set();
    const rest = [];
    args.forEach((arg) => {
      if (/^--[A-Za-z][\w-]*(=.*)?$/.test(arg)) {
        const mapped = longFlagMap[arg.slice(2).split('=')[0]];
        if (mapped) flags.add(mapped);
      } else if (/^-[A-Za-z]+$/.test(arg)) [...arg.slice(1)].forEach((flag) => flags.add(flag));
      else rest.push(arg);
    });
    return { flags, rest };
  };

  const shortPath = (path) => (path === HOME ? '~' : path.startsWith(`${HOME}/`) ? `~${path.slice(HOME.length)}` : path);

  function openTerminal(options = {}) {
    const win = createWindow({ app: 'terminal', title: `${USER}@${HOSTNAME}: ~`, width: options.width || 700, height: options.height || 440, className: 'is-terminal' });
    win.body.innerHTML = `
      <div class="term">
        <div class="term-out"></div>
        <div class="term-line"><span class="term-prompt"></span><input class="term-input" type="text" spellcheck="false" autocomplete="off" autocapitalize="off" aria-label="Terminal input"></div>
      </div>`;
    const term = win.body.querySelector('.term');
    const out = win.body.querySelector('.term-out');
    const promptEl = win.body.querySelector('.term-prompt');
    const input = win.body.querySelector('.term-input');
    const title = win.heading.querySelector('.uwin-title');
    const shell = { cwd: HOME, history: [], cursor: 0, aliases: {}, env: {} };
    const termConfig = ctx.system.config('terminal', ctx.system.defaults.terminal);
    term.style.fontSize = `${Math.min(24, Math.max(10, termConfig.fontSize))}px`;
    term.dataset.scheme = ['default', 'black', 'light'].includes(termConfig.scheme) ? termConfig.scheme : 'default';

    const parseRcLine = (raw) => {
      const line = raw.trim();
      if (!line || line.startsWith('#')) return;
      const alias = line.match(/^alias\s+([\w.-]+)=(?:'([^']*)'|"([^"]*)"|(\S+))$/);
      if (alias) {
        shell.aliases[alias[1]] = alias[2] ?? alias[3] ?? alias[4] ?? '';
        return;
      }
      const assign = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(?:'([^']*)'|"([^"]*)"|(\S*))$/);
      if (assign) shell.env[assign[1]] = assign[2] ?? assign[3] ?? assign[4] ?? '';
    };
    const loadRc = () => {
      shell.aliases = {};
      shell.env = { HOME, USER, LOGNAME: USER, HOSTNAME, SHELL: '/bin/bash', TERM: 'xterm-256color', LANG: `${(navigator.language || 'en-US').replace('-', '_')}.UTF-8`, PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', EDITOR: 'nano' };
      try {
        fs.read(`${HOME}/.bashrc`).split('\n').forEach(parseRcLine);
      } catch (error) {
        return;
      }
    };
    const historyPath = `${HOME}/.bash_history`;
    try {
      shell.history = fs.read(historyPath).split('\n').filter(Boolean).slice(-1000);
    } catch (error) {
      shell.history = [];
    }
    shell.cursor = shell.history.length;
    loadRc();
    const recordHistory = (line) => {
      if (shell.history[shell.history.length - 1] === line) return;
      shell.history.push(line);
      try {
        fs.setContent(historyPath, `${shell.history.slice(-1000).join('\n')}\n`);
      } catch (error) {
        return;
      }
    };
    const expandWord = (word) =>
      word
        .replace(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g, (_, name) => (name === 'PWD' ? shell.cwd : shell.env[name] ?? ''))
        .replace(/\u0000/g, '$');
    const expandAlias = (text) => {
      let result = text;
      const seen = new Set();
      for (let round = 0; round < 5; round++) {
        const match = result.match(/^(\s*)([^\s|>]+)([\s\S]*)$/);
        if (!match || !Object.hasOwn(shell.aliases, match[2]) || seen.has(match[2])) break;
        seen.add(match[2]);
        result = `${match[1]}${shell.aliases[match[2]]}${match[3]}`;
      }
      return result;
    };

    const promptHtml = () => `<span class="t-user">${USER}@${HOSTNAME}</span>:<span class="t-path">${escapeHtml(shortPath(shell.cwd))}</span>$ `;
    const refreshPrompt = () => {
      promptEl.innerHTML = promptHtml();
      title.textContent = `${USER}@${HOSTNAME}: ${shortPath(shell.cwd)}`;
    };
    const print = (html) => {
      const line = document.createElement('div');
      line.innerHTML = html;
      out.append(line);
    };
    const printText = (text) => text.split('\n').forEach((line) => print(escapeHtml(line)));
    const toLines = (text) => (text === '' ? [] : text.replace(/\n$/, '').split('\n'));
    const abs = (path) => fs.resolve(path, shell.cwd);

    const tokenize = (line) => {
      const tokens = [];
      let current = '';
      let started = false;
      let quote = null;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (quote) {
          if (c === quote) quote = null;
          else if (c === '\\' && quote === '"' && i + 1 < line.length) current += line[++i];
          else current += quote === "'" && c === '$' ? '\u0000' : c;
        } else if (c === '"' || c === "'") {
          quote = c;
          started = true;
        } else if (c === '\\' && i + 1 < line.length) {
          current += line[++i];
          started = true;
        } else if (/\s/.test(c)) {
          if (started) tokens.push({ word: current });
          current = '';
          started = false;
        } else if (c === '|' || c === '>') {
          if (started) tokens.push({ word: current });
          current = '';
          started = false;
          if (c === '>' && line[i + 1] === '>') {
            tokens.push({ op: '>>' });
            i++;
          } else {
            tokens.push({ op: c });
          }
        } else {
          current += c;
          started = true;
        }
      }
      if (quote) throw new Error('unexpected EOF while looking for matching quote');
      if (started) tokens.push({ word: current });
      return tokens;
    };

    const parsePipeline = (tokens) => {
      const syntax = () => new Error("syntax error near unexpected token `newline'");
      const segments = [{ args: [], redirect: null }];
      for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        const current = segments[segments.length - 1];
        if (token.op === '|') {
          if (!current.args.length) throw syntax();
          segments.push({ args: [], redirect: null });
        } else if (token.op) {
          const target = tokens[++i];
          if (!target || target.op) throw syntax();
          current.redirect = { append: token.op === '>>', path: target.word };
        } else {
          current.args.push(token.word);
        }
      }
      if (!segments[segments.length - 1].args.length) throw syntax();
      return segments;
    };

    const formatDate = (date) => {
      const month = date.toLocaleDateString('en-US', { month: 'short' });
      const time = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      return `${month} ${String(date.getDate()).padStart(2, ' ')} ${time}`;
    };

    const highlight = (line, pattern) => {
      let html = '';
      let last = 0;
      const re = new RegExp(pattern.source, pattern.flags.includes('i') ? 'gi' : 'g');
      let match;
      while ((match = re.exec(line)) !== null) {
        if (match[0] === '') {
          re.lastIndex += 1;
          continue;
        }
        html += `${escapeHtml(line.slice(last, match.index))}<span class="t-match">${escapeHtml(match[0])}</span>`;
        last = match.index + match[0].length;
      }
      return html + escapeHtml(line.slice(last));
    };

    const readTargets = (files, input, ctx) => {
      if (!files.length) return [{ name: null, lines: toLines(input) }];
      const results = [];
      files.forEach((file) => {
        try {
          const content = fs.read(abs(file));
          results.push({ name: file, lines: content.startsWith('data:image/') ? ['(binary image data)'] : toLines(content) });
        } catch (error) {
          ctx.err(`${file}: ${error.message}`);
        }
      });
      return results;
    };

    const openers = {
      firefox: (args) => openBrowser(args[0]),
      nautilus: (args) => openFiles(args[0] ? abs(args[0]) : shell.cwd),
      'gnome-text-editor': (args) => (args[0] ? openEditor(abs(args[0])) : openNewDocument()),
      'gnome-control-center': () => openSettings(),
      'gnome-terminal': () => openTerminal(),
    };

    const commands = {
      help: () =>
        ['Available commands:', '', Object.keys(commands).sort().join('  ')].join('\n'),
      clear: () => {
        out.innerHTML = '';
        return '';
      },
      whoami: () => 'hello, im rune\n\nwelcome to my webpage\n\nthis took me a while to make i hate my life',
      echo: (args) => (args[0] === '-n' ? args.slice(1) : args).join(' '),
      pwd: () => shell.cwd,
      hostname: () => HOSTNAME,
      alias: (args, _, ctx) => {
        if (!args.length) return Object.entries(shell.aliases).map(([name, value]) => `alias ${name}='${value}'`).join('\n');
        args.forEach((arg) => {
          if (arg.includes('=')) parseRcLine(`alias ${arg}`);
          else if (Object.hasOwn(shell.aliases, arg)) printText(`alias ${arg}='${shell.aliases[arg]}'`);
          else ctx.err(`${arg}: not found`);
        });
        return '';
      },
      unalias: (args) => {
        args.forEach((name) => delete shell.aliases[name]);
        return '';
      },
      export: (args) => {
        args.forEach((arg) => parseRcLine(`export ${arg}`));
        return '';
      },
      env: () => Object.entries({ ...shell.env, PWD: shell.cwd }).map(([name, value]) => `${name}=${value}`).join('\n'),
      printenv: (args) => (args.length ? args.map((name) => (name === 'PWD' ? shell.cwd : shell.env[name] ?? '')).join('\n') : commands.env()),
      source: (args, _, ctx) => {
        if (args[0] && abs(args[0]) !== `${HOME}/.bashrc`) ctx.err(`${args[0]}: only ~/.bashrc can be sourced here`);
        else loadRc();
        return '';
      },
      which: (args) =>
        args
          .filter((name) => commands[name] || installedCommands().includes(name))
          .map((name) => `/usr/bin/${name}`)
          .join('\n'),
      lsb_release: () => 'Distributor ID:\tlambdawebOS\nDescription:\tlambdawebOS 1.0\nRelease:\t1.0',
      df: () => {
        const storage = ctx.system.hw.storage || { used: 0, quota: 0 };
        const size = (bytes) => `${ctx.system.gib(bytes).toFixed(1)}G`;
        return [
          'Filesystem      Size  Used Avail Use% Mounted on',
          `browser-store  ${size(storage.quota).padStart(5)} ${size(storage.used).padStart(5)} ${size(Math.max(0, storage.quota - storage.used)).padStart(5)} ${String(storage.quota ? Math.max(1, Math.round((storage.used / storage.quota) * 100)) : 0).padStart(3)}% /`,
        ].join('\n');
      },
      free: () => {
        const total = Math.round((ctx.system.hw.memoryGiB || 4) * 1024);
        const used = Math.round(ctx.system.mib(ctx.system.jsHeapBytes() || 120 * 1024 * 1024));
        const cell = (value) => String(value).padStart(12);
        return [`               total        used        free`, `Mem:${cell(total)}${cell(used)}${cell(total - used)}`, 'Swap:' + cell(0) + cell(0) + cell(0)].join('\n') + '\n(values in MiB, as reported by the browser)';
      },
      tree: (args, _, ctx) => {
        const start = abs(args[0] || '.');
        const node = fs.get(start);
        if (!node || node.type !== 'dir') {
          ctx.err(`${args[0] || '.'}: No such directory`);
          return '';
        }
        const lines = [args[0] || '.'];
        let dirs = 0;
        let files = 0;
        const walk = (path, prefix, depth) => {
          let list;
          try {
            list = fs.entries(path).filter((entry) => !entry.name.startsWith('.'));
          } catch (error) {
            return;
          }
          list.forEach((entry, index) => {
            const last = index === list.length - 1;
            lines.push(`${prefix}${last ? '└── ' : '├── '}${entry.name}`);
            if (entry.node.type === 'dir') {
              dirs += 1;
              if (depth < 4) walk(entry.path, `${prefix}${last ? '    ' : '│   '}`, depth + 1);
            } else {
              files += 1;
            }
          });
        };
        walk(start, '', 1);
        return `${lines.join('\n')}\n\n${dirs} directories, ${files} files`;
      },
      id: () => `uid=1000(${USER}) gid=1000(${USER}) groups=1000(${USER}),4(adm),24(cdrom),27(sudo),30(dip),46(plugdev)`,
      uname: (args) => {
        const { flags } = parseFlags(args);
        if (flags.has('a')) return `Linux ${HOSTNAME} 7.3.0-generic #1 SMP PREEMPT_DYNAMIC x86_64 x86_64 x86_64 GNU/Linux`;
        if (flags.has('r')) return '7.3.0-generic';
        return 'Linux';
      },
      date: () => {
        const parts = Object.fromEntries(
          new Intl.DateTimeFormat('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            second: '2-digit',
            year: 'numeric',
            timeZoneName: 'short',
          })
            .formatToParts(new Date())
            .map((part) => [part.type, part.value])
        );
        return `${parts.weekday} ${parts.month} ${parts.day} ${parts.hour}:${parts.minute}:${parts.second} ${parts.dayPeriod} ${parts.timeZoneName} ${parts.year}`;
      },
      uptime: () => {
        const now = new Date();
        const time = now.toLocaleTimeString('en-GB');
        return ` ${time} up ${Math.max(1, Math.round(performance.now() / 60000))} min,  1 user,  load average: 0.08, 0.05, 0.01`;
      },
      history: () => shell.history.map((line, i) => `${String(i + 1).padStart(5, ' ')}  ${line}`).join('\n'),
      exit: () => {
        win.close();
        return '';
      },
      sudo: () => `${USER} is not in the sudoers file.`,
      cd: (args, _, ctx) => {
        const target = args[0] === undefined ? HOME : abs(args[0]);
        const node = fs.get(target);
        if (!node) ctx.err(`${args[0]}: No such file or directory`);
        else if (node.type !== 'dir') ctx.err(`${args[0]}: Not a directory`);
        else {
          shell.cwd = target;
          refreshPrompt();
        }
        return '';
      },
      ls: (args, _, ctx) => {
        const { flags, rest } = parseFlags(args);
        const long = flags.has('l');
        const all = flags.has('a');
        const targets = rest.length ? rest : ['.'];
        const textBlocks = [];
        const htmlBlocks = [];
        targets.forEach((target) => {
          const node = fs.get(abs(target));
          if (!node) {
            ctx.err(`cannot access '${target}': No such file or directory`);
            return;
          }
          let entries;
          try {
            entries = node.type === 'file' ? [{ name: target, node, path: abs(target) }] : fs.entries(abs(target)).filter((entry) => all || !entry.name.startsWith('.'));
          } catch (error) {
            ctx.err(`cannot open directory '${target}': ${error.message}`);
            return;
          }
          if (all && node.type === 'dir') entries = [{ name: '.', node, path: abs(target) }, { name: '..', node, path: abs(target) }, ...entries];
          const ownerOf = (entry) => (entry.path === HOME || entry.path.startsWith(`${HOME}/`) || entry.path.startsWith('/tmp') || entry.path === '/home' ? (entry.path === '/home' ? 'root' : USER) : 'root');
          const format = (entry) => {
            const dir = entry.node.type === 'dir';
            const html = dir ? `<span class="t-dir">${escapeHtml(entry.name)}</span>` : escapeHtml(entry.name);
            if (!long) return { text: entry.name, html };
            const owner = ownerOf(entry);
            const mode = entry.node.restricted ? (dir ? 'drwx------' : '-rw-r-----') : dir ? 'drwxr-xr-x' : '-rw-r--r--';
            const meta = `${mode} ${dir ? 2 : 1} ${owner} ${owner} ${String(fs.size(entry.node)).padStart(5, ' ')} ${formatDate(entry.node.mtime)} `;
            return { text: meta + entry.name, html: escapeHtml(meta) + html };
          };
          const rows = entries.map(format);
          const joiner = ctx.tty && !long ? '  ' : '\n';
          const header = targets.length > 1 ? [`${target}:`] : [];
          const total = long ? [`total ${entries.length * 4}`] : [];
          textBlocks.push([...header, ...total, rows.map((row) => row.text).join(joiner)].filter(Boolean).join('\n'));
          htmlBlocks.push([...header, ...total, rows.map((row) => row.html).join(joiner)].filter(Boolean).map((part) => (part.includes('<span') ? part : escapeHtml(part))).join('\n'));
        });
        return { text: textBlocks.join('\n\n'), html: htmlBlocks.join('\n\n') };
      },
      cat: (args, stdin, ctx) => {
        if (!args.length) return stdin;
        return readTargets(args, stdin, ctx)
          .map((item) => item.lines.join('\n'))
          .join('\n');
      },
      mkdir: (args, _, ctx) => {
        const { flags, rest } = parseFlags(args);
        if (!rest.length) ctx.err('missing operand');
        rest.forEach((target) => {
          try {
            fs.mkdir(abs(target), flags.has('p'));
          } catch (error) {
            ctx.err(`cannot create directory '${target}': ${error.message}`);
          }
        });
        return '';
      },
      touch: (args, _, ctx) => {
        if (!args.length) ctx.err('missing file operand');
        args.forEach((target) => {
          try {
            fs.touch(abs(target));
          } catch (error) {
            ctx.err(`cannot touch '${target}': ${error.message}`);
          }
        });
        return '';
      },
      rm: (args, _, ctx) => {
        const { flags, rest } = parseFlags(args);
        const recursive = flags.has('r') || flags.has('R');
        if (!rest.length) ctx.err('missing operand');
        rest.forEach((target) => {
          const node = fs.get(abs(target));
          if (!node) {
            if (!flags.has('f')) ctx.err(`cannot remove '${target}': No such file or directory`);
          } else if (node.type === 'dir' && !recursive) {
            ctx.err(`cannot remove '${target}': Is a directory`);
          } else {
            try {
              fs.remove(abs(target));
            } catch (error) {
              ctx.err(`cannot remove '${target}': ${error.message}`);
            }
          }
        });
        return '';
      },
      rmdir: (args, _, ctx) => {
        args.forEach((target) => {
          const node = fs.get(abs(target));
          if (!node) ctx.err(`failed to remove '${target}': No such file or directory`);
          else if (node.type !== 'dir') ctx.err(`failed to remove '${target}': Not a directory`);
          else if (Object.keys(node.children).length) ctx.err(`failed to remove '${target}': Directory not empty`);
          else {
            try {
              fs.remove(abs(target));
            } catch (error) {
              ctx.err(`failed to remove '${target}': ${error.message}`);
            }
          }
        });
        return '';
      },
      mv: (args, _, ctx) => {
        if (args.length < 2) {
          ctx.err('missing destination file operand');
          return '';
        }
        const dest = abs(args[args.length - 1]);
        const sources = args.slice(0, -1);
        if (sources.length > 1 && !fs.isDir(dest)) {
          ctx.err(`target '${args[args.length - 1]}' is not a directory`);
          return '';
        }
        sources.forEach((source) => {
          try {
            fs.move(abs(source), dest);
          } catch (error) {
            ctx.err(`cannot move '${source}': ${error.message}`);
          }
        });
        return '';
      },
      cp: (args, _, ctx) => {
        const { flags, rest } = parseFlags(args);
        if (rest.length < 2) {
          ctx.err('missing destination file operand');
          return '';
        }
        const dest = abs(rest[rest.length - 1]);
        const sources = rest.slice(0, -1);
        if (sources.length > 1 && !fs.isDir(dest)) {
          ctx.err(`target '${rest[rest.length - 1]}' is not a directory`);
          return '';
        }
        sources.forEach((source) => {
          const node = fs.get(abs(source));
          if (node && node.type === 'dir' && !flags.has('r') && !flags.has('R')) {
            ctx.err(`-r not specified; omitting directory '${source}'`);
            return;
          }
          try {
            fs.copy(abs(source), dest);
          } catch (error) {
            ctx.err(`cannot copy '${source}': ${error.message}`);
          }
        });
        return '';
      },
      grep: (args, stdin, ctx) => {
        const { flags, rest } = parseFlags(args);
        if (!rest.length) {
          ctx.err('Usage: grep [OPTION]... PATTERNS [FILE]...');
          return '';
        }
        const [pattern, ...files] = rest;
        let re;
        try {
          re = new RegExp(pattern, flags.has('i') ? 'i' : '');
        } catch (error) {
          re = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags.has('i') ? 'i' : '');
        }
        const invert = flags.has('v');
        const textOut = [];
        const htmlOut = [];
        readTargets(files, stdin, ctx).forEach((item) => {
          const prefix = files.length > 1 ? `${item.name}:` : '';
          let count = 0;
          item.lines.forEach((line, index) => {
            if (re.test(line) === invert) return;
            count += 1;
            if (flags.has('c')) return;
            const number = flags.has('n') ? `${index + 1}:` : '';
            textOut.push(prefix + number + line);
            htmlOut.push(escapeHtml(prefix + number) + (invert || !ctx.tty ? escapeHtml(line) : highlight(line, re)));
          });
          if (flags.has('c')) {
            textOut.push(prefix + count);
            htmlOut.push(escapeHtml(prefix + count));
          }
        });
        return { text: textOut.join('\n'), html: htmlOut.join('\n') };
      },
      head: (args, stdin, ctx) => {
        const count = parseCount(args);
        return readTargets(parseFiles(args), stdin, ctx)
          .map((item) => item.lines.slice(0, count).join('\n'))
          .join('\n');
      },
      tail: (args, stdin, ctx) => {
        const count = parseCount(args);
        return readTargets(parseFiles(args), stdin, ctx)
          .map((item) => item.lines.slice(-count).join('\n'))
          .join('\n');
      },
      wc: (args, stdin, ctx) => {
        const { flags, rest } = parseFlags(args);
        const none = !flags.has('l') && !flags.has('w') && !flags.has('c');
        return readTargets(rest, stdin, ctx)
          .map((item) => {
            const text = item.lines.join('\n') + (item.lines.length ? '\n' : '');
            const cells = [];
            if (none || flags.has('l')) cells.push(item.lines.length);
            if (none || flags.has('w')) cells.push(text.split(/\s+/).filter(Boolean).length);
            if (none || flags.has('c')) cells.push(new Blob([text]).size);
            return `${cells.map((cell) => String(cell).padStart(4, ' ')).join(' ')}${item.name ? ` ${item.name}` : ''}`;
          })
          .join('\n');
      },
      sort: (args, stdin, ctx) => {
        const { flags, rest } = parseFlags(args);
        const lines = readTargets(rest, stdin, ctx).flatMap((item) => item.lines);
        lines.sort((a, b) => (flags.has('n') ? parseFloat(a) - parseFloat(b) : a.localeCompare(b)));
        if (flags.has('r')) lines.reverse();
        return lines.join('\n');
      },
      uniq: (args, stdin, ctx) =>
        readTargets(args, stdin, ctx)
          .flatMap((item) => item.lines)
          .filter((line, i, all) => i === 0 || line !== all[i - 1])
          .join('\n'),
      'xdg-open': (args, _, ctx) => {
        if (!args[0]) {
          ctx.err('no file or URL specified');
          return '';
        }
        if (/^https?:\/\//i.test(args[0])) return void openBrowser(args[0]) || '';
        const target = abs(args[0]);
        const node = fs.get(target);
        if (!node) ctx.err(`file '${args[0]}' does not exist`);
        else if (node.type === 'dir') openFiles(target);
        else openEditor(target);
        return '';
      },
    };

    function parseCount(args) {
      const flagIndex = args.indexOf('-n');
      if (flagIndex >= 0 && args[flagIndex + 1]) return parseInt(args[flagIndex + 1], 10) || 10;
      const short = args.find((arg) => /^-\d+$/.test(arg));
      return short ? Math.abs(parseInt(short, 10)) : 10;
    }

    function parseFiles(args) {
      return args.filter((arg, i) => !arg.startsWith('-') && args[i - 1] !== '-n');
    }

    Object.keys(openers).forEach((name) => {
      commands[name] = (args) => {
        openers[name](args);
        return '';
      };
    });

    const fetchLogo = (() => {
      const rows = 17;
      const width = 36;
      const slope = 26 / (rows - 1);
      return Array.from({ length: rows }, (_, r) => {
        const cells = Array(width).fill(' ');
        const stroke = (x) => {
          for (let d = -1; d <= 1; d++) {
            const i = Math.round(x) + d;
            if (i >= 0 && i < width) cells[i] = '#';
          }
        };
        stroke(6 + r * slope);
        if (r >= 7) stroke(6 + 7 * slope - (r - 7) * (12 / 9));
        return cells.join('').trimEnd();
      });
    })();

    const fastfetchDefaults = ['title', 'separator', 'os', 'host', 'kernel', 'uptime', 'packages', 'shell', 'display', 'de', 'wm', 'terminal', 'cpu', 'gpu', 'memory', 'disk', 'battery', 'locale'];
    const fastfetchModules = () => {
      try {
        const text = fs.read(`${HOME}/.config/fastfetch/config.jsonc`).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
        const data = JSON.parse(text);
        return Array.isArray(data.modules) ? data.modules.filter((name) => typeof name === 'string') : fastfetchDefaults;
      } catch (error) {
        return fastfetchDefaults;
      }
    };

    const fastfetch = () => {
      const { hw, uptimeSeconds, jsHeapBytes, gib, mib } = ctx.system;
      const seconds = uptimeSeconds();
      const duration = seconds < 90 ? `${seconds} secs` : seconds < 5400 ? `${Math.round(seconds / 60)} mins` : `${(seconds / 3600).toFixed(1)} hours`;
      const memoryTotal = hw.memoryGiB ? `${hw.memoryGiB}${hw.memoryGiB === 8 ? '+' : ''} GiB` : 'Unknown';
      const heap = jsHeapBytes();
      const quota = hw.storage && hw.storage.quota;
      const title = `${USER}@${HOSTNAME}`;
      const available = {
        os: ['OS', `lambdawebOS ${hw.arch}`],
        host: ['Host', hw.host],
        kernel: ['Kernel', `${hw.engine} (${hw.browser})`],
        uptime: ['Uptime', duration],
        packages: ['Packages', `${Object.keys(apps).length} (lpkg)`],
        shell: ['Shell', 'bash'],
        display: ['Display', `${screen.width}x${screen.height} @ ${(window.devicePixelRatio || 1).toFixed(2)}x`],
        de: ['DE', 'lambdaweb'],
        wm: ['WM', 'lambdaweb-shell'],
        terminal: ['Terminal', 'lambdaweb-terminal'],
        cpu: ['CPU', `${hw.cores} logical cores (${hw.arch})`],
        gpu: ['GPU', hw.gpu || 'Unknown'],
        memory: ['Memory', `${heap ? `${mib(heap).toFixed(0)} MiB` : 'n/a'} / ${memoryTotal}`],
        disk: ['Disk (/)', quota ? `${mib(hw.storage.used).toFixed(1)} MiB / ${gib(quota).toFixed(1)} GiB (${Math.max(1, Math.round((hw.storage.used / quota) * 100))}%) - browser storage` : 'Unknown'],
        battery: hw.battery ? ['Battery', `${hw.battery.level}% [${hw.battery.charging ? 'Charging' : 'Discharging'}]`] : null,
        locale: ['Locale', `${(navigator.language || 'en-US').replace('-', '_')}.UTF-8`],
        network: ['Network', ctx.network.online() ? 'Connected' : 'Disconnected'],
      };
      const info = [];
      fastfetchModules().forEach((name) => {
        if (name === 'title') info.push([title, null]);
        else if (name === 'separator') info.push(['-'.repeat(title.length), null]);
        else if (available[name]) info.push(available[name]);
      });
      const rows = Math.max(fetchLogo.length, info.length + 2);
      const html = [];
      const text = [];
      for (let i = 0; i < rows; i++) {
        const logo = fetchLogo[i] || '';
        const row = info[i];
        let right = '';
        let plain = '';
        if (row && row[1] === null) {
          right = `<b class="f-accent">${escapeHtml(row[0])}</b>`;
          plain = row[0];
        } else if (row) {
          right = `<b class="f-accent">${escapeHtml(row[0])}</b>: ${escapeHtml(row[1])}`;
          plain = `${row[0]}: ${row[1]}`;
        } else if (i === info.length + 1) {
          right = ['#2e3436', '#cc0000', '#4e9a06', '#c4a000', '#3465a4', '#75507b', '#06989a', '#d3d7cf'].map((color) => `<i class="f-block" style="background:${color}"></i>`).join('');
        }
        const pad = ' '.repeat(Math.max(0, 43 - logo.length));
        html.push(`<span class="nowrap"><span class="f-logo">${escapeHtml(logo)}</span>${pad}${right}</span>`);
        text.push(logo + pad + plain);
      }
      return { text: text.join('\n'), html: html.join('\n') };
    };

    const programs = {
      fastfetch: () => fastfetch(),
      'pipes.sh': () => void startScreen('pipes.sh') || '',
      lavat: () => void startScreen('lavat') || '',
      cmatrix: (args) => void startScreen('cmatrix', args) || '',
      peaclock: (args) => void startScreen('peaclock', args) || '',
      nano: (args) => void startNano(args.find((arg) => !arg.startsWith('-'))) || '',
    };

    function startNano(file) {
      const editor = ctx.terminalApps.nano({
        term,
        path: file ? abs(file) : null,
        resolve: abs,
        onExit: () => {
          shell.keys = null;
          shell.text = null;
          shell.stop = null;
          if (options.closeOnExit && options.run === 'nano') {
            win.close();
            return;
          }
          term.scrollTop = term.scrollHeight;
          input.focus();
        },
      });
      shell.keys = editor.keys;
      shell.text = editor.text;
      shell.stop = () => editor.destroy();
      win.onClose = () => editor.destroy();
      input.focus();
    }

    function startScreen(name, args = []) {
      const canvasPrograms = {
        'pipes.sh': { fps: 75, make: pipesProgram },
        lavat: { fps: 30, make: lavatProgram },
        ...ctx.terminalApps.canvas,
      };
      const spec = canvasPrograms[name];
      shell.quitOnQ = name === 'cmatrix' || name === 'peaclock';
      const canvas = document.createElement('canvas');
      canvas.className = 'term-canvas';
      term.append(canvas);
      term.classList.add('running');
      term.scrollTop = 0;
      const g = canvas.getContext('2d');
      const probe = document.createElement('span');
      probe.textContent = 'M';
      probe.className = 'term-probe';
      term.append(probe);
      const cw = probe.getBoundingClientRect().width || 9;
      const ch = parseFloat(getComputedStyle(probe).lineHeight) || 19;
      probe.remove();
      const grid = { cols: 0, rows: 0 };
      let timer = null;
      let program = null;

      const resize = () => {
        const ratio = window.devicePixelRatio || 1;
        const width = term.clientWidth;
        const height = term.clientHeight;
        canvas.width = Math.max(1, Math.floor(width * ratio));
        canvas.height = Math.max(1, Math.floor(height * ratio));
        g.setTransform(ratio, 0, 0, ratio, 0, 0);
        grid.cols = Math.max(1, Math.floor(width / cw));
        grid.rows = Math.max(1, Math.floor(height / ch));
        program = spec.make(g, grid, cw, ch, { args });
      };

      const observer = new ResizeObserver(resize);
      observer.observe(term);
      timer = setInterval(() => program && program.frame(), 1000 / spec.fps);

      shell.stop = () => {
        clearInterval(timer);
        observer.disconnect();
        canvas.remove();
        term.classList.remove('running');
        shell.stop = null;
        if (options.closeOnExit && options.run === name) {
          win.close();
          return;
        }
        term.scrollTop = term.scrollHeight;
        input.focus();
      };
      win.onClose = () => {
        if (shell.stop) {
          clearInterval(timer);
          observer.disconnect();
        }
      };
      input.focus();
    }

    const pipesProgram = (g, grid, cw, ch) => {
      const colors = ['#ef2929', '#8ae234', '#fce94f', '#729fcf', '#ad7fa8', '#34e2e2', '#eeeeec'];
      const dx = [0, 1, 0, -1];
      const dy = [-1, 0, 1, 0];
      const lineWidth = Math.max(3, cw * 0.32);
      const pipe = { x: Math.floor(Math.random() * grid.cols), y: Math.floor(Math.random() * grid.rows), dir: Math.floor(Math.random() * 4), color: colors[Math.floor(Math.random() * colors.length)] };
      let count = 0;
      const edge = (side, cx, cy) => [cx + dx[side] * (cw / 2), cy + dy[side] * (ch / 2)];

      return {
        frame() {
          const last = pipe.dir;
          const next = Math.random() * 13 < 1 ? (last + (Math.random() < 0.5 ? 1 : 3)) % 4 : last;
          const cx = pipe.x * cw + cw / 2;
          const cy = pipe.y * ch + ch / 2;
          const from = edge((last + 2) % 4, cx, cy);
          const to = edge(next, cx, cy);
          g.strokeStyle = pipe.color;
          g.lineWidth = lineWidth;
          g.lineJoin = 'miter';
          g.lineCap = 'butt';
          g.beginPath();
          g.moveTo(from[0], from[1]);
          g.lineTo(cx, cy);
          g.lineTo(to[0], to[1]);
          g.stroke();
          pipe.dir = next;
          pipe.x += dx[next];
          pipe.y += dy[next];
          let wrapped = false;
          if (pipe.x < 0) { pipe.x = grid.cols - 1; wrapped = true; }
          if (pipe.x >= grid.cols) { pipe.x = 0; wrapped = true; }
          if (pipe.y < 0) { pipe.y = grid.rows - 1; wrapped = true; }
          if (pipe.y >= grid.rows) { pipe.y = 0; wrapped = true; }
          if (wrapped) pipe.color = colors[Math.floor(Math.random() * colors.length)];
          if (++count > 2000) {
            g.clearRect(0, 0, grid.cols * cw, grid.rows * ch);
            count = 0;
          }
        },
      };
    };

    const lavatProgram = (g, grid, cw, ch) => {
      const aspect = ch / cw;
      const width = grid.cols;
      const height = grid.rows * aspect;
      const radius = Math.min(width, height) * 0.17;
      const balls = Array.from({ length: 8 }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * width * 0.06,
        vy: (Math.random() - 0.5) * height * 0.09,
      }));
      let last = performance.now();

      return {
        frame() {
          const now = performance.now();
          const dt = Math.min(0.1, (now - last) / 1000);
          last = now;
          balls.forEach((ball) => {
            ball.x += ball.vx * dt;
            ball.y += ball.vy * dt;
            if (ball.x < 0 || ball.x > width) ball.vx = -ball.vx;
            if (ball.y < 0 || ball.y > height) ball.vy = -ball.vy;
          });
          g.clearRect(0, 0, grid.cols * cw, grid.rows * ch);
          g.fillStyle = '#cc0000';
          const r2 = radius * radius;
          for (let row = 0; row < grid.rows; row++) {
            const py = (row + 0.5) * aspect;
            let start = -1;
            for (let col = 0; col <= grid.cols; col++) {
              let on = false;
              if (col < grid.cols) {
                const px = col + 0.5;
                let sum = 0;
                for (let i = 0; i < balls.length; i++) {
                  const ddx = px - balls[i].x;
                  const ddy = py - balls[i].y;
                  const falloff = r2 / (ddx * ddx + ddy * ddy + 0.0001);
                  sum += falloff * falloff;
                }
                on = sum >= 1;
              }
              if (on && start < 0) start = col;
              if (!on && start >= 0) {
                g.fillRect(start * cw, row * ch, (col - start) * cw, ch);
                start = -1;
              }
            }
          }
        },
      };
    };

    const execute = (rawLine) => {
      const segments = parsePipeline(tokenize(expandAlias(rawLine)));
      segments.forEach((segment) => {
        segment.args = segment.args.map(expandWord);
        if (segment.redirect) segment.redirect.path = expandWord(segment.redirect.path);
      });
      const errors = [];
      let stdin = '';
      let finalOut = null;
      segments.forEach((segment, index) => {
        const [name, ...args] = segment.args;
        const last = index === segments.length - 1;
        const command = commands[name] || (installedCommands().includes(name) ? programs[name] : undefined);
        if (!command) {
          errors.push(`${name}: command not found`);
          stdin = '';
          return;
        }
        const ctx = { tty: last && !segment.redirect, err: (message) => errors.push(`${name}: ${message}`) };
        let result;
        try {
          result = command(args, stdin, ctx);
        } catch (error) {
          errors.push(`${name}: ${error.message}`);
          result = '';
        }
        const text = typeof result === 'object' && result ? result.text : result || '';
        if (segment.redirect) {
          try {
            fs.write(abs(segment.redirect.path), text ? `${text}\n` : '', segment.redirect.append);
          } catch (error) {
            errors.push(`${segment.redirect.path}: ${error.message}`);
          }
          stdin = '';
        } else if (last) {
          finalOut = result;
        } else {
          stdin = text;
        }
      });
      errors.forEach((message) => printText(message));
      if (finalOut === null || finalOut === '' || finalOut === undefined) return;
      if (typeof finalOut === 'object') {
        if (finalOut.text !== '') finalOut.html.split('\n').forEach((part) => print(part));
      } else {
        printText(finalOut);
      }
    };

    const submit = () => {
      const line = input.value;
      print(promptHtml() + escapeHtml(line));
      input.value = '';
      if (line.trim()) {
        recordHistory(line);
        try {
          execute(line);
        } catch (error) {
          printText(`bash: ${error.message}`);
        }
      }
      shell.cursor = shell.history.length;
      term.scrollTop = term.scrollHeight;
    };

    const complete = () => {
      const before = input.value.slice(0, input.selectionStart);
      const word = (before.match(/\S*$/) || [''])[0];
      const lead = before.slice(0, before.length - word.length);
      let candidates;
      let prefix = '';
      if (lead.trim() === '') {
        candidates = [...Object.keys(commands), ...installedCommands()].filter((name) => name.startsWith(word));
      } else {
        const slash = word.lastIndexOf('/');
        prefix = word.slice(0, slash + 1);
        const stem = word.slice(slash + 1);
        try {
          candidates = fs
            .entries(abs(prefix || '.'))
            .filter((entry) => entry.name.startsWith(stem) && (stem.startsWith('.') || !entry.name.startsWith('.')))
            .map((entry) => (entry.node.type === 'dir' ? `${entry.name}/` : entry.name));
        } catch (error) {
          candidates = [];
        }
      }
      if (!candidates.length) return;
      const common = candidates.reduce((a, b) => {
        let n = 0;
        while (n < a.length && a[n] === b[n]) n++;
        return a.slice(0, n);
      });
      const value = prefix + common;
      const finish = candidates.length === 1 && !common.endsWith('/') ? ' ' : '';
      if (value.length > word.length || finish) {
        input.value = lead + value + finish + input.value.slice(input.selectionStart);
      } else {
        print(promptHtml() + escapeHtml(input.value));
        printText(candidates.join('  '));
        term.scrollTop = term.scrollHeight;
      }
    };

    input.addEventListener('keydown', (event) => {
      if (shell.keys) {
        shell.keys(event);
        return;
      }
      if (shell.stop) {
        event.preventDefault();
        if ((event.ctrlKey && event.key.toLowerCase() === 'c') || (shell.quitOnQ && event.key.toLowerCase() === 'q')) shell.stop();
        return;
      }
      if (event.key === 'Enter') {
        submit();
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        if (shell.cursor > 0) input.value = shell.history[--shell.cursor];
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        shell.cursor = Math.min(shell.cursor + 1, shell.history.length);
        input.value = shell.history[shell.cursor] || '';
      } else if (event.key === 'Tab') {
        event.preventDefault();
        complete();
      } else if (event.ctrlKey && event.key.toLowerCase() === 'l') {
        event.preventDefault();
        out.innerHTML = '';
      } else if (event.ctrlKey && event.key.toLowerCase() === 'c') {
        event.preventDefault();
        print(`${promptHtml()}${escapeHtml(input.value)}^C`);
        input.value = '';
        term.scrollTop = term.scrollHeight;
      }
    });

    term.addEventListener('click', () => {
      if (!String(window.getSelection())) input.focus();
    });
    input.addEventListener('input', () => {
      if (!shell.text) return;
      const value = input.value;
      input.value = '';
      shell.text(value);
    });

    refreshPrompt();
    if (!compact()) input.focus();
    if (options.run) {
      input.value = options.run;
      submit();
    }
  }

  const placeList = [
    { id: 'recent', label: 'Recent', icon: 'document-open-recent', loc: 'recent:///' },
    { id: 'home', label: 'Home', icon: 'user-home', loc: HOME },
    { id: 'desktop', label: 'Desktop', icon: 'user-desktop', loc: `${HOME}/Desktop` },
    { id: 'documents', label: 'Documents', icon: 'folder-documents', loc: `${HOME}/Documents` },
    { id: 'downloads', label: 'Downloads', icon: 'folder-download', loc: `${HOME}/Downloads` },
    { id: 'music', label: 'Music', icon: 'folder-music', loc: `${HOME}/Music` },
    { id: 'pictures', label: 'Pictures', icon: 'folder-pictures', loc: `${HOME}/Pictures` },
    { id: 'videos', label: 'Videos', icon: 'folder-videos', loc: `${HOME}/Videos` },
    { id: 'trash', label: 'Trash', icon: 'user-trash', loc: 'trash:///' },
  ];

  const folderIcons = { Documents: 'folder-documents', Downloads: 'folder-download', Music: 'folder-music', Pictures: 'folder-pictures', Videos: 'folder-videos' };
  let clipboard = null;

  const formatSize = (node) => {
    if (node.type === 'dir') {
      const count = Object.keys(node.children).length;
      return `${count} ${count === 1 ? 'item' : 'items'}`;
    }
    const bytes = fs.size(node);
    if (bytes < 1000) return `${bytes} ${bytes === 1 ? 'byte' : 'bytes'}`;
    return `${(bytes / 1000).toFixed(1)} kB`;
  };

  const formatModified = (date) => {
    const now = new Date();
    if (date.toDateString() === now.toDateString()) return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
  };

  function openFiles(location = HOME) {
    const win = createWindow({ app: 'files', title: 'Files', width: 820, height: 520, minWidth: 340 });
    const filesConfig = ctx.system.config('files', ctx.system.defaults.files);
    const st = { loc: location, back: [], forward: [], view: filesConfig.defaultView === 'list' ? 'list' : 'grid', hidden: filesConfig.showHidden, selected: new Set(), search: '', renaming: null, items: [], lastTap: { key: null, time: 0 } };

    win.heading.innerHTML = `
      <div class="fm-nav hb-group">
        <button class="hb" data-act="back" aria-label="Back">${sym('go-previous')}</button>
        <button class="hb" data-act="forward" aria-label="Forward">${sym('go-next')}</button>
      </div>
      <div class="fm-pathbar"></div>
      <div class="fm-tools">
        <button class="hb" data-act="search" aria-label="Search">${sym('edit-find')}</button>
        <button class="hb" data-act="view" aria-label="Change view">${sym('view-list')}</button>
      </div>`;
    win.body.innerHTML = `
      <div class="fm">
        <aside class="fm-sidebar"></aside>
        <section class="fm-main">
          <div class="fm-searchbar" hidden><input type="text" placeholder="Search current folder" spellcheck="false" autocomplete="off"></div>
          <div class="fm-infobar" hidden><span>Trash</span><button data-act="empty">Empty Trash</button></div>
          <div class="fm-view" tabindex="0"></div>
        </section>
      </div>`;

    const sidebar = win.body.querySelector('.fm-sidebar');
    const view = win.body.querySelector('.fm-view');
    const pathbar = win.heading.querySelector('.fm-pathbar');
    const searchbar = win.body.querySelector('.fm-searchbar');
    const searchInput = searchbar.querySelector('input');
    const infobar = win.body.querySelector('.fm-infobar');
    const backBtn = win.heading.querySelector('[data-act="back"]');
    const forwardBtn = win.heading.querySelector('[data-act="forward"]');
    const viewBtn = win.heading.querySelector('[data-act="view"]');
    const isDirLoc = () => !st.loc.endsWith(':///');

    const bookmarksPath = `${HOME}/.config/gtk-3.0/bookmarks`;
    const bookmarkPlaces = () => {
      try {
        return fs
          .read(bookmarksPath)
          .split('\n')
          .map((line) => line.trim().match(/^file:\/\/(\S+)(?:\s+(.*))?$/))
          .filter(Boolean)
          .map((match) => ({ path: decodeURI(match[1]), label: match[2] }))
          .filter((item) => fs.isDir(item.path))
          .map((item) => ({ id: 'bookmark', label: item.label || fs.split(item.path).name, icon: 'folder', loc: item.path }));
      } catch (error) {
        return [];
      }
    };
    const renderSidebar = () => {
      sidebar.innerHTML = [...placeList, { id: 'computer', label: 'Computer', icon: 'folder', loc: '/' }, ...bookmarkPlaces()]
        .map((place, i) => `${i === 2 || i === 8 || i === 9 ? '<div class="fm-sep"></div>' : ''}<button class="fm-place" data-loc="${escapeHtml(place.loc)}">${sym(place.icon)}<span>${escapeHtml(place.label)}</span></button>`)
        .join('');
      sidebar.querySelectorAll('.fm-place').forEach((button) => button.classList.toggle('active', button.dataset.loc === st.loc));
    };
    renderSidebar();

    const iconFor = (item) => {
      if (item.node.type === 'file') {
        if (isImageData(item.node.content)) return `<img class="fm-thumb" src="${item.node.content}" alt="" draggable="false">`;
        const launcher = desktopEntryOf(item.node.content);
        if (launcher) return icon('apps', launcher.icon || 'about.svg', 'fm-app-icon');
        return `<i class="sym fm-glyph file" style="--m:url('${asset('symbolic/text-x-generic-symbolic.svg')}')"></i>`;
      }
      const { dir, name } = fs.split(item.path);
      return icon('places', dir === HOME && folderIcons[name] ? folderIcons[name] : 'folder');
    };

    const collect = () => {
      let items;
      if (st.loc === 'recent:///') {
        items = fs.recent.filter((path) => fs.get(path)).map((path) => ({ key: path, name: fs.split(path).name, path, node: fs.get(path) }));
      } else if (st.loc === 'trash:///') {
        items = fs.trash.map((item, index) => ({ key: `trash:${index}`, name: item.name, path: item.from, node: item.node, trashIndex: index }));
      } else {
        try {
          items = fs
            .entries(st.loc)
            .filter((entry) => st.hidden || !entry.name.startsWith('.'))
            .map((entry) => ({ key: entry.path, name: entry.name, path: entry.path, node: entry.node }));
        } catch (error) {
          items = [];
        }
        items.sort((a, b) => (a.node.type === b.node.type ? 0 : a.node.type === 'dir' ? -1 : 1));
      }
      const query = st.search.trim().toLowerCase();
      return query ? items.filter((item) => item.name.toLowerCase().includes(query)) : items;
    };

    const crumbs = () => {
      if (st.loc === 'recent:///') return [{ label: 'Recent', loc: st.loc }];
      if (st.loc === 'trash:///') return [{ label: 'Trash', loc: st.loc }];
      const list = [];
      let base = '/';
      let rest = fs.parts(st.loc);
      if (st.loc === HOME || st.loc.startsWith(`${HOME}/`)) {
        list.push({ label: 'Home', loc: HOME, home: true });
        base = HOME;
        rest = fs.parts(st.loc.slice(HOME.length));
      } else {
        list.push({ label: '/', loc: '/' });
      }
      rest.forEach((segment) => {
        base = fs.join(base, segment);
        list.push({ label: segment, loc: base });
      });
      return list;
    };

    const render = () => {
      st.items = collect();
      st.selected.forEach((key) => {
        if (!st.items.some((item) => item.key === key)) st.selected.delete(key);
      });
      sidebar.querySelectorAll('.fm-place').forEach((button) => button.classList.toggle('active', button.dataset.loc === st.loc));
      backBtn.disabled = !st.back.length;
      forwardBtn.disabled = !st.forward.length;
      setSym(viewBtn.firstElementChild, st.view === 'grid' ? 'view-list' : 'view-grid');
      pathbar.innerHTML = `<div class="fm-path">${crumbs()
        .map((crumb) => `<button class="fm-crumb" data-loc="${escapeHtml(crumb.loc)}">${crumb.home ? sym('user-home') : ''}<span>${escapeHtml(crumb.label)}</span></button>`)
        .join('')}</div>`;
      infobar.hidden = !(st.loc === 'trash:///' && fs.trash.length);

      if (!st.items.length) {
        const denied = !st.search && isDirLoc() && (() => {
          try {
            fs.entries(st.loc);
            return false;
          } catch (error) {
            return true;
          }
        })();
        const text = denied ? 'Permission Denied' : st.search ? 'No Results Found' : st.loc === 'trash:///' ? 'Trash is Empty' : st.loc === 'recent:///' ? 'No Recent Files' : 'Folder is Empty';
        const glyph = st.search ? 'edit-find' : st.loc === 'trash:///' ? 'user-trash' : st.loc === 'recent:///' ? 'document-open-recent' : 'folder';
        view.innerHTML = `<div class="fm-empty">${sym(glyph)}<span>${text}</span></div>`;
        return;
      }
      const label = (item) => (st.renaming === item.key ? `<input class="fm-rename" value="${escapeHtml(item.name)}" spellcheck="false" autocomplete="off">` : `<span class="fm-name">${escapeHtml(item.name)}</span>`);
      if (st.view === 'grid') {
        view.innerHTML = `<div class="fm-grid">${st.items
          .map((item) => `<div class="fm-item${st.selected.has(item.key) ? ' selected' : ''}" data-key="${escapeHtml(item.key)}">${iconFor(item)}${label(item)}</div>`)
          .join('')}</div>`;
      } else {
        view.innerHTML = `<div class="fm-list"><div class="fm-row head"><span>Name</span><span>Size</span><span>Modified</span></div>${st.items
          .map(
            (item) =>
              `<div class="fm-row${st.selected.has(item.key) ? ' selected' : ''}" data-key="${escapeHtml(item.key)}"><span class="fm-cell-name">${iconFor(item)}${st.renaming === item.key ? label(item) : `<span>${escapeHtml(item.name)}</span>`}</span><span>${formatSize(item.node)}</span><span>${formatModified(item.node.mtime)}</span></div>`
          )
          .join('')}</div>`;
      }
      const field = view.querySelector('.fm-rename');
      if (field) startRename(field);
    };

    const go = (loc, push = true) => {
      if (push && loc !== st.loc) {
        st.back.push(st.loc);
        st.forward = [];
      }
      st.loc = loc;
      st.selected.clear();
      st.renaming = null;
      st.search = '';
      searchInput.value = '';
      render();
    };

    const itemByKey = (key) => st.items.find((item) => item.key === key);

    const openItem = (item) => {
      if (item.trashIndex !== undefined) return;
      if (item.node.type === 'dir') {
        go(item.path);
      } else {
        fs.touchRecent(item.path);
        openPath(item.path);
      }
    };

    const startRename = (field) => {
      field.focus();
      const dot = field.value.lastIndexOf('.');
      field.setSelectionRange(0, dot > 0 ? dot : field.value.length);
      let done = false;
      const finish = (commit) => {
        if (done) return;
        done = true;
        const key = st.renaming;
        const item = itemByKey(key);
        st.renaming = null;
        const name = field.value.trim();
        if (commit && item && name && name !== item.name && !name.includes('/')) {
          const target = fs.join(fs.split(item.path).dir, name);
          if (!fs.get(target)) {
            try {
              fs.move(item.path, target);
              st.selected = new Set([target]);
              return;
            } catch (error) {
              render();
              return;
            }
          }
        }
        render();
      };
      field.addEventListener('keydown', (event) => {
        event.stopPropagation();
        if (event.key === 'Enter') finish(true);
        else if (event.key === 'Escape') finish(false);
      });
      field.addEventListener('blur', () => finish(true));
      field.addEventListener('pointerdown', (event) => event.stopPropagation());
    };

    const createItem = (kind) => {
      if (!isDirLoc()) return;
      const name = fs.unique(st.loc, kind === 'dir' ? 'Untitled Folder' : 'Untitled Document.txt');
      const path = fs.join(st.loc, name);
      try {
        if (kind === 'dir') fs.mkdir(path);
        else fs.write(path, '');
      } catch (error) {
        return;
      }
      if (kind === 'file') fs.touchRecent(path);
      st.selected = new Set([path]);
      st.renaming = path;
      render();
    };

    const selectedItems = () => st.items.filter((item) => st.selected.has(item.key));

    const trashSelected = () => {
      const items = selectedItems();
      if (st.loc === 'trash:///') {
        items.map((item) => item.trashIndex).sort((a, b) => b - a).forEach((index) => fs.purge(index));
      } else {
        items.forEach((item) => {
          try {
            fs.trashPath(item.path);
          } catch (error) {
            return;
          }
        });
      }
      st.selected.clear();
    };

    const restoreSelected = () => {
      selectedItems()
        .map((item) => item.trashIndex)
        .sort((a, b) => b - a)
        .forEach((index) => fs.restore(index));
      st.selected.clear();
    };

    const setClipboard = (mode) => {
      const paths = selectedItems().map((item) => item.path);
      if (paths.length) clipboard = { mode, paths };
    };

    const paste = () => {
      if (!clipboard || !isDirLoc()) return;
      clipboard.paths.forEach((path) => {
        if (!fs.get(path)) return;
        const { dir, name } = fs.split(path);
        const copying = clipboard.mode === 'copy';
        try {
          if (copying) fs.copy(path, fs.join(st.loc, fs.unique(st.loc, name, dir === st.loc)));
          else fs.move(path, fs.join(st.loc, fs.unique(st.loc, name)));
        } catch (error) {
          return;
        }
      });
      if (clipboard.mode === 'cut') clipboard = null;
    };

    const startRenameSelected = () => {
      const items = selectedItems();
      if (items.length === 1 && st.loc !== 'trash:///') {
        st.renaming = items[0].key;
        render();
      }
    };

    const unsubscribe = fs.onChange(() => {
      if (st.loc !== 'trash:///' && st.loc !== 'recent:///' && !fs.isDir(st.loc)) st.loc = HOME;
      if (!st.renaming) render();
    });
    win.onClose = unsubscribe;

    win.heading.addEventListener('click', (event) => {
      const crumb = event.target.closest('[data-loc]');
      const act = event.target.closest('[data-act]');
      if (crumb) go(crumb.dataset.loc);
      else if (act && !act.disabled) {
        const kind = act.dataset.act;
        if (kind === 'back' && st.back.length) {
          st.forward.push(st.loc);
          go(st.back.pop(), false);
        } else if (kind === 'forward' && st.forward.length) {
          st.back.push(st.loc);
          go(st.forward.pop(), false);
        } else if (kind === 'view') {
          st.view = st.view === 'grid' ? 'list' : 'grid';
          render();
        } else if (kind === 'search') {
          searchbar.hidden = !searchbar.hidden;
          if (searchbar.hidden) {
            st.search = '';
            searchInput.value = '';
            render();
          } else {
            searchInput.focus();
          }
        }
      }
    });

    sidebar.addEventListener('click', (event) => {
      const place = event.target.closest('[data-loc]');
      if (place) go(place.dataset.loc);
    });

    infobar.addEventListener('click', (event) => {
      if (event.target.closest('[data-act="empty"]')) {
        fs.emptyTrash();
        ctx.sound.play('trash-empty');
      }
    });

    searchInput.addEventListener('input', () => {
      st.search = searchInput.value;
      render();
    });

    view.addEventListener('pointerdown', (event) => {
      if (event.target.closest('.fm-rename')) return;
      const row = event.target.closest('[data-key]');
      if (!row) {
        st.selected.clear();
        view.querySelectorAll('.selected').forEach((node) => node.classList.remove('selected'));
        return;
      }
      if (event.button === 2 && st.selected.has(row.dataset.key)) return;
      if (event.ctrlKey || event.metaKey) {
        if (st.selected.has(row.dataset.key)) st.selected.delete(row.dataset.key);
        else st.selected.add(row.dataset.key);
      } else if (event.shiftKey && st.selected.size) {
        const keys = st.items.map((item) => item.key);
        const anchor = keys.indexOf([...st.selected][0]);
        const target = keys.indexOf(row.dataset.key);
        st.selected = new Set(keys.slice(Math.min(anchor, target), Math.max(anchor, target) + 1));
      } else {
        st.selected = new Set([row.dataset.key]);
      }
      view.querySelectorAll('[data-key]').forEach((node) => node.classList.toggle('selected', st.selected.has(node.dataset.key)));
      if (event.button === 0 && event.pointerType !== 'mouse') {
        const now = Date.now();
        if (st.lastTap.key === row.dataset.key && now - st.lastTap.time < 350) {
          const item = itemByKey(row.dataset.key);
          if (item) openItem(item);
        }
        st.lastTap = { key: row.dataset.key, time: now };
      }
    });

    view.addEventListener('dblclick', (event) => {
      const row = event.target.closest('[data-key]');
      const item = row && itemByKey(row.dataset.key);
      if (item) openItem(item);
    });

    view.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      const row = event.target.closest('[data-key]');
      const inTrash = st.loc === 'trash:///';
      if (row) {
        if (!st.selected.has(row.dataset.key)) {
          st.selected = new Set([row.dataset.key]);
          view.querySelectorAll('[data-key]').forEach((node) => node.classList.toggle('selected', st.selected.has(node.dataset.key)));
        }
        const single = st.selected.size === 1;
        if (inTrash) {
          showMenu(event, [
            { label: 'Restore From Trash', run: () => restoreSelected() },
            { label: 'Delete Permanently', run: () => trashSelected() },
          ]);
        } else {
          showMenu(event, [
            { label: 'Open', disabled: !single, run: () => openItem(selectedItems()[0]) },
            '-',
            { label: 'Cut', run: () => setClipboard('cut') },
            { label: 'Copy', run: () => setClipboard('copy') },
            '-',
            { label: 'Add to Bookmarks', disabled: !single || !(st.items.find((item) => item.key === [...st.selected][0]) || { node: {} }).node.children, run: () => {
              const item = st.items.find((entry) => entry.key === [...st.selected][0]);
              if (!item) return;
              let text = '';
              try {
                text = fs.read(bookmarksPath);
              } catch (error) {
                text = '';
              }
              fs.write(bookmarksPath, `${text}${text && !text.endsWith('\n') ? '\n' : ''}file://${encodeURI(item.path)} ${item.name}\n`);
              renderSidebar();
            } },
            '-',
            { label: 'Rename…', disabled: !single, run: startRenameSelected },
            { label: 'Move to Trash', run: () => {
              trashSelected();
              render();
            } },
          ]);
        }
      } else if (!inTrash && isDirLoc()) {
        showMenu(event, [
          { label: 'New Folder', run: () => createItem('dir') },
          { label: 'New Text File', run: () => createItem('file') },
          '-',
          { label: 'Paste', disabled: !clipboard, run: () => {
            paste();
            render();
          } },
          { label: 'Select All', run: () => {
            st.selected = new Set(st.items.map((item) => item.key));
            render();
          } },
          '-',
          { label: `${st.hidden ? '✓ ' : ''}Show Hidden Files`, run: () => {
            st.hidden = !st.hidden;
            render();
          } },
        ]);
      }
    });

    win.body.addEventListener('keydown', (event) => {
      if (event.target.closest('input')) return;
      const ctrl = event.ctrlKey || event.metaKey;
      if (event.key === 'Delete') {
        trashSelected();
        render();
      } else if (event.key === 'F2') {
        startRenameSelected();
      } else if (event.key === 'Enter') {
        const items = selectedItems();
        if (items.length === 1) openItem(items[0]);
      } else if (ctrl && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        st.selected = new Set(st.items.map((item) => item.key));
        render();
      } else if (ctrl && event.key.toLowerCase() === 'c') {
        setClipboard('copy');
      } else if (ctrl && event.key.toLowerCase() === 'x') {
        setClipboard('cut');
      } else if (ctrl && event.key.toLowerCase() === 'v') {
        paste();
        render();
      } else if (ctrl && event.shiftKey && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        createItem('dir');
      } else if (ctrl && event.key.toLowerCase() === 'h') {
        event.preventDefault();
        st.hidden = !st.hidden;
        render();
      } else if (ctrl && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        searchbar.hidden = false;
        searchInput.focus();
      }
    });

    render();
    return win;
  }

  function openEditor(path) {
    const existing = windows.find((win) => win.app === 'editor' && win.path === path);
    if (existing) {
      existing.focus();
      return existing;
    }
    let content;
    try {
      content = fs.read(path);
    } catch (error) {
      return null;
    }
    if (isImageData(content)) return null;
    const { dir, name } = fs.split(path);
    const win = createWindow({ app: 'editor', title: name, width: 640, height: 440 });
    win.path = path;
    win.heading.innerHTML = `<span class="uwin-title">${escapeHtml(name)}<small>${escapeHtml(shortPath(dir))}</small></span>`;
    win.body.innerHTML = '<textarea class="editor" spellcheck="false" aria-label="Document"></textarea>';
    const area = win.body.querySelector('.editor');
    const editorConfig = ctx.system.config('text-editor', ctx.system.defaults['text-editor']);
    area.style.fontSize = `${Math.min(32, Math.max(9, editorConfig.fontSize))}px`;
    area.wrap = editorConfig.wordWrap ? 'soft' : 'off';
    area.value = content;
    area.addEventListener('input', () => fs.setContent(path, area.value));
    if (!compact()) area.focus();
    return win;
  }

  function openNewDocument() {
    const name = fs.unique(HOME, 'Untitled Document.txt');
    const path = fs.join(HOME, name);
    fs.write(path, '');
    fs.touchRecent(path);
    openEditor(path);
  }

  function openSettings(panelId = 'appearance') {
    const found = windows.find((win) => win.app === 'settings');
    if (found) {
      found.focus();
      found.showPanel(panelId);
      return found;
    }
    const win = createWindow({ app: 'settings', title: 'Settings', width: 940, height: 600, minWidth: 340 });
    win.heading.insertAdjacentHTML('afterbegin', `<button class="hb set-back" aria-label="Back">${sym('go-previous')}</button>`);
    win.body.innerHTML = '<div class="set"><nav class="set-side"></nav><div class="set-content"><div class="set-page"></div></div></div>';
    const side = win.body.querySelector('.set-side');
    const page = win.body.querySelector('.set-page');
    const title = win.heading.querySelector('.uwin-title');
    let current = panelId;
    let release = null;
    const panels = ctx.settings.panels();

    side.innerHTML = panels.map((panel) => `<button class="set-nav" data-id="${panel.id}">${sym(panel.icon)}<span>${panel.label}</span></button>`).join('');

    const showPanel = (id, reveal = true) => {
      const panel = panels.find((item) => item.id === id) || panels.find((item) => item.id === 'appearance');
      current = panel.id;
      side.querySelectorAll('.set-nav').forEach((button) => button.classList.toggle('active', button.dataset.id === panel.id));
      if (release) release();
      page.innerHTML = '';
      release = panel.render(page, { win, refresh: () => showPanel(current, false) }) || null;
      title.textContent = panel.label;
      if (reveal) win.el.classList.add('show-content');
    };
    win.onClose = () => {
      if (release) release();
    };

    side.addEventListener('click', (event) => {
      const button = event.target.closest('[data-id]');
      if (button) showPanel(button.dataset.id);
    });
    win.heading.querySelector('.set-back').addEventListener('click', () => {
      win.el.classList.remove('show-content');
      title.textContent = 'Settings';
    });

    win.showPanel = showPanel;
    win.refresh = () => showPanel(current, false);
    showPanel(panelId, false);
    return win;
  }

  function openAbout(tab = 'welcome') {
    const found = windows.find((win) => win.app === 'help');
    if (found) {
      found.focus();
      found.showTab(tab);
      return found;
    }
    const win = createWindow({ app: 'help', title: 'Help', width: 520, height: 580, minWidth: 300 });
    win.body.innerHTML = `
      <div class="help">
        <nav class="help-tabs">
          <button class="help-tab" data-tab="welcome">Welcome &amp; Guide</button>
          <button class="help-tab" data-tab="about">Who Am I</button>
        </nav>
        <section class="help-page" data-page="welcome">
          <div class="guide">
            ${lambda('guide-logo', 'lambdawebOS')}
            <h1>Welcome to lambdawebOS!</h1>
            <p>This is a fun little project that I've created in HTML, CSS, JavaScript and Python, taking me about a month.</p>
            <p>You can download applications from the app store, as we have a very (small) catalogue of packages for you to choose from. Go ham!</p>
            <p>Also, you can send mail to other registered users with the Mail application!</p>
            <p>I hope you enjoy, goodluck!</p>
            <p class="guide-sign">- Rune</p>
          </div>
        </section>
        <section class="help-page" data-page="about" hidden>
          <div class="about">
            <img class="about-pfp" src="amazon-lambda_W8P7.webp" alt="">
            <h1>Rune</h1>
            <div class="about-discord"><span>Discord</span><strong>rune_wasneverhere</strong></div>
            <div class="about-text">
              <p>Hello! I am a small developer that mildly knows python, javascript, and html!</p>
              <p>If you would like to contact me, please use the discord handle above.</p>
            </div>
          </div>
        </section>
      </div>`;
    const tabs = [...win.body.querySelectorAll('.help-tab')];
    const pages = [...win.body.querySelectorAll('.help-page')];
    win.showTab = (name) => {
      tabs.forEach((button) => button.classList.toggle('active', button.dataset.tab === name));
      pages.forEach((page) => {
        page.hidden = page.dataset.page !== name;
      });
    };
    tabs.forEach((button) => button.addEventListener('click', () => win.showTab(button.dataset.tab)));
    win.showTab(tab);
    return win;
  }

  function openBrowser(startUrl) {
    const win = createWindow({ app: 'firefox', title: 'Firefox', width: 900, height: 560, minWidth: 340 });
    win.heading.innerHTML = `<div class="fx-tabs"></div><button class="hb fx-new" aria-label="New Tab">${sym('list-add')}</button>`;
    win.body.innerHTML = `
      <div class="fx">
        <div class="fx-toolbar">
          <div class="hb-group">
            <button class="hb" data-act="back" aria-label="Back">${sym('go-previous')}</button>
            <button class="hb" data-act="forward" aria-label="Forward">${sym('go-next')}</button>
          </div>
          <button class="hb" data-act="reload" aria-label="Reload">${sym('view-refresh')}</button>
          <input class="fx-url" type="text" placeholder="Search or enter address" spellcheck="false" autocomplete="off" autocapitalize="off" aria-label="Address">
        </div>
        <div class="fx-info" hidden><span>Some websites do not allow being displayed inside another page.</span><a target="_blank" rel="noopener noreferrer">Open in a new browser tab</a></div>
        <div class="fx-pages"></div>
      </div>`;
    const tabStrip = win.heading.querySelector('.fx-tabs');
    const pages = win.body.querySelector('.fx-pages');
    const urlInput = win.body.querySelector('.fx-url');
    const info = win.body.querySelector('.fx-info');
    const backBtn = win.body.querySelector('[data-act="back"]');
    const forwardBtn = win.body.querySelector('[data-act="forward"]');
    const tabs = [];
    let active = null;

    const toUrl = (value) => {
      const text = value.trim();
      if (/^https?:\/\//i.test(text)) return text;
      if (/^[\w-]+(\.[\w-]+)+(:\d+)?([/?#].*)?$/.test(text)) return `https://${text}`;
      return `https://en.wikipedia.org/w/index.php?search=${encodeURIComponent(text)}`;
    };

    const hostOf = (url) => {
      try {
        return new URL(url).hostname.replace(/^www\./, '');
      } catch (error) {
        return url;
      }
    };

    const tiles = [
      { label: 'Wikipedia', url: 'https://en.wikipedia.org' },
      { label: 'Example', url: 'https://example.com' },
      { label: 'Live BTOP', url: 'https://btop.runewasneverhere.com' },
    ];

    const render = () => {
      tabStrip.innerHTML = tabs
        .map((tab, i) => `<div class="fx-tab${tab === active ? ' active' : ''}" data-i="${i}"><span>${escapeHtml(tab.index >= 0 ? hostOf(tab.url) : 'New Tab')}</span><button data-close="${i}" aria-label="Close tab">${sym('window-close')}</button></div>`)
        .join('');
      tabs.forEach((tab) => {
        tab.page.classList.toggle('active', tab === active);
        tab.page.classList.toggle('browsing', tab.index >= 0);
        tab.page.classList.toggle('offline', !ctx.network.online() && (tab.index < 0 || !!tab.blocked));
      });
      urlInput.value = active.index >= 0 ? active.url : '';
      backBtn.disabled = active.index < 0;
      forwardBtn.disabled = active.index >= active.history.length - 1;
      info.hidden = active.index < 0;
      info.querySelector('a').href = active.index >= 0 ? active.url : '#';
    };

    const load = (tab) => {
      tab.url = tab.history[tab.index];
      tab.blocked = !ctx.network.online();
      if (tab.blocked) {
        tab.frame.src = 'about:blank';
        return;
      }
      tab.frame.src = tab.url;
    };

    const navigate = (tab, value) => {
      if (!value.trim()) return;
      tab.history = tab.history.slice(0, tab.index + 1);
      tab.history.push(toUrl(value));
      tab.index = tab.history.length - 1;
      load(tab);
      render();
    };

    const select = (tab) => {
      active = tab;
      render();
    };

    const addTab = (target) => {
      const tab = { history: [], index: -1, url: '', page: document.createElement('div'), frame: document.createElement('iframe') };
      tab.page.className = 'fx-page';
      tab.page.innerHTML = `
        <div class="fx-home">
          ${icon('apps', 'firefox')}
          <input class="fx-search" type="text" placeholder="Search Wikipedia or enter address" spellcheck="false" autocomplete="off" aria-label="Search">
          <div class="fx-tiles">${tiles.map((tile) => `<button class="fx-tile" data-url="${tile.url}"><b>${tile.label[0]}</b><span>${tile.label}</span></button>`).join('')}</div>
        </div>
        <div class="fx-offline">${sym('network-wireless')}<h2>No connection</h2><p>Please check your Wi-Fi connection.</p><button class="fx-retry">Try Again</button></div>`;
      tab.page.querySelector('.fx-retry').addEventListener('click', () => {
        if (!state.wifi) ctx.network.setWifi(true);
        else ctx.network.refresh();
      });
      tab.frame.className = 'fx-frame';
      tab.frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups allow-modals');
      tab.frame.setAttribute('referrerpolicy', 'no-referrer');
      tab.frame.title = 'Web page';
      tab.page.append(tab.frame);
      tab.page.querySelector('.fx-search').addEventListener('keydown', (event) => {
        if (event.key === 'Enter') navigate(tab, event.target.value);
      });
      tab.page.querySelector('.fx-tiles').addEventListener('click', (event) => {
        const tile = event.target.closest('[data-url]');
        if (tile) navigate(tab, tile.dataset.url);
      });
      pages.append(tab.page);
      tabs.push(tab);
      select(tab);
      if (target) navigate(tab, target);
      else if (!compact()) tab.page.querySelector('.fx-search').focus();
    };

    tabStrip.addEventListener('click', (event) => {
      const close = event.target.closest('[data-close]');
      const tab = event.target.closest('[data-i]');
      if (close) {
        const index = Number(close.dataset.close);
        const [removed] = tabs.splice(index, 1);
        removed.page.remove();
        if (!tabs.length) win.close();
        else select(active === removed ? tabs[Math.min(index, tabs.length - 1)] : active);
      } else if (tab) {
        select(tabs[Number(tab.dataset.i)]);
      }
    });

    win.heading.querySelector('.fx-new').addEventListener('click', () => addTab());

    win.body.querySelector('.fx-toolbar').addEventListener('click', (event) => {
      const act = event.target.closest('[data-act]');
      if (!act || act.disabled) return;
      if (act.dataset.act === 'back') {
        active.index -= 1;
        if (active.index >= 0) load(active);
        render();
      } else if (act.dataset.act === 'forward') {
        active.index += 1;
        load(active);
        render();
      } else if (active.index >= 0) {
        load(active);
      }
    });

    urlInput.addEventListener('focus', () => urlInput.select());
    urlInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        navigate(active, urlInput.value);
        urlInput.blur();
      }
    });

    const stopWatching = ctx.network.onChange((isOnline) => {
      tabs.forEach((tab) => {
        if (isOnline && tab.blocked && tab.index >= 0) load(tab);
      });
      if (active) render();
    });
    win.onClose = stopWatching;

    addTab(startUrl);
    return win;
  }

  const desktopIcons = document.createElement('div');
  desktopIcons.className = 'desktop-icons';
  desktopIcons.innerHTML = `<button class="desk-icon" data-loc="${HOME}">${icon('places', 'user-home')}<span>Home</span></button>`;
  workarea.append(desktopIcons);
  const homeIcon = desktopIcons.querySelector('.desk-icon');
  homeIcon.addEventListener('click', () => homeIcon.classList.add('selected'));
  homeIcon.addEventListener('dblclick', () => openFiles(HOME));

  const DESKTOP = `${HOME}/Desktop`;
  const desktopFiles = document.createElement('div');
  desktopFiles.className = 'desktop-files';
  workarea.append(desktopFiles);
  const desk = { selected: null, renaming: null, tap: { path: null, time: 0 } };

  const deskGlyph = (entry) => {
    if (entry.node.type === 'dir') return icon('places', 'folder');
    const launcher = desktopEntryOf(entry.node.content);
    if (launcher) return icon('apps', launcher.icon || 'about.svg');
    if (isImageData(entry.node.content)) return `<img class="desk-thumb" src="${entry.node.content}" alt="" draggable="false">`;
    return `<i class="sym fm-glyph file" style="--m:url('${asset('symbolic/text-x-generic-symbolic.svg')}')"></i>`;
  };
  const deskLabel = (entry) => {
    const launcher = entry.node.type === 'file' ? desktopEntryOf(entry.node.content) : null;
    return launcher ? launcher.name : entry.name;
  };

  const renderDesktop = () => {
    let entries = [];
    try {
      entries = fs.entries(DESKTOP).filter((entry) => !entry.name.startsWith('.'));
    } catch (error) {
      entries = [];
    }
    entries.sort((a, b) => (a.node.type === b.node.type ? 0 : a.node.type === 'dir' ? -1 : 1));
    desktopFiles.innerHTML = entries
      .map((entry) => {
        const label = desk.renaming === entry.path ? `<input class="desk-rename" value="${escapeHtml(entry.name)}" spellcheck="false" autocomplete="off">` : `<span>${escapeHtml(deskLabel(entry))}</span>`;
        return `<button class="desk-icon${desk.selected === entry.path ? ' selected' : ''}" data-path="${escapeHtml(entry.path)}">${deskGlyph(entry)}${label}</button>`;
      })
      .join('');
    const field = desktopFiles.querySelector('.desk-rename');
    if (field) startDeskRename(field);
  };

  function startDeskRename(field) {
    field.focus();
    const dot = field.value.lastIndexOf('.');
    field.setSelectionRange(0, dot > 0 ? dot : field.value.length);
    const from = desk.renaming;
    let done = false;
    const finish = (commit) => {
      if (done) return;
      done = true;
      desk.renaming = null;
      const name = field.value.trim();
      if (commit && name && !name.includes('/') && name !== fs.split(from).name) {
        const target = fs.join(DESKTOP, name);
        if (!fs.get(target)) {
          try {
            fs.move(from, target);
            desk.selected = target;
            return;
          } catch (error) {
            renderDesktop();
            return;
          }
        }
      }
      renderDesktop();
    };
    field.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Enter') finish(true);
      else if (event.key === 'Escape') finish(false);
    });
    field.addEventListener('blur', () => finish(true));
    field.addEventListener('pointerdown', (event) => event.stopPropagation());
    field.addEventListener('dblclick', (event) => event.stopPropagation());
  }

  function openDesktopItem(path) {
    const node = fs.get(path);
    if (!node) return;
    if (node.type === 'dir') {
      openFiles(path);
    } else if (desktopEntryOf(node.content)) {
      launchDesktopFile(path);
    } else {
      fs.touchRecent(path);
      openPath(path);
    }
  }

  function createOnDesktop(kind) {
    if (!fs.isDir(DESKTOP)) return;
    const path = fs.join(DESKTOP, fs.unique(DESKTOP, kind === 'dir' ? 'Untitled Folder' : 'Untitled Document.txt'));
    desk.selected = path;
    desk.renaming = path;
    try {
      if (kind === 'dir') fs.mkdir(path);
      else fs.write(path, '');
    } catch (error) {
      desk.renaming = null;
    }
  }

  const deskSelect = (path) => {
    desk.selected = path;
    desktopFiles.querySelectorAll('.desk-icon').forEach((node) => node.classList.toggle('selected', node.dataset.path === path));
  };

  desktopFiles.addEventListener('pointerdown', (event) => {
    const node = event.target.closest('.desk-icon');
    if (!node || event.target.closest('.desk-rename')) return;
    homeIcon.classList.remove('selected');
    deskSelect(node.dataset.path);
    if (event.button === 0 && event.pointerType !== 'mouse') {
      const now = Date.now();
      if (desk.tap.path === node.dataset.path && now - desk.tap.time < 350) openDesktopItem(node.dataset.path);
      desk.tap = { path: node.dataset.path, time: now };
    }
  });
  desktopFiles.addEventListener('dblclick', (event) => {
    const node = event.target.closest('.desk-icon');
    if (node && !event.target.closest('.desk-rename')) openDesktopItem(node.dataset.path);
  });
  desktopFiles.addEventListener('contextmenu', (event) => {
    const node = event.target.closest('.desk-icon');
    if (!node || event.target.closest('.desk-rename')) return;
    event.preventDefault();
    const path = node.dataset.path;
    deskSelect(path);
    showMenu(event, [
      { label: 'Open', run: () => openDesktopItem(path) },
      '-',
      {
        label: 'Rename…',
        run: () => {
          desk.renaming = path;
          renderDesktop();
        },
      },
      {
        label: 'Move to Trash',
        run: () => {
          try {
            fs.trashPath(path);
          } catch (error) {
            return;
          }
          desk.selected = null;
        },
      },
    ]);
  });
  workarea.addEventListener('pointerdown', (event) => {
    if (event.target.closest('.desk-icon')) return;
    homeIcon.classList.remove('selected');
    deskSelect(null);
  });
  fs.onChange(() => {
    if (desk.renaming && desktopFiles.querySelector('.desk-rename')) return;
    renderDesktop();
  });

  const savedFs = session.store.get('fs');
  if (savedFs) {
    try {
      fs.load(savedFs);
    } catch (error) {
      session.store.remove('fs');
    }
  }
  let saveTimer = null;
  fs.onDirty(() => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => session.store.set('fs', fs.dump()), 400);
  });
  window.addEventListener('pagehide', () => session.store.set('fs', fs.dump()));

  renderDesktop();

  const ctx = {
    session,
    root,
    windows,
    createWindow,
    notify,
    fs,
    icon,
    sym,
    setSym,
    asset,
    escapeHtml,
    apps,
    favorites,
    renderDock,
    openFiles,
    openPath,
    openEditor,
    registerOpener,
    isImageData,
    showMenu,
    compact,
    HOME,
    USER,
    HOSTNAME,
    state,
    saveState: () => persistSettings(),
    catalog,
    installed,
    installedCommands: () => installedCommands(),
    wallpapers,
    accents,
    wallpaperCss,
    applyWallpaper,
    applyTheme,
    applyDock: () => applyDock(),
    tick,
    addFavorite,
    removeFavorite,
    createLauncher,
    openSettings,
    defaultWallpaper,
  };
  [window.lambdawebSystem, window.lambdawebNetwork, window.lambdawebTerminalApps, window.lambdawebGuiApps, window.lambdawebSettings, window.lambdawebMedia, window.lambdawebMail, window.lambdawebAdmin, window.lambdawebAnnouncements].forEach((init) => {
    if (init) init(ctx);
  });
  ctx.system.syncEntries();

  favoriteDefaults.push(...favorites);
  try {
    const saved = JSON.parse(session.store.get('favorites') || 'null');
    if (saved && Array.isArray(saved.list)) {
      const known = new Set(Array.isArray(saved.known) ? saved.known : []);
      const list = saved.list.filter((id) => typeof id === 'string');
      favoriteDefaults.forEach((id) => {
        if (!known.has(id) && !list.includes(id)) list.splice(Math.max(0, list.indexOf('settings')), 0, id);
      });
      favorites.length = 0;
      favorites.push(...list);
    }
  } catch (error) {
    session.store.remove('favorites');
  }

  registerOpener((path, node) => /\.desktop$/.test(path) && !!desktopEntryOf(node.content), (path) => launchDesktopFile(path));

  const compactMedia = window.matchMedia('(max-width: 768px)');
  const applyDock = () => {
    root.dataset.dock = state.dockPosition;
    if (compactMedia.matches) root.style.removeProperty('--dock-icon');
    else root.style.setProperty('--dock-icon', `${state.dockIcon}px`);
    root.classList.toggle('no-anim', !state.animations);
    renderDock();
  };
  compactMedia.addEventListener('change', applyDock);
  if (fs.get(`${HOME}/.config/lambdaweb/desktop.conf`)) ctx.desktopConfig.fromFile();

  settingsReady = true;
  quick.querySelector('.qs-volume input').value = String(state.volume);
  applyDock();
  applyWallpaper();
  applyTheme();
  syncFullscreen();
  tick();
  setInterval(tick, 1000);
  renderDock();

  ctx.sound.play('login');
  if (!session.store.get('welcomed')) {
    setTimeout(() => {
      session.store.set('welcomed', '1');
      openAbout('welcome');
    }, 700);
  }
};
