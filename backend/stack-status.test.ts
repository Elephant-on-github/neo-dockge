import { describe, expect, it } from "vitest";
import { Stack } from "./stack";
import { CREATED_STACK, EXITED, RUNNING, UNKNOWN } from "../common/util-common";

// statusConvert mirrors `docker compose ls --all --format json` Status strings.
// R1: count-based, order-independent — any running container wins over
// exited/created one-shot sidecars (spec P1 acceptance 1/2/4; GH #177/#474/#606/#806).
describe("Stack.statusConvert", () => {
    it("maps a plain running stack", () => {
        expect(Stack.statusConvert("running(2)")).toBe(RUNNING);
    });

    it("running wins regardless of segment order (GH #177/#474)", () => {
        expect(Stack.statusConvert("exited(1), running(2)")).toBe(RUNNING);
        expect(Stack.statusConvert("running(2), exited(1)")).toBe(RUNNING);
    });

    it("maps exited-only and created-only stacks", () => {
        expect(Stack.statusConvert("exited(3)")).toBe(EXITED);
        expect(Stack.statusConvert("created(1)")).toBe(CREATED_STACK);
    });

    it("running wins over created", () => {
        expect(Stack.statusConvert("created(1), running(1)")).toBe(RUNNING);
    });

    it("accepts bare state names without counts", () => {
        expect(Stack.statusConvert("running")).toBe(RUNNING);
    });

    it("returns UNKNOWN for empty or unparseable input", () => {
        expect(Stack.statusConvert("")).toBe(UNKNOWN);
        expect(Stack.statusConvert("garbage")).toBe(UNKNOWN);
        expect(Stack.statusConvert("running(abc)")).toBe(UNKNOWN);
    });

    it("returns UNKNOWN for non-string input instead of throwing (#875)", () => {
        expect(Stack.statusConvert(undefined as unknown as string)).toBe(UNKNOWN);
        expect(Stack.statusConvert(12345 as unknown as string)).toBe(UNKNOWN);
    });

    it("keeps parity for paused/dead-only stacks", () => {
        expect(Stack.statusConvert("dead(1)")).toBe(UNKNOWN);
        expect(Stack.statusConvert("paused(1)")).toBe(UNKNOWN);
    });
});
