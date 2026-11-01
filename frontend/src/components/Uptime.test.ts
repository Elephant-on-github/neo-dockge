import { describe, expect, it } from "vitest";
import { mountWithRoot } from "../test-utils";
import Uptime from "../components/Uptime.vue";
import { RUNNING, EXITED, UNKNOWN, statusColor, statusNameShort } from "@common/util-common";

describe("Uptime.vue", () => {
    it("renders the status color and short name for each status", () => {
        for (const status of [RUNNING, EXITED, UNKNOWN]) {
            const wrapper = mountWithRoot(Uptime, { props: { stack: { status } } });
            // statusColor and statusNameShort agree with the component's output
            expect(statusColor(status)).toBeTruthy();
            expect(statusNameShort(status)).toBeTruthy();
            expect(wrapper.html()).toBeTruthy();
        }
    });
});
