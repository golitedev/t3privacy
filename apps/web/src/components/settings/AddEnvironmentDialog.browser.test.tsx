import { AsyncResult } from "effect/reactivity";
import * as Cause from "effect/Cause";
import type { AtomCommandResult } from "@t3tools/client-runtime/state/runtime";
import { useState } from "react";
import { page, userEvent } from "vite-plus/test/browser";
import { describe, expect, it, vi } from "vite-plus/test";

import { render } from "../../../test/render";
import { AppAtomRegistryProvider } from "../../rpc/atomRegistry";

const mocks = vi.hoisted(() => ({
  connectPairing: vi.fn<
    (input: { host: string; pairingCode: string }) => Promise<AtomCommandResult<void, Error>>
  >(async () => AsyncResult.success(undefined)),
}));

vi.mock(import("../../state/use-atom-command"), async (original) => ({
  ...(await original()),
  useAtomCommand: ((command: unknown) => command) as never,
}));
vi.mock(import("~/connection/onboarding"), async (original) => ({
  ...(await original()),
  connectPairing: mocks.connectPairing as never,
}));

import { AddEnvironmentDialog } from "./AddEnvironmentDialog";

function Owner() {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <AppAtomRegistryProvider>
      <AddEnvironmentDialog
        open={open}
        routeTarget={null}
        error={error}
        onOpenChange={setOpen}
        onErrorChange={setError}
      />
    </AppAtomRegistryProvider>
  );
}

const dialog = () => page.getByRole("dialog");
const host = () => dialog().getByRole("textbox", { name: "Host" });
const code = () => dialog().getByRole("textbox", { name: "Pairing code" });

async function openDialog() {
  await userEvent.click(page.getByRole("button", { name: "Add environment" }));
  await expect.element(dialog()).toBeVisible();
}

describe("AddEnvironmentDialog", () => {
  it("pairs directly with the LAN host from a pasted pairing link", async () => {
    mocks.connectPairing.mockReset().mockResolvedValue(AsyncResult.success(undefined));
    await using _screen = await render(<Owner />);

    await openDialog();
    await userEvent.fill(host(), "http://192.168.1.20:3773/#token=PAIRCODE");
    await expect.element(host()).toHaveValue("http://192.168.1.20:3773");
    await expect.element(code()).toHaveValue("PAIRCODE");
    await userEvent.click(dialog().getByRole("button", { name: "Add environment" }));
    await expect.element(dialog()).not.toBeInTheDocument();
    expect(mocks.connectPairing).toHaveBeenCalledExactlyOnceWith({
      host: "http://192.168.1.20:3773",
      pairingCode: "PAIRCODE",
    });
  });

  it("shows a rejected pairing attempt beside the form", async () => {
    mocks.connectPairing
      .mockReset()
      .mockResolvedValue(AsyncResult.failure(Cause.fail(new Error("Pairing expired"))));
    await using _screen = await render(<Owner />);

    await openDialog();
    await userEvent.fill(host(), "192.168.1.20:3773");
    await userEvent.fill(code(), "PAIRCODE");
    await userEvent.click(dialog().getByRole("button", { name: "Add environment" }));
    await expect.element(dialog().getByText("Pairing expired")).toBeVisible();
  });

  it("clears the pairing fields after dismissing the dialog", async () => {
    await using _screen = await render(<Owner />);

    await openDialog();
    await userEvent.fill(host(), "192.168.1.20:3773");
    await userEvent.fill(code(), "PAIRCODE");
    await userEvent.keyboard("{Escape}");
    await expect.element(dialog()).not.toBeInTheDocument();
    await openDialog();
    await expect.element(host()).toHaveValue("");
    await expect.element(code()).toHaveValue("");
  });
});
