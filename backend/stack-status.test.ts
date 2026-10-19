import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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
        fs.rmSync(stacksDir, { recursive: true,
            force: true });
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
                { Name: "beta",
                    Status: "running(2)",
                    ConfigFiles: path.join(stacksDir, "beta", "compose.yaml") },
                { Name: "alpha",
                    Status: 12345,
                    ConfigFiles: path.join(stacksDir, "alpha", "compose.yaml") },
                { Name: "gamma",
                    Status: "exited(3)",
                    ConfigFiles: path.join(stacksDir, "elsewhere", "compose.yaml") },
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
                { Name: "beta",
                    Status: "running(2)",
                    ConfigFiles: path.join(stacksDir, "beta", "compose.yaml") },
                null,
                { Name: "alpha",
                    Status: "exited(1)",
                    ConfigFiles: path.join(stacksDir, "alpha", "compose.yaml") },
            ]),
        });
        const list = await Stack.getStackList(fakeServer(stacksDir));
        expect(list.get("beta")?.status).toBe(RUNNING);
        expect(list.get("alpha")?.status).toBe(EXITED);
    });
});

describe("Stack.resolveManagedFolder (R3)", () => {
    const stacksDir = path.join(os.tmpdir(), "fake-stacks");

    it("returns the direct-child folder name", () => {
        expect(Stack.resolveManagedFolder(stacksDir, path.join(stacksDir, "my-stack", "compose.yaml"))).toBe("my-stack");
    });

    it("rejects deeper paths (not a stack folder)", () => {
        expect(Stack.resolveManagedFolder(stacksDir, path.join(stacksDir, "my-stack", "sub", "compose.yaml"))).toBeUndefined();
    });

    it("rejects config files outside stacksDir", () => {
        expect(Stack.resolveManagedFolder(stacksDir, path.join(os.tmpdir(), "elsewhere", "compose.yaml"))).toBeUndefined();
    });

    it("rejects undefined, non-string, and empty config files", () => {
        expect(Stack.resolveManagedFolder(stacksDir, undefined)).toBeUndefined();
        expect(Stack.resolveManagedFolder(stacksDir, 123)).toBeUndefined();
        expect(Stack.resolveManagedFolder(stacksDir, "")).toBeUndefined();
    });

    it("uses the first path of a multi-file ConfigFiles list", () => {
        const first = path.join(stacksDir, "a", "compose.yaml");
        const second = path.join(stacksDir, "b", "docker-compose.yml");
        expect(Stack.resolveManagedFolder(stacksDir, first + ", " + second)).toBe("a");
    });
});

describe("config-path join for managed truth", () => {
    let stacksDir: string;
    let foreignDir: string;

    beforeAll(() => {
        stacksDir = fs.mkdtempSync(path.join(os.tmpdir(), "neo-dockge-join-"));
        foreignDir = fs.mkdtempSync(path.join(os.tmpdir(), "neo-dockge-foreign-"));
        for (const name of [ "alpha", "beta" ]) {
            fs.mkdirSync(path.join(stacksDir, name));
            fs.writeFileSync(path.join(stacksDir, name, "compose.yaml"), "services:\n  web:\n    image: nginx\n");
        }
    });

    afterAll(() => {
        fs.rmSync(stacksDir, { recursive: true,
            force: true });
        fs.rmSync(foreignDir, { recursive: true,
            force: true });
    });

    beforeEach(() => {
        spawnMock.mockReset();
    });

    it("G: joins a renamed compose project to its stack folder (#19 repro)", async () => {
        spawnMock.mockResolvedValueOnce({
            stdout: JSON.stringify([
                {
                    Name: "renamed-proj",
                    Status: "exited(1), running(1)",
                    ConfigFiles: path.join(stacksDir, "alpha", "compose.yaml"),
                },
            ]),
        });
        const list = await Stack.getStackList(fakeServer(stacksDir));
        expect(list.has("renamed-proj")).toBe(false);
        const alpha = list.get("alpha");
        expect(alpha?.status).toBe(RUNNING);
        expect(alpha?.toSimpleJSON("")).toMatchObject({ name: "alpha",
            isManagedByDockge: true,
            status: RUNNING });
    });

    it("H: keeps a genuinely foreign project as an unmanaged grey row", async () => {
        spawnMock.mockResolvedValueOnce({
            stdout: JSON.stringify([
                { Name: "foreign-proj",
                    Status: "running(1)",
                    ConfigFiles: path.join(foreignDir, "compose.yaml") },
            ]),
        });
        const list = await Stack.getStackList(fakeServer(stacksDir));
        expect(list.get("foreign-proj")?.toSimpleJSON("")).toMatchObject({ name: "foreign-proj",
            isManagedByDockge: false });
    });

    it("I: never lists the manager's own projects (R4 self-skip)", async () => {
        spawnMock.mockResolvedValueOnce({
            stdout: JSON.stringify([
                { Name: "neo-dockge",
                    Status: "running(1)",
                    ConfigFiles: path.join(foreignDir, "compose.yaml") },
                { Name: "dockge",
                    Status: "running(1)",
                    ConfigFiles: path.join(foreignDir, "compose.yaml") },
            ]),
        });
        const list = await Stack.getStackList(fakeServer(stacksDir));
        expect(list.has("neo-dockge")).toBe(false);
        expect(list.has("dockge")).toBe(false);
    });

    it("J: getStatusList exposes both project and folder keys when given stacksDir", async () => {
        spawnMock.mockResolvedValueOnce({
            stdout: JSON.stringify([
                {
                    Name: "renamed-proj",
                    Status: "running(2)",
                    ConfigFiles: path.join(stacksDir, "alpha", "compose.yaml"),
                },
            ]),
        });
        const statuses = await Stack.getStatusList(stacksDir);
        expect(statuses.get("renamed-proj")).toBe(RUNNING);
        expect(statuses.get("alpha")).toBe(RUNNING);
    });

    it("J2: getStatusList without stacksDir keeps name-only keys (back-compat)", async () => {
        spawnMock.mockResolvedValueOnce({
            stdout: JSON.stringify([
                {
                    Name: "renamed-proj",
                    Status: "running(2)",
                    ConfigFiles: path.join(stacksDir, "alpha", "compose.yaml"),
                },
            ]),
        });
        const statuses = await Stack.getStatusList();
        expect(statuses.get("renamed-proj")).toBe(RUNNING);
        expect(statuses.has("alpha")).toBe(false);
    });
});
