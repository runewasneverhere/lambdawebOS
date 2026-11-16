window.lambdawebMedia = (ctx) => {
  const { root, windows, createWindow, notify, fs, sym, setSym, escapeHtml, apps, registerOpener, isImageData, HOME } = ctx;

  const ARTIST = 'Aphex Twin';
  const MAX_SIDE = 1600;

  const formatBytes = (bytes) => (bytes < 1000 ? `${bytes} bytes` : bytes < 1000000 ? `${(bytes / 1000).toFixed(1)} kB` : `${(bytes / 1000000).toFixed(1)} MB`);
  const formatTime = (seconds) => {
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
    return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
  };
  const loadImage = (src) =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('That image could not be read.'));
      img.src = src;
    });
  const writable = (path) => path === HOME || path.startsWith(`${HOME}/`) || path === '/tmp' || path.startsWith('/tmp/');
  const folderOf = (path) => fs.split(path).dir;
  const imagesIn = (dir) => {
    try {
      return fs.entries(dir).filter((entry) => entry.node.type === 'file' && isImageData(entry.node.content));
    } catch (error) {
      return [];
    }
  };
  const setTitle = (win, text) => {
    const title = win.heading.querySelector('.uwin-title');
    if (title) title.textContent = text;
  };
  const sendImage = (payload) => {
    if (ctx.mail && ctx.mail.sendImage) ctx.mail.sendImage(payload);
    else notify({ title: 'Mail is not available', body: 'Sign in to send pictures.', iconName: 'mail.png' });
  };

  const fileDialog = ({ mode, title, dir, name = '', accept = () => true }) =>
    new Promise((resolve) => {
      let current = dir && fs.isDir(dir) ? dir : HOME;
      let chosen = null;
      let replacing = false;
      const overlay = document.createElement('div');
      overlay.className = 'ud-overlay';
      overlay.tabIndex = -1;
      overlay.innerHTML = `
        <div class="ud-dialog" role="dialog" aria-label="${escapeHtml(title)}">
          <h3>${escapeHtml(title)}</h3>
          ${mode === 'save' ? '<input class="ud-name" type="text" spellcheck="false" maxlength="100" aria-label="File name">' : ''}
          <div class="ud-path"><button class="ud-btn" data-act="up" aria-label="Parent folder">${sym('go-up')}</button><span class="ud-where"></span></div>
          <ul class="ud-list"></ul>
          <p class="ud-error" role="alert"></p>
          <div class="ud-foot">
            ${mode === 'save' ? '<button class="ud-btn" data-act="new">New Folder</button>' : ''}
            <span class="ud-spacer"></span>
            <button class="ud-btn" data-act="cancel">Cancel</button>
            <button class="ud-btn primary" data-act="ok"${mode === 'open' ? ' disabled' : ''}>${mode === 'save' ? 'Save' : 'Open'}</button>
          </div>
        </div>`;
      root.append(overlay);
      const list = overlay.querySelector('.ud-list');
      const where = overlay.querySelector('.ud-where');
      const field = overlay.querySelector('.ud-name');
      const error = overlay.querySelector('.ud-error');
      const ok = overlay.querySelector('[data-act="ok"]');
      if (field) field.value = name;

      const finish = (value) => {
        overlay.remove();
        resolve(value);
      };
      const resetReplace = () => {
        replacing = false;
        if (mode === 'save') ok.textContent = 'Save';
      };

      const draw = () => {
        where.textContent = current;
        let entries = [];
        try {
          entries = fs.entries(current);
        } catch (failure) {
          entries = [];
        }
        entries.sort((a, b) => (a.node.type === b.node.type ? 0 : a.node.type === 'dir' ? -1 : 1));
        list.innerHTML =
          entries
            .map((entry) => {
              const dirItem = entry.node.type === 'dir';
              const usable = dirItem || (mode === 'open' ? accept(entry.name, entry.node) : false);
              const thumb = !dirItem && isImageData(entry.node.content) ? `<img class="ud-thumb" src="${entry.node.content}" alt="" draggable="false">` : `<span class="ud-kind">${dirItem ? '📁' : '📄'}</span>`;
              return `<li class="${dirItem ? 'dir' : 'file'}${usable ? '' : ' muted'}${chosen === entry.path ? ' chosen' : ''}" data-path="${escapeHtml(entry.path)}" data-name="${escapeHtml(entry.name)}">${thumb}<span>${escapeHtml(entry.name)}</span></li>`;
            })
            .join('') || '<li class="empty">Empty folder</li>';
      };

      const confirm = () => {
        error.textContent = '';
        if (mode === 'open') {
          if (chosen) finish(chosen);
          return;
        }
        const typed = field.value.trim().replace(/[\\/]/g, '-');
        if (!typed || typed === '.' || typed === '..') return;
        if (!writable(current)) {
          error.textContent = `You can't save in ${current}.`;
          return;
        }
        const target = fs.join(current, typed);
        const existing = fs.get(target);
        if (existing && existing.type === 'dir') {
          error.textContent = 'There is a folder with that name.';
          return;
        }
        if (existing && !replacing) {
          replacing = true;
          ok.textContent = 'Replace';
          error.textContent = `"${typed}" already exists. Replace it?`;
          return;
        }
        finish(target);
      };

      list.addEventListener('click', (event) => {
        const item = event.target.closest('li[data-path]');
        if (!item || item.classList.contains('muted')) return;
        resetReplace();
        error.textContent = '';
        if (item.classList.contains('dir')) {
          current = item.dataset.path;
          chosen = null;
          if (mode === 'open') ok.disabled = true;
        } else if (mode === 'open') {
          chosen = item.dataset.path;
          ok.disabled = false;
        } else if (field) {
          field.value = item.dataset.name;
        }
        draw();
      });
      list.addEventListener('dblclick', (event) => {
        const item = event.target.closest('li.file[data-path]');
        if (mode === 'open' && item && !item.classList.contains('muted')) finish(item.dataset.path);
      });
      overlay.addEventListener('click', (event) => {
        if (event.target === overlay) finish(null);
        const act = event.target.closest('[data-act]');
        if (!act) return;
        if (act.dataset.act === 'cancel') {
          finish(null);
        } else if (act.dataset.act === 'ok') {
          confirm();
        } else if (act.dataset.act === 'up') {
          if (current !== '/') current = folderOf(current);
          chosen = null;
          if (mode === 'open') ok.disabled = true;
          resetReplace();
          draw();
        } else if (act.dataset.act === 'new') {
          if (!writable(current)) {
            error.textContent = `You can't create folders in ${current}.`;
            return;
          }
          try {
            fs.mkdir(fs.join(current, fs.unique(current, 'Untitled Folder')));
          } catch (failure) {
            error.textContent = failure.message;
          }
          draw();
        }
      });
      overlay.addEventListener('keydown', (event) => {
        event.stopPropagation();
        if (event.key === 'Escape') finish(null);
        else if (event.key === 'Enter' && mode === 'save') confirm();
      });
      if (field) {
        field.addEventListener('input', resetReplace);
        field.focus();
        const dot = field.value.lastIndexOf('.');
        field.setSelectionRange(0, dot > 0 ? dot : field.value.length);
      } else {
        overlay.focus();
      }
      draw();
    });
  ctx.fileDialog = fileDialog;

  function openViewer(path) {
    const known = windows.find((win) => win.app === 'viewer' && win.path === path);
    if (known) {
      known.focus();
      return known;
    }
    const node = fs.get(path);
    if (!node || node.type !== 'file' || !isImageData(node.content)) return null;
    const win = createWindow({ app: 'viewer', title: fs.split(path).name, width: 780, height: 560, minWidth: 380, minHeight: 300, className: 'is-viewer' });
    win.path = path;
    win.body.innerHTML = `
      <div class="iv">
        <div class="iv-bar">
          <button class="iv-btn" data-act="prev" aria-label="Previous image">${sym('go-previous')}</button>
          <button class="iv-btn" data-act="next" aria-label="Next image">${sym('go-next')}</button>
          <span class="iv-spacer"></span>
          <button class="iv-btn" data-act="out" aria-label="Zoom out">${sym('zoom-out')}</button>
          <button class="iv-btn iv-zoom" data-act="fit" aria-label="Fit to window">100%</button>
          <button class="iv-btn" data-act="in" aria-label="Zoom in">${sym('zoom-in')}</button>
          <button class="iv-btn" data-act="actual" aria-label="Actual size">${sym('zoom-original')}</button>
          <span class="iv-spacer"></span>
          <button class="iv-btn labelled" data-act="paint">Edit in Paint</button>
          <button class="iv-btn labelled" data-act="send">${sym('mail-send')}<span>Send</span></button>
        </div>
        <div class="iv-stage"><img class="iv-img" alt="" draggable="false"></div>
        <div class="iv-status"></div>
      </div>`;
    const stage = win.body.querySelector('.iv-stage');
    const img = win.body.querySelector('.iv-img');
    const status = win.body.querySelector('.iv-status');
    const zoomLabel = win.body.querySelector('.iv-zoom');
    const prevBtn = win.body.querySelector('[data-act="prev"]');
    const nextBtn = win.body.querySelector('[data-act="next"]');
    let scale = null;

    const applyScale = () => {
      if (!img.naturalWidth) return;
      if (scale === null) {
        stage.classList.remove('zoomed');
        img.style.width = '';
        img.style.height = '';
        const fit = Math.min(1, Math.min(stage.clientWidth / img.naturalWidth, stage.clientHeight / img.naturalHeight));
        zoomLabel.textContent = `${Math.round((fit || 1) * 100)}%`;
      } else {
        stage.classList.add('zoomed');
        img.style.width = `${img.naturalWidth * scale}px`;
        img.style.height = `${img.naturalHeight * scale}px`;
        zoomLabel.textContent = `${Math.round(scale * 100)}%`;
      }
      img.classList.toggle('pixels', scale !== null && scale >= 2);
    };

    const show = () => {
      const current = fs.get(win.path);
      if (!current || !isImageData(current.content)) return;
      img.onload = () => {
        status.textContent = `${img.naturalWidth} × ${img.naturalHeight} · ${formatBytes(fs.size(current))}`;
        applyScale();
      };
      img.src = current.content;
      setTitle(win, fs.split(win.path).name);
      const siblings = imagesIn(folderOf(win.path));
      prevBtn.disabled = nextBtn.disabled = siblings.length < 2;
    };

    const step = (direction) => {
      const siblings = imagesIn(folderOf(win.path));
      if (siblings.length < 2) return;
      const at = siblings.findIndex((entry) => entry.path === win.path);
      win.path = siblings[(at + direction + siblings.length) % siblings.length].path;
      scale = null;
      show();
    };
    const zoomBy = (factor) => {
      const base = scale === null ? Math.min(1, Math.min(stage.clientWidth / img.naturalWidth, stage.clientHeight / img.naturalHeight)) : scale;
      scale = Math.max(0.05, Math.min(16, base * factor));
      applyScale();
    };

    win.body.addEventListener('click', (event) => {
      const act = event.target.closest('[data-act]');
      if (!act || act.disabled) return;
      const action = act.dataset.act;
      if (action === 'prev') step(-1);
      else if (action === 'next') step(1);
      else if (action === 'in') zoomBy(1.25);
      else if (action === 'out') zoomBy(0.8);
      else if (action === 'fit') {
        scale = null;
        applyScale();
      } else if (action === 'actual') {
        scale = 1;
        applyScale();
      } else if (action === 'paint') {
        if (apps.paint) openPaint(win.path);
        else notify({ title: 'Paint is not installed', body: 'Get it from the App Center.', iconName: 'paint.png' });
      } else if (action === 'send') sendImage({ dataUrl: img.src, name: fs.split(win.path).name });
    });
    stage.addEventListener(
      'wheel',
      (event) => {
        if (!event.ctrlKey) return;
        event.preventDefault();
        zoomBy(event.deltaY < 0 ? 1.1 : 0.9);
      },
      { passive: false }
    );
    win.body.tabIndex = 0;
    win.body.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowLeft') step(-1);
      else if (event.key === 'ArrowRight') step(1);
      else if (event.key === '+' || event.key === '=') zoomBy(1.25);
      else if (event.key === '-') zoomBy(0.8);
      else if (event.key === '0') {
        scale = null;
        applyScale();
      }
    });
    const resize = new ResizeObserver(() => {
      if (scale === null) applyScale();
    });
    resize.observe(stage);
    const off = fs.onChange(() => {
      const current = fs.get(win.path);
      if (!current || !isImageData(current.content)) {
        const siblings = imagesIn(folderOf(win.path));
        if (siblings.length) {
          win.path = siblings[0].path;
          show();
        } else {
          win.close();
        }
        return;
      }
      if (img.src !== current.content) show();
    });
    win.onClose = () => {
      off();
      resize.disconnect();
    };
    show();
    return win;
  }

  registerOpener((path, node) => isImageData(node.content), openViewer);
  apps.viewer = { label: 'Image Viewer', icon: 'image-viewer.png', launch: () => openImagePicker() };

  async function openImagePicker() {
    const pictures = `${HOME}/Pictures`;
    const path = await fileDialog({ mode: 'open', title: 'Open Image', dir: fs.isDir(pictures) ? pictures : HOME, accept: (name, node) => isImageData(node.content) });
    if (path) openViewer(path);
  }

  const PALETTE = [
    '#000000', '#7f7f7f', '#880015', '#ed1c24', '#ff7f27', '#fff200', '#22b14c', '#00a2e8', '#3f48cc', '#a349a4',
    '#ffffff', '#c3c3c3', '#b97a57', '#ffaec9', '#ffc90e', '#efe4b0', '#b5e61d', '#99d9ea', '#7092be', '#c8bfe7',
  ];
  const TOOLS = [
    ['pencil', 'Pencil'],
    ['brush', 'Brush'],
    ['eraser', 'Eraser'],
    ['fill', 'Fill'],
    ['picker', 'Picker'],
    ['line', 'Line'],
    ['rect', 'Rectangle'],
    ['ellipse', 'Ellipse'],
  ];

  const hexToRgba = (hex) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16), 255];
  const toHex = (r, g, b) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;

  const floodFill = (canvas, startX, startY, hex) => {
    const c = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    const x0 = Math.floor(startX);
    const y0 = Math.floor(startY);
    if (x0 < 0 || y0 < 0 || x0 >= w || y0 >= h) return false;
    const image = c.getImageData(0, 0, w, h);
    const d = image.data;
    const at = (y0 * w + x0) * 4;
    const target = [d[at], d[at + 1], d[at + 2], d[at + 3]];
    const paint = hexToRgba(hex);
    const tolerance = 24;
    if (target.every((value, i) => Math.abs(value - paint[i]) <= tolerance)) return false;
    const match = (i) => Math.abs(d[i] - target[0]) <= tolerance && Math.abs(d[i + 1] - target[1]) <= tolerance && Math.abs(d[i + 2] - target[2]) <= tolerance && Math.abs(d[i + 3] - target[3]) <= tolerance;
    const stack = [[x0, y0]];
    while (stack.length) {
      let [x, y] = stack.pop();
      let i = (y * w + x) * 4;
      while (x >= 0 && match(i)) {
        x -= 1;
        i -= 4;
      }
      x += 1;
      i += 4;
      let above = false;
      let below = false;
      while (x < w && match(i)) {
        d[i] = paint[0];
        d[i + 1] = paint[1];
        d[i + 2] = paint[2];
        d[i + 3] = 255;
        if (y > 0) {
          const hit = match(i - w * 4);
          if (hit && !above) {
            stack.push([x, y - 1]);
            above = true;
          } else if (!hit) {
            above = false;
          }
        }
        if (y < h - 1) {
          const hit = match(i + w * 4);
          if (hit && !below) {
            stack.push([x, y + 1]);
            below = true;
          } else if (!hit) {
            below = false;
          }
        }
        x += 1;
        i += 4;
      }
    }
    c.putImageData(image, 0, 0);
    return true;
  };

  function openPaint(startPath) {
    const reuse = startPath && windows.find((win) => win.app === 'paint' && win.path === startPath);
    if (reuse) {
      reuse.focus();
      return reuse;
    }
    const win = createWindow({ app: 'paint', title: 'Untitled', width: 940, height: 640, minWidth: 560, minHeight: 380, className: 'is-paint' });
    win.path = null;
    win.body.innerHTML = `
      <div class="pt" tabindex="0">
        <div class="pt-bar">
          <button class="pt-btn" data-act="new" title="New (Ctrl+N)">${sym('document-new')}<span>New</span></button>
          <button class="pt-btn" data-act="open" title="Open (Ctrl+O)">${sym('document-open')}<span>Open</span></button>
          <button class="pt-btn" data-act="save" title="Save (Ctrl+S)">${sym('document-save')}<span>Save</span></button>
          <button class="pt-btn" data-act="saveas" title="Save As">${sym('document-save-as')}<span>Save As</span></button>
          <span class="pt-sep"></span>
          <button class="pt-btn icon" data-act="undo" title="Undo (Ctrl+Z)" aria-label="Undo">${sym('edit-undo')}</button>
          <button class="pt-btn icon" data-act="redo" title="Redo (Ctrl+Y)" aria-label="Redo">${sym('edit-redo')}</button>
          <span class="pt-spacer"></span>
          <button class="pt-btn" data-act="send" title="Send with Mail">${sym('mail-send')}<span>Send</span></button>
        </div>
        <div class="pt-main">
          <div class="pt-tools">
            <div class="pt-toolgrid">${TOOLS.map(([id, label]) => `<button class="pt-tool" data-tool="${id}">${label}</button>`).join('')}</div>
            <label class="pt-field">Size <b class="pt-sizeval">4</b><input class="pt-size" type="range" min="1" max="40" value="4"></label>
            <label class="pt-check"><input class="pt-filled" type="checkbox"> Fill shapes</label>
          </div>
          <div class="pt-canvaswrap"><div class="pt-sheet"><canvas class="pt-canvas"></canvas><canvas class="pt-overlay"></canvas></div></div>
        </div>
        <div class="pt-colors">
          <div class="pt-current"><span class="pt-primary" title="Left click color"></span><span class="pt-secondary" title="Right click color"></span></div>
          <div class="pt-palette">${PALETTE.map((color) => `<button class="pt-swatch" data-color="${color}" style="background:${color}" aria-label="${color}"></button>`).join('')}</div>
          <label class="pt-custom" title="Custom color">Custom<input class="pt-picker" type="color" value="#000000"></label>
        </div>
        <div class="pt-status"></div>
        <div class="pt-layer" hidden></div>
      </div>`;
    const canvas = win.body.querySelector('.pt-canvas');
    const overlay = win.body.querySelector('.pt-overlay');
    const c = canvas.getContext('2d', { willReadFrequently: true });
    const o = overlay.getContext('2d');
    const layer = win.body.querySelector('.pt-layer');
    const status = win.body.querySelector('.pt-status');
    const sizeInput = win.body.querySelector('.pt-size');
    const sizeValue = win.body.querySelector('.pt-sizeval');
    const filledInput = win.body.querySelector('.pt-filled');
    const primaryEl = win.body.querySelector('.pt-primary');
    const secondaryEl = win.body.querySelector('.pt-secondary');
    const colorInput = win.body.querySelector('.pt-picker');
    const undoBtn = win.body.querySelector('[data-act="undo"]');
    const redoBtn = win.body.querySelector('[data-act="redo"]');
    const toolButtons = [...win.body.querySelectorAll('.pt-tool')];
    const surface = win.body.querySelector('.pt');

    const paintConfig = ctx.system.config('paint', ctx.system.defaults.paint);
    sizeInput.value = String(Math.min(Number(sizeInput.max) || 64, Math.max(Number(sizeInput.min) || 1, Math.round(paintConfig.size))));
    const state = { tool: 'brush', primary: /^#[0-9a-f]{6}$/i.test(paintConfig.color) ? paintConfig.color : '#000000', secondary: '#ffffff', dirty: false, undo: [], redo: [] };

    const historyLimit = () => Math.max(6, Math.min(30, Math.floor(40e6 / (canvas.width * canvas.height * 4))));
    const snapshot = () => c.getImageData(0, 0, canvas.width, canvas.height);
    const refreshState = () => {
      undoBtn.disabled = !state.undo.length;
      redoBtn.disabled = !state.redo.length;
      toolButtons.forEach((button) => button.classList.toggle('active', button.dataset.tool === state.tool));
      primaryEl.style.background = state.primary;
      secondaryEl.style.background = state.secondary;
      const name = win.path ? fs.split(win.path).name : 'Untitled';
      setTitle(win, `${state.dirty ? '• ' : ''}${name}`);
      status.textContent = `${canvas.width} × ${canvas.height}px${win.path ? ` · ${win.path.replace(HOME, '~')}` : ''}`;
    };
    const markDirty = () => {
      state.dirty = true;
      refreshState();
    };
    const pushUndo = () => {
      state.undo.push(snapshot());
      if (state.undo.length > historyLimit()) state.undo.shift();
      state.redo = [];
    };
    const sizeCanvas = (width, height) => {
      canvas.width = overlay.width = width;
      canvas.height = overlay.height = height;
      c.fillStyle = '#ffffff';
      c.fillRect(0, 0, width, height);
    };
    const reset = (width, height) => {
      sizeCanvas(width, height);
      state.undo = [];
      state.redo = [];
      state.dirty = false;
      win.path = null;
      refreshState();
    };

    const closeLayer = () => {
      layer.hidden = true;
      layer.innerHTML = '';
    };
    const ask = (html, wire) => {
      layer.hidden = false;
      layer.innerHTML = `<div class="ud-dialog pt-dialog" role="dialog">${html}</div>`;
      wire(layer.querySelector('.pt-dialog'));
    };

    const loadFrom = async (path) => {
      const node = fs.get(path);
      if (!node || !isImageData(node.content)) return;
      try {
        const image = await loadImage(node.content);
        const scale = Math.min(1, MAX_SIDE / image.naturalWidth, MAX_SIDE / image.naturalHeight);
        reset(Math.max(1, Math.round(image.naturalWidth * scale)), Math.max(1, Math.round(image.naturalHeight * scale)));
        c.drawImage(image, 0, 0, canvas.width, canvas.height);
        win.path = path;
        refreshState();
      } catch (error) {
        notify({ title: 'Could not open image', body: error.message, iconName: 'paint.png' });
      }
    };

    const pickFolder = () => {
      const pictures = `${HOME}/Pictures`;
      return fs.isDir(pictures) ? pictures : HOME;
    };
    const writeTo = (path) => {
      try {
        fs.write(path, canvas.toDataURL('image/png'));
        win.path = path;
        state.dirty = false;
        refreshState();
        notify({ title: 'Image saved', body: path.replace(HOME, '~'), iconName: 'paint.png' });
        return true;
      } catch (error) {
        notify({ title: 'Could not save', body: error.message, iconName: 'paint.png' });
        return false;
      }
    };
    const saveAs = async () => {
      const folder = win.path ? folderOf(win.path) : pickFolder();
      const base = win.path ? fs.split(win.path).name : fs.unique(folder, 'Untitled.png');
      let target = await fileDialog({ mode: 'save', title: 'Save Image', dir: folder, name: base });
      if (!target) return false;
      if (!/\.png$/i.test(target)) target += '.png';
      return writeTo(target);
    };
    const save = async () => {
      if (win.path && fs.get(win.path)) return writeTo(win.path);
      return saveAs();
    };
    const openFromDisk = async () => {
      const path = await fileDialog({ mode: 'open', title: 'Open Image', dir: pickFolder(), accept: (name, node) => isImageData(node.content) });
      if (path) loadFrom(path);
    };

    const newImage = () => {
      ask(
        `<h3>New image</h3>
         ${state.dirty ? '<p class="ud-error">Unsaved changes will be lost.</p>' : ''}
         <div class="pt-dims"><label>Width<input class="ud-name" name="w" type="number" min="16" max="${MAX_SIDE}" value="${canvas.width}"></label><label>Height<input class="ud-name" name="h" type="number" min="16" max="${MAX_SIDE}" value="${canvas.height}"></label></div>
         <div class="ud-foot"><span class="ud-spacer"></span><button class="ud-btn" data-x="cancel">Cancel</button><button class="ud-btn primary" data-x="ok">Create</button></div>`,
        (dialog) => {
          dialog.querySelector('[data-x="cancel"]').addEventListener('click', closeLayer);
          dialog.querySelector('[data-x="ok"]').addEventListener('click', () => {
            const w = Math.max(16, Math.min(MAX_SIDE, parseInt(dialog.querySelector('[name="w"]').value, 10) || 800));
            const h = Math.max(16, Math.min(MAX_SIDE, parseInt(dialog.querySelector('[name="h"]').value, 10) || 520));
            closeLayer();
            reset(w, h);
          });
        }
      );
    };

    const undo = () => {
      if (!state.undo.length) return;
      state.redo.push(snapshot());
      c.putImageData(state.undo.pop(), 0, 0);
      state.dirty = true;
      refreshState();
    };
    const redo = () => {
      if (!state.redo.length) return;
      state.undo.push(snapshot());
      c.putImageData(state.redo.pop(), 0, 0);
      state.dirty = true;
      refreshState();
    };

    const pointFrom = (event) => {
      const rect = canvas.getBoundingClientRect();
      return { x: ((event.clientX - rect.left) * canvas.width) / rect.width, y: ((event.clientY - rect.top) * canvas.height) / rect.height };
    };
    const brushWidth = () => (state.tool === 'pencil' ? 1 : Number(sizeInput.value));

    const strokeStyle = (target, color) => {
      target.strokeStyle = color;
      target.fillStyle = color;
      target.lineWidth = brushWidth();
      target.lineCap = 'round';
      target.lineJoin = 'round';
    };
    const dot = (target, p, color) => {
      target.fillStyle = color;
      target.beginPath();
      target.arc(p.x, p.y, Math.max(0.5, brushWidth() / 2), 0, Math.PI * 2);
      target.fill();
    };
    const drawShape = (target, tool, a, b, color, shift) => {
      let end = b;
      if (shift && tool !== 'line') {
        const size = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
        end = { x: a.x + Math.sign(b.x - a.x || 1) * size, y: a.y + Math.sign(b.y - a.y || 1) * size };
      } else if (shift) {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
        const length = Math.hypot(dx, dy);
        end = { x: a.x + Math.cos(angle) * length, y: a.y + Math.sin(angle) * length };
      }
      strokeStyle(target, color);
      target.lineWidth = Number(sizeInput.value);
      target.beginPath();
      if (tool === 'line') {
        target.moveTo(a.x, a.y);
        target.lineTo(end.x, end.y);
        target.stroke();
        return;
      }
      if (tool === 'rect') target.rect(Math.min(a.x, end.x), Math.min(a.y, end.y), Math.abs(end.x - a.x), Math.abs(end.y - a.y));
      else target.ellipse((a.x + end.x) / 2, (a.y + end.y) / 2, Math.abs(end.x - a.x) / 2, Math.abs(end.y - a.y) / 2, 0, 0, Math.PI * 2);
      if (filledInput.checked) target.fill();
      else target.stroke();
    };

    let drag = null;
    const colorFor = (button) => (button === 2 ? state.secondary : state.primary);

    canvas.parentElement.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 && event.button !== 2) return;
      event.preventDefault();
      surface.focus();
      const p = pointFrom(event);
      const color = colorFor(event.button);
      if (state.tool === 'picker') {
        const pixel = c.getImageData(Math.max(0, Math.min(canvas.width - 1, Math.floor(p.x))), Math.max(0, Math.min(canvas.height - 1, Math.floor(p.y))), 1, 1).data;
        const picked = toHex(pixel[0], pixel[1], pixel[2]);
        if (event.button === 2) state.secondary = picked;
        else state.primary = picked;
        refreshState();
        return;
      }
      if (state.tool === 'fill') {
        pushUndo();
        if (floodFill(canvas, p.x, p.y, color)) markDirty();
        else state.undo.pop();
        refreshState();
        return;
      }
      pushUndo();
      canvas.parentElement.setPointerCapture(event.pointerId);
      drag = { id: event.pointerId, button: event.button, start: p, last: p, color: state.tool === 'eraser' ? '#ffffff' : color };
      if (state.tool === 'pencil' || state.tool === 'brush' || state.tool === 'eraser') {
        strokeStyle(c, drag.color);
        dot(c, p, drag.color);
      }
    });
    canvas.parentElement.addEventListener('pointermove', (event) => {
      const p = pointFrom(event);
      const readout = `${Math.max(0, Math.min(canvas.width, Math.round(p.x)))}, ${Math.max(0, Math.min(canvas.height, Math.round(p.y)))}`;
      status.textContent = `${canvas.width} × ${canvas.height}px · ${readout}${win.path ? ` · ${win.path.replace(HOME, '~')}` : ''}`;
      if (!drag || event.pointerId !== drag.id) return;
      if (state.tool === 'pencil' || state.tool === 'brush' || state.tool === 'eraser') {
        strokeStyle(c, drag.color);
        c.beginPath();
        c.moveTo(drag.last.x, drag.last.y);
        c.lineTo(p.x, p.y);
        c.stroke();
        drag.last = p;
      } else {
        o.clearRect(0, 0, overlay.width, overlay.height);
        drawShape(o, state.tool, drag.start, p, drag.color, event.shiftKey);
        drag.last = p;
      }
    });
    const endDrag = (event) => {
      if (!drag || event.pointerId !== drag.id) return;
      const finished = drag;
      drag = null;
      if (state.tool === 'line' || state.tool === 'rect' || state.tool === 'ellipse') {
        o.clearRect(0, 0, overlay.width, overlay.height);
        drawShape(c, state.tool, finished.start, pointFrom(event), finished.color, event.shiftKey);
      }
      markDirty();
    };
    canvas.parentElement.addEventListener('pointerup', endDrag);
    canvas.parentElement.addEventListener('pointercancel', endDrag);
    canvas.parentElement.addEventListener('contextmenu', (event) => event.preventDefault());

    win.body.addEventListener('click', (event) => {
      const tool = event.target.closest('[data-tool]');
      if (tool) {
        state.tool = tool.dataset.tool;
        refreshState();
        return;
      }
      const swatch = event.target.closest('[data-color]');
      if (swatch) {
        state.primary = swatch.dataset.color;
        colorInput.value = state.primary;
        refreshState();
        return;
      }
      const act = event.target.closest('[data-act]');
      if (!act || act.disabled) return;
      const action = act.dataset.act;
      if (action === 'new') newImage();
      else if (action === 'open') openFromDisk();
      else if (action === 'save') save();
      else if (action === 'saveas') saveAs();
      else if (action === 'undo') undo();
      else if (action === 'redo') redo();
      else if (action === 'send') sendImage({ dataUrl: canvas.toDataURL('image/png'), name: win.path ? fs.split(win.path).name : 'drawing.png' });
    });
    win.body.addEventListener('contextmenu', (event) => {
      const swatch = event.target.closest('[data-color]');
      if (swatch) {
        event.preventDefault();
        state.secondary = swatch.dataset.color;
        refreshState();
      }
    });
    colorInput.addEventListener('input', () => {
      state.primary = colorInput.value;
      refreshState();
    });
    sizeInput.addEventListener('input', () => {
      sizeValue.textContent = sizeInput.value;
    });
    surface.addEventListener('keydown', (event) => {
      if (event.target.closest('input')) return;
      const ctrl = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (ctrl && key === 'z' && !event.shiftKey) {
        event.preventDefault();
        undo();
      } else if (ctrl && (key === 'y' || (key === 'z' && event.shiftKey))) {
        event.preventDefault();
        redo();
      } else if (ctrl && key === 's') {
        event.preventDefault();
        save();
      } else if (ctrl && key === 'o') {
        event.preventDefault();
        openFromDisk();
      } else if (ctrl && key === 'n') {
        event.preventDefault();
        newImage();
      }
    });

    const closeWindow = win.close;
    win.close = () => {
      if (!state.dirty || layer.hidden === false) {
        closeWindow();
        return;
      }
      ask(
        `<h3>Save changes?</h3><p class="ud-error">Your drawing has unsaved changes.</p>
         <div class="ud-foot"><span class="ud-spacer"></span><button class="ud-btn" data-x="cancel">Cancel</button><button class="ud-btn" data-x="discard">Discard</button><button class="ud-btn primary" data-x="save">Save</button></div>`,
        (dialog) => {
          dialog.querySelector('[data-x="cancel"]').addEventListener('click', closeLayer);
          dialog.querySelector('[data-x="discard"]').addEventListener('click', () => {
            state.dirty = false;
            closeWindow();
          });
          dialog.querySelector('[data-x="save"]').addEventListener('click', async () => {
            closeLayer();
            if (await save()) closeWindow();
          });
        }
      );
    };

    sizeCanvas(800, 520);
    refreshState();
    if (startPath) loadFrom(startPath);
    surface.focus();
    return win;
  }

  const tracks = () => (typeof playlist !== 'undefined' && Array.isArray(playlist) ? playlist : []);
  const deskAudio = new Audio();
  deskAudio.preload = 'none';
  let musicIndex = 0;
  let shuffle = false;
  let repeat = 'all';
  let musicLoaded = false;
  let blobUrl = null;

  const dropBlob = () => {
    if (!blobUrl) return;
    URL.revokeObjectURL(blobUrl);
    blobUrl = null;
  };
  const canSeekTo = (time) => {
    const ranges = deskAudio.seekable;
    for (let i = 0; i < ranges.length; i += 1) {
      if (time >= ranges.start(i) && time <= ranges.end(i)) return true;
    }
    return false;
  };

  const pauseSite = () => {
    if (typeof pauseSitePlayer === 'function') pauseSitePlayer();
  };
  if (typeof audio !== 'undefined' && audio instanceof HTMLAudioElement) {
    audio.addEventListener('play', () => {
      if (!deskAudio.paused) deskAudio.pause();
    });
  }

  function openMusic() {
    const known = windows.find((win) => win.app === 'music');
    if (known) {
      known.focus();
      return known;
    }
    const list = tracks();
    const win = createWindow({ app: 'music', title: 'Music Player', width: 760, height: 540, minWidth: 460, minHeight: 360, className: 'is-music' });
    win.body.innerHTML = `
      <div class="mp">
        <div class="mp-now">
          <img class="mp-cover" alt="" draggable="false">
          <div class="mp-title"></div>
          <div class="mp-artist">${ARTIST}</div>
          <div class="mp-seek"><span class="mp-cur">0:00</span><input class="mp-bar" type="range" min="0" max="1000" value="0" aria-label="Seek"><span class="mp-dur">0:00</span></div>
          <div class="mp-controls">
            <button class="mp-btn small" data-act="shuffle" aria-label="Shuffle">${sym('media-playlist-shuffle')}</button>
            <button class="mp-btn" data-act="prev" aria-label="Previous">${sym('media-skip-backward')}</button>
            <button class="mp-btn big" data-act="play" aria-label="Play">${sym('media-playback-start')}</button>
            <button class="mp-btn" data-act="next" aria-label="Next">${sym('media-skip-forward')}</button>
            <button class="mp-btn small" data-act="repeat" aria-label="Repeat">${sym('media-playlist-repeat')}<i class="mp-one">1</i></button>
          </div>
          <div class="mp-volume">${sym('audio-volume-high')}<input class="mp-vol" type="range" min="0" max="100" value="100" aria-label="Volume"></div>
        </div>
        <ul class="mp-list"></ul>
      </div>`;
    const cover = win.body.querySelector('.mp-cover');
    const title = win.body.querySelector('.mp-title');
    const bar = win.body.querySelector('.mp-bar');
    const cur = win.body.querySelector('.mp-cur');
    const dur = win.body.querySelector('.mp-dur');
    const playBtn = win.body.querySelector('[data-act="play"] .sym');
    const shuffleBtn = win.body.querySelector('[data-act="shuffle"]');
    const repeatBtn = win.body.querySelector('[data-act="repeat"]');
    const vol = win.body.querySelector('.mp-vol');
    const rows = win.body.querySelector('.mp-list');
    let seeking = false;
    const musicConfig = ctx.system.config('rhythmbox', ctx.system.defaults.rhythmbox);
    deskAudio.volume = Math.min(1, Math.max(0, musicConfig.volume));
    shuffle = musicConfig.shuffle;
    repeat = musicConfig.repeat ? 'all' : 'off';
    const saveMusic = () => ctx.system.saveConfig('rhythmbox', { volume: Math.round(deskAudio.volume * 100) / 100, shuffle, repeat: repeat !== 'off' });

    rows.innerHTML = list
      .map((track, i) => `<li class="mp-row" data-i="${i}"><img src="${escapeHtml(track.cover)}" alt="" draggable="false"><span class="mp-name">${escapeHtml(track.title)}</span><span class="mp-artist-small">${ARTIST}</span></li>`)
      .join('');
    if (!list.length) rows.innerHTML = '<li class="mp-empty">No songs found.</li>';

    const syncButtons = () => {
      setSym(playBtn, deskAudio.paused ? 'media-playback-start' : 'media-playback-pause');
      shuffleBtn.classList.toggle('on', shuffle);
      repeatBtn.classList.toggle('on', repeat !== 'off');
      repeatBtn.classList.toggle('one', repeat === 'one');
      win.body.querySelectorAll('.mp-row').forEach((row) => row.classList.toggle('playing', Number(row.dataset.i) === musicIndex));
    };
    const show = () => {
      const track = list[musicIndex];
      if (!track) return;
      cover.src = track.cover;
      title.textContent = track.title;
      if ('mediaSession' in navigator && window.MediaMetadata) {
        navigator.mediaSession.metadata = new MediaMetadata({ title: track.title, artist: ARTIST, artwork: [{ src: new URL(track.cover, document.baseURI).href }] });
      }
      syncButtons();
    };
    const load = (index, autoplay) => {
      if (!list.length) return;
      musicIndex = ((index % list.length) + list.length) % list.length;
      dropBlob();
      deskAudio.src = list[musicIndex].file;
      musicLoaded = true;
      bar.value = 0;
      cur.textContent = '0:00';
      dur.textContent = '0:00';
      show();
      if (autoplay) {
        pauseSite();
        deskAudio.play().catch(() => syncButtons());
      }
    };
    const advance = (direction) => {
      if (!list.length) return;
      if (shuffle && list.length > 1) {
        let pick = musicIndex;
        while (pick === musicIndex) pick = Math.floor(Math.random() * list.length);
        load(pick, true);
      } else {
        load(musicIndex + direction, true);
      }
    };
    const toggle = () => {
      if (!musicLoaded) {
        load(musicIndex, true);
        return;
      }
      if (deskAudio.paused) {
        pauseSite();
        deskAudio.play().catch(() => {});
      } else {
        deskAudio.pause();
      }
    };

    const onTime = () => {
      if (!seeking) {
        if (deskAudio.duration) bar.value = Math.round((deskAudio.currentTime / deskAudio.duration) * 1000);
        cur.textContent = formatTime(deskAudio.currentTime);
      }
      dur.textContent = formatTime(deskAudio.duration);
    };
    const onEnded = () => {
      if (repeat === 'one') {
        deskAudio.currentTime = 0;
        deskAudio.play().catch(() => {});
      } else if (repeat === 'off' && !shuffle && musicIndex === list.length - 1) {
        syncButtons();
      } else {
        advance(1);
      }
    };
    deskAudio.addEventListener('timeupdate', onTime);
    deskAudio.addEventListener('loadedmetadata', onTime);
    deskAudio.addEventListener('play', syncButtons);
    deskAudio.addEventListener('pause', syncButtons);
    deskAudio.addEventListener('ended', onEnded);
    if ('mediaSession' in navigator) {
      const handlers = { play: toggle, pause: toggle, nexttrack: () => advance(1), previoustrack: () => advance(-1) };
      Object.entries(handlers).forEach(([name, fn]) => {
        try {
          navigator.mediaSession.setActionHandler(name, fn);
        } catch (error) {
          return;
        }
      });
    }

    const seekTo = async (time) => {
      if (canSeekTo(time)) {
        deskAudio.currentTime = time;
        return;
      }
      const index = musicIndex;
      const wasPlaying = !deskAudio.paused;
      const abort = new AbortController();
      const timeout = setTimeout(() => abort.abort(), 60000);
      bar.disabled = true;
      cur.textContent = '…';
      try {
        const response = await fetch(list[index].file, { cache: 'no-store', signal: abort.signal });
        if (!response.ok) throw new Error('download failed');
        const url = URL.createObjectURL(await response.blob());
        if (index !== musicIndex) {
          URL.revokeObjectURL(url);
          return;
        }
        dropBlob();
        blobUrl = url;
        deskAudio.src = url;
        await new Promise((resolve, reject) => {
          deskAudio.addEventListener('loadedmetadata', resolve, { once: true });
          deskAudio.addEventListener('error', reject, { once: true });
        });
        deskAudio.currentTime = time;
        if (wasPlaying) await deskAudio.play();
      } catch (error) {
        notify({ title: 'Could not jump to that spot', body: 'The song could not be downloaded.', iconName: 'rhythmbox.png' });
      } finally {
        clearTimeout(timeout);
        bar.disabled = false;
      }
    };

    bar.addEventListener('input', () => {
      seeking = true;
      if (deskAudio.duration) cur.textContent = formatTime((bar.value / 1000) * deskAudio.duration);
    });
    bar.addEventListener('change', async () => {
      seeking = true;
      if (deskAudio.duration) await seekTo((bar.value / 1000) * deskAudio.duration);
      seeking = false;
      onTime();
    });
    vol.value = Math.round(deskAudio.volume * 100);
    vol.addEventListener('input', () => {
      deskAudio.volume = vol.value / 100;
    });
    vol.addEventListener('change', saveMusic);

    win.body.addEventListener('click', (event) => {
      const row = event.target.closest('.mp-row');
      if (row) {
        load(Number(row.dataset.i), true);
        return;
      }
      const act = event.target.closest('[data-act]');
      if (!act) return;
      const action = act.dataset.act;
      if (action === 'play') toggle();
      else if (action === 'next') advance(1);
      else if (action === 'prev') {
        if (deskAudio.currentTime > 3) deskAudio.currentTime = 0;
        else advance(-1);
      } else if (action === 'shuffle') {
        shuffle = !shuffle;
        syncButtons();
        saveMusic();
      } else if (action === 'repeat') {
        repeat = repeat === 'off' ? 'all' : repeat === 'all' ? 'one' : 'off';
        syncButtons();
        saveMusic();
      }
    });

    win.onClose = () => {
      deskAudio.pause();
      deskAudio.removeEventListener('timeupdate', onTime);
      deskAudio.removeEventListener('loadedmetadata', onTime);
      deskAudio.removeEventListener('play', syncButtons);
      deskAudio.removeEventListener('pause', syncButtons);
      deskAudio.removeEventListener('ended', onEnded);
    };

    if (musicLoaded) {
      show();
      onTime();
    } else if (list.length) {
      const track = list[musicIndex];
      cover.src = track.cover;
      title.textContent = track.title;
    }
    syncButtons();
    return win;
  }

  ctx.media = { openViewer, openPaint, openMusic };
};
