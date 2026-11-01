import { describe, expect, it, vi } from "vitest";
import { mountWithRoot } from "../test-utils";
import Settings from "./Settings.vue";

describe("Settings.vue", () => {
    it("currentPage parses the last path segment", () => {
        const wrapper = mountWithRoot(Settings, { route: { path: "/settings/general", name: "settings", params: {}, fullPath: "/settings/general" } });
        expect(wrapper.vm.currentPage).toBe("general");

        const w2 = mountWithRoot(Settings, { route: { path: "/settings", name: "settings", params: {}, fullPath: "/settings" } });
        expect(w2.vm.currentPage).toBeNull();
    });

    it("loadGeneralPage redirects to appearance only on desktop when no page is selected", async () => {
        const push = vi.fn();
        const wrapper = mountWithRoot(Settings, {
            route: { path: "/settings", name: "settings", params: {}, fullPath: "/settings" },
            router: { push },
            rootOverrides: { isMobile: false },
        });
        (wrapper.vm as any).loadGeneralPage();
        expect(push).toHaveBeenCalledWith("/settings/appearance");

        const push2 = vi.fn();
        const wrapper2 = mountWithRoot(Settings, {
            route: { path: "/settings", name: "settings", params: {}, fullPath: "/settings" },
            router: { push: push2 },
            rootOverrides: { isMobile: true },
        });
        (wrapper2.vm as any).loadGeneralPage();
        expect(push2).not.toHaveBeenCalled();
    });

    it("showSubMenu is true on desktop and depends on currentPage on mobile", () => {
        const w = mountWithRoot(Settings, { rootOverrides: { isMobile: false } });
        expect(w.vm.showSubMenu).toBe(true);

        const w2 = mountWithRoot(Settings, { rootOverrides: { isMobile: true }, route: { path: "/settings/general", name: "settings", params: {}, fullPath: "/settings/general" } });
        expect(w2.vm.showSubMenu).toBe(false);
    });
});
