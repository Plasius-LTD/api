"use strict";

const RELEASE_VERSION_PATTERN =
  /^[0-9]+\.[0-9]+\.[0-9]+(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;

function deriveReleasePreid(version) {
  const match = String(version ?? "").match(RELEASE_VERSION_PATTERN);
  if (!match) {
    throw new TypeError("Invalid release version.");
  }

  const identifiers = match[1] ? match[1].split(".") : [];
  if (identifiers.length > 1 && /^[0-9]+$/u.test(identifiers.at(-1))) {
    identifiers.pop();
  }
  return identifiers.join(".");
}

if (require.main === module) {
  try {
    process.stdout.write(deriveReleasePreid(process.argv[2]));
  } catch {
    process.stderr.write("Cannot derive pre-release identity.\n");
    process.exitCode = 1;
  }
}

module.exports = { deriveReleasePreid };
