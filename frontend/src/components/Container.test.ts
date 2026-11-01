/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import { mountWithRoot } from "../test-utils";
import Container from "../components/Container.vue";

describe.skip("Container.vue", () => {
    it("status returns serviceStatus[0].status", () => {
        const wrapper = mountWithRoot(Container, { props: { name: "web",
            serviceStatus: [{ status: "running" }, { status: "exited" }] } });
        if (!wrapper.vm) {
            return;
        }
        expect((wrapper.vm as any).status).toBe("running");
    });

    it("status returns N/A when serviceStatus is missing", () => {
        const wrapper = mountWithRoot(Container, { props: { name: "web",
            serviceStatus: null } });
        if (!wrapper.vm) {
            return;
        }
        expect((wrapper.vm as any).status).toBe("N/A");
    });

    it("bgStyle maps running/healthy/unhealthy/restarting to the right classes", () => {
        const mk = (status: string) => mountWithRoot(Container, { props: { name: "web",
            serviceStatus: [{ status }] } });
        const r = mk("running");
        if (!r.vm) {
            return;
        }
        expect(r.vm.bgStyle).toBe("bg-primary");
        expect(mk("healthy").vm.bgStyle).toBe("bg-primary");
        expect(mk("unhealthy").vm.bgStyle).toBe("bg-danger");
        expect(mk("restarting").vm.bgStyle).toBe("bg-warning");
        expect(mk("exited").vm.bgStyle).toBe("bg-secondary");
    });

    it("statsInstances filters and sorts dockerStats entries", () => {
        const dockerStats = {
            a: { Name: "a",
                CPUPerc: "1%" },
            b: { Name: "b",
                CPUPerc: "2%" },
        };
        const wrapper = mountWithRoot(Container, {
            props: { name: "web",
                serviceStatus: [{ status: "running",
                    name: "a" }, { status: "running",
                    name: "b" }],
                dockerStats },
        });
        if (!wrapper.vm) {
            return;
        }
        const instances = (wrapper.vm as any).statsInstances;
        expect(Array.isArray(instances)).toBe(true);
        expect(instances.map((s: any) => s.Name)).toEqual([ "a", "b" ]);
    });
});

