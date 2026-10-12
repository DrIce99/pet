// Other applications' windows, read from Windows through koffi (user32 and
// dwmapi): their top edges are ledges the pet can climb onto. Any failure
// (another OS, a missing native binary) just means there are no windows.
import { screen } from "electron";
import type { WindowBox } from "./ledges";
import { log } from "./log";

const GW_HWNDNEXT = 2;
const GWL_EXSTYLE = -20;
const WS_EX_TRANSPARENT = 0x20;
const WS_EX_TOOLWINDOW = 0x80;
const WS_EX_NOACTIVATE = 0x08000000;
const DWMWA_EXTENDED_FRAME_BOUNDS = 9;
const DWMWA_CLOAKED = 14;
/** Shell surfaces and helper windows that look like windows but aren't. */
const IGNORED_CLASSES = new Set([
  "Progman",
  "WorkerW",
  "Shell_TrayWnd",
  "Shell_SecondaryTrayWnd",
  "NotifyIconOverflowWindow",
  "Windows.UI.Core.CoreWindow",
  "XamlExplorerHostIslandWindow",
  "TopLevelWindowForOverflowXamlIsland",
]);
const MIN_WIDTH = 120;
const MIN_HEIGHT = 60;

type Handle = unknown;

interface User32 {
  GetTopWindow(hwnd: Handle): Handle;
  GetWindow(hwnd: Handle, cmd: number): Handle;
  IsWindowVisible(hwnd: Handle): boolean;
  IsIconic(hwnd: Handle): boolean;
  GetWindowLongW(hwnd: Handle, index: number): number;
  GetWindowTextLengthW(hwnd: Handle): number;
  GetClassNameW(hwnd: Handle, buffer: Buffer, size: number): number;
  GetWindowThreadProcessId(hwnd: Handle, pid: number[]): number;
  DwmGetWindowAttribute(hwnd: Handle, attribute: number, out: Buffer, size: number): number;
}

let api: User32 | null | undefined;

function load(): User32 | null {
  if (api !== undefined) return api;
  api = null;
  if (process.platform !== "win32") return api;
  try {
    // Loaded lazily so that a missing native binary only disables climbing
    const koffi = require("koffi") as typeof import("koffi");
    const user32 = koffi.load("user32.dll");
    const dwmapi = koffi.load("dwmapi.dll");
    api = {
      GetTopWindow: user32.func("void * __stdcall GetTopWindow(void *hWnd)"),
      GetWindow: user32.func("void * __stdcall GetWindow(void *hWnd, uint32_t uCmd)"),
      IsWindowVisible: user32.func("bool __stdcall IsWindowVisible(void *hWnd)"),
      IsIconic: user32.func("bool __stdcall IsIconic(void *hWnd)"),
      GetWindowLongW: user32.func("int32_t __stdcall GetWindowLongW(void *hWnd, int nIndex)"),
      GetWindowTextLengthW: user32.func("int __stdcall GetWindowTextLengthW(void *hWnd)"),
      GetClassNameW: user32.func("int __stdcall GetClassNameW(void *hWnd, _Out_ void *lpClassName, int nMaxCount)"),
      GetWindowThreadProcessId: user32.func("uint32_t __stdcall GetWindowThreadProcessId(void *hWnd, _Out_ uint32_t *lpdwProcessId)"),
      DwmGetWindowAttribute: dwmapi.func("int32_t __stdcall DwmGetWindowAttribute(void *hwnd, uint32_t dwAttribute, _Out_ void *pvAttribute, uint32_t cbAttribute)"),
    };
  } catch (err) {
    log.warn("Can't read the other windows: the pet won't climb on them", err);
  }
  return api;
}

/** Visible application windows in Z-order (topmost first), in DIP coordinates. */
export function desktopWindows(): WindowBox[] {
  const w = load();
  if (!w) return [];
  const out: WindowBox[] = [];
  const rect = Buffer.alloc(16);
  const cloaked = Buffer.alloc(4);
  const className = Buffer.alloc(256 * 2);
  const pid = [0];
  try {
    for (let hwnd = w.GetTopWindow(null); hwnd; hwnd = w.GetWindow(hwnd, GW_HWNDNEXT)) {
      if (!w.IsWindowVisible(hwnd) || w.IsIconic(hwnd)) continue;
      const exStyle = w.GetWindowLongW(hwnd, GWL_EXSTYLE);
      if (exStyle & (WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE | WS_EX_TRANSPARENT)) continue;
      if (w.GetWindowTextLengthW(hwnd) === 0) continue;
      w.GetWindowThreadProcessId(hwnd, pid);
      if (pid[0] === process.pid) continue;
      // Windows on other virtual desktops and suspended store apps are "cloaked"
      if (w.DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, cloaked, 4) === 0 && cloaked.readUInt32LE(0) !== 0) continue;
      const length = w.GetClassNameW(hwnd, className, 256);
      if (IGNORED_CLASSES.has(className.toString("utf16le", 0, length * 2))) continue;
      // The visible frame, without the invisible resize borders of GetWindowRect
      if (w.DwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, rect, 16) !== 0) continue;
      const left = rect.readInt32LE(0);
      const top = rect.readInt32LE(4);
      const dip = screen.screenToDipRect(null, { x: left, y: top, width: rect.readInt32LE(8) - left, height: rect.readInt32LE(12) - top });
      if (dip.width < MIN_WIDTH || dip.height < MIN_HEIGHT) continue;
      out.push({ id: String(hwnd), left: dip.x, top: dip.y, right: dip.x + dip.width, bottom: dip.y + dip.height });
    }
  } catch (err) {
    log.warn("Reading the other windows failed", err);
  }
  return out;
}
