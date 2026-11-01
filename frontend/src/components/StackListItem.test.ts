/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import { mountWithRoot } from "../test-utils";
import StackListItem from "./StackListItem.vue";

describe("StackListItem.vue", () => {
    it("stackName returns stack.name", () => {
        const wrapper = mountWithRoot(StackListItem, { props: { stack: { name: "my-stack",
            id: "1",
            status: 3,
            isManagedByDockge: true,
            endpoint: "" } } });
        expect((wrapper.vm as any).stackName).toBe("my-stack");
    });

    it("url builds the compose route (with and without endpoint)", () => {
        const w1 = mountWithRoot(StackListItem, { props: { stack: { name: "s",
            id: "1",
            status: 3,
            isManagedByDockge: true,
            endpoint: "" } } });
        expect((w1.vm as any).url).toBe("/compose/s");

        const w2 = mountWithRoot(StackListItem, { props: { stack: { name: "s",
            id: "1",
            status: 3,
            isManagedByDockge: true,
            endpoint: "agent1" } } });
        expect((w2.vm as any).url).toBe("/compose/s/agent1");
    });

    it("applies the dim class when the stack is not managed by dockge", () => {
        const wrapper = mountWithRoot(StackListItem, { props: { stack: { name: "s",
            id: "1",
            status: 3,
            isManagedByDockge: false,
            endpoint: "" } } });
        expect(wrapper.classes()).toContain("dim");
    });
});

