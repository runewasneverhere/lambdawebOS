window.lambdawebSetup = {
  run({ root, notice, NAME, RESERVED, fileToAvatar, create, finish }) {
    const HOSTNAME = /^[a-z][a-z0-9-]{0,30}$/;
    const data = { hostname: '', username: '', password: '', pfp: null };
    const esc = (text) => String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const eyeOpen = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M1.5 12S5.5 5 12 5s10.5 7 10.5 7-4 7-10.5 7S1.5 12 1.5 12Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>';
    const eyeShut = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18M10.6 5.2A9.9 9.9 0 0 1 12 5c6.5 0 10.5 7 10.5 7a17 17 0 0 1-3.2 3.9M6.4 6.5C3.4 8.4 1.5 12 1.5 12S5.5 19 12 19c1.6 0 3-.4 4.3-1" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
    const slides = [
      { image: 'lambdaweb/splash/desktop.png', text: 'lambdawebOS is a fully functional web-based GNOME desktop operating system. All written in HTML, Javascript, and CSS!' },
      { image: 'lambdaweb/splash/app-center.png', text: 'Download recreations of popular linux terminal applications and more!' },
      { image: 'lambdaweb/splash/mail.png', text: 'Make friends, and talk to other lambdawebOS users!' },
    ];

    root.innerHTML = '<div class="su"><div class="su-card"></div></div>';
    const shell = root.querySelector('.su');
    const card = root.querySelector('.su-card');
    let timers = [];
    const clearTimers = () => {
      timers.forEach((id) => {
        clearTimeout(id);
        clearInterval(id);
      });
      timers = [];
    };

    const show = (html, className = '') => {
      clearTimers();
      shell.className = `su ${className}`.trim();
      card.className = 'su-card';
      card.innerHTML = html;
      void card.offsetWidth;
      card.classList.add('in');
      return card;
    };

    const logoImg = '<img class="su-logo" src="lambdaweb/lambda-white.png" alt="lambdawebOS">';

    const pageWelcome = () => {
      const page = show(`
        ${logoImg}
        <h1>Welcome to lambdawebOS</h1>
        <p class="su-lead">Let's get your desktop ready. In a couple of quick steps you'll pick a name for your device and create your account.</p>
        <p class="su-small">Everything is stored in this browser, so it only takes a minute. Messages you send with Mail can be reviewed by site administrators.</p>
        <p class="su-error" role="alert">${esc(notice || '')}</p>
        <div class="su-actions"><button class="su-btn primary" type="button" data-next>Get Started</button></div>`);
      page.querySelector('[data-next]').addEventListener('click', pageHost);
      page.querySelector('[data-next]').focus();
    };

    const pageHost = () => {
      const page = show(`
        ${logoImg}
        <h1>Login Information</h1>
        <p class="su-lead">Please input your desired hostname for lambdawebOS</p>
        <input class="su-input" name="hostname" type="text" placeholder="Hostname" value="${esc(data.hostname)}" maxlength="31" autocomplete="off" autocapitalize="off" spellcheck="false">
        <p class="su-small">Letters, numbers and hyphens, starting with a letter. For example: my-laptop</p>
        <p class="su-error" role="alert"></p>
        <div class="su-actions"><button class="su-btn" type="button" data-back>Back</button><button class="su-btn primary" type="button" data-next>Next</button></div>`);
      const input = page.querySelector('input');
      const error = page.querySelector('.su-error');
      const next = () => {
        const value = input.value.trim().toLowerCase();
        if (!HOSTNAME.test(value)) {
          error.textContent = 'Use letters, numbers and hyphens, starting with a letter.';
          return;
        }
        data.hostname = value;
        pageAccount();
      };
      page.querySelector('[data-back]').addEventListener('click', pageWelcome);
      page.querySelector('[data-next]').addEventListener('click', next);
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') next();
      });
      input.focus();
    };

    const passwordField = (name, placeholder, autocomplete) =>
      `<div class="su-pass"><input class="su-input" name="${name}" type="password" placeholder="${placeholder}" autocomplete="${autocomplete}" maxlength="128"><button class="su-eye" type="button" aria-label="Show password" aria-pressed="false">${eyeOpen}</button></div>`;

    const pageAccount = () => {
      const page = show(`
        ${logoImg}
        <h1>Login Information</h1>
        <p class="su-lead">Please input your username &amp; password</p>
        <label class="su-avatar-pick"><img class="su-avatar" alt="" hidden><span class="su-avatar su-blank">+</span><input type="file" accept="image/png,image/jpeg,image/webp" hidden></label>
        <p class="su-small">Profile picture (optional)</p>
        <input class="su-input" name="username" type="text" placeholder="Username" value="${esc(data.username)}" maxlength="16" autocomplete="off" autocapitalize="off" spellcheck="false">
        ${passwordField('password', 'Password', 'new-password')}
        ${passwordField('confirm', 'Confirm password', 'new-password')}
        <p class="su-error" role="alert"></p>
        <div class="su-actions"><button class="su-btn" type="button" data-back>Back</button><button class="su-btn primary" type="button" data-next>Install</button></div>`);
      const username = page.querySelector('[name="username"]');
      const password = page.querySelector('[name="password"]');
      const confirm = page.querySelector('[name="confirm"]');
      const error = page.querySelector('.su-error');
      const next = page.querySelector('[data-next]');
      const preview = page.querySelector('img.su-avatar');
      const blank = page.querySelector('span.su-avatar');
      if (data.pfp) {
        preview.src = data.pfp;
        preview.hidden = false;
        blank.hidden = true;
      }

      page.querySelectorAll('.su-eye').forEach((button) =>
        button.addEventListener('click', () => {
          const field = button.previousElementSibling;
          const show = field.type === 'password';
          field.type = show ? 'text' : 'password';
          button.innerHTML = show ? eyeShut : eyeOpen;
          button.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
          button.setAttribute('aria-pressed', String(show));
        })
      );

      page.querySelector('input[type="file"]').addEventListener('change', async (event) => {
        const file = event.target.files[0];
        if (!file) return;
        try {
          data.pfp = await fileToAvatar(file);
          preview.src = data.pfp;
          preview.hidden = false;
          blank.hidden = true;
          error.textContent = '';
        } catch (problem) {
          error.textContent = problem.message;
        }
        event.target.value = '';
      });

      const submit = async () => {
        const name = username.value.trim().toLowerCase();
        error.textContent = '';
        if (!NAME.test(name)) {
          error.textContent = 'Usernames are 3 to 16 characters: letters, numbers, - and _, starting with a letter or _.';
          return;
        }
        if (RESERVED.includes(name)) {
          error.textContent = 'That username is already taken.';
          return;
        }
        if (password.value.length < 4) {
          error.textContent = 'Use a password of at least 4 characters.';
          return;
        }
        if (password.value !== confirm.value) {
          error.textContent = 'The passwords do not match.';
          return;
        }
        if (!window.crypto || !crypto.subtle) {
          error.textContent = 'This browser cannot create accounts here.';
          return;
        }
        data.username = name;
        next.disabled = true;
        next.textContent = 'Checking…';
        try {
          const account = await create({ username: name, password: password.value, pfp: data.pfp, hostname: data.hostname });
          data.password = '';
          pageInstall(account);
        } catch (problem) {
          error.textContent = problem.message;
          next.disabled = false;
          next.textContent = 'Install';
        }
      };
      page.querySelector('[data-back]').addEventListener('click', () => {
        data.username = username.value.trim().toLowerCase();
        pageHost();
      });
      next.addEventListener('click', submit);
      page.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && event.target.tagName === 'INPUT' && event.target.type !== 'file') submit();
      });
      username.focus();
    };

    const pageInstall = (account) => {
      const page = show(
        `
        <div class="su-stage">${slides.map((slide, index) => `<figure class="su-slide${index === 0 ? ' on' : ''}"><img src="${slide.image}" alt="" onerror="this.style.visibility='hidden'"><figcaption>${esc(slide.text)}</figcaption></figure>`).join('')}</div>
        <div class="su-dots">${slides.map((_, index) => `<i${index === 0 ? ' class="on"' : ''}></i>`).join('')}</div>
        <div class="su-spinner"><img class="su-lambda" src="lambdaweb/lambda-white.png" alt=""></div>
        <p class="su-status">Installing lambdawebOS…</p>`,
        'splash'
      );
      const items = [...page.querySelectorAll('.su-slide')];
      const dots = [...page.querySelectorAll('.su-dots i')];
      let current = 0;
      timers.push(
        setInterval(() => {
          current = (current + 1) % items.length;
          items.forEach((item, index) => item.classList.toggle('on', index === current));
          dots.forEach((dot, index) => dot.classList.toggle('on', index === current));
        }, 5200)
      );
      const duration = 15000 + Math.random() * 30000;
      timers.push(
        setTimeout(() => {
          clearTimers();
          const curtain = document.createElement('div');
          curtain.className = 'su-curtain';
          curtain.innerHTML = '<img class="su-curtain-logo" src="lambdaweb/lambda-white.png" alt="lambdawebOS">';
          root.append(curtain);
          requestAnimationFrame(() => curtain.classList.add('dark'));
          setTimeout(() => finish(account, curtain), 4200);
        }, duration)
      );
    };

    pageWelcome();
  },
};
