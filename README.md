# lambdawebOS

A desktop operating system that runs entirely in the browser. It has a window manager, dock, file manager, terminal, text editor, web browser, settings, an app store, and a few small apps (calculator, clocks, system monitor, music, paint, image viewer). Everything you do is stored in the browser's IndexedDB.

Accounts, Mail and Announcements need a small server. It is in [relay](relay) and is optional: without it the rest of the desktop works.

## Running it

It is a static site with no build step. Serve the folder with any web server:

    python -m http.server 8000

Then open http://127.0.0.1:8000.

## Relay

[relay/relay.py](relay/relay.py) is a single-file Python server with no dependencies. See [relay/README.md](relay/README.md) for configuration and deployment, and run its tests with:

    python -m unittest discover -s relay -p test_announcements.py

The relay address defaults to localhost:8765 when served locally and can be overridden by setting `window.LAMBDAWEB_RELAY` before the scripts load.

## License

The code is licensed under the GNU General Public License, version 2. See [LICENSE](LICENSE). Icons, sounds and other bundled assets keep their own licenses, listed in [NOTICE](NOTICE).
