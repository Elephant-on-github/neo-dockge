import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Stack } from "./stack";
import { CREATED_STACK, DEGRADED, EXITED, RUNNING, UNKNOWN, statusColor, statusName, statusNameShort } from "../common/util-common";
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

// F1 (spec 2026-10-19-f1-degraded-status): nonzero-exit / restarting / dead
// containers next to living ones surface as DEGRADED. Warn flags carry only
// the docker-ps-sourced nonzeroExit; restarting/dead arrive as compose-ls
// count segments.
describe("statusConvert with warn flags", () => {
    it("flags a living stack with a crashed sibling as DEGRADED", () => {
        expect(Stack.statusConvert("running(2)", { nonzeroExit: true })).toBe(DEGRADED);
        expect(Stack.statusConvert("exited(1), running(2)", { nonzeroExit: true })).toBe(DEGRADED);
    });

    it("keeps R1: no warn flags means running wins as before", () => {
        expect(Stack.statusConvert("exited(1), running(2)")).toBe(RUNNING);
        expect(Stack.statusConvert("running(2)", { nonzeroExit: false })).toBe(RUNNING);
    });

    it("restarting/dead count segments warn without docker ps", () => {
        expect(Stack.statusConvert("restarting(1), running(1)")).toBe(DEGRADED);
        expect(Stack.statusConvert("dead(1), running(1)")).toBe(DEGRADED);
        expect(Stack.statusConvert("restarting(2)")).toBe(DEGRADED);
        expect(Stack.statusConvert("exited(1), restarting(1)")).toBe(DEGRADED);
    });

    it("does not degrade a fully exited stack", () => {
        expect(Stack.statusConvert("exited(3)", { nonzeroExit: true })).toBe(EXITED);
    });

    it("ignores garbage warn values", () => {
        expect(Stack.statusConvert("running(2)", { nonzeroExit: "yes" as unknown as boolean })).toBe(RUNNING);
    });

    it("exposes DEGRADED through the shared status helpers", () => {
        expect(statusName(DEGRADED)).toBe("degraded");
        expect(statusNameShort(DEGRADED)).toBe("degraded");
        expect(statusColor(DEGRADED)).toBe("warning");
    });
});

// F1: one global `docker ps -a` per poll feeds per-project crash flags.
// Labels is a comma-joined string (not an object); project values never
// contain '=', but other label values may — split on the first '=' only.
describe("container warnings", () => {
    const line = (over : object) => JSON.stringify({
        State: "running",
        Status: "Up 2 minutes",
        Labels: "com.docker.compose.project=alpha,com.docker.compose.service=web",
        ...over,
    });

    it("parses NDJSON into per-project nonzeroExit flags", () => {
        const out = [
            line({ State: "exited", Status: "Exited (137) 2 minutes ago", Labels: "com.docker.compose.project=beta" }),
            line({ State: "restarting", Status: "Restarting (1) 3 seconds ago", Labels: "com.docker.compose.project=beta" }),
            line({ Status: "Exited (0) 5 minutes ago", Labels: "com.docker.compose.project=beta" }),
            "not json{",
            line({ State: "running", Labels: "com.docker.compose.project=beta" }),
            line({ Status: "Exited (abc)", Labels: "com.docker.compose.project=gamma" }),
            line({ State: "exited", Status: "Exited (1)", Labels: "a=b=com.example=x,com.docker.compose.project=delta" }),
        ].join("\n");
        const w = Stack.parseContainerWarnings(out);
        expect(w.get("beta")).toEqual({ nonzeroExit: true });
        expect(w.get("gamma")).toEqual({ nonzeroExit: false });
        expect(w.get("delta")).toEqual({ nonzeroExit: true });
        expect(w.get("alpha")).toBeUndefined();
    });

    it("is fail-soft on empty and old-CLI template noise", () => {
        expect(Stack.parseContainerWarnings("")).toEqual(new Map());
        expect(Stack.parseContainerWarnings("json\njson")).toEqual(new Map());
    });

    it("getContainerWarnings spawns the exact docker ps argv", async () => {
        spawnMock.mockResolvedValueOnce({ stdout: line({ State: "exited", Status: "Exited (1)", Labels: "com.docker.compose.project=beta" }) });
        const w = await Stack.getContainerWarnings();
        expect(w.get("beta")).toEqual({ nonzeroExit: true });
        expect(spawnMock).toHaveBeenCalledWith("docker", [
            "ps", "-a", "--filter", "label=com.docker.compose.project", "--format", "{{json .}}",
        ], expect.anything());
    });

    it("getContainerWarnings never rejects (R3)", async () => {
        spawnMock.mockRejectedValueOnce(new Error("docker daemon down"));
        await expect(Stack.getContainerWarnings()).resolves.toEqual(new Map());
        spawnMock.mockResolvedValueOnce(undefined as unknown as { stdout: string });
        await expect(Stack.getContainerWarnings()).resolves.toEqual(new Map());
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

// F1 wiring: getStatusList (feeds updateStatus) re-converts compose-ls
// statuses with docker-ps crash warnings, keyed by compose project Name;
// folder aliases inherit the already-converted value (M-2).
describe("getStatusList crash-warning wiring (F1)", () => {
    let stacksDir: string;

    beforeAll(() => {
        stacksDir = fs.mkdtempSync(path.join(os.tmpdir(), "neo-dockge-warn-"));
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

    const composeLs = (entries : object[]) => ({ stdout: JSON.stringify(entries) });
    const psLine = (over : object) => JSON.stringify({
        State: "running",
        Status: "Up 2 minutes",
        Labels: "com.docker.compose.project=x",
        ...over,
    });

    it("marks a living stack with a crashed sibling DEGRADED (project-label match)", async () => {
        spawnMock.mockResolvedValueOnce(composeLs([ {
            Name: "beta",
            Status: "exited(1), running(2)",
            ConfigFiles: path.join(stacksDir, "beta", "compose.yaml"),
        } ]));
        spawnMock.mockResolvedValueOnce({ stdout: psLine({
            State: "exited",
            Status: "Exited (137)",
            Labels: "com.docker.compose.project=beta",
        }) });
        const statuses = await Stack.getStatusList();
        expect(statuses.get("beta")).toBe(DEGRADED);
    });

    it("aliases inherit the degraded status, keyed by project Name", async () => {
        spawnMock.mockResolvedValueOnce(composeLs([ {
            Name: "renamed-proj",
            Status: "exited(1), running(2)",
            ConfigFiles: path.join(stacksDir, "alpha", "compose.yaml"),
        } ]));
        spawnMock.mockResolvedValueOnce({ stdout: psLine({
            State: "exited",
            Status: "Exited (137)",
            Labels: "com.docker.compose.project=renamed-proj",
        }) });
        const statuses = await Stack.getStatusList(stacksDir);
        expect(statuses.get("renamed-proj")).toBe(DEGRADED);
        expect(statuses.get("alpha")).toBe(DEGRADED);
    });

    it("falls back to compose-ls-only statuses when docker ps fails (R3)", async () => {
        spawnMock.mockResolvedValueOnce(composeLs([ {
            Name: "beta",
            Status: "exited(1), running(2)",
            ConfigFiles: path.join(stacksDir, "beta", "compose.yaml"),
        } ]));
        spawnMock.mockRejectedValueOnce(new Error("docker daemon down"));
        const statuses = await Stack.getStatusList();
        expect(statuses.get("beta")).toBe(RUNNING);
    });

    it("ignores foreign projects from docker ps", async () => {
        spawnMock.mockResolvedValueOnce(composeLs([ {
            Name: "beta",
            Status: "running(1)",
            ConfigFiles: path.join(stacksDir, "beta", "compose.yaml"),
        } ]));
        spawnMock.mockResolvedValueOnce({ stdout: psLine({
            State: "exited",
            Status: "Exited (1)",
            Labels: "com.docker.compose.project=foreign",
        }) });
        const statuses = await Stack.getStatusList();
        expect(statuses.has("foreign")).toBe(false);
        expect(statuses.get("beta")).toBe(RUNNING);
    });
});

// F1 wiring: getStackList is the path the UI actually renders
// (dockge-server sendStackList -> getStackList with cache). Warnings are
// fetched strictly after the compose-ls spawn: single-response mocks in the
// older tests pin that order.
describe("getStackList crash-warning wiring (F1)", () => {
    let stacksDir: string;

    beforeAll(() => {
        stacksDir = fs.mkdtempSync(path.join(os.tmpdir(), "neo-dockge-warnlist-"));
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

    const composeLs = (entries : object[]) => ({ stdout: JSON.stringify(entries) });
    const psLine = (over : object) => JSON.stringify({
        State: "running",
        Status: "Up 2 minutes",
        Labels: "com.docker.compose.project=x",
        ...over,
    });

    it("marks a folder stack DEGRADED via its project's crashed container", async () => {
        spawnMock.mockResolvedValueOnce(composeLs([ {
            Name: "beta",
            Status: "exited(1), running(2)",
            ConfigFiles: path.join(stacksDir, "beta", "compose.yaml"),
        } ]));
        spawnMock.mockResolvedValueOnce({ stdout: psLine({
            State: "exited",
            Status: "Exited (137)",
            Labels: "com.docker.compose.project=beta",
        }) });
        const list = await Stack.getStackList(fakeServer(stacksDir));
        expect(list.get("beta")?.status).toBe(DEGRADED);
    });

    it("renamed projects carry the warn to the joined folder stack", async () => {
        spawnMock.mockResolvedValueOnce(composeLs([ {
            Name: "renamed-proj",
            Status: "exited(1), running(2)",
            ConfigFiles: path.join(stacksDir, "alpha", "compose.yaml"),
        } ]));
        spawnMock.mockResolvedValueOnce({ stdout: psLine({
            State: "exited",
            Status: "Exited (137)",
            Labels: "com.docker.compose.project=renamed-proj",
        }) });
        const list = await Stack.getStackList(fakeServer(stacksDir));
        expect(list.get("alpha")?.status).toBe(DEGRADED);
    });

    it("falls back to compose-ls-only status when docker ps fails (R3)", async () => {
        spawnMock.mockResolvedValueOnce(composeLs([ {
            Name: "beta",
            Status: "exited(1), running(2)",
            ConfigFiles: path.join(stacksDir, "beta", "compose.yaml"),
        } ]));
        spawnMock.mockRejectedValueOnce(new Error("docker daemon down"));
        const list = await Stack.getStackList(fakeServer(stacksDir));
        expect(list.get("beta")?.status).toBe(RUNNING);
    });
});

describe("Stack.isManagedByDockge resilience (final fix pass M-4)", () => {
    it("returns false instead of throwing when the folder vanishes between existsSync and statSync", () => {
        const never = path.join(os.tmpdir(), "neo-dockge-never-exists");
        const stack = new Stack(fakeServer(never), "ghost");
        const ghostPath = path.join(never, "ghost");
        const original = fs.existsSync;
        // Simulate the TOCTOU race: existsSync saw the directory, statSync will not.
        const spy = vi.spyOn(fs, "existsSync").mockImplementation((p: fs.PathLike) => {
            if (String(p) === ghostPath) {
                return true;
            }
            return original(p);
        });
        try {
            expect(stack.isManagedByDockge).toBe(false);
        } finally {
            spy.mockRestore();
        }
    });
});
