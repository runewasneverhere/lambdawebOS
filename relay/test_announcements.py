import base64
import json
import queue
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from unittest.mock import patch

import relay


class AnnouncementTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = relay.ThreadingHTTPServer(("127.0.0.1", 0), relay.Handler)
        cls.server.daemon_threads = True
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.url = f"http://127.0.0.1:{cls.server.server_port}/api/announcements/"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.config = patch.multiple(relay, DATA_FILE=str(Path(self.temp.name) / "data.json"),
                                     OWNERS={"rune"}, ANNOUNCEMENT_STORAGE_MAX=32 * 1024 * 1024)
        self.config.start()
        self.addCleanup(self.config.stop)
        for value in (relay.registry, relay.joined, relay.pending, relay.admins, relay.log, relay.retract,
                      relay.sessions, relay.online, relay.rate, relay.announcements):
            value.clear()
        relay.announcement_seq = 0
        self.png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII="
        avatar = (base64.b64decode(self.png.split(",")[1]), "image/png")
        for name in ("rune", "tester", "helper"):
            relay.registry[name] = relay.digest("a" * 64)
            relay.sessions[name] = {"user": name, "open": True, "queue": queue.Queue(), "avatar": avatar}
            relay.online[name] = name
        relay.admins.add("helper")

    def post(self, action, ticket="rune", **body):
        request = urllib.request.Request(self.url + action, json.dumps(dict(body, ticket=ticket)).encode(),
                                         {"Content-Type": "application/json", "Origin": "http://localhost:8092"})
        try:
            response = urllib.request.urlopen(request)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            return response.status, json.load(response)

    def create(self, **body):
        status, data = self.post("create", **dict({"text": "Hello!", "notify": True}, **body))
        self.assertEqual(status, 200, data)
        return relay.announcements[-1]["id"]

    def test_new_accounts_are_not_notified_about_older_announcements(self):
        self.create(text="old quiet", notify=False)
        self.create(text="old broadcast", notify=True)
        claim = urllib.request.Request(
            f"http://127.0.0.1:{self.server.server_port}/api/claim",
            json.dumps({"username": "newbie", "secret": "c" * 64}).encode(),
            {"Content-Type": "application/json", "Origin": "http://localhost:8092"},
        )
        with urllib.request.urlopen(claim) as response:
            self.assertTrue(json.load(response)["created"])
        relay.sessions["newbie"] = {"user": "newbie", "open": True, "queue": queue.Queue(), "avatar": None}
        relay.online["newbie"] = "newbie"
        self.assertEqual(relay.joined["newbie"], 2)

        existing = self.post("list", ticket="tester", seen=0)[1]
        self.assertEqual(existing["unread"], 2)
        self.assertTrue(existing["notify"])

        fresh = self.post("list", ticket="newbie", seen=0)[1]
        self.assertEqual(fresh["unread"], 0)
        self.assertFalse(fresh["notify"])
        self.assertEqual(len(fresh["items"]), 2)

        self.create(text="after joining", notify=True)
        later = self.post("list", ticket="newbie", seen=0)[1]
        self.assertEqual(later["unread"], 1)
        self.assertTrue(later["notify"])
        self.assertEqual(self.post("list", ticket="newbie", seen=3)[1]["unread"], 0)

        relay.save()
        relay.joined.clear()
        relay.load()
        self.assertEqual(relay.joined["newbie"], 2)

        relay.registry.pop("newbie")
        relay.joined.pop("newbie")
        self.assertNotIn("newbie", relay.joined)

    def test_permissions_and_revoked_accounts(self):
        self.assertEqual(self.post("list", ticket="missing")[0], 403)
        self.assertEqual(self.post("create", ticket="tester", text="No")[0], 403)
        announcement = self.create(ticket="helper")
        self.assertEqual(self.post("delete", ticket="tester", id=announcement)[0], 403)
        relay.admins.clear()
        self.assertEqual(self.post("delete", ticket="helper", id=announcement)[0], 403)
        relay.registry.pop("tester")
        self.assertEqual(self.post("comment", ticket="tester", id=announcement, text="No")[0], 403)

    def test_titles_validation_persistence_and_legacy_posts(self):
        self.create(title="  News <b>today</b>  ")
        self.assertEqual(self.post("list")[1]["items"][0]["title"], "News <b>today</b>")
        relay.announcements.clear()
        relay.load()
        self.assertEqual(relay.announcements[0]["title"], "News <b>today</b>")
        for title in ("", "   ", "a" * 121, None, 123, []):
            self.assertEqual(self.post("create", title=title, text="Description")[0], 400)
        self.create(title="a" * 120)
        self.create()
        relay.announcements[-1].pop("title")
        relay.save()
        relay.announcements.clear()
        relay.load()
        legacy = self.post("list")[1]["items"][0]
        self.assertEqual(legacy["text"], "Hello!")
        self.assertNotIn("title", legacy)

    def test_images_comments_events_and_restart(self):
        announcement = self.create(image=self.png)
        self.assertEqual(self.post("comment", ticket="tester", id=announcement, text="Nice!")[0], 200)
        event = relay.sessions["tester"]["queue"].get_nowait()
        self.assertEqual(event["event"], "announcements")
        status, detail = self.post("detail", ticket="tester", id=announcement)
        self.assertEqual(status, 200)
        self.assertEqual(self.post("photo", ticket="tester", id=announcement)[1]["image"], self.png)
        self.assertEqual(detail["comments"][0]["author"]["username"], "tester")
        self.assertEqual(detail["comments"][0]["author"]["avatar"], self.png)
        self.assertEqual(detail["comments"][0]["text"], "Nice!")
        relay.announcements.clear()
        relay.announcement_seq = 0
        relay.load()
        self.assertEqual(len(relay.announcements), 1)
        self.assertEqual(relay.announcement_seq, 1)
        self.assertEqual(self.post("detail", id=announcement)[1], detail)
        self.assertEqual(self.post("photo", id=announcement)[1]["image"], self.png)

    def test_unread_pagination_and_delete(self):
        for number in range(23):
            self.create(text=str(number), notify=number == 22)
        status, data = self.post("list", ticket="tester", seen=0)
        self.assertEqual(status, 200)
        self.assertEqual(data["unread"], 23)
        self.assertTrue(data["notify"])
        self.assertEqual(len(data["items"]), 20)
        self.assertEqual(data["items"][0]["text"], "22")
        self.assertNotIn("comments", data["items"][0])
        older = self.post("list", before=data["next"])[1]
        self.assertEqual(len(older["items"]), 3)
        self.assertIsNone(older["next"])
        self.assertFalse(self.post("list", seen=data["latest"])[1]["notify"])
        last_id = relay.announcements[-1]["id"]
        self.assertEqual(self.post("delete", id=last_id)[0], 200)
        self.assertFalse(self.post("list", seen=0)[1]["notify"])
        self.assertEqual(self.post("detail", id=last_id)[0], 404)
        self.assertEqual(self.post("comment", id=last_id, text="No")[0], 404)
        self.create()
        self.assertEqual(relay.announcements[-1]["seq"], 24)

    def test_validation_storage_and_rate_limits(self):
        for body in ({"text": ""}, {"text": "a" * 4001}, {"text": "OK", "image": "data:image/svg+xml;base64,abc"},
                     {"text": "OK", "notify": "yes"}):
            self.assertEqual(self.post("create", **body)[0], 400)
        self.assertEqual(self.post("list", seen=[])[0], 400)
        announcement = self.create()
        self.assertEqual(self.post("comment", id=announcement, text=" ")[0], 400)
        self.assertEqual(self.post("comment", id=announcement, text="x" * 1001)[0], 400)
        for _ in range(10):
            self.assertEqual(self.post("comment", ticket="tester", id=announcement, text="OK")[0], 200)
        self.assertEqual(self.post("comment", ticket="tester", id=announcement, text="No")[0], 429)
        with patch.object(relay, "ANNOUNCEMENT_STORAGE_MAX", 1):
            self.assertEqual(self.post("create", text="Full")[0], 409)
            self.assertEqual(self.post("comment", id=announcement, text="Full")[0], 409)
        self.assertEqual(len(relay.announcements), 1)

    def test_comment_pagination_and_caps(self):
        announcement = self.create()
        relay.announcements[0]["comments"] = [{"text": str(i)} for i in range(100)]
        first = self.post("detail", id=announcement)[1]
        self.assertEqual(len(first["comments"]), 30)
        self.assertEqual(first["next"], 30)
        self.assertEqual(len(self.post("detail", id=announcement, offset=90)[1]["comments"]), 10)
        self.assertEqual(self.post("comment", id=announcement, text="Full")[0], 409)
        relay.announcements.extend([dict(relay.announcements[0])] * 199)
        self.assertEqual(self.post("create", text="Full")[0], 409)


if __name__ == "__main__":
    unittest.main()
