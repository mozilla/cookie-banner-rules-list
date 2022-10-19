/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const Ajv = require("ajv");
const fsPromise = require("fs").promises;

const schema = require("../CookieBannerRuleList.schema.json");
const { exit } = require("process");

const RULE_LIST_FILE = "cookie-banner-rules-list.json";

let fetch;

/**
 * Load schema from URI via HTTP.
 * @param {string} uri - URI to load schema from.
 * @returns {Promise<Object>} - Resolve with the schema JSON object or rejects
 * on error.
 */
async function loadSchema(uri) {
  // node-fetch no longer supports importing via require(). We can't use the
  // global import because this is not a module. Use a dynamic import instead.
  // This code can be switched over to the regular fetch once node supports
  // it.
  if (!fetch) {
    fetch = (await import("node-fetch")).default;
  }

  const response = await fetch(uri);
  if (response.statusCode >= 400)
    throw new Error("Loading error: " + response.statusCode);
  return response.json();
}

function exitWithError(reason) {
  console.error(`❌ ${RULE_LIST_FILE} is invalid: ${reason}`);
  exit(1);
}

const ajv = new Ajv({ loadSchema });

(async () => {
  // 1. Load and parse the rules list.
  const ruleListStr = await fsPromise.readFile(RULE_LIST_FILE, {
    encoding: "utf-8",
  });

  let ruleList;
  try {
    ruleList = JSON.parse(ruleListStr);
  } catch (error) {
    console.error("Error while parsing rule list", error);
    exitWithError("Invalid JSON");
  }

  // 2. Validate rules list against schema.
  //    The loadSchema method is passed to support fetching remote schemas
  //    embedded via $ref in CookieBannerRuleList.schema.json.
  const validate = await ajv.compileAsync(schema);
  const valid = validate(ruleList);
  if (!valid) {
    console.info("Rule list validation error", validate.errors);
    exitWithError("Schema validation error");
  }

  // 3. Check for duplicate rules (id or domain)
  const idSet = new Set();
  const domainSet = new Set();

  let foundDuplicates = false;
  let i = 0;
  ruleList.data.forEach((rule) => {
    if (idSet.has(rule.id)) {
      console.error(`Duplicate id ${rule.id} for rule #${i}`);
      foundDuplicates = true;
    }
    // Allow * domain rules which are global rules.
    if (domainSet.has(rule.domain) && rule.domain != "*") {
      console.error(`Duplicate domain ${rule.domain} for rule #${i}`);
      foundDuplicates = true;
    }

    idSet.add(rule.id);
    domainSet.add(rule.domain);
    i += 1;
  });
  if (foundDuplicates) {
    exitWithError("Found duplicate rules");
  }

  console.info(`✅ ${RULE_LIST_FILE} is valid.`);
})();
