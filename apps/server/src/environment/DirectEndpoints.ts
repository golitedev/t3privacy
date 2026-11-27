import type { ServerDirectEndpoint } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";

import * as HostProcess from "@t3tools/shared/HostProcess";
import {
  formatHostForUrl,
  isTailnetHost,
  isWildcardHost,
} from "@t3tools/shared/hostClassification";

import * as ServerConfig from "../config.ts";
import {
  isLoopbackHost,
  isPrivateNetworkAddress,
  isVirtualInterface,
  WINDOWS_HOST_ADAPTER_MAC,
} from "../startupAccess.ts";

type NetworkInterfacesMap = ReturnType<typeof NodeOS.networkInterfaces>;

export class DirectEndpoints extends Context.Service<
  DirectEndpoints,
  {
    readonly resolveAvailable: () => Effect.Effect<ReadonlyArray<ServerDirectEndpoint>>;
    readonly resolve: () => Effect.Effect<ReadonlyArray<ServerDirectEndpoint>>;
  }
>()("t3/environment/DirectEndpoints") {}

// Credentials travel over HTTP; public IPs leak them and hostnames can resolve differently per client.
const isAdvertisableAddress = (address: string): boolean =>
  NodeNet.isIPv4(address) && !address.startsWith("127.") && isPrivateNetworkAddress(address);

// macOS utun names need Tailscale's IPv6 range to identify them; WARP shares its IPv4 range.
const isTailscaleInterface = (
  name: string,
  entries: ReadonlyArray<NodeOS.NetworkInterfaceInfo>,
): boolean =>
  /^tailscale/i.test(name) ||
  entries.some((entry) => entry.family === "IPv6" && isTailnetHost(entry.address));

export function resolveBoundEndpoints(input: {
  readonly platform: NodeJS.Platform;
  readonly host: string | undefined;
  readonly port: number;
  readonly interfaces: NetworkInterfacesMap;
  /** A cloud VM's private network is its provider's, which no client shares. */
  readonly onCloudVm?: boolean;
  readonly isolatedBridges?: ReadonlySet<string>;
}): ReadonlyArray<ServerDirectEndpoint> {
  if (isLoopbackHost(input.host)) return [];
  const tailscaleAddresses = new Set(
    Object.entries(input.interfaces).flatMap(([name, entries = []]) =>
      isTailscaleInterface(name, entries) ? entries.map((entry) => entry.address) : [],
    ),
  );
  const addresses = isWildcardHost(input.host)
    ? Object.entries(input.interfaces)
        .flatMap(([name, entries]) =>
          isVirtualInterface(name, input.platform) || input.isolatedBridges?.has(name)
            ? []
            : (entries ?? []),
        )
        .filter(
          (entry) =>
            !entry.internal &&
            entry.family === "IPv4" &&
            isAdvertisableAddress(entry.address) &&
            !(input.platform === "win32" && WINDOWS_HOST_ADAPTER_MAC.test(entry.mac)),
        )
        .map((entry) => entry.address)
    : [input.host!].filter(
        (address) =>
          isAdvertisableAddress(address) ||
          (NodeNet.isIPv6(address) &&
            !address.toLowerCase().startsWith("::ffff:") &&
            isPrivateNetworkAddress(address)),
      );
  return [...new Set(addresses)]
    .filter((address) => !input.onCloudVm && !tailscaleAddresses.has(address))
    .map((address) => ({
      kind: "lan",
      httpBaseUrl: `http://${formatHostForUrl(address)}:${input.port}/`,
    }));
}

const SYSFS_NET = "/sys/class/net";

/**
 * Linux bridges with no port leading to a NIC, such as a container network
 * under any name. A host bridge like `br0` enslaves the NIC, directly or
 * through a bond or VLAN, and stays listed.
 */
export const readIsolatedLinuxBridges = Effect.fn("DirectEndpoints.readIsolatedLinuxBridges")(
  function* (names: ReadonlyArray<string>, root = SYSFS_NET) {
    const fs = yield* FileSystem.FileSystem;
    const exists = (path: string) => fs.exists(path).pipe(Effect.orElseSucceed(() => false));
    const list = (path: string) =>
      fs.readDirectory(path).pipe(Effect.orElseSucceed((): ReadonlyArray<string> => []));
    const reachesHardware: (name: string, depth: number) => Effect.Effect<boolean> =
      Effect.fnUntraced(function* (name: string, depth: number) {
        if (yield* exists(`${root}/${name}/device`)) return true;
        if (depth === 0) return false;
        const lowers = (yield* list(`${root}/${name}`)).flatMap((entry) =>
          entry.startsWith("lower_") ? [entry.slice("lower_".length)] : [],
        );
        for (const lower of lowers) {
          if (yield* reachesHardware(lower, depth - 1)) return true;
        }
        return false;
      });
    const isolated = new Set<string>();
    for (const name of names) {
      if (!(yield* exists(`${root}/${name}/bridge`))) continue;
      let uplinked = false;
      for (const port of yield* list(`${root}/${name}/brif`)) {
        if (yield* reachesHardware(port, 3)) {
          uplinked = true;
          break;
        }
      }
      if (!uplinked) isolated.add(name);
    }
    return isolated;
  },
);

export const layer = Layer.effect(
  DirectEndpoints,
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    const platform = yield* HostProcess.Platform;
    const fs = yield* FileSystem.FileSystem;
    const resolve = Effect.fn("DirectEndpoints.resolve")(function* () {
      const interfaces = NodeOS.networkInterfaces();
      const isolatedBridges =
        platform === "linux" && isWildcardHost(config.host)
          ? yield* readIsolatedLinuxBridges(Object.keys(interfaces)).pipe(
              Effect.provideService(FileSystem.FileSystem, fs),
            )
          : undefined;
      return resolveBoundEndpoints({
        platform,
        host: config.host,
        port: config.port,
        interfaces,
        ...(isolatedBridges === undefined ? {} : { isolatedBridges }),
      });
    });
    return DirectEndpoints.of({ resolveAvailable: resolve, resolve });
  }),
);
