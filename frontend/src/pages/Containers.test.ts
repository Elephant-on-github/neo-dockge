/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi } from "vitest";
import { mountWithRoot } from "../test-utils";
import Containers from "../pages/Containers.vue";

describe("Containers.vue", () => {
    it("starts in the loading state", () => {
        const wrapper = mountWithRoot(Containers);
        expect((wrapper.vm as any).loading).toBe(true);
    });

    it("refresh populates containerList from the socket response", () => {
        const socket = { emit: vi.fn(),
            on: vi.fn(),
            token: "autoLogin",
            connected: true };
        const emitAgent = vi.fn((_ep: string, _ev: string, cb: (r: any) => void) => {
            cb({ ok: true,
                containerList: [{ id: "abc",
                    name: "web",
                    state: "running",
                    managed: true,
                    cpu: "1%" }] });
        });
        const wrapper = mountWithRoot(Containers, { rootOverrides: { emitAgent,
            getSocket: () => socket } });
        const vm = wrapper.vm as any;
        vm.refresh();
        expect(vm.containerList.length).toBe(1);
        expect(vm.containerList[0].name).toBe("web");
        expect(vm.loading).toBe(false);
    });

    it("stateBadgeClass maps states to badge classes", () => {
        const wrapper = mountWithRoot(Containers);
        const vm = wrapper.vm as any;
        expect(vm.stateBadgeClass({ state: "running" })).toBe("bg-primary");
        expect(vm.stateBadgeClass({ state: "exited" })).toBe("bg-danger");
        expect(vm.stateBadgeClass({ state: "restarting" })).toBe("bg-warning");
        expect(vm.stateBadgeClass({ state: "paused" })).toBe("bg-warning");
        expect(vm.stateBadgeClass({ state: "created" })).toBe("bg-secondary");
    });

    it("clears the refresh timer on unmount", () => {
        vi.useFakeTimers();
        const wrapper = mountWithRoot(Containers);
        const vm = wrapper.vm as any;
        vm.autoRefresh = true;
        vm.refresh();
        wrapper.unmount();
        expect(vm.refreshTimer).toBeNull();
        vi.useRealTimers();
    });
});

