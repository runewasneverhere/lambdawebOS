window.lambdawebGuiApps = (ctx) => {
  const { createWindow, notify, escapeHtml, windows, sym, apps } = ctx;
  const system = ctx.system;
  const MAX_ALARMS = 20;

  const focusOrCreate = (appId, build) => {
    const found = windows.find((win) => win.app === appId);
    if (found) {
      found.focus();
      return found;
    }
    return build();
  };

  const parseExpression = (source, degrees) => {
    const text = source.replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-').replace(/π/g, 'pi').replace(/√/g, 'sqrt');
    const tokens = text.match(/\d+\.?\d*(?:e[+-]?\d+)?|\.\d+|[a-z]+|[-+*/^%()!]/gi) || [];
    if (tokens.join('').length !== text.replace(/\s+/g, '').length) throw new Error('syntax');
    let at = 0;
    const peek = () => tokens[at];
    const take = () => tokens[at++];
    const toRad = (value) => (degrees ? (value * Math.PI) / 180 : value);
    const fromRad = (value) => (degrees ? (value * 180) / Math.PI : value);
    const functions = {
      sin: (v) => Math.sin(toRad(v)),
      cos: (v) => Math.cos(toRad(v)),
      tan: (v) => Math.tan(toRad(v)),
      asin: (v) => fromRad(Math.asin(v)),
      acos: (v) => fromRad(Math.acos(v)),
      atan: (v) => fromRad(Math.atan(v)),
      ln: Math.log,
      log: Math.log10,
      sqrt: Math.sqrt,
      cbrt: Math.cbrt,
      abs: Math.abs,
      exp: Math.exp,
    };
    const factorial = (value) => {
      if (!Number.isInteger(value) || value < 0 || value > 170) throw new Error('domain');
      let result = 1;
      for (let i = 2; i <= value; i++) result *= i;
      return result;
    };
    const startsOperand = (token) => token !== undefined && (/^[\d.]/.test(token) || /^[a-z]/i.test(token) || token === '(');
    const expression = () => {
      let value = term();
      while (peek() === '+' || peek() === '-') value = take() === '+' ? value + term() : value - term();
      return value;
    };
    const term = () => {
      let value = unary();
      while (peek() === '*' || peek() === '/' || startsOperand(peek())) {
        if (peek() === '*') {
          take();
          value *= unary();
        } else if (peek() === '/') {
          take();
          const divisor = unary();
          if (divisor === 0) throw new Error('divide');
          value /= divisor;
        } else {
          value *= unary();
        }
      }
      return value;
    };
    const unary = () => {
      if (peek() === '-') {
        take();
        return -unary();
      }
      if (peek() === '+') {
        take();
        return unary();
      }
      return power();
    };
    const power = () => {
      const base = postfix();
      if (peek() === '^') {
        take();
        return base ** unary();
      }
      return base;
    };
    const postfix = () => {
      let value = primary();
      while (peek() === '%' || peek() === '!') value = take() === '%' ? value / 100 : factorial(value);
      return value;
    };
    const primary = () => {
      const token = take();
      if (token === undefined) throw new Error('syntax');
      if (token === '(') {
        const value = expression();
        if (take() !== ')') throw new Error('syntax');
        return value;
      }
      if (/^[\d.]/.test(token)) return parseFloat(token);
      const name = token.toLowerCase();
      if (name === 'pi') return Math.PI;
      if (name === 'e') return Math.E;
      if (functions[name]) {
        const value = peek() === '(' ? primary() : postfix();
        return functions[name](value);
      }
      throw new Error('syntax');
    };
    const result = expression();
    if (at < tokens.length) throw new Error('syntax');
    if (!Number.isFinite(result)) throw new Error('domain');
    return result;
  };

  const formatNumber = (value) => {
    if (Object.is(value, -0)) return '0';
    const rounded = Number(value.toPrecision(12));
    const text = String(rounded);
    return text.includes('e') ? rounded.toExponential(6).replace(/\.?0+e/, 'e') : text;
  };

  const openCalculator = () =>
    focusOrCreate('calculator', () => {
      const win = createWindow({ app: 'calculator', title: 'Calculator', width: 360, height: 560, minWidth: 300, minHeight: 440, className: 'is-calc' });
      const settings = system.config('calculator', system.defaults.calculator);
      let mode = settings.mode === 'scientific' ? 'scientific' : 'basic';
      let degrees = true;
      let expr = '';
      let previous = '';
      let justEvaluated = false;
      win.body.innerHTML = `
        <div class="calc" tabindex="0">
          <div class="calc-top"><button class="calc-mode" data-act="mode"></button><button class="calc-mode" data-act="angle" hidden></button></div>
          <div class="calc-screen"><div class="calc-prev"></div><div class="calc-expr"></div><div class="calc-result">0</div></div>
          <div class="calc-keys"></div>
        </div>`;
      const root = win.body.querySelector('.calc');
      const keys = win.body.querySelector('.calc-keys');
      const prevEl = win.body.querySelector('.calc-prev');
      const exprEl = win.body.querySelector('.calc-expr');
      const resultEl = win.body.querySelector('.calc-result');
      const modeButton = win.body.querySelector('[data-act="mode"]');
      const angleButton = win.body.querySelector('[data-act="angle"]');

      const basic = [
        ['AC', 'clear', 'fn'], ['⌫', 'back', 'fn'], ['%', '%', 'fn'], ['÷', '÷', 'op'],
        ['7', '7'], ['8', '8'], ['9', '9'], ['×', '×', 'op'],
        ['4', '4'], ['5', '5'], ['6', '6'], ['−', '−', 'op'],
        ['1', '1'], ['2', '2'], ['3', '3'], ['+', '+', 'op'],
        ['±', 'sign', 'fn'], ['0', '0'], ['.', '.'], ['=', 'equals', 'eq'],
      ];
      const scientific = [
        ['sin', 'sin(', 'fn'], ['cos', 'cos(', 'fn'], ['tan', 'tan(', 'fn'], ['(', '(', 'fn'], [')', ')', 'fn'],
        ['ln', 'ln(', 'fn'], ['log', 'log(', 'fn'], ['√', '√(', 'fn'], ['x²', '^2', 'fn'], ['xʸ', '^', 'fn'],
        ['π', 'π', 'fn'], ['e', 'e', 'fn'], ['n!', '!', 'fn'], ['1/x', '1/(', 'fn'], ['abs', 'abs(', 'fn'],
      ];

      const draw = () => {
        const cells = [...(mode === 'scientific' ? scientific : []), ...basic];
        keys.className = `calc-keys${mode === 'scientific' ? ' sci' : ''}`;
        keys.innerHTML = cells.map(([label, value, kind = 'num']) => `<button class="calc-key ${kind}" data-key="${escapeHtml(value)}">${escapeHtml(label)}</button>`).join('');
        modeButton.textContent = mode === 'scientific' ? 'Basic' : 'Scientific';
        angleButton.hidden = mode !== 'scientific';
        angleButton.textContent = degrees ? 'DEG' : 'RAD';
        update();
      };

      const update = () => {
        prevEl.textContent = previous;
        exprEl.textContent = expr;
        if (!expr) {
          resultEl.textContent = '0';
          resultEl.classList.remove('error');
          return;
        }
        try {
          const closed = expr + ')'.repeat(Math.max(0, (expr.match(/\(/g) || []).length - (expr.match(/\)/g) || []).length));
          resultEl.textContent = formatNumber(parseExpression(closed, degrees));
          resultEl.classList.remove('error');
        } catch (error) {
          if (/[-+×÷−*/^(]$/.test(expr)) {
            resultEl.classList.remove('error');
          } else {
            resultEl.textContent = '…';
          }
        }
      };

      const evaluate = () => {
        if (!expr) return;
        const closed = expr + ')'.repeat(Math.max(0, (expr.match(/\(/g) || []).length - (expr.match(/\)/g) || []).length));
        try {
          const value = formatNumber(parseExpression(closed, degrees));
          previous = `${expr} =`;
          expr = value;
          justEvaluated = true;
          resultEl.classList.remove('error');
        } catch (error) {
          resultEl.textContent = error.message === 'divide' ? 'Cannot divide by zero' : 'Invalid expression';
          resultEl.classList.add('error');
          return;
        }
        update();
      };

      const press = (value) => {
        if (value === 'clear') {
          expr = '';
          previous = '';
        } else if (value === 'back') {
          expr = expr.replace(/(?:sin\(|cos\(|tan\(|ln\(|log\(|√\(|abs\(|.)$/, '');
        } else if (value === 'equals') {
          evaluate();
          return;
        } else if (value === 'sign') {
          if (/^-?[\d.]+$/.test(expr)) expr = expr.startsWith('-') ? expr.slice(1) : `-${expr}`;
          else if (expr) expr = `-(${expr})`;
        } else {
          const isOperator = /^[×÷−+^%!]$|^\^2$/.test(value);
          if (justEvaluated && !isOperator) expr = '';
          justEvaluated = false;
          expr += value;
        }
        if (value !== 'equals') justEvaluated = value === 'clear' || value === 'back' ? false : justEvaluated;
        update();
      };

      keys.addEventListener('click', (event) => {
        const button = event.target.closest('[data-key]');
        if (button) press(button.dataset.key);
        root.focus();
      });
      win.body.querySelector('.calc-top').addEventListener('click', (event) => {
        const act = event.target.closest('[data-act]');
        if (!act) return;
        if (act.dataset.act === 'mode') {
          mode = mode === 'scientific' ? 'basic' : 'scientific';
          system.saveConfig('calculator', { ...settings, mode });
        } else {
          degrees = !degrees;
        }
        draw();
      });
      root.addEventListener('keydown', (event) => {
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        const map = { '*': '×', '/': '÷', '-': '−' };
        if (/^[0-9.+()^%!]$/.test(event.key)) press(event.key);
        else if (map[event.key]) press(map[event.key]);
        else if (event.key === 'Enter' || event.key === '=') press('equals');
        else if (event.key === 'Backspace') press('back');
        else if (event.key === 'Escape' || event.key === 'Delete') press('clear');
        else return;
        event.preventDefault();
      });
      draw();
      root.focus();
      return win;
    });

  const zones = [
    'UTC', 'America/Vancouver', 'America/Los_Angeles', 'America/Denver', 'America/Chicago', 'America/New_York', 'America/Sao_Paulo', 'Europe/London', 'Europe/Paris', 'Europe/Berlin',
    'Europe/Moscow', 'Africa/Cairo', 'Africa/Johannesburg', 'Asia/Dubai', 'Asia/Kolkata', 'Asia/Bangkok', 'Asia/Shanghai', 'Asia/Tokyo', 'Asia/Seoul', 'Australia/Sydney', 'Pacific/Auckland', 'Pacific/Honolulu',
  ];
  const zoneLabel = (zone) => (zone === 'UTC' ? 'UTC' : zone.split('/').pop().replace(/_/g, ' '));
  const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

  const stopwatch = { running: false, started: 0, elapsed: 0, laps: [] };
  const timer = { total: 300, remaining: 300, running: false, end: 0 };
  const lastRung = { minute: '' };

  const pad = (value, size = 2) => String(value).padStart(size, '0');
  const stopwatchMs = () => stopwatch.elapsed + (stopwatch.running ? performance.now() - stopwatch.started : 0);
  const formatStopwatch = (ms) => `${pad(Math.floor(ms / 60000))}:${pad(Math.floor(ms / 1000) % 60)}.${pad(Math.floor((ms % 1000) / 10))}`;
  const timerSeconds = () => (timer.running ? Math.max(0, Math.ceil((timer.end - performance.now()) / 1000)) : timer.remaining);
  const formatTimer = (seconds) => `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}`;

  const ring = (title, body) => {
    ctx.sound.play('bell', { force: true });
    setTimeout(() => ctx.sound.play('bell', { force: true }), 1400);
    setTimeout(() => ctx.sound.play('bell', { force: true }), 2800);
    notify({ title, body, iconName: 'clocks.png', duration: 20000, onClick: () => openClocks() });
  };

  setInterval(() => {
    if (!ctx.installed.has('clocks')) return;
    if (timer.running && performance.now() >= timer.end) {
      timer.running = false;
      timer.remaining = 0;
      ring('Timer finished', formatTimer(timer.total));
    }
    const now = new Date();
    const stamp = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    if (lastRung.minute !== stamp) {
      lastRung.minute = stamp;
      const settings = system.config('clocks', system.defaults.clocks);
      settings.alarms.forEach((alarm) => {
        if (alarm && alarm.enabled && alarm.time === stamp) ring(alarm.label || 'Alarm', stamp);
      });
    }
  }, 1000);

  function openClocks() {
    return focusOrCreate('clocks', () => {
      const win = createWindow({ app: 'clocks', title: 'Clocks', width: 460, height: 560, minWidth: 340, minHeight: 420, className: 'is-clocks' });
      const read = () => system.config('clocks', system.defaults.clocks);
      let tab = 'world';
      win.body.innerHTML = `
        <div class="clk">
          <nav class="clk-tabs">${[['world', 'World'], ['alarm', 'Alarm'], ['stopwatch', 'Stopwatch'], ['timer', 'Timer']].map(([id, label]) => `<button class="clk-tab" data-tab="${id}">${label}</button>`).join('')}</nav>
          <div class="clk-view"></div>
        </div>`;
      const view = win.body.querySelector('.clk-view');
      const tabs = [...win.body.querySelectorAll('.clk-tab')];

      const timeIn = (zone) => {
        const settings = read();
        return new Intl.DateTimeFormat([], { timeZone: zone, hour: '2-digit', minute: '2-digit', hour12: !settings.hour24 }).format(new Date());
      };
      const dayIn = (zone) => new Intl.DateTimeFormat([], { timeZone: zone, weekday: 'short', day: 'numeric', month: 'short' }).format(new Date());

      const renderWorld = () => {
        const settings = read();
        const list = [localZone, ...settings.zones.filter((zone) => zone !== localZone)];
        view.innerHTML = `
          <div class="clk-bar"><label class="clk-check"><input type="checkbox" data-opt="hour24"${settings.hour24 ? ' checked' : ''}> 24-hour time</label>
            <select class="clk-add"><option value="">Add city…</option>${zones.filter((zone) => !list.includes(zone)).map((zone) => `<option value="${zone}">${escapeHtml(zoneLabel(zone))}</option>`).join('')}</select></div>
          <ul class="clk-list">${list.map((zone, index) => `<li><div><strong>${escapeHtml(zoneLabel(zone))}${index === 0 ? ' (local)' : ''}</strong><span data-day="${zone}">${dayIn(zone)}</span></div><b data-zone="${zone}">${timeIn(zone)}</b>${index ? `<button class="clk-x" data-remove="${zone}" aria-label="Remove">×</button>` : ''}</li>`).join('')}</ul>`;
      };

      const renderAlarm = () => {
        const settings = read();
        view.innerHTML = `
          <form class="clk-form"><input type="time" name="time" required value="07:00"><input type="text" name="label" placeholder="Label (optional)" maxlength="40"><button class="clk-primary" type="submit">Add Alarm</button></form>
          <ul class="clk-list">${settings.alarms.length ? settings.alarms.map((alarm, index) => `<li><div><strong>${escapeHtml(alarm.time)}</strong><span>${escapeHtml(alarm.label || 'Alarm')}</span></div><label class="clk-check"><input type="checkbox" data-alarm="${index}"${alarm.enabled ? ' checked' : ''}> On</label><button class="clk-x" data-delete="${index}" aria-label="Delete">×</button></li>`).join('') : '<li class="clk-empty">No alarms yet.</li>'}</ul>
          <p class="clk-note">Alarms ring while lambdawebOS is open in this browser tab.</p>`;
      };

      const renderStopwatch = () => {
        view.innerHTML = `
          <div class="clk-big" data-sw>${formatStopwatch(stopwatchMs())}</div>
          <div class="clk-actions"><button class="clk-primary" data-sw-act="toggle">${stopwatch.running ? 'Stop' : 'Start'}</button><button data-sw-act="lap"${stopwatch.running ? '' : ' disabled'}>Lap</button><button data-sw-act="reset"${stopwatch.elapsed || stopwatch.running ? '' : ' disabled'}>Reset</button></div>
          <ol class="clk-laps" reversed>${[...stopwatch.laps].reverse().map((lap, index) => `<li><span>Lap ${stopwatch.laps.length - index}</span><b>${formatStopwatch(lap)}</b></li>`).join('')}</ol>`;
      };

      const renderTimer = () => {
        const left = timerSeconds();
        const editable = !timer.running && left === timer.total;
        view.innerHTML = `
          <div class="clk-big" data-timer>${formatTimer(left)}</div>
          ${editable ? `<form class="clk-form tmr"><label>h<input type="number" name="h" min="0" max="99" value="${Math.floor(timer.total / 3600)}"></label><label>m<input type="number" name="m" min="0" max="59" value="${Math.floor(timer.total / 60) % 60}"></label><label>s<input type="number" name="s" min="0" max="59" value="${timer.total % 60}"></label></form>` : ''}
          <div class="clk-actions"><button class="clk-primary" data-tm-act="toggle">${timer.running ? 'Pause' : 'Start'}</button><button data-tm-act="reset">Reset</button></div>`;
      };

      const renderers = { world: renderWorld, alarm: renderAlarm, stopwatch: renderStopwatch, timer: renderTimer };
      const render = () => {
        tabs.forEach((button) => button.classList.toggle('active', button.dataset.tab === tab));
        renderers[tab]();
      };

      const saveSettings = (change) => {
        system.saveConfig('clocks', { ...read(), ...change });
        render();
      };

      win.body.querySelector('.clk-tabs').addEventListener('click', (event) => {
        const button = event.target.closest('[data-tab]');
        if (!button) return;
        tab = button.dataset.tab;
        render();
      });

      view.addEventListener('change', (event) => {
        const target = event.target;
        const settings = read();
        if (target.matches('[data-opt="hour24"]')) saveSettings({ hour24: target.checked });
        else if (target.matches('.clk-add') && target.value) saveSettings({ zones: [...settings.zones, target.value].slice(0, 12) });
        else if (target.matches('[data-alarm]')) saveSettings({ alarms: settings.alarms.map((alarm, index) => (index === Number(target.dataset.alarm) ? { ...alarm, enabled: target.checked } : alarm)) });
        else if (target.closest('.tmr')) {
          const form = target.closest('form');
          const total = Number(form.h.value || 0) * 3600 + Number(form.m.value || 0) * 60 + Number(form.s.value || 0);
          timer.total = Math.max(1, Math.min(359999, total));
          timer.remaining = timer.total;
          const display = view.querySelector('[data-timer]');
          if (display) display.textContent = formatTimer(timer.remaining);
        }
      });

      view.addEventListener('submit', (event) => {
        event.preventDefault();
        if (!event.target.matches('.clk-form') || event.target.matches('.tmr')) return;
        const settings = read();
        if (settings.alarms.length >= MAX_ALARMS) return;
        saveSettings({ alarms: [...settings.alarms, { time: event.target.time.value, label: event.target.label.value.trim(), enabled: true }].sort((a, b) => a.time.localeCompare(b.time)) });
      });

      view.addEventListener('click', (event) => {
        const settings = read();
        const remove = event.target.closest('[data-remove]');
        const del = event.target.closest('[data-delete]');
        const sw = event.target.closest('[data-sw-act]');
        const tm = event.target.closest('[data-tm-act]');
        if (remove) {
          saveSettings({ zones: settings.zones.filter((zone) => zone !== remove.dataset.remove) });
        } else if (del) {
          saveSettings({ alarms: settings.alarms.filter((_, index) => index !== Number(del.dataset.delete)) });
        } else if (sw) {
          if (sw.dataset.swAct === 'toggle') {
            if (stopwatch.running) {
              stopwatch.elapsed = stopwatchMs();
              stopwatch.running = false;
            } else {
              stopwatch.started = performance.now();
              stopwatch.running = true;
            }
          } else if (sw.dataset.swAct === 'lap') {
            stopwatch.laps.push(stopwatchMs());
          } else {
            Object.assign(stopwatch, { running: false, started: 0, elapsed: 0, laps: [] });
          }
          renderStopwatch();
        } else if (tm) {
          if (tm.dataset.tmAct === 'toggle') {
            if (timer.running) {
              timer.remaining = timerSeconds();
              timer.running = false;
            } else if (timer.remaining > 0) {
              timer.end = performance.now() + timer.remaining * 1000;
              timer.running = true;
            }
          } else {
            timer.running = false;
            timer.remaining = timer.total;
          }
          renderTimer();
        }
      });

      const interval = setInterval(() => {
        if (tab === 'world') {
          view.querySelectorAll('[data-zone]').forEach((node) => {
            node.textContent = timeIn(node.dataset.zone);
          });
        } else if (tab === 'stopwatch') {
          const node = view.querySelector('[data-sw]');
          if (node) node.textContent = formatStopwatch(stopwatchMs());
        } else if (tab === 'timer') {
          const node = view.querySelector('[data-timer]');
          if (node) node.textContent = formatTimer(timerSeconds());
          if (!timer.running && view.querySelector('[data-tm-act="toggle"]') && view.querySelector('[data-tm-act="toggle"]').textContent === 'Pause') renderTimer();
        }
      }, 100);
      const stopConfig = system.onConfig('clocks', render);
      win.onClose = () => {
        clearInterval(interval);
        stopConfig();
      };
      render();
      return win;
    });
  }

  const processNames = {
    firefox: 'firefox',
    files: 'nautilus',
    center: 'app-center',
    help: 'help',
    settings: 'settings',
    terminal: 'terminal',
    mail: 'mail',
    announcements: 'announcements',
    admin: 'admin-panel',
    editor: 'text-editor',
    viewer: 'image-viewer',
    music: 'music',
    paint: 'paint',
  };

  const openMonitor = () =>
    focusOrCreate('system-monitor', () => {
      const win = createWindow({ app: 'system-monitor', title: 'System Monitor', width: 760, height: 540, minWidth: 420, minHeight: 360, className: 'is-monitor' });
      let tab = 'processes';
      let selected = null;
      win.body.innerHTML = `
        <div class="mon">
          <nav class="clk-tabs">${[['processes', 'Processes'], ['resources', 'Resources'], ['filesystems', 'File Systems']].map(([id, label]) => `<button class="clk-tab" data-tab="${id}">${label}</button>`).join('')}</nav>
          <div class="mon-view"></div>
        </div>`;
      const view = win.body.querySelector('.mon-view');
      const tabs = [...win.body.querySelectorAll('.clk-tab')];
      const history = { cpu: [], memory: [], network: [] };
      let busy = 0;
      let lastTick = performance.now();
      let observer = null;
      try {
        observer = new PerformanceObserver((list) => {
          list.getEntries().forEach((entry) => {
            busy += entry.duration;
          });
        });
        observer.observe({ entryTypes: ['longtask'] });
      } catch (error) {
        observer = null;
      }

      const pidOf = (id) => 1000 + [...id].reduce((sum, char) => sum + char.charCodeAt(0), 0);
      const sizeOf = (win) => {
        const nodes = win.el.querySelectorAll('*').length;
        let canvasBytes = 0;
        win.el.querySelectorAll('canvas').forEach((canvas) => {
          canvasBytes += canvas.width * canvas.height * 4;
        });
        let mediaBytes = 0;
        win.el.querySelectorAll('img').forEach((img) => {
          mediaBytes += (img.naturalWidth || 0) * (img.naturalHeight || 0) * 4;
        });
        return nodes * 700 + canvasBytes + mediaBytes;
      };
      const bytesText = (bytes) => (bytes > 1048576 ? `${(bytes / 1048576).toFixed(1)} MiB` : `${Math.max(1, Math.round(bytes / 1024))} KiB`);

      const groups = () => {
        const byApp = new Map();
        windows.forEach((item) => {
          const list = byApp.get(item.app) || [];
          list.push(item);
          byApp.set(item.app, list);
        });
        return [...byApp].map(([id, list]) => ({
          id,
          name: processNames[id] || id,
          pid: pidOf(id),
          count: list.length,
          bytes: list.reduce((sum, item) => sum + sizeOf(item), 0),
          status: list.every((item) => item.minimized) ? 'Sleeping' : 'Running',
          list,
        }));
      };

      const sparkline = (values, max, color) => {
        const width = 320;
        const height = 80;
        const points = values.map((value, index) => `${(index / 59) * width},${height - Math.min(1, value / max) * height}`).join(' ');
        return `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" class="mon-graph"><polyline fill="none" stroke="${color}" stroke-width="2" points="${points}"/></svg>`;
      };

      const renderProcesses = () => {
        const list = groups().sort((a, b) => b.bytes - a.bytes);
        view.innerHTML = `
          <div class="mon-bar"><span>${list.length} processes</span><span class="clk-actions"><button data-mon="show"${selected ? '' : ' disabled'}>Show</button><button data-mon="end" class="clk-danger"${selected ? '' : ' disabled'}>End Process</button></span></div>
          <table class="mon-table"><thead><tr><th>Process Name</th><th>Status</th><th>Windows</th><th>Memory (est.)</th><th>PID</th></tr></thead>
          <tbody>${[{ id: '__shell', name: 'lambdaweb-shell', status: 'Running', count: 1, bytes: (system.jsHeapBytes() || 30 * 1048576) * 0.25, pid: 1 }, ...list]
            .map((row) => `<tr data-pid="${row.id}" class="${selected === row.id ? 'selected' : ''}${row.id === '__shell' ? ' fixed' : ''}"><td>${escapeHtml(row.name)}</td><td>${row.status}</td><td>${row.count}</td><td>${bytesText(row.bytes)}</td><td>${row.pid}</td></tr>`)
            .join('')}</tbody></table>`;
      };

      const renderResources = () => {
        const hw = system.hw;
        const cpu = history.cpu[history.cpu.length - 1] || 0;
        const heap = system.jsHeapBytes();
        const total = hw.memoryGiB ? hw.memoryGiB * 1073741824 : 0;
        const connection = ctx.network.link();
        view.innerHTML = `
          <section class="mon-card"><h3>CPU <small>${hw.cores} logical cores · main-thread load</small></h3>${sparkline(history.cpu, 100, '#3584e4')}<p>${cpu.toFixed(0)}%</p></section>
          <section class="mon-card"><h3>Memory <small>JavaScript heap</small></h3>${sparkline(history.memory, Math.max(...history.memory, 1), '#7764d8')}<p>${heap ? bytesText(heap) : 'Not reported by this browser'}${total ? ` of ${hw.memoryGiB}${hw.memoryGiB === 8 ? '+' : ''} GiB device memory` : ''}</p></section>
          <section class="mon-card"><h3>Network <small>${ctx.network.online() ? 'Connected' : 'Disconnected'}</small></h3>${sparkline(history.network, Math.max(...history.network, 1), '#4e9a06')}<p>${connection ? `${connection.downlink} Mbit/s downlink, ${connection.rtt} ms round trip` : 'Link speed not reported by this browser'}</p></section>`;
      };

      const renderFilesystems = () => {
        const storage = system.hw.storage;
        const used = storage ? storage.used : 0;
        const quota = storage ? storage.quota : 0;
        const percent = quota ? Math.max(1, Math.round((used / quota) * 100)) : 0;
        view.innerHTML = `
          <table class="mon-table"><thead><tr><th>Device</th><th>Directory</th><th>Type</th><th>Total</th><th>Used</th></tr></thead>
          <tbody><tr><td>browser-store</td><td>/</td><td>idb</td><td>${quota ? `${system.gib(quota).toFixed(1)} GiB` : 'Unknown'}</td><td>${quota ? `${bytesText(used)} (${percent}%)` : 'Unknown'}</td></tr>
          <tr><td>tmpfs</td><td>/tmp</td><td>tmpfs</td><td>—</td><td>—</td></tr></tbody></table>
          <div class="mon-bar-graph"><i style="width:${percent}%"></i></div>`;
      };

      const render = () => {
        tabs.forEach((button) => button.classList.toggle('active', button.dataset.tab === tab));
        if (tab === 'processes') renderProcesses();
        else if (tab === 'resources') renderResources();
        else renderFilesystems();
      };

      win.body.querySelector('.clk-tabs').addEventListener('click', (event) => {
        const button = event.target.closest('[data-tab]');
        if (!button) return;
        tab = button.dataset.tab;
        render();
      });
      view.addEventListener('click', (event) => {
        const row = event.target.closest('[data-pid]');
        const act = event.target.closest('[data-mon]');
        if (row && !row.classList.contains('fixed')) {
          selected = row.dataset.pid;
          renderProcesses();
        } else if (act && selected) {
          const group = groups().find((item) => item.id === selected);
          if (group && act.dataset.mon === 'show') group.list[0].focus();
          else if (group && act.dataset.mon === 'end') {
            [...group.list].forEach((item) => item.close());
            selected = null;
          }
          render();
        }
      });

      const sample = () => {
        const now = performance.now();
        const elapsed = Math.max(1, now - lastTick);
        lastTick = now;
        const load = Math.min(100, (busy / elapsed) * 100);
        busy = 0;
        const connection = ctx.network.link();
        history.cpu.push(observer ? load : Math.min(100, Math.max(0, load)));
        history.memory.push((system.jsHeapBytes() || 0) / 1048576);
        history.network.push(ctx.network.online() ? (connection ? connection.downlink : 1) : 0);
        Object.values(history).forEach((series) => {
          while (series.length < 60) series.unshift(0);
          if (series.length > 60) series.shift();
        });
        if (tab !== 'filesystems' || !view.children.length) render();
      };
      const interval = setInterval(sample, 1000);
      win.onClose = () => {
        clearInterval(interval);
        if (observer) observer.disconnect();
      };
      sample();
      return win;
    });

  ctx.guiApps = { openCalculator, openClocks, openMonitor };
};
