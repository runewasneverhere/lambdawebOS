window.lambdawebSettings = (ctx) => {
  const { state, sym, escapeHtml, fs, HOME, USER, HOSTNAME, session, apps, favorites, notify } = ctx;
  const system = ctx.system;
  const CONF = `${HOME}/.config/lambdaweb/desktop.conf`;
  let lastText = '';
  let applying = false;

  const bool = (value) => (value ? 'true' : 'false');
  const confText = () =>
    [
      '# lambdawebOS desktop settings. Edit and save; changes apply automatically.',
      `theme=${state.theme}`,
      `accent=${state.accent}`,
      `wallpaper=${state.wallpaper}`,
      `dock-position=${state.dockPosition}`,
      `dock-icon-size=${state.dockIcon}`,
      `show-trash=${bool(state.showTrash)}`,
      `sound-effects=${bool(state.sounds)}`,
      `volume=${state.volume}`,
      `clock-24h=${bool(state.clock24)}`,
      `show-seconds=${bool(state.showSeconds)}`,
      `show-date=${bool(state.showDate)}`,
      `animations=${bool(state.animations)}`,
      '',
    ].join('\n');

  const desktopConfig = {
    toFile() {
      if (applying) return;
      const text = confText();
      lastText = text;
      fs.seedFile(CONF, text, { overwrite: true });
      fs.markDirty();
    },
    fromFile() {
      let text;
      try {
        text = fs.read(CONF);
      } catch (error) {
        return;
      }
      if (text === lastText) return;
      lastText = text;
      const values = {};
      text.split('\n').forEach((line) => {
        const match = line.trim().match(/^([a-z0-9-]+)\s*=\s*(.+)$/);
        if (match && !line.trim().startsWith('#')) values[match[1]] = match[2].trim();
      });
      const flag = (key, field) => {
        if (values[key] === 'true' || values[key] === 'false') state[field] = values[key] === 'true';
      };
      applying = true;
      if (values.theme === 'light' || values.theme === 'dark') state.theme = values.theme;
      if (/^#[0-9a-f]{6}$/i.test(values.accent || '')) state.accent = values.accent;
      if (values.wallpaper && (ctx.wallpapers.some((item) => item.id === values.wallpaper) || (values.wallpaper === 'custom' && state.customWallpaper))) state.wallpaper = values.wallpaper;
      if (['left', 'right', 'bottom'].includes(values['dock-position'])) state.dockPosition = values['dock-position'];
      const iconSize = Number(values['dock-icon-size']);
      if (Number.isFinite(iconSize)) state.dockIcon = Math.min(64, Math.max(32, Math.round(iconSize)));
      const volume = Number(values.volume);
      if (Number.isFinite(volume)) state.volume = Math.min(100, Math.max(0, Math.round(volume)));
      flag('show-trash', 'showTrash');
      flag('sound-effects', 'sounds');
      flag('clock-24h', 'clock24');
      flag('show-seconds', 'showSeconds');
      flag('show-date', 'showDate');
      flag('animations', 'animations');
      ctx.applyDock();
      ctx.applyWallpaper();
      ctx.applyTheme();
      ctx.tick();
      ctx.windows.forEach((win) => win.refresh && win.refresh());
      ctx.root.querySelector('.qs-volume input').value = String(state.volume);
      applying = false;
    },
  };
  ctx.desktopConfig = desktopConfig;
  if (!fs.get(CONF)) desktopConfig.toFile();

  const switchHtml = (on, key, label) => `<button class="switch${on ? ' on' : ''}" role="switch" aria-checked="${on}" aria-label="${escapeHtml(label)}" data-switch="${key}"></button>`;
  const row = (label, control, hint = '') => `<div class="row"><span>${label}${hint ? `<small class="hint">${hint}</small>` : ''}</span>${control}</div>`;
  const mount = (page) => {
    const box = document.createElement('div');
    page.append(box);
    return box;
  };
  const bump = () => ctx.saveState();

  const wifiPanel = (page, { refresh }) => {
    const box = mount(page);
    const link = ctx.network.link();
    box.innerHTML = `<h2>Wi-Fi</h2>
      <div class="boxed">${row('Wi-Fi', switchHtml(state.wifi, 'wifi', 'Wi-Fi'))}</div>
      <div class="boxed">
        ${row('Status', `<span class="dim">${ctx.network.online() ? 'Connected' : state.wifi ? 'No internet connection' : 'Turned off'}</span>`)}
        ${link ? row('Connection quality', `<span class="dim">${escapeHtml(link.type || 'unknown')}</span>`) : ''}
        ${link && link.downlink ? row('Downlink', `<span class="dim">${link.downlink} Mbit/s</span>`) : ''}
        ${link && link.rtt ? row('Latency', `<span class="dim">${link.rtt} ms</span>`) : ''}
      </div>
      <p class="set-note">With Wi-Fi off, Firefox, Mail, Announcements and the App Center cannot reach the network. Your actual connection is managed by your browser.</p>`;
    box.addEventListener('click', (event) => {
      if (event.target.closest('[data-switch="wifi"]')) ctx.network.setWifi(!state.wifi);
    });
    return ctx.network.onChange(() => refresh());
  };

  const bluetoothPanel = (page) => {
    const box = mount(page);
    box.className = 'set-bluetooth';
    return ctx.network.renderBluetooth(box);
  };

  const readPicture = (file) =>
    new Promise((resolve, reject) => {
      if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > 12 * 1024 * 1024) {
        reject(new Error('Choose a PNG, JPEG or WebP picture under 12 MiB.'));
        return;
      }
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        URL.revokeObjectURL(url);
        const scale = Math.min(1, 1920 / Math.max(image.naturalWidth, image.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('That picture could not be read.'));
      };
      image.src = url;
    });

  const backgroundPanel = (page, { refresh }) => {
    const box = mount(page);
    const swatches = ctx.wallpapers.map((item) => `<button class="swatch${item.id === state.wallpaper ? ' selected' : ''}" data-id="${item.id}" title="${item.label}" aria-label="${item.label}" style="background:${item.css}"></button>`);
    if (state.customWallpaper) swatches.push(`<button class="swatch${state.wallpaper === 'custom' ? ' selected' : ''}" data-id="custom" title="Custom picture" aria-label="Custom picture" style="background:url('${state.customWallpaper}') center / cover"></button>`);
    box.innerHTML = `<h2>Background</h2>
      <div class="set-preview" style="background:${ctx.wallpaperCss(state.wallpaper)}"></div>
      <div class="set-swatches">${swatches.join('')}</div>
      <div class="set-actions"><button class="set-btn" data-act="pictures">Choose from Pictures…</button><label class="set-btn">Upload a Picture…<input type="file" accept="image/png,image/jpeg,image/webp" hidden></label></div>
      <p class="set-note" data-note>${state.wallpaper === 'default' ? 'The default wallpaper follows your light or dark style.' : ''}</p>`;
    const note = box.querySelector('[data-note]');
    const useCustom = (dataUrl) => {
      state.customWallpaper = dataUrl;
      state.wallpaper = 'custom';
      ctx.applyWallpaper();
      refresh();
    };
    box.addEventListener('click', async (event) => {
      const swatch = event.target.closest('.swatch');
      if (swatch) {
        state.wallpaper = swatch.dataset.id;
        ctx.applyWallpaper();
        refresh();
      } else if (event.target.closest('[data-act="pictures"]')) {
        const pictures = `${HOME}/Pictures`;
        const path = await ctx.fileDialog({ mode: 'open', title: 'Choose Background', dir: fs.isDir(pictures) ? pictures : HOME, accept: (name, node) => ctx.isImageData(node.content) });
        if (!path) return;
        try {
          const blob = await (await fetch(fs.read(path))).blob();
          useCustom(await readPicture(new File([blob], 'background', { type: blob.type })));
        } catch (error) {
          note.textContent = error.message;
        }
      }
    });
    box.querySelector('input[type="file"]').addEventListener('change', async (event) => {
      const file = event.target.files[0];
      if (!file) return;
      try {
        useCustom(await readPicture(file));
      } catch (error) {
        note.textContent = error.message;
      }
      event.target.value = '';
    });
  };

  const appearancePanel = (page, { refresh }) => {
    const box = mount(page);
    box.innerHTML = `<h2>Style</h2>
      <div class="set-styles">${['light', 'dark']
        .map((theme) => `<button class="style-card${state.theme === theme ? ' selected' : ''}" data-theme="${theme}"><span class="style-thumb ${theme}"><i></i><b></b></span><span>${theme === 'light' ? 'Light' : 'Dark'}</span></button>`)
        .join('')}</div>
      <h2>Accent Colour</h2>
      <div class="set-accents">${ctx.accents.map((item) => `<button class="accent${state.accent === item.color ? ' selected' : ''}" style="--c:${item.color}" data-color="${item.color}" title="${item.name}" aria-label="${item.name}">${sym('object-select')}</button>`).join('')}</div>
      <h2>Effects</h2>
      <div class="boxed">${row('Window animations', switchHtml(state.animations, 'animations', 'Window animations'), 'Opening, closing and minimizing windows')}</div>`;
    box.addEventListener('click', (event) => {
      const style = event.target.closest('.style-card');
      const accent = event.target.closest('.accent');
      if (style) {
        state.theme = style.dataset.theme;
        ctx.applyTheme();
        ctx.windows.forEach((win) => win.refresh && win.refresh());
      } else if (accent) {
        state.accent = accent.dataset.color;
        ctx.applyTheme();
        refresh();
      } else if (event.target.closest('[data-switch="animations"]')) {
        state.animations = !state.animations;
        ctx.applyDock();
        bump();
        refresh();
      }
    });
  };

  const desktopPanel = (page, { refresh }) => {
    const box = mount(page);
    const positions = [['left', 'Left'], ['bottom', 'Bottom'], ['right', 'Right']];
    const favoriteRows = favorites
      .filter((id) => apps[id])
      .map((id) => `<div class="row"><span class="set-app">${ctx.icon('apps', apps[id].icon, 'set-app-icon')}${escapeHtml(apps[id].label)}</span><button class="set-btn small" data-remove="${id}">Remove</button></div>`)
      .join('');
    box.innerHTML = `<h2>Dock</h2>
      <div class="boxed">
        ${row('Position on screen', `<span class="set-seg">${positions.map(([value, label]) => `<button class="${state.dockPosition === value ? 'on' : ''}" data-pos="${value}">${label}</button>`).join('')}</span>`)}
        ${row('Icon size', `<span class="row-ctl"><input type="range" min="32" max="64" step="2" value="${state.dockIcon}" aria-label="Icon size"><output>${state.dockIcon}</output></span>`)}
        ${row('Show Trash', switchHtml(state.showTrash, 'trash', 'Show Trash'))}
      </div>
      <h2>Favorites</h2>
      <div class="boxed">${favoriteRows || '<div class="row"><span class="dim">No apps pinned.</span></div>'}</div>
      <div class="set-actions"><button class="set-btn" data-act="reset-dock">Reset Favorites</button></div>
      <p class="set-note">Tip: right-click an app in the dock or in Show Apps to pin it, or drag it onto the dock or your desktop.</p>`;
    const range = box.querySelector('input[type="range"]');
    range.addEventListener('input', () => {
      state.dockIcon = Number(range.value);
      box.querySelector('output').textContent = range.value;
      ctx.applyDock();
    });
    range.addEventListener('change', bump);
    box.addEventListener('click', (event) => {
      const position = event.target.closest('[data-pos]');
      const remove = event.target.closest('[data-remove]');
      if (position) {
        state.dockPosition = position.dataset.pos;
        ctx.applyDock();
        bump();
        refresh();
      } else if (event.target.closest('[data-switch="trash"]')) {
        state.showTrash = !state.showTrash;
        ctx.applyDock();
        bump();
        refresh();
      } else if (remove) {
        ctx.removeFavorite(remove.dataset.remove);
        refresh();
      } else if (event.target.closest('[data-act="reset-dock"]')) {
        [...favorites].forEach((id) => ctx.removeFavorite(id));
        ['firefox', 'files', 'center', 'help', 'mail', 'announcements', 'admin', 'settings'].filter((id) => apps[id]).forEach((id) => ctx.addFavorite(id));
        refresh();
      }
    });
  };

  const soundPanel = (page, { refresh }) => {
    const box = mount(page);
    box.innerHTML = `<h2>Sound</h2>
      <div class="boxed">
        ${row('Volume', `<span class="row-ctl"><input type="range" min="0" max="100" value="${state.volume}" aria-label="Volume"><output>${state.volume}</output></span>`)}
        ${row('System sounds', switchHtml(state.sounds, 'sounds', 'System sounds'), 'Login, alerts, notifications and more')}
      </div>
      <h2>Try a Sound</h2>
      <div class="set-actions">${[['login', 'Login'], ['message', 'Notification'], ['mail', 'New Mail'], ['bell', 'Alert'], ['error', 'Error'], ['device-added', 'Device Added']].map(([id, label]) => `<button class="set-btn" data-sound="${id}">${label}</button>`).join('')}</div>`;
    const range = box.querySelector('input[type="range"]');
    range.addEventListener('input', () => {
      state.volume = Number(range.value);
      box.querySelector('output').textContent = range.value;
      ctx.root.querySelector('.qs-volume input').value = range.value;
    });
    range.addEventListener('change', () => {
      bump();
      ctx.sound.play('volume');
    });
    box.addEventListener('click', (event) => {
      const test = event.target.closest('[data-sound]');
      if (event.target.closest('[data-switch="sounds"]')) {
        state.sounds = !state.sounds;
        bump();
        refresh();
      } else if (test) {
        ctx.sound.play(test.dataset.sound, { force: true });
      }
    });
  };

  const timePanel = (page, { refresh }) => {
    const box = mount(page);
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    box.innerHTML = `<h2>Date &amp; Time</h2>
      <div class="boxed">
        ${row('Time zone', `<span class="dim">${escapeHtml(zone)}</span>`, 'Taken from your browser')}
        ${row('24-hour time', switchHtml(state.clock24, 'clock24', '24-hour time'))}
        ${row('Show seconds', switchHtml(state.showSeconds, 'seconds', 'Show seconds'))}
        ${row('Show date in the top bar', switchHtml(state.showDate, 'date', 'Show date'))}
      </div>`;
    box.addEventListener('click', (event) => {
      const toggle = event.target.closest('[data-switch]');
      if (!toggle) return;
      const map = { clock24: 'clock24', seconds: 'showSeconds', date: 'showDate' };
      const field = map[toggle.dataset.switch];
      if (!field) return;
      state[field] = !state[field];
      ctx.tick();
      bump();
      refresh();
    });
  };

  const appSchemas = [
    { id: 'files', label: 'Files', icon: 'files.svg', core: true, options: [{ key: 'showHidden', type: 'switch', label: 'Show hidden files' }, { key: 'defaultView', type: 'select', label: 'Default view', choices: [['grid', 'Icons'], ['list', 'List']] }] },
    { id: 'terminal', label: 'Terminal', icon: 'org.gnome.Ptyxis.png', core: true, options: [{ key: 'fontSize', type: 'range', label: 'Font size', min: 10, max: 24 }, { key: 'scheme', type: 'select', label: 'Colour scheme', choices: [['default', 'lambda'], ['black', 'Black'], ['light', 'Light']] }], files: [['~/.bashrc', `${HOME}/.bashrc`]] },
    { id: 'text-editor', label: 'Text Editor', icon: 'text-editor.svg', core: true, options: [{ key: 'fontSize', type: 'range', label: 'Font size', min: 9, max: 32 }, { key: 'wordWrap', type: 'switch', label: 'Wrap long lines' }] },
    { id: 'mail', label: 'Mail', icon: 'mail.png', core: true, options: [{ key: 'newMailNotifications', type: 'switch', label: 'Notify me about new mail' }] },
    { id: 'rhythmbox', label: 'Music Player', icon: 'rhythmbox.png', store: 'music', options: [{ key: 'volume', type: 'range', label: 'Volume', min: 0, max: 100, scale: 100 }, { key: 'shuffle', type: 'switch', label: 'Shuffle' }, { key: 'repeat', type: 'switch', label: 'Repeat' }] },
    { id: 'paint', label: 'Paint', icon: 'paint.png', store: 'paint', options: [{ key: 'color', type: 'color', label: 'Starting colour' }, { key: 'size', type: 'range', label: 'Starting brush size', min: 1, max: 64 }] },
    { id: 'clocks', label: 'Clocks', icon: 'clocks.png', store: 'clocks', options: [{ key: 'hour24', type: 'switch', label: '24-hour time' }] },
    { id: 'calculator', label: 'Calculator', icon: 'calculator.png', store: 'calculator', options: [{ key: 'mode', type: 'select', label: 'Mode', choices: [['basic', 'Basic'], ['scientific', 'Scientific']] }] },
    { id: 'nano', label: 'nano', icon: 'nano.png', store: 'nano', options: [], files: [['~/.nanorc', `${HOME}/.nanorc`]] },
    { id: 'peaclock', label: 'peaclock', icon: 'cli-terminal.png', store: 'peaclock', options: [], files: [['~/.config/peaclock/config', `${HOME}/.config/peaclock/config`]] },
    { id: 'fastfetch', label: 'fastfetch', icon: 'lambda', store: 'fastfetch', options: [], files: [['~/.config/fastfetch/config.jsonc', `${HOME}/.config/fastfetch/config.jsonc`]] },
  ];

  const applicationsPanel = (page, { refresh }) => {
    const box = mount(page);
    const visible = appSchemas.filter((schema) => schema.core || ctx.installed.has(schema.store));
    const control = (schema, option, value) => {
      const id = `${schema.id}.${option.key}`;
      if (option.type === 'switch') return `<button class="switch${value ? ' on' : ''}" role="switch" aria-checked="${value}" aria-label="${option.label}" data-opt="${id}"></button>`;
      if (option.type === 'range') {
        const shown = option.scale ? Math.round(value * option.scale) : value;
        return `<span class="row-ctl"><input type="range" min="${option.min}" max="${option.max}" value="${shown}" data-opt="${id}" aria-label="${option.label}"><output>${shown}</output></span>`;
      }
      if (option.type === 'color') return `<input type="color" value="${escapeHtml(value)}" data-opt="${id}" aria-label="${option.label}">`;
      return `<select data-opt="${id}" aria-label="${option.label}">${option.choices.map(([choice, label]) => `<option value="${choice}"${choice === value ? ' selected' : ''}>${label}</option>`).join('')}</select>`;
    };
    box.innerHTML = `<h2>Applications</h2><p class="set-note">Each app keeps its settings in a file under <code>~/.config</code>. Change them here or edit the files yourself.</p>
      ${visible
        .map((schema) => {
          const values = schema.options.length ? system.config(schema.id, system.defaults[schema.id]) : {};
          const rows = schema.options.map((option) => row(option.label, control(schema, option, values[option.key]))).join('');
          const files = [...(schema.options.length ? [[`~/.config/${schema.id}/settings.json`, system.configPath(schema.id)]] : []), ...(schema.files || [])]
            .map(([label, path]) => `<button class="set-btn small" data-open="${escapeHtml(path)}">Open ${escapeHtml(label)}</button>`)
            .join('');
          return `<section class="set-app-card"><header>${ctx.icon('apps', schema.icon, 'set-app-icon')}<strong>${escapeHtml(schema.label)}</strong></header>${rows ? `<div class="boxed">${rows}</div>` : ''}${files ? `<div class="set-actions">${files}</div>` : ''}</section>`;
        })
        .join('')}`;
    const update = (target) => {
      const [appId, key] = target.dataset.opt.split('.');
      const schema = appSchemas.find((item) => item.id === appId);
      const option = schema.options.find((item) => item.key === key);
      const values = system.config(appId, system.defaults[appId]);
      if (option.type === 'switch') values[key] = !values[key];
      else if (option.type === 'range') values[key] = option.scale ? Number(target.value) / option.scale : Number(target.value);
      else values[key] = target.value;
      system.saveConfig(appId, values);
    };
    box.addEventListener('click', (event) => {
      const toggle = event.target.closest('button[data-opt]');
      const open = event.target.closest('[data-open]');
      if (toggle) {
        update(toggle);
        refresh();
      } else if (open) {
        ctx.openEditor(open.dataset.open);
      }
    });
    box.addEventListener('input', (event) => {
      const target = event.target;
      if (target.type === 'range') target.nextElementSibling.textContent = target.value;
    });
    box.addEventListener('change', (event) => {
      if (event.target.matches('input[data-opt], select[data-opt]')) update(event.target);
    });
  };

  const aboutPanel = (page, { refresh }) => {
    const box = mount(page);
    const hw = system.hw;
    const seconds = system.uptimeSeconds();
    const uptime = seconds < 90 ? `${seconds} seconds` : seconds < 5400 ? `${Math.round(seconds / 60)} minutes` : `${(seconds / 3600).toFixed(1)} hours`;
    const storage = hw.storage;
    box.innerHTML = `${ctx.icon('apps', 'lambda', 'about-logo')}
      <div class="boxed">
        ${row('Device name', `<form class="set-host"><input type="text" value="${escapeHtml(HOSTNAME)}" maxlength="31" spellcheck="false" autocomplete="off" aria-label="Device name"><button class="set-btn small" type="submit">Rename</button></form>`)}
        ${row('Signed in as', `<span class="dim">${escapeHtml(USER)}</span>`)}
        ${row('OS name', '<span class="dim">lambdawebOS 1.0</span>')}
        ${row('OS type', `<span class="dim">${hw.arch === 'aarch64' ? '64-bit ARM' : '64-bit'}</span>`)}
        ${row('Uptime', `<span class="dim">${uptime}</span>`)}
      </div>
      <h2>Hardware</h2>
      <div class="boxed">
        ${row('Running on', `<span class="dim">${escapeHtml(hw.host)}</span>`)}
        ${row('Browser', `<span class="dim">${escapeHtml(hw.browser)} (${escapeHtml(hw.engine)})</span>`)}
        ${row('Processor', `<span class="dim">${hw.cores} logical cores</span>`, 'Model name is hidden by browsers')}
        ${row('Graphics', `<span class="dim">${escapeHtml(hw.gpu || 'Not reported')}</span>`)}
        ${row('Memory', `<span class="dim">${hw.memoryGiB ? `${hw.memoryGiB}${hw.memoryGiB === 8 ? '+' : ''} GiB` : 'Not reported'}</span>`)}
        ${row('Browser storage', `<span class="dim">${storage ? `${system.mib(storage.used).toFixed(1)} MiB of ${system.gib(storage.quota).toFixed(1)} GiB used` : 'Not reported'}</span>`)}
        ${row('Display', `<span class="dim">${screen.width} × ${screen.height}</span>`)}
      </div>
      <h2>Reset</h2>
      <div class="set-actions"><button class="set-btn danger" data-act="reset">Reset Desktop Settings</button></div>
      <p class="set-note" data-note></p>`;
    const note = box.querySelector('[data-note]');
    box.querySelector('.set-host').addEventListener('submit', (event) => {
      event.preventDefault();
      const value = event.target.querySelector('input').value.trim().toLowerCase();
      if (!/^[a-z][a-z0-9-]{0,30}$/.test(value)) {
        note.textContent = 'Use letters, numbers and hyphens, starting with a letter.';
        return;
      }
      session.setHostname(value);
      note.textContent = 'Device name saved. It takes effect the next time you sign in.';
    });
    let armed = false;
    box.addEventListener('click', (event) => {
      const reset = event.target.closest('[data-act="reset"]');
      if (!reset) return;
      if (!armed) {
        armed = true;
        reset.textContent = 'Click again to confirm';
        return;
      }
      Object.assign(state, { theme: 'dark', accent: '#7764d8', wallpaper: 'default', showTrash: true, sounds: true, volume: 60, dockPosition: 'left', dockIcon: 40, clock24: true, showSeconds: false, showDate: true, animations: true });
      ctx.applyDock();
      ctx.applyWallpaper();
      ctx.applyTheme();
      ctx.tick();
      ctx.windows.forEach((win) => win.refresh && win.refresh());
      notify({ title: 'Settings reset', body: 'Your desktop settings are back to their defaults.', iconName: 'settings.svg', sound: null });
    });
  };

  ctx.settings = {
    panels: () => [
      { id: 'wifi', label: 'Wi-Fi', icon: 'network-wireless', render: wifiPanel },
      ...(ctx.network.bluetooth.supported ? [{ id: 'bluetooth', label: 'Bluetooth', icon: 'bluetooth', render: bluetoothPanel }] : []),
      { id: 'background', label: 'Background', icon: 'preferences-desktop-wallpaper', render: backgroundPanel },
      { id: 'appearance', label: 'Appearance', icon: 'preferences-desktop-appearance', render: appearancePanel },
      { id: 'dock', label: 'Desktop', icon: 'user-desktop', render: desktopPanel },
      { id: 'sound', label: 'Sound', icon: 'audio-volume-high', render: soundPanel },
      { id: 'datetime', label: 'Date & Time', icon: 'document-open-recent', render: timePanel },
      { id: 'apps', label: 'Applications', icon: 'view-grid', render: applicationsPanel },
      { id: 'about', label: 'About', icon: 'help-about', render: aboutPanel },
    ],
  };
};
