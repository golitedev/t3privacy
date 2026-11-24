const STABLE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function resolveRelease({ tag, channel, version, runNumber, date }) {
  if (tag !== undefined) {
    if (!tag.startsWith("v") || !STABLE_VERSION.test(tag.slice(1))) {
      throw new Error("Stable tags must have the form vX.Y.Z.");
    }
    return { version: tag.slice(1), tag, release_channel: "stable" };
  }
  if (!STABLE_VERSION.test(version)) throw new Error("Version must have the form X.Y.Z.");
  if (channel === "stable") return { version, tag: `v${version}`, release_channel: channel };
  if (channel !== "nightly") throw new Error("Unknown release channel.");
  if (!/^\d{8}$/.test(date) || !Number.isSafeInteger(runNumber) || runNumber < 1) {
    throw new Error("Nightlies require a date and positive run number.");
  }
  const [major, minor, patch] = version.split(".");
  const nightly = `${major}.${minor}.${Number(patch) + 1}-nightly.${date}.${runNumber}`;
  return { version: nightly, tag: `v${nightly}`, release_channel: channel };
}

function releaseManifest(version, migrationFiles) {
  const ids = migrationFiles.flatMap((file) => {
    const match = /^(\d+)_\w+\.ts$/.exec(file);
    return match ? [Number(match[1])] : [];
  });
  if (ids.length === 0) throw new Error("No database migrations found.");
  return { version, t3code: { databaseMigration: Math.max(...ids) } };
}

module.exports = { resolveRelease, releaseManifest };
