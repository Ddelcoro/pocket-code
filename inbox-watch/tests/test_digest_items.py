"""1.95: the morning digest carries its lines as items (one per story, ref a<alert id>), a look-ahead its bullets (ref
c<alert id>.<bullet>), and a decision on one item in Pocket (feedback kind 'digest-item') promotes that story to an alert now,
closes it, or is a lesson. No Pocket, network or mailbox.

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


def test_add_to_inbox_on_a_digest_item_sends_it_now_and_is_a_lesson():
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
    assert any("added this to the Inbox from the morning digest" in r["fact"] for r in store.events("roslynn-website-feedback"))
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
    # A tidy line has no alert behind it: Add to Inbox on it sends nothing and is still acked.
    pocket.items = [{"id": "e/t1", "entry": "e", "item": "t1", "action": "alert", "at": "2026-11-07T13:05:00Z", "note": "", "title": "Polo launch",
                     "story": "polo-launch", "source": "inbox-monitor", "kind": "digest-item"}]
    E.apply_feedback(store)
    assert pocket.sent == [] and pocket.acked[-1] == "e/t1"




class Archive:
    def get(self, ids, until):
        return [{"thread_id": T}] if ids and ids[0] == "aaaaaa01" else []


LOOK = """Three things worth catching:
- The payment settles by Tuesday. [Notice](msg:bbbbbb02)
- Davenport's auto policy looks renewed. [Renewal](msg:aaaaaa01)
- Veterans Day closes the banks, and nobody has said so."""


def test_look_ahead_cards_lose_no_bullet():
    store, _ = setup()
    stories = [{"issue_key": "card-payment", "title": "Card payment", "priority": "high", "bullet": 1, "evidence": [], "thread": T},
               {"issue_key": "davenport-auto", "title": "Davenport auto", "priority": "normal", "bullet": None, "evidence": [{"message_id": "aaaaaa01"}]},
               {"issue_key": "unmentioned", "title": "Not in the message", "bullet": None, "evidence": [{"message_id": "cccccc03"}]}]
    cards = E.lookahead_cards(store, Archive(), 12, LOOK, stories, 0, False)
    assert [c["ref"] for c in cards] == ["c12.1", "c12.2", "c12.3"] and {c["section"] for c in cards} == {"ahead"}, cards
    named, cited, alone = cards
    assert (named["story"], named["title"], named["priority"]) == ("card-payment", "Card payment", "high"), named
    assert named["gmail"] == f"https://mail.google.com/mail/u/0/#all/{T}" and named["text"].endswith("[Notice](msg:bbbbbb02)"), named
    assert (cited["story"], cited["title"]) == ("davenport-auto", "Davenport auto"), "no bullet named: the story it cites"
    assert cited["gmail"] == f"https://mail.google.com/mail/u/0/#all/{T}", "the thread comes from the citation"
    assert (alone["story"], alone["gmail"], alone["priority"]) == ("", "", "normal"), alone
    assert alone["title"] == "Veterans Day closes the banks, and nobody has said so.", "a bullet on no story still has a card"
    # A model that writes the number as a string, or one past the end, costs nothing.
    assert E.lookahead_cards(store, Archive(), 12, LOOK, [{"issue_key": "x", "bullet": "3"}, {"issue_key": "y", "bullet": 9}], 0, False)[2]["story"] == "x"
    assert E.lookahead_cards(store, Archive(), 12, "No bullets here.", stories, 0, False) == []


def look_item(action, ref="c12.2", **kw):
    return {"id": f"e/{ref}", "entry": "e", "item": ref, "action": action, "at": "2026-11-07T14:00:00Z", "note": "", "title": "Davenport auto", "story": "davenport-auto",
            "text": "Davenport's auto policy looks renewed. [Renewal](msg:aaaaaa01)", "gmail": f"https://mail.google.com/mail/u/0/#all/{T}", "priority": "normal",
            "source": "inbox-monitor", "kind": "digest-item", **kw}


def test_add_to_inbox_on_a_look_ahead_item_sends_it_and_teaches_nothing():
    store, _ = setup()
    pocket = Pocket()
    E.DELIVERIES = [pocket]
    store.upsert_story({"issue_key": "davenport-auto", "status": "open", "priority": "low", "new_fact": "Renewal."}, T)
    store.commit()
    pocket.items = [look_item("alert")]
    E.apply_feedback(store)
    assert pocket.sent == ["Davenport auto"] and pocket.acked == ["e/c12.2"], (pocket.sent, pocket.acked)
    row = store.db.execute("select kind, status, thread_id, issue_key, text, dedupe_key from alerts").fetchone()
    assert tuple(row) == ("notify", "sent", T, "davenport-auto", look_item("alert")["text"], "escalate:c12.2:2026-11-07T14:00:00Z"), tuple(row)
    assert store.story("davenport-auto")["priority"] == "normal"
    assert store.db.execute("select count(*) from lessons").fetchone()[0] == 0, "a finding is not a kind of mail"
    assert any("from a look-ahead" in r["fact"] for r in store.events("davenport-auto"))
    E.apply_feedback(store)  # reported again before the ack landed: not sent twice
    assert pocket.sent == ["Davenport auto"]
    # On no story and no thread it is still an alert.
    pocket.items = [look_item("alert", ref="c12.3", story="", gmail="", title="Veterans Day closes the banks.")]
    E.apply_feedback(store)
    assert pocket.sent[-1] == "Veterans Day closes the banks.", pocket.sent


def test_the_other_choices_on_a_look_ahead_item():
    store, _ = setup()
    pocket = Pocket()
    E.DELIVERIES = [pocket]
    store.upsert_story({"issue_key": "davenport-auto", "status": "open", "priority": "normal", "new_fact": "Renewal."}, T)
    store.commit()
    pocket.items = [look_item("resolved")]
    E.apply_feedback(store)
    assert store.story("davenport-auto")["status"] == "resolved"
    pocket.items = [look_item("restore")]
    E.apply_feedback(store)
    assert store.story("davenport-auto")["status"] == "open"
    pocket.items = [look_item("not_useful", note="I know")]
    E.apply_feedback(store)
    lesson = store.db.execute("select kind, note, before from lessons").fetchone()
    assert lesson["kind"] == "not_useful" and lesson["before"].startswith("look-ahead item:"), tuple(lesson)
    assert pocket.sent == []


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


def line(store, key, thread, text, subject="Same story", kind="digest", status="queued", priority="low"):
    return store.queue_alert(f"fact:{key}", issue_key=thread and f"story-{thread}", thread_id=thread, kind=kind, priority=priority, text=text, next_step=None,
                             subject=subject, sender="a@example.com", status=status)


def digest_pocket(store):
    pocket = Pocket()
    E.DELIVERIES = [pocket]
    return pocket


def test_one_card_per_story_and_the_text_keeps_every_line():
    store, _ = setup()
    pocket = digest_pocket(store)
    old = line(store, "old", "t1", "First fact. [Text](msg:t1)")
    new = line(store, "new", "t1", "Second fact. [Text](msg:t1)")
    solo = line(store, "solo", "t2", "Other fact. [Text](msg:t2)", subject="")
    E.send_digest(store, [], False)
    _, text, items = pocket.digests[0]
    assert [i["ref"] for i in items] == [f"a{new}", f"a{solo}"], items
    assert items[0]["text"].index("Second fact") < items[0]["text"].index("First fact"), "newest first, and both are on the card"
    assert "First fact" in text and "Second fact" in text, "the digest's text is not merged"
    assert items[1]["title"].startswith("Other fact"), "a line with no subject still gets a title"
    assert dict(store.db.execute("select id, status from alerts").fetchall()) == {old: "digested", new: "digested", solo: "digested"}


def test_a_failed_start_link_does_not_hold_up_the_rest():
    store, _ = setup()
    pocket = digest_pocket(store)
    for n in range(3):
        line(store, f"k{n}", f"t{n}", f"Fact {n}.")
    calls = []
    saved, root = E.start_link, E.CFG.pocket.get("root")
    E.start_link = lambda *a: calls.append(a) and None
    E.CFG.pocket["root"] = "/nowhere"
    try:
        E.send_digest(store, [], False)
    finally:
        E.start_link = saved
        E.CFG.pocket["root"] = root
    assert len(calls) == 1, calls
    assert len(pocket.digests[0][2]) == 3 and all(not i["url"] for i in pocket.digests[0][2]), "the cards still go, without a link"


def test_more_lines_than_cards_says_so_at_the_top():
    store, _ = setup()
    pocket = digest_pocket(store)
    saved = E.DIGEST_CARDS
    E.DIGEST_CARDS = 2
    try:
        for n in range(3):
            line(store, f"k{n}", f"t{n}", f"Fact {n}.")
        E.send_digest(store, [], False)
    finally:
        E.DIGEST_CARDS = saved
    _, text, items = pocket.digests[0]
    assert len(items) == 2 and text.startswith("1 more line did not fit as cards."), text[:80]
    assert all(f"Fact {n}." in text for n in range(3))


def test_a_failed_alert_me_is_kept_and_sent_once():
    store, _ = setup()
    pocket = digest_pocket(store)
    aid = seed(store)
    E.send_digest(store, [], False)
    saved = pocket.send_alert

    def down(*a, **k):
        raise RuntimeError("no route")
    pocket.send_alert = down
    pocket.items = [{"id": f"d/a{aid}", "entry": "d", "item": f"a{aid}", "action": "alert", "at": "2026-11-07T13:01:00Z", "note": "",
                     "title": "Roslynn website feedback and review", "story": "roslynn-website-feedback", "source": "inbox-monitor", "kind": "digest-item"}]
    E.apply_feedback(store)
    assert pocket.acked == [], "not acked: Pocket keeps the request"
    assert not store.db.execute("select 1 from lessons").fetchone(), "no lesson until the alert reached the owner"
    pocket.send_alert = saved
    E.apply_feedback(store)
    assert pocket.sent == ["Roslynn website feedback and review"] and pocket.acked == [f"d/a{aid}"], (pocket.sent, pocket.acked)
    assert store.db.execute("select count(*) c from alerts where id!=?", (aid,)).fetchone()["c"] == 1, "the retry reuses the alert the failed run left"
    assert store.db.execute("select count(*) c from lessons").fetchone()["c"] == 1
    E.apply_feedback(store)
    assert pocket.sent == ["Roslynn website feedback and review"], "and is not sent again"


def test_digest_off_sends_held_alerts_and_no_digest():
    store, _ = setup()
    pocket = digest_pocket(store)
    held = line(store, "held", "t1", "Held fact.", subject="Held", kind="notify", status="held", priority="normal")
    worth = line(store, "worth", "t2", "Worth fact.")
    saved = {k: getattr(E, k) for k in ("DIGEST_HOUR", "in_quiet_hours", "CHECKIN_SLOTS")}
    E.DIGEST_HOUR, E.in_quiet_hours, E.CHECKIN_SLOTS = None, lambda *a: False, {}
    assert E.scheduled_due(store), "the morning release is still owed"

    class Archive:
        pruned = 0

        def prune(self):
            Archive.pruned += 1
    try:
        E.scheduled(store, Archive(), None, False)
        assert not E.scheduled_due(store), "once a day"
    finally:
        for k, v in saved.items():
            setattr(E, k, v)
    assert pocket.digests == [] and pocket.sent == ["Held"], (pocket.digests, pocket.sent)
    assert dict(store.db.execute("select id, status from alerts").fetchall()) == {held: "sent", worth: "skipped"}
    assert Archive.pruned == 1, "the archive still gets its morning prune"


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
