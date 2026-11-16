window.lambdawebTerminalApps = (ctx) => {
  const { fs, HOME, escapeHtml } = ctx;

  const named = {
    green: '#00ff41',
    red: '#ff3030',
    blue: '#3a7bff',
    white: '#e8e8e8',
    yellow: '#ffe34d',
    cyan: '#33ffee',
    magenta: '#ff4dff',
    orange: '#ff9a3c',
    black: '#555555',
  };
  const colorOf = (value, fallback) => {
    if (named[value]) return named[value];
    return /^#[0-9a-f]{6}$/i.test(value || '') ? value : fallback;
  };

  const glyphs = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789';

  const cmatrix = (g, grid, cw, ch, { args }) => {
    let color = named.green;
    let speed = 4;
    let rainbow = false;
    let bold = false;
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === '-C' && args[i + 1]) color = colorOf(args[++i], color);
      else if (arg === '-u' && args[i + 1]) speed = Math.min(10, Math.max(0, parseInt(args[++i], 10) || 4));
      else if (arg === '-r') rainbow = true;
      else if (arg === '-b' || arg === '-B') bold = true;
    }
    const randomGlyph = () => glyphs[Math.floor(Math.random() * glyphs.length)];
    const fresh = (initial) => ({
      head: initial ? -Math.random() * grid.rows * 1.5 : -Math.random() * 8,
      speed: (0.25 + Math.random() * 0.75) * (0.3 + speed * 0.18),
      length: 5 + Math.floor(Math.random() * Math.max(6, grid.rows * 0.7)),
      chars: [],
    });
    const columns = Array.from({ length: grid.cols }, () => fresh(true));
    const font = `${bold ? '700 ' : ''}${Math.max(8, Math.floor(ch * 0.88))}px 'JetBrains Mono', monospace`;
    return {
      frame() {
        g.clearRect(0, 0, grid.cols * cw, grid.rows * ch);
        g.font = font;
        g.textBaseline = 'top';
        const hueShift = performance.now() / 25;
        columns.forEach((column, index) => {
          column.head += column.speed;
          const headRow = Math.floor(column.head);
          const fill = rainbow ? `hsl(${(index * 9 + hueShift) % 360} 90% 55%)` : color;
          for (let row = Math.max(0, headRow - column.length); row <= Math.min(grid.rows - 1, headRow); row++) {
            if (!column.chars[row] || Math.random() < 0.015) column.chars[row] = randomGlyph();
            g.globalAlpha = row === headRow ? 1 : Math.max(0.06, 1 - (headRow - row) / column.length);
            g.fillStyle = row === headRow ? '#e9fff0' : fill;
            g.fillText(column.chars[row], index * cw, row * ch);
          }
          if (headRow - column.length > grid.rows) columns[index] = fresh(false);
        });
        g.globalAlpha = 1;
      },
    };
  };

  const font = {
    0: ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
    1: ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
    2: ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
    3: ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
    4: ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
    5: ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
    6: ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
    7: ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
    8: ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
    9: ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
    ':': ['0', '0', '1', '0', '1', '0', '0'],
    A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
    P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
    M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
    ' ': ['00', '00', '00', '00', '00', '00', '00'],
  };

  const peaclock = (g, grid, cw, ch) => {
    const settings = { 'time-format': '24h', 'show-date': true, color: '#ffffff' };
    try {
      fs.read(`${HOME}/.config/peaclock/config`)
        .split('\n')
        .forEach((line) => {
          const match = line.trim().match(/^set\s+([\w-]+)\s+(\S+)/);
          if (!match) return;
          if (match[1] === 'time-format') settings['time-format'] = match[2] === '12h' ? '12h' : '24h';
          else if (match[1] === 'show-date') settings['show-date'] = match[2] !== 'false';
          else if (match[1] === 'color') settings.color = colorOf(match[2], settings.color);
        });
    } catch (error) {
      settings.color = '#ffffff';
    }
    return {
      frame() {
        const now = new Date();
        let text;
        if (settings['time-format'] === '12h') {
          const hours = now.getHours() % 12 || 12;
          text = `${String(hours).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')} ${now.getHours() < 12 ? 'AM' : 'PM'}`;
        } else {
          text = now.toLocaleTimeString('en-GB');
        }
        const width = grid.cols * cw;
        const height = grid.rows * ch;
        g.clearRect(0, 0, width, height);
        const glyphsOf = [...text].map((char) => font[char] || font[' ']);
        const units = glyphsOf.reduce((sum, glyph) => sum + glyph[0].length + 1, -1);
        const pixel = Math.max(2, Math.floor(Math.min((width * 0.9) / units, (height * 0.5) / 7)));
        const left = Math.floor((width - units * pixel) / 2);
        const top = Math.floor((height - 7 * pixel) / 2 - (settings['show-date'] ? ch : 0));
        g.fillStyle = settings.color;
        let x = left;
        glyphsOf.forEach((glyph) => {
          glyph.forEach((row, y) => {
            [...row].forEach((bit, offset) => {
              if (bit === '1') g.fillRect(x + offset * pixel, top + y * pixel, pixel - 1, pixel - 1);
            });
          });
          x += (glyph[0].length + 1) * pixel;
        });
        g.font = `${Math.floor(ch * 0.9)}px 'JetBrains Mono', monospace`;
        g.textAlign = 'center';
        g.textBaseline = 'top';
        if (settings['show-date']) g.fillText(now.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }), width / 2, top + 7 * pixel + ch);
        g.globalAlpha = 0.5;
        g.fillText('press q to quit', width / 2, height - ch * 1.4);
        g.globalAlpha = 1;
        g.textAlign = 'start';
      },
    };
  };

  const readNanorc = () => {
    const options = { tabsize: 8, linenumbers: false, autoindent: false };
    ['.nanorc', '.config/nano/nanorc'].forEach((name) => {
      let text = '';
      try {
        text = fs.read(`${HOME}/${name}`);
      } catch (error) {
        return;
      }
      text.split('\n').forEach((raw) => {
        const line = raw.trim();
        if (!line || line.startsWith('#')) return;
        const size = line.match(/^set\s+tabsize\s+(\d+)$/);
        if (size) options.tabsize = Math.min(16, Math.max(1, parseInt(size[1], 10)));
        else if (/^set\s+linenumbers$/.test(line)) options.linenumbers = true;
        else if (/^set\s+autoindent$/.test(line)) options.autoindent = true;
      });
    });
    return options;
  };

  const nano = ({ term, path, resolve, onExit }) => {
    const rc = readNanorc();
    const host = document.createElement('div');
    host.className = 'nano';
    host.innerHTML = `
      <div class="nano-title"><span class="nano-name"></span><span class="nano-flag"></span></div>
      <div class="nano-body"></div>
      <div class="nano-status"></div>
      <div class="nano-help"></div>`;
    term.append(host);
    term.classList.add('running');
    const probe = document.createElement('span');
    probe.className = 'term-probe';
    probe.textContent = 'M';
    host.append(probe);
    const nameEl = host.querySelector('.nano-name');
    const flagEl = host.querySelector('.nano-flag');
    const body = host.querySelector('.nano-body');
    const status = host.querySelector('.nano-status');
    const help = host.querySelector('.nano-help');

    const model = { lines: [''], x: 0, y: 0, top: 0, left: 0, modified: false, path, prompt: null, cut: '', cutChain: false, message: '', search: '' };
    let closed = false;
    let messageTimer = null;

    const say = (text) => {
      model.message = text;
      clearTimeout(messageTimer);
      messageTimer = setTimeout(() => {
        model.message = '';
        draw();
      }, 4000);
    };

    if (path) {
      const node = fs.get(path);
      if (node && node.type === 'dir') {
        say(`[ Error reading ${path}: Is a directory ]`);
        model.path = null;
      } else if (node && node.restricted) {
        say(`[ Error reading ${path}: Permission denied ]`);
        model.path = null;
      } else if (node && node.content.startsWith('data:image/')) {
        say('[ Cannot edit binary data ]');
        model.path = null;
      } else if (node) {
        const text = node.content;
        model.lines = (text.endsWith('\n') ? text.slice(0, -1) : text).split('\n');
        say(`[ Read ${model.lines.length} ${model.lines.length === 1 ? 'line' : 'lines'} ]`);
      } else {
        say('[ New File ]');
      }
    }

    const expand = (line, upTo = line.length) => {
      let out = '';
      for (let i = 0; i < upTo && i < line.length; i++) {
        if (line[i] === '\t') out += ' '.repeat(rc.tabsize - (out.length % rc.tabsize));
        else out += line[i];
      }
      return out;
    };
    const displayName = () => (model.path ? model.path.split('/').pop() : 'New Buffer');

    const helpRows = [
      [['^G', 'Help'], ['^O', 'Write Out'], ['^W', 'Where Is'], ['^K', 'Cut'], ['^C', 'Location']],
      [['^X', 'Exit'], ['^R', 'Read File'], ['^U', 'Paste'], ['^_', 'Go To Line']],
    ];
    const promptHelp = [[['^C', 'Cancel']], []];

    const draw = () => {
      if (closed) return;
      const charW = probe.getBoundingClientRect().width || 9;
      const lineH = parseFloat(getComputedStyle(host).lineHeight) || 20;
      const rows = Math.max(3, Math.floor((term.clientHeight - lineH * 4) / lineH));
      const gutter = rc.linenumbers ? String(model.lines.length).length + 1 : 0;
      const cols = Math.max(10, Math.floor(term.clientWidth / charW) - gutter - 1);
      if (model.y < model.top) model.top = model.y;
      if (model.y >= model.top + rows) model.top = model.y - rows + 1;
      const column = expand(model.lines[model.y], model.x).length;
      if (column < model.left) model.left = column;
      if (column >= model.left + cols) model.left = column - cols + 1;

      nameEl.textContent = `  nano 7.2${' '.repeat(8)}${displayName()}`;
      flagEl.textContent = model.modified ? 'Modified  ' : '';
      const html = [];
      for (let row = model.top; row < model.top + rows; row++) {
        const number = rc.linenumbers ? `<span class="nano-num">${row < model.lines.length ? String(row + 1).padStart(gutter - 1, ' ') : ' '.repeat(gutter - 1)} </span>` : '';
        if (row >= model.lines.length) {
          html.push(`<div>${number}</div>`);
          continue;
        }
        const full = expand(model.lines[row]);
        const visible = full.slice(model.left, model.left + cols);
        if (row === model.y && !model.prompt) {
          const at = column - model.left;
          const before = visible.slice(0, at);
          const char = visible.slice(at, at + 1) || ' ';
          html.push(`<div>${number}${escapeHtml(before)}<span class="nano-cursor">${escapeHtml(char)}</span>${escapeHtml(visible.slice(at + 1))}</div>`);
        } else {
          html.push(`<div>${number}${escapeHtml(visible)}</div>`);
        }
      }
      body.innerHTML = html.join('');
      body.style.height = `${rows * lineH}px`;

      if (model.prompt) {
        const p = model.prompt;
        status.innerHTML = `<span>${escapeHtml(p.label)}</span>${p.choices ? '' : escapeHtml(p.value)}<span class="nano-cursor"> </span>`;
      } else {
        status.innerHTML = model.message ? `<span class="nano-msg">${escapeHtml(model.message)}</span>` : '';
      }
      const rowsToShow = model.prompt ? (model.prompt.choices ? model.prompt.choices : promptHelp) : helpRows;
      help.innerHTML = rowsToShow
        .map((row) => `<div>${row.map(([key, label]) => `<span class="nano-key">${escapeHtml(key)}</span> ${escapeHtml(label)}`).join('')}</div>`)
        .join('');
    };

    const lineText = () => model.lines[model.y];
    const touch = () => {
      model.modified = true;
      model.cutChain = false;
    };
    const insert = (text) => {
      text.split(/\r?\n/).forEach((piece, index) => {
        if (index > 0) newline();
        const line = lineText();
        model.lines[model.y] = line.slice(0, model.x) + piece + line.slice(model.x);
        model.x += piece.length;
      });
      touch();
    };
    const newline = () => {
      const line = lineText();
      const indent = rc.autoindent ? line.match(/^\s*/)[0] : '';
      model.lines[model.y] = line.slice(0, model.x);
      model.lines.splice(model.y + 1, 0, indent + line.slice(model.x));
      model.y += 1;
      model.x = indent.length;
      touch();
    };
    const clampX = () => {
      model.x = Math.min(model.x, lineText().length);
    };

    const save = (target) => {
      try {
        fs.write(target, `${model.lines.join('\n')}\n`);
        model.path = target;
        model.modified = false;
        say(`[ Wrote ${model.lines.length} ${model.lines.length === 1 ? 'line' : 'lines'} ]`);
        return true;
      } catch (error) {
        say(`[ Error writing ${target}: ${error.message} ]`);
        return false;
      }
    };

    const close = () => {
      if (closed) return;
      closed = true;
      clearTimeout(messageTimer);
      host.remove();
      term.classList.remove('running');
      onExit();
    };

    const ask = (label, value, done, choices) => {
      model.prompt = { label, value, done, choices };
      draw();
    };

    const askWrite = (thenExit) => {
      ask('File Name to Write: ', model.path ? model.path : '', (name) => {
        if (!name.trim()) return;
        const target = resolve(name.trim());
        if (save(target) && thenExit) close();
      });
    };

    const askExit = () => {
      if (!model.modified) {
        close();
        return;
      }
      ask('Save modified buffer?  ', '', null, [[['Y', 'Yes'], ['N', 'No'], ['^C', 'Cancel']], []]);
      model.prompt.exit = true;
    };

    const find = (term) => {
      if (!term) return;
      const lower = term.toLowerCase();
      for (let step = 0; step <= model.lines.length; step++) {
        const row = (model.y + step) % model.lines.length;
        const from = step === 0 ? model.x + 1 : 0;
        const at = model.lines[row].toLowerCase().indexOf(lower, from);
        if (at >= 0) {
          model.y = row;
          model.x = at;
          return;
        }
      }
      say(`[ "${term}" not found ]`);
    };

    const promptKey = (event) => {
      const p = model.prompt;
      if (p.exit) {
        const key = event.key.toLowerCase();
        if (event.ctrlKey && key === 'c') {
          model.prompt = null;
        } else if (key === 'n') {
          model.prompt = null;
          close();
          return;
        } else if (key === 'y') {
          model.prompt = null;
          if (model.path) {
            if (save(model.path)) close();
          } else {
            askWrite(true);
          }
        }
        draw();
        return;
      }
      if (event.key === 'Enter') {
        const done = p.done;
        const value = p.value;
        model.prompt = null;
        done(value);
      } else if (event.key === 'Escape' || (event.ctrlKey && event.key.toLowerCase() === 'c')) {
        model.prompt = null;
        say('[ Cancelled ]');
      } else if (event.key === 'Backspace') {
        p.value = p.value.slice(0, -1);
      } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
        p.value += event.key;
      }
      draw();
    };

    const keys = (event) => {
      if (closed) return;
      event.preventDefault();
      if (model.prompt) {
        promptKey(event);
        return;
      }
      const ctrl = event.ctrlKey || event.metaKey;
      const key = event.key;
      const lower = key.toLowerCase();
      const rows = Math.max(3, Math.floor((term.clientHeight - 80) / 20));
      let keepChain = false;
      if (ctrl && lower === 'x') {
        askExit();
        return;
      } else if (ctrl && lower === 'o') {
        askWrite(false);
        return;
      } else if (ctrl && lower === 'r') {
        ask('File to insert: ', '', (name) => {
          try {
            const text = fs.read(resolve(name.trim()));
            insert(text.endsWith('\n') ? text.slice(0, -1) : text);
          } catch (error) {
            say(`[ Error reading ${name}: ${error.message} ]`);
          }
          draw();
        });
        return;
      } else if ((ctrl && lower === 'w') || key === 'F6') {
        ask('Search: ', model.search, (value) => {
          model.search = value;
          find(value);
          draw();
        });
        return;
      } else if (ctrl && lower === 'g') {
        say('[ ^O Write Out   ^X Exit   ^K Cut   ^U Paste   ^W Where Is   ^C Location ]');
      } else if (ctrl && lower === 'c') {
        const total = model.lines.join('\n').length;
        say(`[ line ${model.y + 1}/${model.lines.length}, col ${model.x + 1}/${lineText().length + 1}, char ${model.lines.slice(0, model.y).reduce((sum, line) => sum + line.length + 1, 0) + model.x + 1}/${total} ]`);
      } else if (ctrl && (key === '_' || key === '/')) {
        ask('Enter line number: ', '', (value) => {
          const target = parseInt(value, 10);
          if (Number.isFinite(target)) {
            model.y = Math.min(model.lines.length, Math.max(1, target)) - 1;
            clampX();
          }
          draw();
        });
        return;
      } else if (ctrl && lower === 'k') {
        const removed = lineText();
        model.cut = model.cutChain ? `${model.cut}\n${removed}` : removed;
        if (model.lines.length > 1) model.lines.splice(model.y, 1);
        else model.lines[0] = '';
        model.y = Math.min(model.y, model.lines.length - 1);
        clampX();
        model.modified = true;
        keepChain = true;
      } else if (ctrl && lower === 'u') {
        if (model.cut) {
          const pasted = model.cut.split('\n');
          model.lines.splice(model.y, 0, ...pasted);
          model.y += pasted.length;
          clampX();
          model.modified = true;
        }
      } else if (ctrl && lower === 'a') {
        model.x = 0;
      } else if (ctrl && lower === 'e') {
        model.x = lineText().length;
      } else if (key === 'ArrowLeft') {
        if (model.x > 0) model.x -= 1;
        else if (model.y > 0) {
          model.y -= 1;
          model.x = lineText().length;
        }
      } else if (key === 'ArrowRight') {
        if (model.x < lineText().length) model.x += 1;
        else if (model.y < model.lines.length - 1) {
          model.y += 1;
          model.x = 0;
        }
      } else if (key === 'ArrowUp') {
        if (model.y > 0) model.y -= 1;
        clampX();
      } else if (key === 'ArrowDown') {
        if (model.y < model.lines.length - 1) model.y += 1;
        clampX();
      } else if (key === 'PageUp') {
        model.y = Math.max(0, model.y - rows);
        clampX();
      } else if (key === 'PageDown') {
        model.y = Math.min(model.lines.length - 1, model.y + rows);
        clampX();
      } else if (key === 'Home') {
        model.x = 0;
      } else if (key === 'End') {
        model.x = lineText().length;
      } else if (key === 'Enter') {
        newline();
      } else if (key === 'Backspace') {
        if (model.x > 0) {
          const line = lineText();
          model.lines[model.y] = line.slice(0, model.x - 1) + line.slice(model.x);
          model.x -= 1;
          touch();
        } else if (model.y > 0) {
          const previous = model.lines[model.y - 1];
          model.lines[model.y - 1] = previous + lineText();
          model.lines.splice(model.y, 1);
          model.y -= 1;
          model.x = previous.length;
          touch();
        }
      } else if (key === 'Delete') {
        const line = lineText();
        if (model.x < line.length) {
          model.lines[model.y] = line.slice(0, model.x) + line.slice(model.x + 1);
          touch();
        } else if (model.y < model.lines.length - 1) {
          model.lines[model.y] = line + model.lines[model.y + 1];
          model.lines.splice(model.y + 1, 1);
          touch();
        }
      } else if (key === 'Tab') {
        insert('\t');
      } else if (key.length === 1 && !ctrl) {
        insert(key);
      }
      model.cutChain = keepChain;
      draw();
    };

    const text = (value) => {
      if (closed || !value) return;
      if (model.prompt) {
        if (!model.prompt.choices) model.prompt.value += value.replace(/\n/g, '');
      } else {
        insert(value);
      }
      draw();
    };

    const observer = new ResizeObserver(draw);
    observer.observe(term);
    draw();

    return {
      keys,
      text,
      destroy() {
        observer.disconnect();
        closed = true;
        clearTimeout(messageTimer);
        host.remove();
        term.classList.remove('running');
      },
    };
  };

  ctx.terminalApps = { canvas: { cmatrix: { fps: 20, make: cmatrix }, peaclock: { fps: 4, make: peaclock } }, nano };
};
