window.lambdawebNetwork = (ctx) => {
  const { root, state, notify, sym, escapeHtml } = ctx;
  const quick = root.querySelector('.qs');
  const quickMain = quick.querySelector('.qs-main');
  const panel = quick.querySelector('.qs-panel');
  const wifiTile = quick.querySelector('[data-tile="wifi"]');
  const bluetoothTile = quick.querySelector('[data-tile="bluetooth"]');
  const listeners = new Set();
  const renderers = new Set();

  const online = () => state.wifi && navigator.onLine !== false;
  const onChange = (fn) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  };

  const bluetooth = {
    supported: !!navigator.bluetooth,
    devices: new Map(),
    busy: false,
    message: '',
  };
  if (!bluetooth.supported) bluetoothTile.remove();

  const rerender = () => renderers.forEach((fn) => fn());

  const refresh = () => {
    root.classList.toggle('wifi-off', !online());
    wifiTile.classList.toggle('on', state.wifi);
    bluetoothTile.classList.toggle('on', state.bluetooth);
    listeners.forEach((fn) => fn(online()));
    rerender();
  };

  const setWifi = (value) => {
    state.wifi = !!value;
    ctx.saveState();
    refresh();
  };

  const nameOf = (device) => device.name || `Unnamed device (${device.id.slice(0, 6)})`;

  const watch = (device) => {
    if (bluetooth.devices.has(device.id)) return;
    bluetooth.devices.set(device.id, device);
    device.addEventListener('gattserverdisconnected', () => {
      ctx.sound.play('device-removed');
      notify({ title: 'Bluetooth', body: `${nameOf(device)} disconnected.`, iconName: 'settings.svg' });
      rerender();
    });
  };

  if (bluetooth.supported && navigator.bluetooth.getDevices) {
    navigator.bluetooth
      .getDevices()
      .then((list) => {
        list.forEach(watch);
        rerender();
      })
      .catch(() => {});
  }

  const setBluetooth = (value) => {
    state.bluetooth = !!value;
    if (!state.bluetooth) {
      bluetooth.devices.forEach((device) => {
        if (device.gatt && device.gatt.connected) device.gatt.disconnect();
      });
    }
    ctx.saveState();
    refresh();
  };

  const scan = async () => {
    if (!bluetooth.supported || !state.bluetooth || bluetooth.busy) return;
    bluetooth.busy = true;
    bluetooth.message = '';
    rerender();
    try {
      const device = await navigator.bluetooth.requestDevice({ acceptAllDevices: true });
      watch(device);
    } catch (error) {
      if (error.name !== 'NotFoundError') bluetooth.message = error.message || 'Could not scan for devices.';
    }
    bluetooth.busy = false;
    rerender();
  };

  const connect = async (id) => {
    const device = bluetooth.devices.get(id);
    if (!device || !device.gatt || bluetooth.busy) return;
    bluetooth.busy = true;
    bluetooth.message = '';
    rerender();
    try {
      await device.gatt.connect();
      ctx.sound.play('device-added');
      notify({ title: 'Bluetooth', body: `Connected to ${nameOf(device)}.`, iconName: 'settings.svg' });
    } catch (error) {
      bluetooth.message = `Could not connect to ${nameOf(device)}.`;
    }
    bluetooth.busy = false;
    rerender();
  };

  const disconnect = (id) => {
    const device = bluetooth.devices.get(id);
    if (device && device.gatt && device.gatt.connected) device.gatt.disconnect();
  };

  const renderBluetooth = (container, { onBack } = {}) => {
    const draw = () => {
      const rows = [...bluetooth.devices.values()]
        .map((device) => {
          const connected = !!(device.gatt && device.gatt.connected);
          return `<div class="blu-row"><div class="blu-name"><span>${escapeHtml(nameOf(device))}</span><em>${connected ? 'Connected' : 'Not connected'}</em></div><button class="blu-btn" data-blu="${connected ? 'disconnect' : 'connect'}" data-id="${escapeHtml(device.id)}"${!state.bluetooth || bluetooth.busy ? ' disabled' : ''}>${connected ? 'Disconnect' : 'Connect'}</button></div>`;
        })
        .join('');
      container.innerHTML = `
        <div class="blu-head">${onBack ? `<button class="blu-back" data-blu="back" aria-label="Back">${sym('go-previous')}</button>` : ''}<strong>Bluetooth</strong><button class="switch${state.bluetooth ? ' on' : ''}" role="switch" aria-checked="${state.bluetooth}" aria-label="Bluetooth" data-blu="power"></button></div>
        <div class="blu-list">${state.bluetooth ? rows || '<p class="blu-empty">No devices yet. Scan to find nearby devices.</p>' : '<p class="blu-empty">Bluetooth is turned off.</p>'}</div>
        ${bluetooth.message ? `<p class="blu-error" role="alert">${escapeHtml(bluetooth.message)}</p>` : ''}
        <button class="blu-scan" data-blu="scan"${!state.bluetooth || bluetooth.busy ? ' disabled' : ''}>${bluetooth.busy ? 'Working…' : 'Scan for Devices…'}</button>
        <p class="blu-note">Your browser shows its own device picker when scanning.</p>`;
    };
    container.addEventListener('click', (event) => {
      const button = event.target.closest('[data-blu]');
      if (!button || button.disabled) return;
      const action = button.dataset.blu;
      if (action === 'power') setBluetooth(!state.bluetooth);
      else if (action === 'scan') scan();
      else if (action === 'connect') connect(button.dataset.id);
      else if (action === 'disconnect') disconnect(button.dataset.id);
      else if (action === 'back' && onBack) onBack();
    });
    renderers.add(draw);
    draw();
    return () => renderers.delete(draw);
  };

  const openPanel = (name) => {
    if (name !== 'bluetooth' || !bluetooth.supported) return;
    quickMain.hidden = true;
    panel.hidden = false;
    panel.innerHTML = '';
    if (panel.release) panel.release();
    panel.release = renderBluetooth(panel, {
      onBack: () => {
        panel.hidden = true;
        quickMain.hidden = false;
      },
    });
  };

  const guard = (win) => {
    const layer = document.createElement('div');
    layer.className = 'net-offline';
    layer.innerHTML = `${sym('network-wireless')}<h2>No connection</h2><p>Please check your Wi-Fi connection.</p><button class="net-retry"></button>`;
    const retry = layer.querySelector('.net-retry');
    retry.addEventListener('click', () => {
      if (!state.wifi) setWifi(true);
      else refresh();
    });
    win.body.append(layer);
    const update = () => {
      layer.hidden = online();
      retry.textContent = state.wifi ? 'Try Again' : 'Turn On Wi-Fi';
    };
    const off = onChange(update);
    update();
    const previous = win.onClose;
    win.onClose = () => {
      off();
      if (previous) previous();
    };
  };

  const link = () => {
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection || null;
    return connection ? { type: connection.effectiveType || '', downlink: connection.downlink || 0, rtt: connection.rtt || 0 } : null;
  };

  window.addEventListener('online', refresh);
  window.addEventListener('offline', refresh);
  if (navigator.connection && navigator.connection.addEventListener) navigator.connection.addEventListener('change', rerender);

  ctx.network = { online, onChange, setWifi, setBluetooth, openPanel, guard, bluetooth, renderBluetooth, link, refresh };
  refresh();
};
