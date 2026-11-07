"""1.95: the morning digest carries its lines as items (one per story, ref a<alert id>), and a decision on one item in Pocket
(feedback kind 'digest-item') promotes that story to an alert now, closes it, or is a lesson. No Pocket, network or mailbox.

    python3 tests/test_digest_items.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from inbox_monitor import engine as E  # noqa: E402
from test_process import setup  # noqa: E402

T = "18f0aa01b2c3d4e7"


class Pocket:
    kind = "pocket"

    def __init__(self):
        self.sent, self.digests, self.acked = [], [], []
        self.items = []

    def send_alert(self, a, pocket_url=None, held_note=False):
        self.sent.append(a["subject"])
        return "e"

    def send_digest(self, title, text, items=None):
        self.digests.append((title, text, items))
        return "d"

    def feedback(self):
        return self.items

    open_entries: list = []

    def inbox_open(self):
        return self.open_entries

    def ack(self, ids):
        self.acked.extend(ids)


def seed(store):
    store.upsert_story({"issue_key": "roslynn-website-feedback", "status": "open", "priority": "low", "new_fact": "Roslynn texted."}, None)
    aid = store.queue_alert("fact:roslynn", issue_key="roslynn-website-feedback", thread_id=T, kind="digest", priority="low",
                            text=f"Roslynn texted that business is up 25% since the new site. [Text](msg:{T})", next_step="Thank her",
                            subject="Roslynn website feedback and review", sender="service@ringcentral.com", status="queued")
    store.db.execute("insert into tidy_log(at,entry_id,issue_key,title,verdict,reason,evidence,acted) values(?,?,?,?,?,?,?,?)",
                     (E.iso(), "cccccccccccc", "polo-launch", "Polo launch", "resolved", "live", "[]", 1))
    store.commit()
    return aid


def fake_pocket_root():
    import tempfile
    root = Path(tempfile.mkdtemp())
    (root / "scripts").mkdir()
    (root / "scripts" / "pocket-start.mjs").write_text("console.log('/#/start/0123456789ab');\n")
    return str(root)


def test_the_digest_carries_its_items():
    store, _ = setup()
    pocket = Pocket()
    E.DELIVERIES = [pocket]
    aid = seed(store)
    E.CFG.pocket = {"root": fake_pocket_root()}  # an open line gets a briefed start link, as an alert does
    try:
        E.send_digest(store, [], False)
    finally:
        E.CFG.pocket = {}
    assert len(pocket.digests) == 1, pocket.digests
    title, text, items = pocket.digests[0]
    assert "## Worth knowing" in text and "Roslynn website feedback and review" in text
    worth = [i for i in items if i["section"] == "worth"]
    assert worth == [{"ref": f"a{aid}", "section": "worth", "title": "Roslynn website feedback and review",
                      "text": f"Roslynn texted that business is up 25% since the new site. [Text](msg:{T})", "story": "roslynn-website-feedback",
                      "gmail": f"https://mail.google.com/mail/u/0/#all/{T}", "priority": "low", "url": "/#/start/0123456789ab"}], worth
    tidied = [i for i in items if i["section"] == "tidied"]
    assert tidied and tidied[0]["ref"].startswith("t") and tidied[0]["title"] == "Polo launch" and tidied[0]["text"] == "Resolved" and tidied[0]["url"] == "", tidied
    assert dict(store.db.execute("select id, status from alerts").fetchall())[aid] == "digested"


def test_alert_me_on_a_digest_item_sends_it_now_and_is_a_lesson():
    store, _ = setup()
    pocket = Pocket()
    E.DELIVERIES = [pocket]
    aid = seed(store)
    E.send_digest(store, [], False)
    pocket.items = [{"id": f"dddddddddddd/a{aid}", "entry": "dddddddddddd", "item": f"a{aid}", "action": "alert", "at": "2026-11-07T13:01:00Z", "note": "",
                     "title": "Roslynn website feedback and review", "story": "roslynn-website-feedback", "source": "inbox-monitor", "kind": "digest-item"}]
    E.apply_feedback(store)
    assert pocket.sent == ["Roslynn website feedback and review"], pocket.sent
    rows = store.db.execute("select kind, status, priority, dedupe_key from alerts where id!=?", (aid,)).fetchall()
    assert [tuple(r) for r in rows] == [("notify", "sent", "normal", f"escalate:{aid}:2026-11-07T13:01:00Z")], rows
    assert store.story("roslynn-website-feedback")["priority"] == "normal", "a low story is lifted to normal"
    lesson = store.db.execute("select kind, thread_id, issue_key, before from lessons").fetchone()
    assert tuple(lesson) == ("escalated", T, "roslynn-website-feedback", f"digest line: Roslynn texted that business is up 25% since the new site. [Text](msg:{T})"), tuple(lesson)
    assert any("asked for an alert" in r["fact"] for r in store.events("roslynn-website-feedback"))
    assert pocket.acked == [f"dddddddddddd/a{aid}"], pocket.acked
    # The same decision reported again (a retry before the ack landed) is not sent twice: its dedupe key is taken.
    E.apply_feedback(store)
    assert pocket.sent == ["Roslynn website feedback and review"] and len(store.db.execute("select 1 from alerts").fetchall()) == 2


def test_resolve_and_not_useful_on_a_digest_item():
    store, _ = setup()
    pocket = Pocket()
    E.DELIVERIES = [pocket]
    aid = seed(store)
    E.send_digest(store, [], False)
    pocket.items = [{"id": f"e/a{aid}", "entry": "e", "item": f"a{aid}", "action": "not_useful", "at": "2026-11-07T13:02:00Z", "note": "Roslyn texts me anyway",
                     "title": "Roslynn website feedback and review", "story": "roslynn-website-feedback", "source": "inbox-monitor", "kind": "digest-item"}]
    E.apply_feedback(store)
    lesson = store.db.execute("select kind, note, before from lessons").fetchone()
    assert tuple(lesson)[:2] == ("not_useful", "Roslyn texts me anyway") and lesson["before"].startswith("digest line:"), tuple(lesson)
    assert pocket.sent == [], "not useful sends nothing"
    pocket.items = [{"id": f"e/a{aid}", "entry": "e", "item": f"a{aid}", "action": "resolved", "at": "2026-11-07T13:03:00Z", "note": "",
                     "title": "Roslynn website feedback and review", "story": "roslynn-website-feedback", "source": "inbox-monitor", "kind": "digest-item"}]
    E.apply_feedback(store)
    assert store.story("roslynn-website-feedback")["status"] == "resolved"
    pocket.items = [{"id": f"e/a{aid}", "entry": "e", "item": f"a{aid}", "action": "restore", "at": "2026-11-07T13:04:00Z", "note": "",
                     "title": "Roslynn website feedback and review", "story": "roslynn-website-feedback", "source": "inbox-monitor", "kind": "digest-item"}]
    E.apply_feedback(store)
    assert store.story("roslynn-website-feedback")["status"] == "open", "restore reopens"
    # A tidy line has no alert behind it: Alert me on it sends nothing and is still acked.
    pocket.items = [{"id": "e/t1", "entry": "e", "item": "t1", "action": "alert", "at": "2026-11-07T13:05:00Z", "note": "", "title": "Polo launch",
                     "story": "polo-launch", "source": "inbox-monitor", "kind": "digest-item"}]
    E.apply_feedback(store)
    assert pocket.sent == [] and pocket.acked[-1] == "e/t1"


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)


def test_a_story_already_on_the_list_is_not_a_new_card():
    # Brad, 2026-11-07: nothing already in the Inbox comes back in the morning brief as a new card.
    store, _ = setup()
    pocket = Pocket()
    E.DELIVERIES = [pocket]
    aid = seed(store)
    other = store.queue_alert("fact:other", issue_key="other-story", thread_id="18f0aa01b2c3d4e8", kind="digest", priority="low",
                              text="Something else.", next_step=None, subject="Other story", sender="x@example.com", status="queued")
    pocket.open_entries = [{"id": "abcabcabcabc", "kind": "alert", "state": "opened", "story": "roslynn-website-feedback", "gmail": "", "source": "inbox-monitor"},
                           {"id": "dddddddddddd", "kind": "digest", "state": "new", "story": "other-story", "gmail": "", "source": "inbox-monitor"}]
    E.CFG.pocket = {"root": fake_pocket_root()}
    try:
        E.send_digest(store, [], False)
    finally:
        E.CFG.pocket = {}
    title, text, items = pocket.digests[0]
    by = {i["ref"]: i for i in items}
    assert by[f"a{aid}"]["section"] == "listed" and by[f"a{aid}"]["url"] == "/#/inbox/abcabcabcabc", by[f"a{aid}"]
    assert by[f"a{other}"]["section"] == "worth" and by[f"a{other}"]["url"] == "/#/start/0123456789ab", "an open digest entry on the story does not count; a worth line keeps its start link"
    assert "## Already on your list (1)" in text and text.index("## Worth knowing") < text.index("## Already on your list"), text
    assert dict(store.db.execute("select id, status from alerts").fetchall()) == {aid: "digested", other: "digested"}
