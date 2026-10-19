import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { Stack } from "./stack";
import { CREATED_STACK, EXITED, RUNNING, UNKNOWN } from "../common/util-common";
import { DockgeServer } from "./dockge-server";
import childProcessAsync from "promisify-child-process";
import fs from "fs";
import os from "os";
import path from "path";

// The list functions must contain `docker compose ls` failures themselves:
// spawn rejects on non-zero exit (verified in package source) and the 10s
// cron calls sendStackList unguarded — a raw rejection is a crash loop (#875).
vi.mock("promisify-child-process", () => ({
    default: { spawn: vi.fn() },
}));

const spawnMock = vi.mocked(childProcessAsync.spawn);
const fakeServer = (stacksDir: string) => ({ stacksDir }) as unknown as DockgeServer;

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

describe("stack list failure containment", () => {
    let stacksDir: string;

    beforeAll(() => {
        stacksDir = fs.mkdtempSync(path.join(os.tmpdir(), "neo-dockge-list-"));
        for (const name of [ "alpha", "beta" ]) {
            fs.mkdirSync(path.join(stacksDir, name));
            fs.writeFileSync(path.join(stacksDir, name, "compose.yaml"), "services:\n  web:\n    image: nginx\n");
        }
    });

    afterAll(() => {
        fs.rmSync(stacksDir, { recursive: true, force: true });
    });

    beforeEach(() => {
        spawnMock.mockReset();
    });

    it("A: getStatusList returns an empty map on unparseable output", async () => {
        spawnMock.mockResolvedValueOnce({ stdout: "not json" });
        const result = await Stack.getStatusList();
        expect(result.size).toBe(0);
    });

    it("B: getStatusList returns an empty map when docker compose ls fails", async () => {
        spawnMock.mockRejectedValueOnce(new Error("Process exited with code 1"));
        const result = await Stack.getStatusList();
        expect(result.size).toBe(0);
    });

    it("C: getStackList keeps folder rows when compose ls fails", async () => {
        spawnMock.mockRejectedValueOnce(new Error("Process exited with code 1"));
        const list = await Stack.getStackList(fakeServer(stacksDir));
        expect(list.has("alpha")).toBe(true);
        expect(list.has("beta")).toBe(true);
    });

    it("D: getStackList keeps folder rows on unparseable output", async () => {
        spawnMock.mockResolvedValueOnce({ stdout: "not json" });
        const list = await Stack.getStackList(fakeServer(stacksDir));
        expect(list.has("alpha")).toBe(true);
        expect(list.has("beta")).toBe(true);
    });

    it("E: a malformed entry shows unknown without affecting siblings (acceptance 3)", async () => {
        spawnMock.mockResolvedValueOnce({
            stdout: JSON.stringify([
                { Name: "beta", Status: "running(2)", ConfigFiles: path.join(stacksDir, "beta", "compose.yaml") },
                { Name: "alpha", Status: 12345, ConfigFiles: path.join(stacksDir, "alpha", "compose.yaml") },
                { Name: "gamma", Status: "exited(3)", ConfigFiles: path.join(stacksDir, "elsewhere", "compose.yaml") },
            ]),
        });
        const list = await Stack.getStackList(fakeServer(stacksDir));
        expect(list.get("beta")?.status).toBe(RUNNING);
        expect(list.get("alpha")?.status).toBe(UNKNOWN);
        expect(list.get("gamma")?.status).toBe(EXITED);
    });

    it("F: a null entry in compose ls output does not blank the list", async () => {
        spawnMock.mockResolvedValueOnce({
            stdout: JSON.stringify([
                { Name: "beta", Status: "running(2)", ConfigFiles: path.join(stacksDir, "beta", "compose.yaml") },
                null,
                { Name: "alpha", Status: "exited(1)", ConfigFiles: path.join(stacksDir, "alpha", "compose.yaml") },
            ]),
        });
        const list = await Stack.getStackList(fakeServer(stacksDir));
        expect(list.get("beta")?.status).toBe(RUNNING);
        expect(list.get("alpha")?.status).toBe(EXITED);
    });
});
