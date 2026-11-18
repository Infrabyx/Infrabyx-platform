// How the agent keeps its private key (owner answer #136 (4), R1-D-184). On Windows, where
// TallyPrime mostly runs, the key is kept under DPAPI for the account the agent's service runs as;
// elsewhere, or when DPAPI is not available, in the mode-0600 state file, which the agent reports
// at enrolment so the platform's record carries a warning.
//
// The DPAPI call path, checked on 18 Nov 2026 against Microsoft's reference source
// (dotnet/dotnet-api-docs `xml/System.Security.Cryptography/ProtectedData.xml` and
// `DataProtectionScope.xml`; MicrosoftDocs/PowerShell-Docs `reference/5.1/.../about_PowerShell_exe.md`;
// learn.microsoft.com itself is not reachable from the build session):
//   * `System.Security.Cryptography.ProtectedData.Protect` and `.Unprotect` wrap DPAPI
//     (`CryptProtectData`, `CryptUnprotectData`), on Windows only; elsewhere they throw
//     `PlatformNotSupportedException`.
//   * `DataProtectionScope.CurrentUser`: only the same account can unprotect. `LocalMachine` lets
//     every account on the computer do so, and Microsoft advises `CurrentUser`.
//   * DPAPI keeps its keys in the user's profile, so that profile must be loaded: a Windows
//     service that runs under its own account has it.
//   * Windows PowerShell 5.1 ships with Windows, so the agent needs no npm dependency. The script
//     is fixed and passed with `-Command`; the key and the entropy go in on standard input and the
//     result comes out on standard output, so the key is on no command line (process listings)
//     and in no script text (PowerShell script-block logging).
// [VERIFY] on a Windows host before a tenant relies on it: the agent's self-test (protect, then
// unprotect, then compare) runs at every enrolment and falls back to the file if it fails.
import { execFile } from "node:child_process";

export type KeyProtection = "dpapi" | "file";

/** Runs a program with `stdin` and returns its exit code and output (never through a shell). */
export type Runner = (
  exe: string,
  args: readonly string[],
  stdin: string,
) => Promise<{ code: number; stdout: string }>;

/** Windows PowerShell 5.1 at its standard place (configurable: `powershellPath`). */
export const WINDOWS_POWERSHELL = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";

const script = (op: "Protect" | "Unprotect") =>
  "$ErrorActionPreference='Stop';" +
  "Add-Type -AssemblyName System.Security;" +
  "$i=[Console]::In.ReadToEnd().Trim().Split(' ');" +
  "$d=[Convert]::FromBase64String($i[0]);" +
  "$e=[Convert]::FromBase64String($i[1]);" +
  `$o=[System.Security.Cryptography.ProtectedData]::${op}($d,$e,` +
  "[System.Security.Cryptography.DataProtectionScope]::CurrentUser);" +
  "[Console]::Out.Write([Convert]::ToBase64String($o))";

const B64 = /^[A-Za-z0-9+/]+={0,2}$/;

export const execRunner: Runner = (exe, args, stdin) =>
  new Promise((resolve) => {
    const child = execFile(
      exe,
      [...args],
      { windowsHide: true, timeout: 30_000, maxBuffer: 64 * 1024, shell: false },
      (err, stdout) => {
        const code = err ? (typeof err.code === "number" ? err.code : 1) : 0;
        resolve({ code, stdout: String(stdout) });
      },
    );
    child.stdin?.end(stdin);
  });

/** DPAPI through Windows PowerShell; `entropy` binds a blob to one agent (its id). */
export class DpapiKeyGuard {
  constructor(private readonly o: { powershellPath?: string; run?: Runner } = {}) {}

  private async call(op: "Protect" | "Unprotect", data: Buffer, entropy: string): Promise<Buffer> {
    const exe = this.o.powershellPath ?? WINDOWS_POWERSHELL;
    const args = ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script(op)];
    const input = `${data.toString("base64")} ${Buffer.from(entropy, "utf8").toString("base64")}`;
    const { code, stdout } = await (this.o.run ?? execRunner)(exe, args, input);
    const out = stdout.trim();
    if (code !== 0 || !B64.test(out)) throw new Error(`DPAPI ${op} failed`);
    return Buffer.from(out, "base64");
  }

  async protect(pem: string, entropy: string): Promise<string> {
    return (await this.call("Protect", Buffer.from(pem, "utf8"), entropy)).toString("base64");
  }

  async unprotect(blob: string, entropy: string): Promise<string> {
    return (await this.call("Unprotect", Buffer.from(blob, "base64"), entropy)).toString("utf8");
  }

  /** Protect, unprotect, compare: the call path works for this account on this machine. */
  async selfTest(pem: string, entropy: string): Promise<string | null> {
    try {
      const blob = await this.protect(pem, entropy);
      return (await this.unprotect(blob, entropy)) === pem ? blob : null;
    } catch {
      return null;
    }
  }
}
