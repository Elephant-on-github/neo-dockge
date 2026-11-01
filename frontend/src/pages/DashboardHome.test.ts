/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import { mountWithRoot } from "../test-utils";
import DashboardHome from "../pages/DashboardHome.vue";
import { RUNNING, EXITED, CREATED_FILE } from "@common/util-common";

describe("DashboardHome.vue", () => {
    it("getStatusNum counts stacks by statusNameShort", () => {
        const completeStackList = {
            a: { status: RUNNING },
            b: { status: RUNNING },
            c: { status: EXITED },
            d: { status: CREATED_FILE },
        };
        const wrapper = mountWithRoot(DashboardHome, { rootOverrides: { completeStackList } });
        const vm = wrapper.vm as any;
        expect(vm.getStatusNum("active")).toBe(2);
        expect(vm.getStatusNum("exited")).toBe(1);
        expect(vm.activeNum).toBe(2);
        expect(vm.exitedNum).toBe(1);
        expect(vm.inactiveNum).toBe(1);
    });
});

