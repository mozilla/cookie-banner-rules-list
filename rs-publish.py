import json
import os
import sys
import requests

from kinto_http import Client, BearerTokenAuth

AUTH = os.getenv("AUTHORIZATION", "")
BUCKET = "main-workspace"
COLLECTION = "cookie-banner-rules-list"


class GitHubRepo:
    def __init__(self, org, repo):
        self.__org = org
        self.__repo = repo

    def __api_get(self, url):
        headers = {"Accept": "application/vnd.github+json"}

        response = requests.get(f"https://api.github.com{url}", headers=headers)
        doc = None

        if response.ok:
            doc = response.json()

        else:
            try:
                raise Exception(
                    f'could not get latest release for "{self.__org}/{self.__repo}!"'
                )

            except Exception as err:
                print(err, file=sys.stderr)
                sys.exit(1)

        return doc.get("tag_name")

    def __get(self, url):
        response = requests.get(url)
        body = None

        if response.ok:
            body = response.text

        else:
            try:
                raise Exception(f'could not get url: "{url}"!')

            except Exception as err:
                print(err, file=sys.stderr)
                sys.exit(1)

        return body

    def get_latest_release(self):
        latest_release = self.__api_get(
            f"/repos/{self.__org}/{self.__repo}/releases/latest"
        )

        return latest_release

    def get_file_content(self, commitish, path):
        return self.__get(
            f"https://raw.githubusercontent.com/{self.__org}/{self.__repo}/{commitish}/{path}"
        )


# fetch cookie-banner-rules-list.json of latest release from github.com/mozilla/cookie-banner-rules-list
gh_repo = GitHubRepo("mozilla", "cookie-banner-rules-list")
latest_release = gh_repo.get_latest_release()
source_records = json.loads(
    gh_repo.get_file_content(latest_release, "cookie-banner-rules-list.json")
).get("data")

client = Client(
    server_url=os.getenv("SERVER", "https://remote-settings-dev.allizom.org/v1/"),
    bucket=BUCKET,
    collection=COLLECTION,
    auth=tuple(AUTH.split(":", 1)) if ":" in AUTH else BearerTokenAuth(AUTH),
)

records_by_id = {r["id"]: r for r in client.get_records()}

# Create or update the destination records.
to_create = []
to_update = []
for r in source_records:
    record = records_by_id.pop(r["id"], None)

    # Record does not exist, create it.
    if record is None:
        to_create.append(r)
        continue

    # Record exists, check if it matches the record from the repo.
    # RemoteSettings includes meta-data fields which would always cause a
    # mismatch when comparing records. Remove them before compare.
    del record["last_modified"]
    del record["schema"]

    # Update the record on mismatch.
    if r != record:
        to_update.append(r)

# Delete the records missing from source.
to_delete = records_by_id.values()

has_pending_changes = (len(to_create) + len(to_update) + len(to_delete)) > 0
if not has_pending_changes:
    print("Records are in sync. Nothing to do.")
    sys.exit(0)

with client.batch() as batch:
    for r in to_create:
        batch.create_record(data=r)
    for r in to_update:
        # Let the server assign a new timestamp.
        if "last_modified" in r:
            del r["last_modified"]
        batch.update_record(data=r)
    for r in to_delete:
        batch.delete_record(id=r["id"])

ops_count = len(batch.results())

# If collection has multi-signoff, request review, otherwise auto-approve changes.
server_info = client.server_info()
signer_config = server_info["capabilities"].get("signer", {})
signer_resources = signer_config.get("resources", [])
# Check collection config (sign-off required etc.)
signed_dest = [
    r
    for r in signer_resources
    if r["source"]["bucket"] == BUCKET and r["source"]["collection"] == COLLECTION
]
if len(signed_dest) == 0:
    # Not explicitly configured. Check if configured at bucket level?
    signed_dest = [
        r
        for r in signer_resources
        if r["source"]["bucket"] == BUCKET and r["source"]["collection"] is None
    ]
# Collection has no signoff features (eg. dev server). Nothing to do.
if len(signed_dest) == 0:
    print(f"Done. {ops_count} changes applied.")
    sys.exit(0)

has_signoff_disabled = not signed_dest[0].get(
    "to_review_enabled", signer_config["to_review_enabled"]
) and not signed_dest[0].get(
    "group_check_enabled", signer_config["group_check_enabled"]
)
if has_signoff_disabled:
    # Approve the changes.
    client.patch_collection(data={"status": "to-sign"})
    print(f"Done. {ops_count} changes applied and signed.")
else:
    # Request review.
    client.patch_collection(data={"status": "to-review"})
    print(f"Done. Requested review for {ops_count} changes.")
