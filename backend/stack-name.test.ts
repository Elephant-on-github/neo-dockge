import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Stack } from "./stack";
import { ValidationError } from "./util-server";
import { DockgeServer } from "./dockge-server";
import fs from "fs";
import os from "os";
import path from "path";

// A minimal stand-in for DockgeServer: Stack only reads `.stacksDir` for these paths.
const fakeServer = (stacksDir: string) => ({ stacksDir }) as unknown as DockgeServer;

const VALID_NAMES = [ "my-stack", "my_stack", "stack2", "a", "0", "my-stack_2" ];
const INVALID_NAMES = [
    "../evil",
    "..",
    "a/../b",
    "a/b",
    "a\\b",
    ".hidden",
    "UPPER",
    "a b",
    "a.b",
    "",
    "a$b",
];

describe("Stack.validateStackName", () => {
    it("accepts valid stack names", () => {
        for (const name of VALID_NAMES) {
            expect(() => Stack.validateStackName(name), `expected "${name}" to be valid`).not.toThrow();
        }
    });

    it("rejects path traversal and malformed names", () => {
        for (const name of INVALID_NAMES) {
            expect(() => Stack.validateStackName(name), `expected "${name}" to be rejected`).toThrow(ValidationError);
        }
    });
});

describe("Stack.path getter", () => {
    it("throws for a traversal name instead of building an escaped path", () => {
        const stack = new Stack(fakeServer("/app/data/stacks"), "../evil", undefined, undefined, true);
        expect(() => stack.path).toThrow(ValidationError);
    });

    it("still returns the joined path for a valid name", () => {
        const stack = new Stack(fakeServer("/app/data/stacks"), "my-stack", undefined, undefined, true);
        expect(stack.path).toBe(path.join("/app/data/stacks", "my-stack"));
    });
});

describe("Stack.getStack", () => {
    let tmp: string;
    let stacksDir: string;

    beforeAll(() => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), "neodockge-"));
        stacksDir = path.join(tmp, "stacks");
        // A real directory OUTSIDE stacksDir that "../evil" would resolve to if
        // the name were not validated. Its existence means that without the fix,
        // getStack would happily return it — so the test fails for the right reason.
        fs.mkdirSync(stacksDir, { recursive: true });
        fs.mkdirSync(path.join(tmp, "evil"), { recursive: true });
    });

    afterAll(() => {
        fs.rmSync(tmp, {
            recursive: true,
            force: true,
        });
    });

    it("rejects a traversal stack name before any filesystem work", async () => {
        await expect(Stack.getStack(fakeServer(stacksDir), "../evil")).rejects.toThrow(ValidationError);
    });

    it("rejects a dot-dot stack name", async () => {
        await expect(Stack.getStack(fakeServer(stacksDir), "..")).rejects.toThrow(ValidationError);
    });
});
