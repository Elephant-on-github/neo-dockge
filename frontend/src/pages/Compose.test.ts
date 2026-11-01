import { describe, expect, it } from "vitest";
import { mountWithRoot } from "../test-utils";
import Compose from "./Compose.vue";
import { RUNNING, DEGRADED, EXITED } from "@common/util-common";

describe("Compose.vue", () => {
    it("yamlToJSON parses valid YAML into {config, doc}", () => {
        const wrapper = mountWithRoot(Compose, { rootOverrides: { completeStackList: { "undefined_": { name: "t", status: 3 } } } });
        const { config, doc } = (wrapper.vm as any).yamlToJSON("services:\n  web:\n    image: nginx\n");
        expect(config.services.web.image).toBe("nginx");
        expect(doc).toBeTruthy();
        expect(typeof doc.toString).toBe("function");
    });

    it("yamlToJSON throws on a syntax error", () => {
        const wrapper = mountWithRoot(Compose, { rootOverrides: { completeStackList: { "undefined_": { name: "t", status: 3 } } } });
        expect(() => (wrapper.vm as any).yamlToJSON("services:\n  web:\n   image: [")).toThrow();
    });

    it("yamlToJSON throws when services is not an object", () => {
        const wrapper = mountWithRoot(Compose, { rootOverrides: { completeStackList: { "undefined_": { name: "t", status: 3 } } } });
        expect(() => (wrapper.vm as any).yamlToJSON("services:\n  - nginx\n")).toThrow(/Services must be an object/);
    });

    it("active() is true for RUNNING and DEGRADED, false otherwise", () => {
        // RUNNING, DEGRADED, EXITED imported at top
        const w1 = mountWithRoot(Compose, { rootOverrides: { completeStackList: { "undefined_": { name: "t", status: RUNNING } } } });
        expect((w1.vm as any).active).toBe(true);
        const w2 = mountWithRoot(Compose, { rootOverrides: { completeStackList: { "undefined_": { name: "t", status: DEGRADED } } } });
        expect((w2.vm as any).active).toBe(true);
        const w3 = mountWithRoot(Compose, { rootOverrides: { completeStackList: { "undefined_": { name: "t", status: EXITED } } } });
        expect((w3.vm as any).active).toBe(false);
    });

    it("formatYAML re-serializes composeYAML and keeps jsonConfig untouched", () => {
        const wrapper = mountWithRoot(Compose, { rootOverrides: { completeStackList: { "undefined_": { name: "t", status: 3 } } } });
        const vm = wrapper.vm as any;
        if (!vm) return;
        vm.stack = { composeYAML: "services:\n  web:\n    image: nginx\n", composeENV: "", name: "t", endpoint: "" };
        vm.jsonConfig = { services: { web: { image: "nginx" } } };
        const before = vm.jsonConfig;
        vm.formatYAML();
        expect(typeof vm.stack.composeYAML).toBe("string");
        expect(vm.stack.composeYAML).toContain("services");
        // jsonConfig must not be replaced by the format (would clobber formatting)
        expect(vm.jsonConfig).toBe(before);
    });

    it("formatYAML surfaces a parse error instead of overwriting", () => {
        const wrapper = mountWithRoot(Compose, { rootOverrides: { completeStackList: { "undefined_": { name: "t", status: 3 } } } });
        const vm = wrapper.vm as any;
        if (!vm) return;
        vm.stack = { composeYAML: "services:\n  web:\n   image: [", composeENV: "", name: "t", endpoint: "" };
        const before = vm.stack.composeYAML;
        vm.formatYAML();
        expect(vm.stack.composeYAML).toBe(before);
    });
});
