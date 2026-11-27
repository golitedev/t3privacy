import { CLI_INSTALL_SCRIPT_URL } from "@t3tools/shared/cliRelease";
import { T } from "gt-react";
import { cn } from "~/lib/utils";

import { CommandBlock } from "./CommandBlock";

/**
 * Setup steps for another computer: install `t3`, then run `command`. The fork publishes a Linux x64 CLI.
 */
export function InstallT3Commands({
  command,
  className,
}: {
  readonly command: string;
  readonly className?: string;
}) {
  return (
    <div className={cn("space-y-2", className)}>
      <p className="text-xs text-muted-foreground">Linux x64</p>
      <CommandBlock command={"curl -fsSL " + CLI_INSTALL_SCRIPT_URL + " | sh"} />
      <p className="text-xs text-muted-foreground">
        <T>Then</T>
      </p>
      <CommandBlock command={command} />
      <p className="text-xs text-muted-foreground">
        <T>
          Skip the install if you already have <code className="font-mono">t3</code>. If{" "}
          <code className="font-mono">t3</code> is not found after installing, add the folder the
          installer names to your PATH.
        </T>
      </p>
    </div>
  );
}
