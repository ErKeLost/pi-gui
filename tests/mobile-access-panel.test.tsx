import { afterEach, describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import MobileAccessPanel from "../src/components/panels/MobileAccessPanel";
import { useWorkspace } from "../src/lib/store";

afterEach(() => {
  useWorkspace.getState().set({ runtimeTarget: "unknown", connection: "offline", remoteTheme: null });
});

describe("standalone mobile access panel", () => {
  test("shows the desktop host entry point", () => {
    useWorkspace.setState({ runtimeTarget: "desktop" });
    const html = renderToStaticMarkup(<MobileAccessPanel />);
    expect(html).toContain("链接手机");
    expect(html).toContain("电脑连接");
  });

  test("shows phone connection state without host controls", () => {
    useWorkspace.setState({ runtimeTarget: "mobile", connection: "online" });
    const html = renderToStaticMarkup(<MobileAccessPanel />);
    expect(html).toContain("电脑连接");
    expect(html).toContain("链接手机");
  });
});
