#!/usr/bin/env node

"use strict";

const [published, releaseState, tagCommit, currentCommit] = process.argv.slice(2);
const fullSha = /^[0-9a-f]{40}$/u;

if (
  !["true", "false"].includes(published) ||
  !["missing", "draft", "published"].includes(releaseState) ||
  !fullSha.test(currentCommit ?? "") ||
  (tagCommit !== "" && !fullSha.test(tagCommit ?? ""))
) {
  process.stderr.write("Cannot evaluate prepared release reuse.\n");
  process.exit(1);
}

const releaseIncomplete = published !== "true" || releaseState !== "published";
const tagIsReusable = tagCommit === "" || tagCommit === currentCommit;

process.stdout.write(String(releaseIncomplete && tagIsReusable));
