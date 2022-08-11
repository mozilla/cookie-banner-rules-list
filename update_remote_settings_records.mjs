/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at <http://mozilla.org/MPL/2.0/>. */

/* global process */

// This script consumes the following env variables:
// - AUTHORIZATION (mandatory): Raw authorization header (e.g. `AUTHORIZATION='Bearer XXXXXXXXXXXXX'`)
// - SERVER (mandatory): Writer server URL (eg. https://settings-writer.stage.mozaws.net/v1)
// - ENVIRONMENT (optional): dev, stage, prod. When set to `dev`, the script will approve its own changes.
// - DRY_RUN (optional): If set to 1, no changes will be made to the collection, this will
//                       only log the actions that would be done.

// This node script syncs `https://github.com/mozilla/cookie-banner-rules-list`
// and updates records from the associated collection in RemoteSettings.

import fetch from "node-fetch";

// Use the legacy wrapper to support all Node 12+ versions.
// If we only support Node 16+, can be updated to:
//   import bcd from '@mdn/browser-compat-data' assert { type: 'json' };
// See https://github.com/mozilla/cookie-banner-rules-list
import compatData from "@mdn/browser-compat-data/forLegacyNode";

const SUCCESS_RET_VALUE = 0;
const FAILURE_RET_VALUE = 1;
const VALID_ENVIRONMENTS = ["dev", "stage", "prod"];

if (!process.env.AUTHORIZATION) {
  console.error(`AUTHORIZATION environment variable needs to be set`);
  process.exit(FAILURE_RET_VALUE);
}

if (!process.env.SERVER) {
  console.error(`SERVER environment variable needs to be set`);
  process.exit(FAILURE_RET_VALUE);
}

if (
  process.env.ENVIRONMENT &&
  !VALID_ENVIRONMENTS.includes(process.env.ENVIRONMENT)
) {
  console.error(
    `ENVIRONMENT environment variable needs to be set to one of the following values: ${VALID_ENVIRONMENTS.join(
      ", "
    )}`
  );
  process.exit(FAILURE_RET_VALUE);
}

const rsBrowsersCollectionEndpoint = `${process.env.SERVER}/buckets/main-workspace/collections/devtools-compatibility-browsers`;
const rsBrowsersRecordsEndpoint = `${rsBrowsersCollectionEndpoint}/records`;
const isDryRun = process.env.DRY_RUN == "1";
const headers = {
  "Content-Type": "application/json",
  Authorization: process.env.AUTHORIZATION,
};

update()
  .then(() => {
    return process.exit(SUCCESS_RET_VALUE);
  })
  .catch((e) => {
    console.error(e);
    return process.exit(FAILURE_RET_VALUE);
  });

async function update() {
  const records = await getRSRecords();
  const operations = { added: [], updated: [], removed: [] };

  const browsersMdn = getFlatBrowsersMdnData();

  for (const browserMdn of browsersMdn) {
    const rsRecord = records.find(
      (record) =>
        record.browserid == browserMdn.browserid &&
        record.version == browserMdn.version
    );
    if (browserMdn.status == "retired") {
      if (rsRecord) {
        const succesful = await deleteRecord(rsRecord);
        if (succesful) {
          operations.removed.push(rsRecord);
        }
      }
      continue;
    }

    if (!rsRecord) {
      const succesful = await createRecord(browserMdn);
      if (succesful) {
        operations.added.push(browserMdn);
      }
      continue;
    }

    if (
      rsRecord.status !== browserMdn.status ||
      rsRecord.name !== browserMdn.name
    ) {
      const succesful = await updateRecord(rsRecord, browserMdn);
      if (succesful) {
        operations.updated.push(browserMdn);
      }
    }
  }

  for (const record of records) {
    const browserMdn = browsersMdn.find(
      (browser) =>
        browser.browserid == record.browserid &&
        browser.version == record.version
    );
    if (!browserMdn) {
      const succesful = await deleteRecord(record);
      if (succesful) {
        operations.removed.push(record);
      }
    }
  }

  console.group("Results");
  console.log("Added:", operations.added.length);
  if (operations.added.length > 0) {
    console.table(operations.added);
  }
  console.log("Updated:", operations.updated.length);
  if (operations.updated.length > 0) {
    console.table(operations.updated);
  }
  console.log("Removed:", operations.removed.length);
  if (operations.removed.length > 0) {
    console.table(operations.removed);
  }
  console.groupEnd();

  if (
    operations.added.length +
      operations.updated.length +
      operations.removed.length ==
    0
  ) {
    console.log("No changes detected");
  } else {
    const refreshedRecords = await getRSRecords();
    console.log("Browsers data synced ✅\nRefreshed records:");
    console.table(refreshedRecords);
    if (process.env.ENVIRONMENT === "dev") {
      await approveChanges();
    } else {
      await requestReview();
    }
  }
}

async function getRSRecords() {
  console.log(`Get existing records from ${rsBrowsersCollectionEndpoint}`);
  const response = await fetch(rsBrowsersRecordsEndpoint, {
    method: "GET",
    headers,
  });
  if (response.status !== 200) {
    throw new Error(
      `Can't retrieve records: "[${response.status}] ${response.statusText}"`
    );
  }
  const { data } = await response.json();
  return data;
}

/**
 * Create a record on RemoteSetting
 *
 * @param {Object} browserMdn: An item from the result of getFlatBrowsersMdnData
 * @returns {Boolean} Whether the API call was succesful or not
 */
async function createRecord(browserMdn) {
  console.log(
    isDryRun ? "[DRY_RUN]" : "",
    "Create",
    browserMdn.browserid,
    browserMdn.version
  );
  if (isDryRun) {
    return true;
  }

  const response = await fetch(`${rsBrowsersRecordsEndpoint}`, {
    method: "POST",
    body: JSON.stringify({ data: browserMdn }),
    headers,
  });
  const succesful = response.status == 201;
  if (!succesful) {
    console.warn(
      `Couldn't create record: "[${response.status}] ${response.statusText}"`
    );
  }
  return succesful;
}

/**
 * Update a record on RemoteSetting
 *
 * @param {Object} record: The existing record on RemoteSetting
 * @param {Object} browserMdn: An item from the result of getFlatBrowsersMdnData whose data
 *                             will be put into the record.
 * @returns {Boolean} Whether the API call was succesful or not
 */
async function updateRecord(record, browserMdn) {
  console.log(
    isDryRun ? "[DRY_RUN]" : "",
    "Update",
    record.browserid,
    record.version
  );
  if (isDryRun) {
    return true;
  }

  const response = await fetch(`${rsBrowsersRecordsEndpoint}/${record.id}`, {
    method: "PUT",
    body: JSON.stringify({ data: browserMdn }),
    headers,
  });
  const succesful = response.status == 200;
  if (!succesful) {
    console.warn(
      `Couldn't update record: "[${response.status}] ${response.statusText}"`
    );
  }
  return succesful;
}

/**
 * Remove a record on RemoteSetting
 *
 * @param {Object} record: The existing record on RemoteSetting
 * @returns {Boolean} Whether the API call was succesful or not
 */
async function deleteRecord(record) {
  console.log(
    isDryRun ? "[DRY_RUN]" : "",
    "Delete",
    record.browserid,
    record.version
  );
  if (isDryRun) {
    return true;
  }

  const response = await fetch(`${rsBrowsersRecordsEndpoint}/${record.id}`, {
    method: "DELETE",
    headers,
  });
  const succesful = response.status == 200;
  if (!succesful) {
    console.warn(
      `Couldn't delete record: "[${response.status}] ${response.statusText}"`
    );
  }
  return succesful;
}

/**
 * Ask for review on the collection.
 */
async function requestReview() {
  console.log(isDryRun ? "[DRY_RUN]" : "", "Requesting review");
  if (isDryRun) {
    return true;
  }

  const response = await fetch(rsBrowsersCollectionEndpoint, {
    method: "PATCH",
    body: JSON.stringify({ data: { status: "to-review" } }),
    headers,
  });
  if (response.status === 200) {
    console.log("Review requested ✅");
  } else {
    console.warn(
      `Couldn't request review: "[${response.status}] ${response.statusText}"`
    );
  }
}

/**
 * Automatically approve changes made on the collection.
 * ⚠️ This only works on the `dev` server.
 */
async function approveChanges() {
  console.log(isDryRun ? "[DRY_RUN]" : "", "Approving changes");
  if (isDryRun) {
    return true;
  }

  const response = await fetch(rsBrowsersCollectionEndpoint, {
    method: "PATCH",
    body: JSON.stringify({ data: { status: "to-sign" } }),
    headers,
  });
  if (response.status === 200) {
    console.log("Changes approved ✅");
  } else {
    console.warn(
      `Couldn't automatically approve changes: "[${response.status}] ${response.statusText}"`
    );
  }
}

function getFlatBrowsersMdnData() {
  const browsers = [];
  for (const [browserid, browserInfo] of Object.entries(compatData.browsers)) {
    for (const [releaseNumber, releaseInfo] of Object.entries(
      browserInfo.releases
    )) {
      if (!browserInfo.name) {
        console.error(
          `${browserid} "name" property is expected but wasn't found`,
          browserInfo
        );
        continue;
      }

      if (!releaseInfo.status) {
        console.error(
          `${browserid} "status" property is expected but wasn't found`,
          releaseInfo
        );
        continue;
      }

      if (!releaseNumber || !releaseNumber.match(/\d/)) {
        console.error(
          `${browserid} "releaseNumber" doesn't have expected shape`,
          releaseNumber
        );
        continue;
      }

      browsers.push({
        browserid,
        name: browserInfo.name,
        status: releaseInfo.status,
        version: releaseNumber,
      });
    }
  }
  return browsers;
}
