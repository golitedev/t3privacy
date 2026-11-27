import {
  ServerNpmReleaseError,
  ServerNpmReleaseInput,
  type ServerNpmRelease,
} from "@t3tools/contracts";
import {
  CLI_RELEASES_PAGE_URL,
  cliReleaseAssetUrl,
  cliReleaseChannelOf,
} from "@t3tools/shared/cliRelease";
import * as Cache from "effect/Cache";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { FetchHttpClient, HttpClient } from "effect/http";

const Version = Schema.String.check(Schema.isPattern(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/));
const Manifest = Schema.Struct({
  version: Version,
  t3code: Schema.Struct({ databaseMigration: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)) }),
});
const isReleaseError = Schema.is(ServerNpmReleaseError);
const decodeManifest = Schema.decodeUnknownEffect(Schema.fromJsonString(Manifest));
const decodeInput = Schema.decodeUnknownEffect(ServerNpmReleaseInput);

// Keep the RPC name for existing clients. The fork publishes its release metadata on GitHub.
export class NpmRelease extends Context.Service<
  NpmRelease,
  {
    readonly get: (
      input: ServerNpmReleaseInput,
    ) => Effect.Effect<ServerNpmRelease | null, ServerNpmReleaseError>;
  }
>()("t3/cloud/npmRelease") {}

export const make = Effect.fn("NpmRelease.make")(function* () {
  const http = yield* HttpClient.HttpClient;
  const cache = yield* Cache.make({
    capacity: 32,
    timeToLive: Duration.minutes(1),
    lookup: Effect.fn("NpmRelease.lookup")(
      function* (spec: string) {
        if (spec === "nightly") return null;
        const url =
          spec === "latest"
            ? CLI_RELEASES_PAGE_URL + "/latest/download/release.json"
            : cliReleaseAssetUrl(spec, "release.json");
        const response = yield* http.get(url);
        if (response.status === 404) return null;
        if (response.status !== 200) {
          return yield* new ServerNpmReleaseError({
            reason: "Fork release metadata is unavailable.",
          });
        }
        const manifest = yield* decodeManifest(yield* response.text);
        if (
          spec === "latest"
            ? cliReleaseChannelOf(manifest.version) !== "stable"
            : manifest.version !== spec
        ) {
          return yield* new ServerNpmReleaseError({
            reason: "Fork release metadata has an unexpected version.",
          });
        }
        return { version: manifest.version, databaseMigration: manifest.t3code.databaseMigration };
      },
      Effect.timeout(Duration.seconds(15)),
      Effect.mapError((error) =>
        isReleaseError(error)
          ? error
          : new ServerNpmReleaseError({
              reason: "Could not read fork release metadata from GitHub.",
            }),
      ),
    ),
  });
  return NpmRelease.of({
    get: Effect.fn("NpmRelease.get")(function* (input) {
      const { spec } = yield* decodeInput(input).pipe(
        Effect.mapError(
          () => new ServerNpmReleaseError({ reason: "Invalid release version or track." }),
        ),
      );
      return yield* Cache.get(cache, spec);
    }),
  });
});

export const layer = Layer.effect(NpmRelease, make()).pipe(Layer.provide(FetchHttpClient.layer));
