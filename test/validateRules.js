/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const Ajv = require("ajv");
const fsPromise = require("fs").promises;

const schema = require("../CookieBannerRuleList.schema.json");
const { exit } = require("process");

const RULE_LIST_FILE = "cookie-banner-rules-list.json";

// ID of the rule which contains sites where the mechanism is disabled.
const RULE_ID_DISABLED = "disabled";

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

const ajv = new Ajv({ loadSchema, allErrors: true });

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

  // 3. Check for duplicate rules (id or domains)
  const idSet = new Set();
  const domainSet = new Set();

  let foundDuplicates = false;
  ruleList.data.forEach((rule, i) => {
    if (idSet.has(rule.id)) {
      console.error(`Duplicate id ${rule.id} for rule #${i}`);
      foundDuplicates = true;
    }
    // This still allows for global rules which have an empty domains array.
    let duplicateDomains = rule.domains.filter((d) => domainSet.has(d));
    if (duplicateDomains.length) {
      console.error(`Duplicate domain/s for rule #${i}`, duplicateDomains);
      foundDuplicates = true;
    }

    idSet.add(rule.id);
    rule.domains.forEach((d) => domainSet.add(d));
  });
  if (foundDuplicates) {
    exitWithError("Found duplicate rules");
  }

  // 4. Check for empty rules that have no click or cookie injection rule.
  //    Allow detect-only click rules that only have a presence field.
  //    Also allow the "disabled" rule which contains all sites the mechanism is
  //    disabled for.
  let foundEmptyRules = false;
  ruleList.data.forEach((rule, i) => {
    if (
      rule.id !== RULE_ID_DISABLED &&
      !rule.cookies?.optIn?.length &&
      !rule.cookies?.optOut?.length &&
      !rule.click?.presence
    ) {
      console.error(`Empty rule rule #${i} id: ${rule.id}`);
      foundEmptyRules = true;
    }
  });
  if (foundEmptyRules) {
    exitWithError("Found empty rules");
  }

  console.info(`✅ ${RULE_LIST_FILE} is valid.`);
})();
