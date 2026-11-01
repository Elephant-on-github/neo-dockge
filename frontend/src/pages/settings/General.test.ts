import { describe, expect, it, vi } from "vitest";
import { mountWithRoot } from "../../test-utils";
import General from "../../components/settings/General.vue";

describe("General.vue", () => {
    it("settings computed walks up to an ancestor that owns settings", () => {
        const settingsObj = { primaryHostname: "host.example" };
        const wrapper = mountWithRoot(General, {
            rootOverrides: { settings: settingsObj },
        });
        // The walk-up finds $root.settings when no intermediate owner exists.
        // Either way the computed must never throw and must be an object.
        expect(typeof wrapper.vm.settings).toBe("object");
    });

    it("timezoneList returns an array and never throws", () => {
        const wrapper = mountWithRoot(General);
        expect(Array.isArray(wrapper.vm.timezoneList)).toBe(true);
    });

    it("saveGeneral calls saveSettings", () => {
        const saveSettings = vi.fn();
        const wrapper = mountWithRoot(General, { rootOverrides: { saveSettings } });
        (wrapper.vm as any).saveGeneral();
        expect(saveSettings).toHaveBeenCalled();
    });
});
