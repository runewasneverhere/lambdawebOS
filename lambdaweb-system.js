window.lambdawebSystem = (ctx) => {
  const { fs, HOME, USER, HOSTNAME, state } = ctx;
  const BUILD = new Date('2026-10-30T09:00:00Z');
  const BOOT = Date.now();
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const locale = (navigator.language || 'en-US').replace('-', '_');

  const hw = {
    os: 'Unknown OS',
    arch: 'x86_64',
    host: 'Generic Device',
    browser: 'Browser',
    engine: 'Blink',
    gpu: null,
    cores: navigator.hardwareConcurrency || 1,
    memoryGiB: navigator.deviceMemory || null,
    battery: null,
    storage: null,
  };

  const brandOf = (brands) => {
    const list = (brands || []).map((entry) => entry.brand).filter((name) => !/not.?a.?brand|^chromium$/i.test(name));
    return list.find((name) => /brave|edge|opera|vivaldi|chrome|firefox/i.test(name)) || list[0] || null;
  };

  const detect = async () => {
    const ua = navigator.userAgent;
    const data = navigator.userAgentData;
    let platform = (data && data.platform) || navigator.platform || '';
    let platformVersion = '';
    let model = '';
    if (data && data.getHighEntropyValues) {
      try {
        const high = await data.getHighEntropyValues(['platformVersion', 'architecture', 'bitness', 'model']);
        platformVersion = high.platformVersion || '';
        model = high.model || '';
        if (high.architecture === 'arm') hw.arch = 'aarch64';
        else if (high.architecture === 'x86') hw.arch = high.bitness === '32' ? 'i686' : 'x86_64';
      } catch (error) {
        platformVersion = '';
      }
    } else if (/arm|aarch64/i.test(ua)) {
      hw.arch = 'aarch64';
    }
    const major = parseInt(platformVersion, 10);
    if (/windows|win32/i.test(platform)) hw.os = Number.isFinite(major) && major >= 13 ? 'Windows 11' : 'Windows 10';
    else if (/mac/i.test(platform)) hw.os = 'macOS';
    else if (/android/i.test(platform + ua)) hw.os = 'Android';
    else if (/cros|chrome os/i.test(platform + ua)) hw.os = 'ChromeOS';
    else if (/linux/i.test(platform + ua)) hw.os = 'Linux';
    else if (/iphone|ipad|ios/i.test(platform + ua)) hw.os = 'iOS';
    else hw.os = platform || 'Unknown OS';
    hw.host = model ? `${model} (${hw.os})` : hw.os;

    let browser = brandOf(data && data.brands);
    if (navigator.brave && navigator.brave.isBrave) {
      try {
        if (await navigator.brave.isBrave()) browser = 'Brave';
      } catch (error) {
        browser = browser || null;
      }
    }
    const version = (ua.match(/(?:Firefox|Chrome|Version|Edg|OPR)\/(\d+(?:\.\d+)*)/) || [])[1] || '';
    if (!browser) browser = /firefox/i.test(ua) ? 'Firefox' : /safari/i.test(ua) && !/chrome/i.test(ua) ? 'Safari' : 'Browser';
    hw.browser = `${browser}${version ? ` ${version.split('.')[0]}` : ''}`;
    hw.engine = /firefox/i.test(ua) ? 'Gecko' : /applewebkit/i.test(ua) && !/chrome|chromium|edg|opr/i.test(ua) ? 'WebKit' : 'Blink';

    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
      let renderer = gl && ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '') : '';
      const angle = renderer.match(/^ANGLE \(([^,]+),\s*(.+?)(?:\s*\(0x[0-9a-f]+\))?(?:\s+(?:Direct3D|OpenGL|Metal|Vulkan)[^,]*)?(?:,\s*[^,]+)?\)$/i);
      if (angle) renderer = angle[2].replace(/\s*\(0x[0-9a-f]+\)/i, '').replace(/\s+(Direct3D|OpenGL|Metal|Vulkan).*$/i, '');
      hw.gpu = renderer || null;
    } catch (error) {
      hw.gpu = null;
    }

    if (navigator.getBattery) {
      try {
        const battery = await navigator.getBattery();
        const read = () => {
          hw.battery = { level: Math.round(battery.level * 100), charging: battery.charging };
        };
        read();
        battery.addEventListener('levelchange', read);
        battery.addEventListener('chargingchange', read);
      } catch (error) {
        hw.battery = null;
      }
    }
  };

  const refreshStorage = async () => {
    if (!(navigator.storage && navigator.storage.estimate)) return;
    try {
      const estimate = await navigator.storage.estimate();
      hw.storage = { used: estimate.usage || 0, quota: estimate.quota || 0 };
    } catch (error) {
      hw.storage = null;
    }
  };

  const jsHeapBytes = () => (performance.memory && performance.memory.usedJSHeapSize) || null;
  const uptimeSeconds = () => Math.max(1, Math.round((Date.now() - BOOT) / 1000));
  const gib = (bytes) => bytes / 1024 ** 3;
  const mib = (bytes) => bytes / 1024 ** 2;

  detect();
  refreshStorage();
  setInterval(refreshStorage, 60000);

  const sounds = {
    login: 'desktop-login',
    logout: 'desktop-logoff',
    bell: 'bell',
    complete: 'complete',
    message: 'message-new-instant',
    mail: 'message-new-email',
    error: 'dialog-error',
    question: 'dialog-question',
    warning: 'dialog-warning',
    'device-added': 'device-added',
    'device-removed': 'device-removed',
    'trash-empty': 'trash-empty',
    volume: 'audio-volume-change',
  };
  const play = (name, { force = false } = {}) => {
    if ((!state.sounds && !force) || !sounds[name]) return null;
    try {
      const audio = new Audio(ctx.asset(`sounds/${sounds[name]}.oga`));
      audio.volume = Math.min(1, Math.max(0, state.volume / 100));
      audio.play().catch(() => {});
      return audio;
    } catch (error) {
      return null;
    }
  };

  const configPath = (app) => `${HOME}/.config/${app}/settings.json`;
  const known = new Map();
  const subscribers = new Map();
  const typed = (defaults, source) => {
    const result = { ...defaults };
    if (source && typeof source === 'object') {
      Object.keys(defaults).forEach((key) => {
        if (typeof source[key] === typeof defaults[key] && Array.isArray(source[key]) === Array.isArray(defaults[key]) && source[key] !== null) result[key] = source[key];
      });
    }
    return result;
  };
  const config = (app, defaults) => {
    let parsed = null;
    try {
      parsed = JSON.parse(fs.read(configPath(app)));
    } catch (error) {
      parsed = null;
    }
    return typed(defaults, parsed);
  };
  const saveConfig = (app, values) => {
    const path = configPath(app);
    const text = `${JSON.stringify(values, null, 2)}\n`;
    known.set(path, text);
    fs.seedFile(path, text, { overwrite: true });
    fs.markDirty();
  };
  const ensureConfig = (app, defaults) => {
    const path = configPath(app);
    if (fs.seedFile(path, `${JSON.stringify(defaults, null, 2)}\n`)) fs.markDirty();
    try {
      known.set(path, fs.read(path));
    } catch (error) {
      known.delete(path);
    }
  };
  const onConfig = (app, fn) => {
    const list = subscribers.get(app) || [];
    list.push(fn);
    subscribers.set(app, list);
    return () => subscribers.set(app, (subscribers.get(app) || []).filter((item) => item !== fn));
  };

  let configTimer = null;
  fs.onDirty(() => {
    clearTimeout(configTimer);
    configTimer = setTimeout(() => {
      subscribers.forEach((list, app) => {
        const path = configPath(app);
        let text = null;
        try {
          text = fs.read(path);
        } catch (error) {
          text = null;
        }
        if (text === known.get(path)) return;
        known.set(path, text);
        list.forEach((fn) => fn());
      });
      if (ctx.desktopConfig) ctx.desktopConfig.fromFile();
    }, 300);
  });

  const stamp = (offsetMinutes = 0) => {
    const d = new Date(BOOT - offsetMinutes * 60000);
    const month = d.toLocaleDateString('en-US', { month: 'short' });
    return `${month} ${String(d.getDate()).padStart(2, ' ')} ${d.toLocaleTimeString('en-GB')}`;
  };

  const hex32 = (text) => {
    let h = 2166136261;
    const out = [];
    for (let round = 0; round < 4; round++) {
      for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i) + round;
        h = Math.imul(h, 16777619) >>> 0;
      }
      out.push(h.toString(16).padStart(8, '0'));
    }
    return out.join('');
  };

  const baseCommands = [
    'bash', 'cat', 'cp', 'date', 'echo', 'grep', 'head', 'hostname', 'id', 'ls', 'mkdir', 'mv', 'pwd', 'rm', 'rmdir',
    'sort', 'sudo', 'tail', 'touch', 'uname', 'uniq', 'uptime', 'wc', 'whoami', 'xdg-open', 'env', 'printenv', 'clear',
    'nautilus', 'gnome-text-editor', 'gnome-control-center', 'gnome-terminal', 'firefox', 'df', 'free', 'which', 'man',
  ];

  const seedSystem = () => {
    const seed = (path, content, options = {}) => fs.seedFile(path, content, { overwrite: true, mtime: BUILD, ...options });
    const dir = (path, options = {}) => fs.seedDir(path, { mtime: BUILD, ...options });

    ['boot', 'dev', 'media', 'mnt', 'opt', 'run', 'srv', 'sys', 'tmp'].forEach((name) => dir(`/${name}`));
    dir('/root', { restricted: true });
    dir('/lost+found', { restricted: true });
    dir(`/media/${USER}`);
    dir('/run/lock');
    dir(`/run/user/1000`);
    dir('/opt');
    dir('/usr/local/bin');
    dir('/usr/local/lib');
    dir('/usr/local/share');
    dir('/usr/bin');
    dir('/usr/lib');
    dir('/usr/include');
    dir('/usr/games');
    dir('/usr/sbin');
    ['bin', 'sbin', 'lib'].forEach((name) => fs.seedAlias(`/${name}`, `/usr/${name}`));
    dir('/usr/share/doc');
    dir('/usr/share/fonts');
    dir('/usr/share/icons');
    dir('/usr/share/man');
    dir('/usr/share/applications');
    dir('/var/cache');
    dir('/var/lib');
    dir('/var/mail');
    dir('/var/spool');
    dir('/var/tmp');
    dir('/lib64');
    dir('/etc/skel');
    dir('/etc/default');
    dir('/etc/NetworkManager');
    dir('/etc/ssl/certs');
    dir('/etc/xdg');

    ['null', 'zero', 'full', 'random', 'urandom', 'tty', 'console'].forEach((name) => seed(`/dev/${name}`, ''));

    seed('/etc/hostname', `${HOSTNAME}\n`);
    seed('/etc/hosts', `127.0.0.1\tlocalhost\n127.0.1.1\t${HOSTNAME}\n\n::1\t\tip6-localhost ip6-loopback\nfe00::0\t\tip6-localnet\nff00::0\t\tip6-mcastprefix\nff02::1\t\tip6-allnodes\nff02::2\t\tip6-allrouters\n`);
    seed('/etc/os-release', ['PRETTY_NAME="lambdawebOS 1.0"', 'NAME="lambdawebOS"', 'VERSION_ID="1.0"', 'VERSION="1.0"', 'ID=lambdaweb', 'HOME_URL="https://runewasneverhere.com/"', 'SUPPORT_URL="https://runewasneverhere.com/"', 'BUG_REPORT_URL="https://runewasneverhere.com/"', ''].join('\n'));
    seed('/etc/lsb-release', 'DISTRIB_ID=lambdawebOS\nDISTRIB_RELEASE=1.0\nDISTRIB_DESCRIPTION="lambdawebOS 1.0"\n');
    seed('/etc/issue', 'lambdawebOS 1.0 \\n \\l\n\n');
    seed('/etc/issue.net', 'lambdawebOS 1.0\n');
    seed('/etc/machine-id', `${hex32(`${USER}@${HOSTNAME}`)}\n`);
    seed('/etc/timezone', `${timezone}\n`);
    seed('/etc/resolv.conf', 'nameserver 1.1.1.1\nnameserver 9.9.9.9\n');
    seed('/etc/environment', 'PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/usr/games"\n');
    seed('/etc/shells', '# /etc/shells: valid login shells\n/bin/sh\n/bin/bash\n/usr/bin/bash\n');
    seed('/etc/fstab', '# <file system> <mount point> <type> <options> <dump> <pass>\nUUID=3f2b6c1e-0000-4d1e-9a5e-lambdaweb0001 / ext4 errors=remount-ro 0 1\ntmpfs /tmp tmpfs defaults,noatime 0 0\n');
    seed('/etc/passwd', `root:x:0:0:root:/root:/bin/bash\ndaemon:x:1:1:daemon:/usr/sbin:/usr/sbin/nologin\nbin:x:2:2:bin:/bin:/usr/sbin/nologin\nsys:x:3:3:sys:/dev:/usr/sbin/nologin\nnobody:x:65534:65534:nobody:/nonexistent:/usr/sbin/nologin\n${USER}:x:1000:1000:${USER},,,:${HOME}:/bin/bash\n`);
    seed('/etc/group', `root:x:0:\ndaemon:x:1:\nadm:x:4:${USER}\ncdrom:x:24:${USER}\nsudo:x:27:${USER}\ndip:x:30:${USER}\nplugdev:x:46:${USER}\nnogroup:x:65534:\n${USER}:x:1000:\n`);
    seed('/etc/shadow', 'root:*:20000:0:99999:7:::\n', { restricted: true });
    seed('/etc/profile', '# /etc/profile: system-wide .profile file for the Bourne shell\nexport PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"\nif [ -f /etc/bash.bashrc ]; then . /etc/bash.bashrc; fi\n');
    seed('/etc/bash.bashrc', '# System-wide .bashrc file for interactive bash shells.\n[ -z "$PS1" ] && return\nshopt -s checkwinsize\n');
    seed('/etc/default/locale', `LANG=${locale}.UTF-8\n`);
    seed('/etc/NetworkManager/NetworkManager.conf', '[main]\nplugins=ifupdown,keyfile\n\n[ifupdown]\nmanaged=false\n');
    seed('/etc/lambdaweb-release', 'lambdawebOS 1.0\n');

    const skelBashrc = bashrcText();
    seed('/etc/skel/.bashrc', skelBashrc);
    seed('/etc/skel/.profile', profileText());
    seed('/etc/skel/.bash_logout', logoutText());

    const proc = (path, make) => seed(path, make, { mtime: undefined });
    proc('/proc/version', () => `lambdaweb version 1.0 (${hw.engine} ${hw.browser}) #1 SMP PREEMPT_DYNAMIC ${BUILD.toDateString()}\n`);
    proc('/proc/uptime', () => `${uptimeSeconds()}.00 ${(uptimeSeconds() * 0.9).toFixed(2)}\n`);
    proc('/proc/loadavg', () => '0.08 0.05 0.01 1/142 4242\n');
    proc('/proc/cmdline', () => 'BOOT_IMAGE=/boot/lambdaweb root=UUID=3f2b6c1e quiet splash\n');
    proc('/proc/cpuinfo', () =>
      Array.from({ length: hw.cores }, (_, index) =>
        [`processor\t: ${index}`, 'vendor_id\t: BrowserReported', `model name\t: ${hw.cores}-thread logical processor (${hw.arch})`, `cpu cores\t: ${hw.cores}`, `siblings\t: ${hw.cores}`, ''].join('\n')
      ).join('\n')
    );
    proc('/proc/meminfo', () => {
      const total = Math.round((hw.memoryGiB || 4) * 1024 * 1024);
      const used = Math.round((jsHeapBytes() || 120 * 1024 * 1024) / 1024);
      return `MemTotal:       ${String(total).padStart(10)} kB\nMemFree:        ${String(Math.max(0, total - used)).padStart(10)} kB\nMemAvailable:   ${String(Math.max(0, total - used)).padStart(10)} kB\nSwapTotal:      ${String(0).padStart(10)} kB\nSwapFree:       ${String(0).padStart(10)} kB\n`;
    });

    seed('/var/log/syslog', `${stamp(2)} ${HOSTNAME} systemd[1]: Starting lambdaweb session...\n${stamp(2)} ${HOSTNAME} systemd[1]: Reached target Basic System.\n${stamp(1)} ${HOSTNAME} systemd[1]: Started Network Manager.\n${stamp(1)} ${HOSTNAME} systemd[1]: Started Session of user ${USER}.\n`, { mtime: undefined });
    seed('/var/log/auth.log', `${stamp(1)} ${HOSTNAME} login[612]: pam_unix(login:session): session opened for user ${USER}\n`, { mtime: undefined });
    seed('/var/log/kern.log', `${stamp(2)} ${HOSTNAME} kernel: lambdaweb ${hw.engine} runtime initialised\n`, { mtime: undefined });
    seed('/var/log/boot.log', `[  OK  ] Started lambdaweb desktop.\n`, { mtime: undefined });
    dir('/var/log');
  };

  function bashrcText() {
    return [
      '# ~/.bashrc: executed by bash(1) for non-login shells.',
      '',
      '# If not running interactively, do nothing',
      'case $- in',
      '    *i*) ;;',
      '      *) return;;',
      'esac',
      '',
      '# History options',
      'HISTSIZE=1000',
      'HISTFILESIZE=2000',
      '',
      '# Colored output',
      "alias ls='ls --color=auto'",
      "alias grep='grep --color=auto'",
      '',
      '# Some handy aliases',
      "alias ll='ls -alF'",
      "alias la='ls -A'",
      "alias l='ls -CF'",
      '',
      '# Add your own aliases and exports below, for example:',
      "# alias cls='clear'",
      "# export EDITOR=nano",
      '',
    ].join('\n');
  }
  function profileText() {
    return ['# ~/.profile: executed by the command interpreter for login shells.', '', 'if [ -n "$BASH_VERSION" ]; then', '    if [ -f "$HOME/.bashrc" ]; then', '        . "$HOME/.bashrc"', '    fi', 'fi', '', 'if [ -d "$HOME/.local/bin" ] ; then', '    PATH="$HOME/.local/bin:$PATH"', 'fi', ''].join('\n');
  }
  function logoutText() {
    return ['# ~/.bash_logout: executed by bash(1) when login shell exits.', '', 'if [ "$SHLVL" = 1 ]; then', '    [ -x /usr/bin/clear_console ] && /usr/bin/clear_console -q', 'fi', ''].join('\n');
  }

  const desktopEntry = (id, app) =>
    ['[Desktop Entry]', 'Type=Application', `Name=${app.label}`, `Exec=lambdaweb-launch ${id}`, `Icon=${app.icon}`, 'Terminal=false', 'Categories=GTK;Utility;', `X-Lambdaweb-App=${id}`, ''].join('\n');

  const syncEntries = () => {
    const apps = ctx.apps;
    const appDir = fs.get('/usr/share/applications');
    if (!appDir) return;
    Object.keys(appDir.children).forEach((name) => {
      if (name.startsWith('lambdaweb-') && name.endsWith('.desktop')) delete appDir.children[name];
    });
    Object.entries(apps).forEach(([id, app]) => fs.seedFile(`/usr/share/applications/lambdaweb-${id}.desktop`, desktopEntry(id, app), { overwrite: true, mtime: BUILD }));
    const bin = fs.get('/usr/bin');
    if (bin) {
      Object.keys(bin.children).forEach((name) => {
        if (bin.children[name].lambdawebCommand) delete bin.children[name];
      });
    }
    const commands = [...baseCommands, ...(ctx.installedCommands ? ctx.installedCommands() : [])];
    commands.forEach((name) => {
      fs.seedFile(`/usr/bin/${name}`, `#!/usr/bin/env lambdaweb-shell\n# built-in ${name}\n`, { overwrite: true, mtime: BUILD });
      fs.get(`/usr/bin/${name}`).lambdawebCommand = true;
    });
  };

  const seedHome = () => {
    let changed = false;
    const ensure = (path, content) => {
      if (fs.seedFile(path, content)) changed = true;
    };
    const ensureDir = (path) => {
      const before = !!fs.get(path);
      fs.seedDir(path);
      if (!before) changed = true;
    };
    ensure(`${HOME}/.bashrc`, bashrcText());
    ensure(`${HOME}/.profile`, profileText());
    ensure(`${HOME}/.bash_logout`, logoutText());
    ensure(`${HOME}/.bash_history`, '');
    ['.cache', '.config', '.local/share', '.local/bin', '.ssh'].forEach(ensureDir);
    ensure(`${HOME}/.ssh/known_hosts`, '');
    ensure(`${HOME}/.config/user-dirs.dirs`, ['XDG_DESKTOP_DIR="$HOME/Desktop"', 'XDG_DOWNLOAD_DIR="$HOME/Downloads"', 'XDG_TEMPLATES_DIR="$HOME/Templates"', 'XDG_PUBLICSHARE_DIR="$HOME/Public"', 'XDG_DOCUMENTS_DIR="$HOME/Documents"', 'XDG_MUSIC_DIR="$HOME/Music"', 'XDG_PICTURES_DIR="$HOME/Pictures"', 'XDG_VIDEOS_DIR="$HOME/Videos"', ''].join('\n'));
    ensure(`${HOME}/.config/user-dirs.locale`, `${locale}\n`);
    ensure(`${HOME}/.config/gtk-3.0/bookmarks`, '');
    ensure(`${HOME}/.config/gtk-3.0/settings.ini`, '[Settings]\ngtk-application-prefer-dark-theme=0\n');
    ensure(`${HOME}/.config/nano/nanorc`, '');
    ensure(`${HOME}/.nanorc`, ['# ~/.nanorc: personal settings for nano', '# set tabsize 4', '# set linenumbers', '# set nowrap', '# set autoindent', ''].join('\n'));
    ensure(`${HOME}/.config/peaclock/config`, ['# peaclock configuration', 'set mode clock', 'set time-format 24h', 'set show-date true', 'set color white', ''].join('\n'));
    ensure(`${HOME}/.config/fastfetch/config.jsonc`, ['{', '  // Choose which lines fastfetch prints, and in which order.', '  "modules": ["title", "separator", "os", "host", "kernel", "uptime", "packages", "shell", "display", "de", "wm", "terminal", "cpu", "gpu", "memory", "disk", "battery", "locale"]', '}', ''].join('\n'));
    ensureDir(`${HOME}/.local/share/applications`);
    ensure(`${HOME}/.local/share/recently-used.xbel`, '<?xml version="1.0" encoding="UTF-8"?>\n<xbel version="1.0"></xbel>\n');
    ensureDir(`${HOME}/Desktop`);
    if (changed) fs.markDirty();
  };

  const defaults = {
    files: { showHidden: false, defaultView: 'grid' },
    terminal: { fontSize: 15, scheme: 'default' },
    'text-editor': { fontSize: 14, wordWrap: true },
    rhythmbox: { volume: 0.8, shuffle: false, repeat: false },
    paint: { color: '#000000', size: 4 },
    mail: { newMailNotifications: true },
    clocks: { hour24: true, zones: ['America/New_York', 'Europe/London', 'Asia/Tokyo'], alarms: [] },
    calculator: { mode: 'basic' },
  };

  seedSystem();
  seedHome();
  Object.entries(defaults).forEach(([app, values]) => ensureConfig(app, values));

  ctx.system = { hw, play, sounds, config, saveConfig, onConfig, defaults, syncEntries, desktopEntry, uptimeSeconds, jsHeapBytes, gib, mib, configPath, stamp, BOOT };
  ctx.sound = { play };
};
