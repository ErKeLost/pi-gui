import { afterEach, describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import MobileAccessPanel from "../src/components/panels/MobileAccessPanel";
import { useWorkspace } from "../src/lib/store";

afterEach(() => {
  useWorkspace.getState().set({ runtimeTarget: "unknown", connection: "offline", remoteTheme: null });
});

describe("standalone mobile access panel", () => {
  test("shows the desktop host page", () => {
    useWorkspace.setState({ runtimeTarget: "desktop" });
    const desktopHtml = renderToStaticMarkup(<MobileAccessPanel />);
    expect(desktopHtml).toContain("移动端");
    expect(desktopHtml).toContain("电脑 Host");
    expect(desktopHtml).toContain("已连接的设备");
  });
});
