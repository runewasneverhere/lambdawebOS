# Desktop relay

## Announcements

Announcements and their comments/photos are shared by all registered desktop users.
The relay must be updated along with the website. Existing relay data is preserved.
Only server-authorized owners and administrators can publish or delete announcements.
Every registered user can read and comment. Deleting a post also deletes its comments
and photo. Author names and profile pictures are saved with posts and comments.

The sidebar's Announcements app includes **Create Announcement**, a title and
description, an optional photo
and **Notify everyone**. Publishing always requires Yes/No confirmation; broadcasting
requires a second confirmation. Online users receive an unread-count notification.
Offline users receive it on their next connection. The count includes all remaining
announcements since the app was last opened/refreshed, but a notification is triggered
only when at least one unread post has **Notify everyone** enabled. Comments do not
trigger broadcast notifications. Read position is saved per browser-local account;
clearing browser storage resets it. Accounts created after an announcement are never
notified about it: the relay records how many announcements existed when each account
registered and only counts newer ones. Older posts stay visible in the app. Accounts
created before this rule have no saved starting point and keep their current behavior.

Posts are newest first, with older-post and comment pagination. Limits are explicit:
200 posts, 100 comments per post, 120 characters per title, 4000 per description, 1000 per comment,
10 comments per user per minute, and 32 MiB total announcement data. Nothing is
automatically discarded when full: an administrator must delete older posts.
Photos are converted by the website to PNG (up to 280 KiB); the server accepts PNG
up to 300 KiB and 4096 pixels per side. Announcement data lives in the existing
relay data JSON, independent of Mail image retention. Saving uses a temporary
file, so allow room for both the current data file and its replacement.

Existing announcements without titles remain readable and display their original
message. Older cached clients may still publish without a title; the updated
creation form requires one.

The megaphone icon is from GitHub Octicons (MIT); its license is distributed in
[octicons-LICENSE.txt](../lambdaweb/apps/octicons-LICENSE.txt).

### Deploying an update

Upload the updated website, including the new announcement script, stylesheet
changes, and icon/license files. Upload `relay.py` to its existing server location,
then restart the existing relay service:

```sh
sudo systemctl restart relay
sudo systemctl status relay --no-pager
curl http://127.0.0.1:8765/api/health
```

Keep the existing `RELAY_OWNERS=rune` service override. No new service, Cloudflare
route, port, or database is needed. Verify using an administrator account and a
normal account; the health endpoint alone does not test announcement permissions.

### Tests

From the project directory:

```sh
python -m unittest discover -s relay -p test_announcements.py -v
```

Tests use a temporary data file and local HTTP server; they never access production.
