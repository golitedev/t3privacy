import * as NodeServices from "@effect/platform-node/NodeServices";
import { it as effectIt } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import type * as NodeOS from "node:os";

import { describe, expect, it } from "vite-plus/test";

import { readIsolatedLinuxBridges, resolveBoundEndpoints } from "./DirectEndpoints.ts";

const INTERFACES: ReturnType<typeof NodeOS.networkInterfaces> = {
  lo0: [
    {
      address: "127.0.0.1",
      netmask: "255.0.0.0",
      family: "IPv4",
      mac: "00:00:00:00:00:00",
      internal: true,
      cidr: "127.0.0.1/8",
    },
  ],
  en0: [
    {
      address: "192.168.1.10",
      netmask: "255.255.255.0",
      family: "IPv4",
      mac: "aa:bb:cc:dd:ee:ff",
      internal: false,
      cidr: "192.168.1.10/24",
    },
    {
      address: "fe80::1",
      netmask: "ffff:ffff:ffff:ffff::",
      family: "IPv6",
      mac: "aa:bb:cc:dd:ee:ff",
      internal: false,
      cidr: "fe80::1/64",
      scopeid: 4,
    },
  ],
  en1: [
    {
      address: "203.0.113.20",
      netmask: "255.255.255.0",
      family: "IPv4",
      mac: "aa:bb:cc:dd:ee:00",
      internal: false,
      cidr: "203.0.113.20/24",
    },
  ],
  utun4: [
    {
      address: "100.101.102.103",
      netmask: "255.255.255.255",
      family: "IPv4",
      mac: "00:00:00:00:00:00",
      internal: false,
      cidr: "100.101.102.103/32",
    },
    {
      address: "fd7a:115c:a1e0::1",
      netmask: "ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff",
      family: "IPv6",
      mac: "00:00:00:00:00:00",
      internal: false,
      cidr: "fd7a:115c:a1e0::1/128",
      scopeid: 0,
    },
  ],
};

const virtualInterface = (address: string, mac = "02:42:ac:11:00:01") => [
  {
    address,
    netmask: "255.255.0.0",
    family: "IPv4" as const,
    mac,
    internal: false,
    cidr: `${address}/16`,
  },
];

describe("resolveBoundEndpoints", () => {
  it("skips container and VM networks, which only this machine reaches", () => {
    const interfaces = {
      ...INTERFACES,
      docker0: virtualInterface("172.17.0.1"),
      "br-3f2a1b": virtualInterface("172.18.0.1"),
      virbr0: virtualInterface("192.168.122.1"),
      "vEthernet (WSL)": virtualInterface("172.24.0.1"),
      bridge100: virtualInterface("192.168.64.1"),
      vmbr0: virtualInterface("192.168.1.20"),
      fhciowner: virtualInterface("10.221.0.1"),
    };
    expect(
      resolveBoundEndpoints({
        platform: "linux",
        host: "0.0.0.0",
        port: 3773,
        interfaces,
        isolatedBridges: new Set(["fhciowner"]),
      }),
    ).toEqual([
      { kind: "lan", httpBaseUrl: "http://192.168.1.10:3773/" },
      { kind: "lan", httpBaseUrl: "http://192.168.1.20:3773/" },
    ]);
  });

  it("skips NixOS container and systemd-nspawn veths, which only this machine reaches", () => {
    const interfaces = {
      ...INTERFACES,
      "ve-jellyfin": virtualInterface("192.168.53.193"),
      "ve-qbittorrent": virtualInterface("192.168.55.225"),
      "vb-jellyfin": virtualInterface("192.168.100.1"),
      "vz-machine": virtualInterface("192.168.101.1"),
    };
    expect(
      resolveBoundEndpoints({ platform: "linux", host: "0.0.0.0", port: 3773, interfaces }),
    ).toEqual([{ kind: "lan", httpBaseUrl: "http://192.168.1.10:3773/" }]);
  });

  it("keeps a Windows alias matching a Linux container prefix eligible", () => {
    const interfaces = {
      ...INTERFACES,
      "ve-office": virtualInterface("192.168.1.30"),
    };
    expect(
      resolveBoundEndpoints({ platform: "win32", host: "0.0.0.0", port: 3773, interfaces }),
    ).toEqual([
      { kind: "lan", httpBaseUrl: "http://192.168.1.10:3773/" },
      { kind: "lan", httpBaseUrl: "http://192.168.1.30:3773/" },
    ]);
  });

  it("omits Windows host-only adapters without excluding guest NICs or explicit binds", () => {
    const interfaces = {
      ...INTERFACES,
      "VirtualBox-Host-Only-Netzwerk": virtualInterface("192.168.56.1", "0A:00:27:00:01:01"),
      "Ethernet 2": virtualInterface("192.168.150.1", "00:50:56:c0:00:01"),
      "Renamed network": virtualInterface("192.168.151.1", "00:50:56:c0:00:08"),
      guest1: virtualInterface("192.168.1.30", "08:00:27:5e:1a:22"),
      guest2: virtualInterface("192.168.1.31", "00:50:56:2b:8c:01"),
      guest3: virtualInterface("192.168.1.32", "00:0c:29:4f:8e:35"),
      guest4: virtualInterface("192.168.1.33", "00:50:56:80:8c:01"),
    };
    const input = { host: "0.0.0.0", port: 3773, interfaces };
    const retained = [
      { kind: "lan", httpBaseUrl: "http://192.168.1.10:3773/" },
      ...[30, 31, 32, 33].map((last) => ({
        kind: "lan",
        httpBaseUrl: `http://192.168.1.${last}:3773/`,
      })),
    ];
    expect(resolveBoundEndpoints({ ...input, platform: "win32" })).toEqual(retained);
    for (const platform of ["linux", "darwin"] as const) {
      expect(resolveBoundEndpoints({ ...input, platform })).toHaveLength(retained.length + 3);
    }
    for (const host of ["192.168.56.1", "192.168.150.1", "192.168.151.1"]) {
      expect(resolveBoundEndpoints({ ...input, platform: "win32", host })).toEqual([
        { kind: "lan", httpBaseUrl: `http://${host}:3773/` },
      ]);
    }
  });

  it("never reports a host name, which can resolve to another machine per client", () => {
    for (const host of ["server.local", "devbox", "devbox.home.arpa"]) {
      expect(
        resolveBoundEndpoints({ platform: "linux", host, port: 3773, interfaces: INTERFACES }),
      ).toEqual([]);
    }
  });

  it("never reports a public address, which would carry the credential over plain HTTP", () => {
    expect(
      resolveBoundEndpoints({
        platform: "linux",
        host: "203.0.113.20",
        port: 3773,
        interfaces: INTERFACES,
      }),
    ).toEqual([]);
  });

  it.each(["::ffff:127.0.0.1", "::ffff:7f00:1"])(
    "never advertises the IPv4-mapped address %s",
    (host) => {
      expect(
        resolveBoundEndpoints({
          platform: "linux",
          host,
          port: 3773,
          interfaces: INTERFACES,
        }),
      ).toEqual([]);
    },
  );
});

describe("readIsolatedLinuxBridges", () => {
  effectIt.effect("finds bridges whose ports never reach a NIC, under any name", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-sysfs-" });
      const dirs = [
        "eth0/device",
        "eth1/device",
        "bond0/lower_eth1",
        "veth1",
        "br0/bridge",
        "br0/brif/eth0",
        "vmbr0/bridge",
        "vmbr0/brif/bond0",
        "fhciowner/bridge",
        "fhciowner/brif/veth1",
        "virbr0/bridge",
      ];
      for (const dir of dirs) yield* fs.makeDirectory(`${root}/${dir}`, { recursive: true });
      const names = ["eth0", "bond0", "veth1", "br0", "vmbr0", "fhciowner", "virbr0"];
      expect([...(yield* readIsolatedLinuxBridges(names, root))].toSorted()).toEqual([
        "fhciowner",
        "virbr0",
      ]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
