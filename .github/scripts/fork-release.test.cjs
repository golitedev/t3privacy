const assert = require("node:assert/strict");
const { test } = require("node:test");
const { resolveRelease, releaseManifest } = require("./fork-release.cjs");

test("stable dispatch can publish the first release without a prior nightly", () => {
  assert.deepEqual(resolveRelease({ channel: "stable", version: "0.1.11" }), {
    version: "0.1.11",
    tag: "v0.1.11",
    release_channel: "stable",
  });
});

test("a stable tag defines its own version", () => {
  assert.deepEqual(resolveRelease({ tag: "v1.2.3", version: "0.1.11" }), {
    version: "1.2.3",
    tag: "v1.2.3",
    release_channel: "stable",
  });
});

test("nightlies follow the next patch and do not replace stable", () => {
  assert.deepEqual(
    resolveRelease({ channel: "nightly", version: "1.2.3", date: "20261124", runNumber: 4 }),
    {
      version: "1.2.4-nightly.20261124.4",
      tag: "v1.2.4-nightly.20261124.4",
      release_channel: "nightly",
    },
  );
});

test("rejects prerelease tags, invalid versions and invalid channels", () => {
  for (const tag of ["v1.2.3-nightly.20261124.1", "1.2.3", "v01.2.3"]) {
    assert.throws(() => resolveRelease({ tag }));
  }
  for (const version of ["1.2.3\nother=value", "1.2", "1.2.3-beta.1"]) {
    assert.throws(() => resolveRelease({ channel: "stable", version }));
  }
  assert.throws(() => resolveRelease({ channel: "other", version: "1.2.3" }));
});

test("compatibility metadata includes the highest migration, excluding tests", () => {
  assert.deepEqual(
    releaseManifest("1.2.3", [
      "002_Early.ts",
      "099_Last.ts",
      "100_Future.test.ts",
      "OrchestrationV2",
    ]),
    {
      version: "1.2.3",
      t3code: { databaseMigration: 99 },
    },
  );
  assert.throws(() => releaseManifest("1.2.3", []));
});
