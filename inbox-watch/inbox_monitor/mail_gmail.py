"""Gmail access for one mailbox: history sync, thread and message reads, searches. Read-only, except for one label: with
the Pocket Inbox label on (Pocket 1.75), the watcher creates that label and adds or removes it (and INBOX: put back for a thread the
owner labelled, taken off when an entry finished in Pocket archives its thread) on threads, with the gmail.modify scope. Nothing else is ever changed.

Two ways in:
  auth = "service_account": a Google Workspace service account with domain-wide delegation impersonates the owner
      (service_account_file, scope gmail.readonly). Works for every mailbox in a domain the admin controls.
  auth = "oauth": the owner's own consent. `inbox-monitor gmail-auth` runs the browser flow once with
      oauth_client_file (an OAuth client of type "Desktop app") and keeps the refresh token in oauth_token_file.
"""
from __future__ import annotations

import time
import json
from pathlib import Path

from googleapiclient.discovery import build
from googleapiclient.errors import HttpError  # noqa: F401  (re-exported for the engine)

GMAIL_SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]
LABEL_SCOPES = ["https://www.googleapis.com/auth/gmail.modify"]  # the Pocket Inbox label: create it, add and remove it on threads
WRITE_GRANTS = {"https://www.googleapis.com/auth/gmail.modify", "https://mail.google.com/"}


def credentials(mail: dict, owner_email: str, scopes: list[str] | None = None):
    auth = mail.get("auth", "service_account")
    if auth == "service_account":
        from google.oauth2 import service_account
        return service_account.Credentials.from_service_account_file(mail["service_account_file"], scopes=scopes or GMAIL_SCOPES).with_subject(owner_email)
    if auth == "oauth":
        from google.oauth2.credentials import Credentials
        token = Path(mail["oauth_token_file"])
        if not token.exists():
            raise RuntimeError(f"no Gmail token at {token}; run `inbox-monitor gmail-auth` once")
        # Renew with the scopes the sign-in was granted: a token reused from another app (granted gmail.modify, say) cannot be
        # refreshed for gmail.readonly ("invalid_scope"). Only reads are ever made either way.
        try:
            granted = json.loads(token.read_text()).get("scopes") or GMAIL_SCOPES
        except ValueError:
            granted = GMAIL_SCOPES
        if scopes and not WRITE_GRANTS & set(granted):
            raise PermissionError("the Gmail sign-in is read-only; run `inbox-monitor gmail-auth` again to allow the Pocket Inbox label")
        creds = Credentials.from_authorized_user_file(str(token), granted)
        if not creds.valid:
            from google.auth.transport.requests import Request
            creds.refresh(Request())
            token.write_text(creds.to_json())
        return creds
    raise ValueError(f"mail.auth must be service_account or oauth, not {auth!r}")


def oauth_consent(mail: dict, label: bool = True) -> Path:
    """One-time browser consent for auth = "oauth"; writes the token file. With the Pocket Inbox label on it asks for
    gmail.modify too (reads stay reads; the only change ever made is that one label)."""
    from google_auth_oauthlib.flow import InstalledAppFlow
    flow = InstalledAppFlow.from_client_secrets_file(mail["oauth_client_file"], GMAIL_SCOPES + (LABEL_SCOPES if label else []))
    creds = flow.run_local_server(port=0, open_browser=False)
    token = Path(mail["oauth_token_file"])
    token.parent.mkdir(parents=True, exist_ok=True)
    token.write_text(creds.to_json())
    token.chmod(0o600)
    return token


from .schedule import scope_query  # noqa: E402

SKIP_LABELS = {"SPAM", "TRASH", "DRAFT", "CHAT", "CATEGORY_PROMOTIONS"}


class Gmail:
    def __init__(self, mail: dict, owner_email: str, baseline_query: str, archive_query: str):
        self.svc = build("gmail", "v1", credentials=credentials(mail, owner_email), cache_discovery=False)
        self.u = self.svc.users()
        self.mail, self.owner_email, self._writer = mail, owner_email, None
        self.arrived_labels: dict[str, set[str]] = {}  # thread -> labels its new mail arrived with (a filter's, never the owner's hand)
        self.baseline_query = baseline_query
        self.archive_query = archive_query
        self.scope = mail.get("scope") or {}  # 1.100: {mode, labels}; history reads are filtered by label, searches by scope_query
        self._scope_ids: set[str] | None = None

    def scope_label_ids(self) -> set[str] | None:
        """The label ids a message must carry to be inside the scope; None when everything is read."""
        mode = self.scope.get("mode", "all")
        if mode not in ("inbox", "inbox_labels"):
            return None
        if self._scope_ids is None:
            ids = {"INBOX"}
            if mode == "inbox_labels" and self.scope.get("labels"):
                want = {n.lower() for n in self.scope["labels"]}
                ids |= {lab["id"] for lab in self.u.labels().list(userId="me").execute().get("labels", []) if str(lab.get("name", "")).lower() in want}
            self._scope_ids = ids
        return self._scope_ids

    def is_reply(self, thread_id: str | None) -> bool:
        """Whether a sent message answers a thread rather than starting one. A 404 stays here: in changed_threads it means an expired cursor."""
        if not thread_id:
            return False
        try:
            thread = self.u.threads().get(userId="me", id=thread_id, format="minimal", fields="messages/id").execute()
        except HttpError as e:
            if e.resp.status == 404:
                return False
            raise
        return len(thread.get("messages", [])) > 1

    def list_labels(self) -> list[str]:
        """The owner's own Gmail labels, for the scope setting's picker."""
        labs = self.u.labels().list(userId="me").execute().get("labels", [])
        return sorted({lab["name"] for lab in labs if lab.get("type") == "user" and lab.get("name")}, key=str.lower)

    @staticmethod
    def cursor_ok(cursor: str) -> bool:
        return str(cursor).isdigit()

    def profile_history_id(self) -> str:
        return str(self.u.getProfile(userId="me").execute()["historyId"])

    def changed_threads(self, cursor: str) -> tuple[set[str], str, bool]:
        """Thread ids with messages added since cursor, the new cursor, and whether a rebaseline is needed."""
        threads: set[str] = set()
        self.arrived_labels = {}
        page = None
        try:
            while True:
                resp = self.u.history().list(userId="me", startHistoryId=cursor, historyTypes=["messageAdded"], maxResults=500, pageToken=page).execute()
                for h in resp.get("history", []):
                    for item in h.get("messagesAdded", []):
                        m = item.get("message", {})
                        if SKIP_LABELS & set(m.get("labelIds", [])):
                            continue
                        want, labels = self.scope_label_ids(), set(m.get("labelIds", []))
                        if want is not None and not (want & labels) and not ("SENT" in labels and self.is_reply(m.get("threadId"))):
                            continue  # outside the scope (1.100): not in the inbox nor under a chosen label, and not the owner's reply
                        if m.get("threadId"):
                            threads.add(m["threadId"])
                            # a label a message carries as it is added was put on by a Gmail filter; one the owner adds by
                            # hand is a later labelsAdded record, never part of messagesAdded
                            self.arrived_labels.setdefault(m["threadId"], set()).update(m.get("labelIds", []))
                page = resp.get("nextPageToken")
                new_cursor = str(resp.get("historyId", cursor))
                if not page:
                    return threads, new_cursor, False
        except HttpError as e:
            if e.resp.status == 404:
                return set(), cursor, True  # cursor expired: rebaseline
            raise

    def search_ids(self, query: str, cap: int) -> list[str]:
        ids: list[str] = []
        page = None
        while len(ids) < cap:
            resp = self.u.messages().list(userId="me", q=query, maxResults=min(500, cap - len(ids)), pageToken=page).execute()
            ids += [m["id"] for m in resp.get("messages", [])]
            page = resp.get("nextPageToken")
            if not page:
                break
        return ids[:cap]

    # ---- the Pocket Inbox label (1.75): the one thing the watcher may change
    def label_access(self) -> str | None:
        """None when the label can be written, else why not (a read-only sign-in, a scope the admin has not allowed)."""
        try:
            self._labels()
            return None
        except Exception as ex:  # noqa: BLE001
            return str(ex)[:200]

    def _labels(self):
        if self._writer is None:
            creds = credentials(self.mail, self.owner_email, LABEL_SCOPES)
            if not getattr(creds, "valid", False):
                from google.auth.transport.requests import Request
                creds.refresh(Request())
            self._writer = build("gmail", "v1", credentials=creds, cache_discovery=False).users()
        return self._writer

    def label_id(self, name: str, create: bool = True) -> str | None:
        """The id of the user label called name (any case), created when missing and create is set."""
        for lab in self.u.labels().list(userId="me").execute().get("labels", []):
            if lab.get("type") == "user" and lab.get("name", "").lower() == name.lower():
                return lab["id"]
        if not create:
            return None
        body = {"name": name, "labelListVisibility": "labelShow", "messageListVisibility": "show"}
        return self._labels().labels().create(userId="me", body=body).execute()["id"]

    def labelled_threads(self, label_id: str, cap: int) -> set[str]:
        threads: set[str] = set()
        page = None
        while len(threads) < cap:
            resp = self.u.threads().list(userId="me", labelIds=[label_id], maxResults=min(100, cap - len(threads)), pageToken=page).execute()
            threads |= {t["id"] for t in resp.get("threads", [])}
            page = resp.get("nextPageToken")
            if not page:
                break
        return threads

    def label_thread(self, thread_id: str, add: list[str] = (), remove: list[str] = ()) -> None:
        self._labels().threads().modify(userId="me", id=thread_id, body={"addLabelIds": list(add), "removeLabelIds": list(remove)}).execute()

    def label_threads(self, changes: list[tuple[str, list[str], list[str]]]) -> set[str]:
        """Apply [(thread id, add ids, remove ids)]; the thread ids that took the change (one failure leaves only that one)."""
        ok: set[str] = set()
        for tid, add, remove in changes:
            try:
                self.label_thread(tid, add, remove)
                ok.add(tid)
            except HttpError:
                continue
        return ok

    def baseline_threads(self, query: str | None = None, cap: int = 60) -> set[str]:
        threads: set[str] = set()
        page = None
        while len(threads) < cap:
            resp = self.u.messages().list(userId="me", q=f"{query or self.baseline_query} {scope_query(self.scope)}".strip(), maxResults=100, pageToken=page).execute()
            for m in resp.get("messages", []):
                threads.add(m["threadId"])
            page = resp.get("nextPageToken")
            if not page:
                break
        return threads

    def fetch_messages(self, ids: list[str]) -> list[dict]:
        """messages.get(format=full) in batches of 40, retrying rate-limit and server errors."""
        out: list[dict] = []
        ids = list(ids)
        for i in range(0, len(ids), 40):
            pending, tries = ids[i:i + 40], 0
            while pending and tries < 6:
                retry: list[str] = []

                def cb(rid, resp, exc, retry=retry):
                    if exc is None:
                        out.append(resp)
                    elif isinstance(exc, HttpError) and exc.resp.status in (429, 500, 502, 503):
                        retry.append(rid)

                batch = self.svc.new_batch_http_request()
                for mid in pending:
                    batch.add(self.u.messages().get(userId="me", id=mid, format="full"), request_id=mid, callback=cb)
                batch.execute()
                pending = retry
                if pending:
                    time.sleep(2 ** tries)
                    tries += 1
            time.sleep(0.4)
        return out

    def thread_raw(self, thread_id: str) -> list[dict]:
        return self.u.threads().get(userId="me", id=thread_id, format="full").execute().get("messages", [])
