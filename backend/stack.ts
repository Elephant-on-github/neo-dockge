import { DockgeServer } from "./dockge-server";
import fs, { promises as fsAsync } from "fs";
import { log } from "./log";
import yaml from "yaml";
import { DockgeSocket, fileExists, ValidationError } from "./util-server";
import path from "path";
import {
    acceptedComposeFileNames,
    COMBINED_TERMINAL_COLS,
    COMBINED_TERMINAL_ROWS,
    CREATED_FILE,
    CREATED_STACK,
    DEGRADED,
    type ContainerListEntry,
    EXITED, getCombinedTerminalName,
    getComposeTerminalName, getContainerExecTerminalName,
    PROGRESS_TERMINAL_ROWS,
    RUNNING, TERMINAL_ROWS,
    UNKNOWN
} from "../common/util-common";
import { InteractiveTerminal, Terminal } from "./terminal";
import childProcessAsync from "promisify-child-process";
import { Settings } from "./settings";

export class Stack {

    name: string;
    protected _status: number = UNKNOWN;
    protected _composeYAML?: string;
    protected _composeENV?: string;
    protected _configFilePath?: string;
    protected _composeFileName: string = "compose.yaml";
    protected server: DockgeServer;

    protected combinedTerminal? : Terminal;

    protected static managedStackList: Map<string, Stack> = new Map();

    constructor(server : DockgeServer, name : string, composeYAML? : string, composeENV? : string, skipFSOperations = false) {
        this.name = name;
        this.server = server;
        this._composeYAML = composeYAML;
        this._composeENV = composeENV;

        if (!skipFSOperations) {
            // Check if compose file name is different from compose.yaml
            for (const filename of acceptedComposeFileNames) {
                if (fs.existsSync(path.join(this.path, filename))) {
                    this._composeFileName = filename;
                    break;
                }
            }
        }
    }

    async toJSON(endpoint : string) : Promise<object> {

        // Since we have multiple agents now, embed primary hostname in the stack object too.
        let primaryHostname = await Settings.get("primaryHostname");
        if (!primaryHostname) {
            if (!endpoint) {
                primaryHostname = "localhost";
            } else {
                // Use the endpoint as the primary hostname
                try {
                    primaryHostname = (new URL("https://" + endpoint).hostname);
                } catch (e) {
                    // Just in case if the endpoint is in a incorrect format
                    primaryHostname = "localhost";
                }
            }
        }

        let obj = this.toSimpleJSON(endpoint);
        return {
            ...obj,
            composeYAML: this.composeYAML,
            composeENV: this.composeENV,
            primaryHostname,
        };
    }

    toSimpleJSON(endpoint : string) : object {
        return {
            name: this.name,
            status: this._status,
            tags: [],
            isManagedByDockge: this.isManagedByDockge,
            composeFileName: this._composeFileName,
            endpoint,
        };
    }

    /**
     * Get the status of the stack from `docker compose ps --format json`
     */
    async ps() : Promise<object> {
        let res = await childProcessAsync.spawn("docker", this.getComposeOptions("ps", "--format", "json"), {
            cwd: this.path,
            encoding: "utf-8",
        });
        if (!res.stdout) {
            return {};
        }
        return JSON.parse(res.stdout.toString());
    }

    get isManagedByDockge() : boolean {
        try {
            return fs.statSync(this.path).isDirectory();
        } catch {
            // The folder can vanish between scans (concurrent rm): a throw here would
            // escape toSimpleJSON -> sendStackList -> the unguarded 10s cron and crash
            // the process - dimmed row instead (final review M-4, re-graded by effect).
            return false;
        }
    }

    get status() : number {
        return this._status;
    }

    /**
     * Validate a stack name at every filesystem-path choke point.
     * Only [a-z0-9_-] are allowed — this is what stops path traversal (GHSA-w8rm-ccw3-9jpc).
     * @param name
     */
    static validateStackName(name : string) {
        if (!name.match(/^[a-z0-9_-]+$/)) {
            throw new ValidationError("Stack name can only contain [a-z][0-9] _ - only");
        }
    }

    validate() {
        // Check name, allows [a-z][0-9] _ - only
        Stack.validateStackName(this.name);

        // Check YAML format
        yaml.parse(this.composeYAML);

        let lines = this.composeENV.split("\n");

        // Check if the .env is able to pass docker-compose
        // Prevent "setenv: The parameter is incorrect"
        // It only happens when there is one line and it doesn't contain "="
        if (lines.length === 1 && !lines[0].includes("=") && lines[0].length > 0) {
            throw new ValidationError("Invalid .env format");
        }
    }

    get composeYAML() : string {
        if (this._composeYAML === undefined) {
            try {
                this._composeYAML = fs.readFileSync(path.join(this.path, this._composeFileName), "utf-8");
            } catch (e) {
                this._composeYAML = "";
            }
        }
        return this._composeYAML;
    }

    get composeENV() : string {
        if (this._composeENV === undefined) {
            try {
                this._composeENV = fs.readFileSync(path.join(this.path, ".env"), "utf-8");
            } catch (e) {
                this._composeENV = "";
            }
        }
        return this._composeENV;
    }

    get path() : string {
        Stack.validateStackName(this.name);
        return path.join(this.server.stacksDir, this.name);
    }

    get fullPath() : string {
        let dir = this.path;

        // Compose up via node-pty
        let fullPathDir;

        // if dir is relative, make it absolute
        if (!path.isAbsolute(dir)) {
            fullPathDir = path.join(process.cwd(), dir);
        } else {
            fullPathDir = dir;
        }
        return fullPathDir;
    }

    /**
     * Save the stack to the disk
     * @param isAdd
     */
    async save(isAdd : boolean) {
        this.validate();

        let dir = this.path;

        // Check if the name is used if isAdd
        if (isAdd) {
            if (await fileExists(dir)) {
                throw new ValidationError("Stack name already exists");
            }

            // Create the stack folder
            await fsAsync.mkdir(dir);
        } else {
            if (!await fileExists(dir)) {
                throw new ValidationError("Stack not found");
            }
        }

        // Write or overwrite the compose.yaml
        fs.writeFileSync(path.join(dir, this._composeFileName), this.composeYAML);
        if (process.env.PUID && process.env.PGID) {
            const uid = Number(process.env.PUID);
            const gid = Number(process.env.PGID);
            fs.lchownSync(dir, uid, gid);
            fs.chownSync(path.join(dir, this._composeFileName), uid, gid);
        }
    }

    async deploy(socket : DockgeSocket) : Promise<number> {
        const terminalName = getComposeTerminalName(socket.endpoint, this.name);
        let exitCode = await Terminal.exec(this.server, socket, terminalName, "docker", this.getComposeOptions("up", "-d", "--remove-orphans"), this.path);
        if (exitCode !== 0) {
            throw new Error("Failed to deploy, please check the terminal output for more information.");
        }
        return exitCode;
    }

    async delete(socket: DockgeSocket) : Promise<number> {
        const terminalName = getComposeTerminalName(socket.endpoint, this.name);
        let exitCode = await Terminal.exec(this.server, socket, terminalName, "docker", this.getComposeOptions("down", "--remove-orphans"), this.path);
        if (exitCode !== 0) {
            throw new Error("Failed to delete, please check the terminal output for more information.");
        }

        // Remove the stack folder
        await fsAsync.rm(this.path, {
            recursive: true,
            force: true
        });

        return exitCode;
    }

    async updateStatus() {
        let statusList = await Stack.getStatusList(this.server.stacksDir);
        let status = statusList.get(this.name);

        if (status) {
            this._status = status;
        } else {
            this._status = UNKNOWN;
        }
    }

    /**
     * Checks if a compose file exists in the specified directory.
     * @async
     * @static
     * @param {string} stacksDir - The directory of the stack.
     * @param {string} filename - The name of the directory to check for the compose file.
     * @returns {Promise<boolean>} A promise that resolves to a boolean indicating whether any compose file exists.
     */
    static async composeFileExists(stacksDir : string, filename : string) : Promise<boolean> {
        let filenamePath = path.join(stacksDir, filename);
        // Check if any compose file exists
        for (const filename of acceptedComposeFileNames) {
            let composeFile = path.join(filenamePath, filename);
            if (await fileExists(composeFile)) {
                return true;
            }
        }
        return false;
    }

    static async getStackList(server : DockgeServer, useCacheForManaged = false) : Promise<Map<string, Stack>> {
        let stacksDir = server.stacksDir;
        let stackList : Map<string, Stack>;

        // Use cached stack list?
        if (useCacheForManaged && this.managedStackList.size > 0) {
            stackList = this.managedStackList;
        } else {
            stackList = new Map<string, Stack>();

            // Scan the stacks directory, and get the stack list
            try {
                let filenameList = await fsAsync.readdir(stacksDir);

                for (let filename of filenameList) {
                    try {
                        // Check if it is a directory
                        let stat = await fsAsync.stat(path.join(stacksDir, filename));
                        if (!stat.isDirectory()) {
                            continue;
                        }
                        // If no compose file exists, skip it
                        if (!await Stack.composeFileExists(stacksDir, filename)) {
                            continue;
                        }
                        let stack = await this.getStack(server, filename);
                        stack._status = CREATED_FILE;
                        stackList.set(filename, stack);
                    } catch (e) {
                        if (e instanceof Error) {
                            log.warn("getStackList", `Failed to get stack ${filename}, error: ${e.message}`);
                        }
                    }
                }

                // Cache by copying
                this.managedStackList = new Map(stackList);
            } catch (e) {
                // A broken stacks dir must degrade, not reject: the 10s cron calls
                // sendStackList unguarded and spawn rejects on non-zero exit (#875).
                if (e instanceof Error) {
                    log.warn("getStackList", `Failed to scan the stacks directory, error: ${e.message}`);
                }
            }
        }

        // Get status from docker compose ls
        try {
            let res = await childProcessAsync.spawn("docker", [ "compose", "ls", "--all", "--format", "json" ], {
                encoding: "utf-8",
            });

            if (!res.stdout) {
                return stackList;
            }

            let composeList = JSON.parse(res.stdout.toString());

            if (!Array.isArray(composeList)) {
                throw new Error("Unexpected docker compose ls output");
            }

            // F1: crash warnings come from one extra global docker ps, strictly
            // after the compose-ls spawn; getContainerWarnings never rejects (R3).
            const warnings = await this.getContainerWarnings();

            for (let composeStack of composeList) {
                try {
                    let stack = stackList.get(composeStack.Name);

                    // Project name can differ from the folder name (`name:` key, -p,
                    // normalization) - join by config path instead of declaring the
                    // folder stack "not managed" (#19/#359/#509).
                    if (!stack) {
                        const folder = this.resolveManagedFolder(stacksDir, composeStack.ConfigFiles);
                        if (folder) {
                            stack = stackList.get(folder);
                        }
                    }

                    if (!stack) {
                        // Skip our own stack if it is not managed by Dockge (R4)
                        if (composeStack.Name === "dockge" || composeStack.Name === "neo-dockge") {
                            continue;
                        }
                        stack = new Stack(server, composeStack.Name);
                        stackList.set(composeStack.Name, stack);
                    }

                    stack._status = this.statusConvert(composeStack.Status, warnings.get(composeStack.Name));
                    stack._configFilePath = composeStack.ConfigFiles;
                } catch (e) {
                    // One malformed entry must not blank the list: log and keep the siblings.
                    if (e instanceof Error) {
                        log.warn("getStackList", `Failed to process a compose ls entry, error: ${e.message}`);
                    }
                }
            }
        } catch (e) {
            if (e instanceof Error) {
                log.warn("getStackList", `Failed to get statuses from docker compose ls, error: ${e.message}`);
            }
        }

        return stackList;
    }

    /**
     * Get the status list, it will be used to update the status of the stacks
     * Not all status will be returned, only the stack that is deployed or created to `docker compose` will be returned
     * @param stacksDir when given, entries are keyed by BOTH project name and resolved
     *                  folder name, so name-mismatch stacks resolve via updateStatus (R6)
     */
    static async getStatusList(stacksDir? : string) : Promise<Map<string, number>> {
        let statusList = new Map<string, number>();

        try {
            let res = await childProcessAsync.spawn("docker", [ "compose", "ls", "--all", "--format", "json" ], {
                encoding: "utf-8",
            });

            if (!res.stdout) {
                return statusList;
            }

            let composeList = JSON.parse(res.stdout.toString());

            if (!Array.isArray(composeList)) {
                log.warn("getStatusList", "Unexpected docker compose ls output");
                return statusList;
            }

            const entries : { name : string, statusString : string, configFiles : string }[] = [];
            for (let composeStack of composeList) {
                try {
                    entries.push({
                        name: composeStack.Name,
                        statusString: composeStack.Status,
                        configFiles: composeStack.ConfigFiles,
                    });
                } catch (e) {
                    if (e instanceof Error) {
                        log.warn("getStatusList", `Failed to process a compose ls entry, error: ${e.message}`);
                    }
                }
            }

            // F1: one extra global docker ps after the compose-ls spawn
            // (spawn order matters for the mocked tests and for the CLI call
            // budget); getContainerWarnings never rejects (R3).
            const warnings = await this.getContainerWarnings();

            for (let entry of entries) {
                try {
                    const status = this.statusConvert(entry.statusString, warnings.get(entry.name));
                    statusList.set(entry.name, status);
                    if (stacksDir) {
                        const folder = this.resolveManagedFolder(stacksDir, entry.configFiles);
                        if (folder && folder !== entry.name) {
                            statusList.set(folder, status);
                        }
                    }
                } catch (e) {
                    if (e instanceof Error) {
                        log.warn("getStatusList", `Failed to process a compose ls entry, error: ${e.message}`);
                    }
                }
            }
        } catch (e) {
            // Callers (updateStatus) treat an empty map as UNKNOWN — degrade, never reject (#875).
            if (e instanceof Error) {
                log.warn("getStatusList", `Failed to get statuses from docker compose ls, error: ${e.message}`);
            }
        }

        return statusList;
    }

    /**
     * R3: a compose project belongs to a stack folder when its config file lives
     * directly under stacksDir/<name>. This outlasts project-name ≠ folder-name
     * mismatches (`name:` key, -p, normalization) that made dockge-created stacks
     * render as duplicate "not managed" rows (GH #19/#359/#509).
     * @param stacksDir absolute stacks directory
     * @param configFiles raw ConfigFiles value from `docker compose ls` (may be comma-separated)
     * @returns the direct-child folder name, or undefined if not directly under stacksDir
     */
    static resolveManagedFolder(stacksDir : string, configFiles? : unknown) : string | undefined {
        if (typeof configFiles !== "string" || configFiles.length === 0) {
            return undefined;
        }
        const first = configFiles.split(",")[0].trim();
        if (!first) {
            return undefined;
        }
        const dir = path.dirname(path.normalize(first));
        const rel = path.relative(path.normalize(stacksDir), dir);
        if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel) || rel.includes(path.sep)) {
            return undefined;
        }
        return rel;
    }

    /**
     * Convert the status string from `docker compose ls` to the status number.
     * Input Example: "exited(1), running(1)"
     *
     * Count-based and order-independent (R1): any running container wins, so
     * one-shot/exited sidecars never make a live stack look exited (GH #177/#474/#606/#806).
     * Non-string or unparseable input yields UNKNOWN instead of throwing (#875).
     *
     * F1 (spec 2026-10-19-f1-degraded-status): `warn` carries docker-ps-sourced
     * facts (a sibling container exited with a nonzero code). Combined with the
     * compose-ls `restarting`/`dead` segments this surfaces a living-but-crashing
     * stack as DEGRADED; a one-shot exiting 0 stays plain RUNNING (R1 intact).
     * @param status
     * @param warn
     */
    static statusConvert(status : string, warn? : { nonzeroExit?: boolean }) : number {
        if (typeof status !== "string") {
            return UNKNOWN;
        }

        const counts = new Map<string, number>();
        for (const segment of status.split(",")) {
            const withCount = segment.trim().match(/^([a-z]+)\s*\((\d+)\)$/);
            if (withCount) {
                counts.set(withCount[1], (counts.get(withCount[1]) ?? 0) + Number(withCount[2]));
                continue;
            }
            const bare = segment.trim().match(/^([a-z]+)$/);
            if (bare) {
                counts.set(bare[1], (counts.get(bare[1]) ?? 0) + 1);
            }
        }

        if ((counts.get("running") ?? 0) > 0) {
            if (warn?.nonzeroExit === true || (counts.get("restarting") ?? 0) > 0 || (counts.get("dead") ?? 0) > 0) {
                return DEGRADED;
            }
            return RUNNING;
        }
        if ((counts.get("restarting") ?? 0) > 0) {
            // A whole stack in a restart loop is not cleanly exited either.
            return DEGRADED;
        }
        if ((counts.get("exited") ?? 0) > 0) {
            return EXITED;
        }
        if ((counts.get("created") ?? 0) > 0) {
            return CREATED_STACK;
        }
        return UNKNOWN;
    }

    /**
     * Parse `docker ps -a --format '{{json .}}'` NDJSON output into per
     * compose-project crash flags (F1, spec 2026-10-19-f1-degraded-status).
     *
     * `Labels` is a comma-joined string, not an object; the project value is
     * extracted with a first-'=' split (other label values may contain '=').
     * Per-line parse failures are skipped; an unparseable exit code in
     * `Status` conservatively contributes no warning.
     * @param output
     */
    static parseContainerWarnings(output : string | undefined) : Map<string, { nonzeroExit: boolean }> {
        const warnings = new Map<string, { nonzeroExit: boolean }>();
        if (typeof output !== "string") {
            return warnings;
        }
        for (const line of output.split("\n")) {
            if (!line.trim()) {
                continue;
            }
            let obj : { State? : string, Status? : string, Labels? : string };
            try {
                obj = JSON.parse(line);
            } catch {
                continue;
            }
            if (typeof obj.Labels !== "string") {
                continue;
            }
            const projectEntry = obj.Labels.split(",").find((entry) => entry.startsWith("com.docker.compose.project="));
            if (!projectEntry) {
                continue;
            }
            const project = projectEntry.slice(projectEntry.indexOf("=") + 1);
            const codeMatch = (obj.Status ?? "").match(/^(?:Exited|Restarting|Dead)\s*\((\d+)\)/);
            const nonzeroExit = (obj.State === "exited" || obj.State === "restarting") && codeMatch !== null && Number(codeMatch[1]) > 0;
            const existing = warnings.get(project);
            warnings.set(project, { nonzeroExit: (existing?.nonzeroExit ?? false) || nonzeroExit });
        }
        return warnings;
    }

    /**
     * One global `docker ps -a` (compose-managed containers only) feeds the
     * per-stack nonzeroExit warn flags. Never rejects (R3): spawn failure or
     * a malformed result yields an empty map, i.e. today's behavior.
     */
    static async getContainerWarnings() : Promise<Map<string, { nonzeroExit: boolean }>> {
        try {
            const res = await childProcessAsync.spawn("docker", [ "ps", "-a", "--filter", "label=com.docker.compose.project", "--format", "{{json .}}" ], {
                encoding: "utf-8",
            });
            return this.parseContainerWarnings(res?.stdout?.toString());
        } catch (e) {
            log.warn("getContainerWarnings", `Failed to list containers: ${(e as Error).message}`);
            return new Map();
        }
    }

    /**
     * Host-wide container list with live stats (1.6.3, lazydocker-style
     * "pane of glass"). Joins `docker ps -a` (every container) with
     * `docker stats` (running ones) by the 12-char short id.
     *
     * `managed` is derived from the compose `working_dir` label: a project
     * directory that is a direct child of stacksDir is managed (same rule as
     * R2). No storage is involved - the daemon is the source of truth.
     *
     * Never rejects (R3): a failing `docker ps` yields an empty list, a
     * failing `docker stats` still lists the containers without stats.
     * @param stacksDir absolute stacks directory
     */
    static async getContainerList(stacksDir: string) : Promise<ContainerListEntry[]> {
        let psEntries : { ID? : string, Names? : string, Image? : string, State? : string, Status? : string, HealthStatus? : string, Labels? : string }[] = [];
        try {
            const res = await childProcessAsync.spawn("docker", [ "ps", "-a", "--format", "{{json .}}" ], {
                encoding: "utf-8",
            });
            psEntries = this.parseNdjson<{ ID? : string, Names? : string, Image? : string, State? : string, Status? : string, HealthStatus? : string, Labels? : string }>(res?.stdout?.toString());
        } catch (e) {
            log.warn("getContainerList", `Failed to list containers: ${(e as Error).message}`);
            return [];
        }

        let statsEntries : { ID? : string, Name? : string, CPUPerc? : string, MemUsage? : string, MemPerc? : string, NetIO? : string, BlockIO? : string, PIDs? : string }[] = [];
        try {
            const res = await childProcessAsync.spawn("docker", [ "stats", "--no-stream", "--format", "{{json .}}" ], {
                encoding: "utf-8",
            });
            statsEntries = this.parseNdjson<{ ID? : string, Name? : string, CPUPerc? : string, MemUsage? : string, MemPerc? : string, NetIO? : string, BlockIO? : string, PIDs? : string }>(res?.stdout?.toString());
        } catch (e) {
            // Stats are a nice-to-have: keep the container list.
            log.warn("getContainerList", `Failed to get container stats: ${(e as Error).message}`);
        }

        const statsById = new Map<string, typeof statsEntries[number]>();
        const statsByName = new Map<string, typeof statsEntries[number]>();
        for (let entry of statsEntries) {
            if (entry.ID) {
                statsById.set(entry.ID.slice(0, 12), entry);
            }
            if (entry.Name) {
                statsByName.set(entry.Name, entry);
            }
        }

        const stacksDirFull = path.resolve(stacksDir);
        const list : ContainerListEntry[] = [];
        for (let entry of psEntries) {
            const name = (entry.Names ?? "").split(",")[0];
            const labels = this.parseLabels(entry.Labels);
            const workingDir = labels.get("com.docker.compose.project.working_dir") ?? "";
            const project = labels.get("com.docker.compose.project") ?? "";
            const id = entry.ID ?? "";
            const stats = (id ? statsById.get(id.slice(0, 12)) : undefined) ?? (name ? statsByName.get(name) : undefined);

            let managed = false;
            if (workingDir) {
                try {
                    managed = path.dirname(path.resolve(workingDir)) === stacksDirFull;
                } catch {
                    managed = false;
                }
            }

            list.push({
                id,
                name,
                image: entry.Image ?? "",
                state: entry.State ?? "",
                status: entry.Status ?? "",
                health: entry.HealthStatus ?? "",
                project,
                workingDir,
                managed,
                cpu: stats?.CPUPerc ?? "",
                memUsage: stats?.MemUsage ?? "",
                memPerc: stats?.MemPerc ?? "",
                netIO: stats?.NetIO ?? "",
                blockIO: stats?.BlockIO ?? "",
                pids: stats?.PIDs ?? "",
            });
        }
        return list;
    }

    /**
     * Parse NDJSON output into objects, skipping unparseable lines.
     */
    private static parseNdjson<T>(output : string | undefined) : T[] {
        if (typeof output !== "string") {
            return [];
        }
        const result : T[] = [];
        for (let line of output.split("\n")) {
            if (!line.trim()) {
                continue;
            }
            try {
                result.push(JSON.parse(line) as T);
            } catch {
                // skip malformed line
            }
        }
        return result;
    }

    /**
     * Parse the comma-joined `Labels` string of `docker ps` into a map.
     * Values may contain "=", so split each entry on the first "=" only.
     */
    private static parseLabels(labels : string | undefined) : Map<string, string> {
        const result = new Map<string, string>();
        if (typeof labels !== "string" || !labels) {
            return result;
        }
        for (let entry of labels.split(",")) {
            const index = entry.indexOf("=");
            if (index <= 0) {
                continue;
            }
            result.set(entry.slice(0, index), entry.slice(index + 1));
        }
        return result;
    }

    static async getStack(server: DockgeServer, stackName: string, skipFSOperations = false) : Promise<Stack> {
        this.validateStackName(stackName);
        let dir = path.join(server.stacksDir, stackName);

        if (!skipFSOperations) {
            if (!await fileExists(dir) || !(await fsAsync.stat(dir)).isDirectory()) {
                // Maybe it is a stack managed by docker compose directly
                let stackList = await this.getStackList(server, true);
                let stack = stackList.get(stackName);

                if (stack) {
                    return stack;
                } else {
                    // Really not found
                    throw new ValidationError("Stack not found");
                }
            }
        } else {
            //log.debug("getStack", "Skip FS operations");
        }

        let stack : Stack;

        if (!skipFSOperations) {
            stack = new Stack(server, stackName);
        } else {
            stack = new Stack(server, stackName, undefined, undefined, true);
        }

        stack._status = UNKNOWN;
        stack._configFilePath = path.resolve(dir);
        return stack;
    }

    getComposeOptions(command : string, ...extraOptions : string[]) {
        //--env-file ./../global.env --env-file .env
        let options = [ "compose", command, ...extraOptions ];
        if (fs.existsSync(path.join(this.server.stacksDir, "global.env"))) {
            if (fs.existsSync(path.join(this.path, ".env"))) {
                options.splice(1, 0, "--env-file", "./.env");
            }
            options.splice(1, 0, "--env-file", "../global.env");
        }
        console.log(options);
        return options;
    }

    async start(socket: DockgeSocket) {
        const terminalName = getComposeTerminalName(socket.endpoint, this.name);
        let exitCode = await Terminal.exec(this.server, socket, terminalName, "docker", this.getComposeOptions("up", "-d", "--remove-orphans"), this.path);
        if (exitCode !== 0) {
            throw new Error("Failed to start, please check the terminal output for more information.");
        }
        return exitCode;
    }

    async stop(socket: DockgeSocket) : Promise<number> {
        const terminalName = getComposeTerminalName(socket.endpoint, this.name);
        let exitCode = await Terminal.exec(this.server, socket, terminalName, "docker", this.getComposeOptions("stop"), this.path);
        if (exitCode !== 0) {
            throw new Error("Failed to stop, please check the terminal output for more information.");
        }
        return exitCode;
    }

    async restart(socket: DockgeSocket) : Promise<number> {
        const terminalName = getComposeTerminalName(socket.endpoint, this.name);
        let exitCode = await Terminal.exec(this.server, socket, terminalName, "docker", this.getComposeOptions("restart"), this.path);
        if (exitCode !== 0) {
            throw new Error("Failed to restart, please check the terminal output for more information.");
        }
        return exitCode;
    }

    async down(socket: DockgeSocket) : Promise<number> {
        const terminalName = getComposeTerminalName(socket.endpoint, this.name);
        let exitCode = await Terminal.exec(this.server, socket, terminalName, "docker", this.getComposeOptions("down"), this.path);
        if (exitCode !== 0) {
            throw new Error("Failed to down, please check the terminal output for more information.");
        }
        return exitCode;
    }

    async update(socket: DockgeSocket) {
        const terminalName = getComposeTerminalName(socket.endpoint, this.name);
        let exitCode = await Terminal.exec(this.server, socket, terminalName, "docker", this.getComposeOptions("pull"), this.path);
        if (exitCode !== 0) {
            throw new Error("Failed to pull, please check the terminal output for more information.");
        }

        // If the stack is not running (and not degraded), we don't need to restart it
        await this.updateStatus();
        log.debug("update", "Status: " + this.status);
        if (this.status !== RUNNING && this.status !== DEGRADED) {
            return exitCode;
        }

        exitCode = await Terminal.exec(this.server, socket, terminalName, "docker", this.getComposeOptions("up", "-d", "--remove-orphans"), this.path);
        if (exitCode !== 0) {
            throw new Error("Failed to restart, please check the terminal output for more information.");
        }
        return exitCode;
    }

    async joinCombinedTerminal(socket: DockgeSocket) {
        const terminalName = getCombinedTerminalName(socket.endpoint, this.name);
        const terminal = Terminal.getOrCreateTerminal(this.server, terminalName, "docker", this.getComposeOptions("logs", "-f", "--tail", "100"), this.path);
        terminal.enableKeepAlive = true;
        terminal.rows = COMBINED_TERMINAL_ROWS;
        terminal.cols = COMBINED_TERMINAL_COLS;
        terminal.join(socket);
        terminal.start();
    }

    async leaveCombinedTerminal(socket: DockgeSocket) {
        const terminalName = getCombinedTerminalName(socket.endpoint, this.name);
        const terminal = Terminal.getTerminal(terminalName);
        if (terminal) {
            terminal.leave(socket);
        }
    }

    async joinContainerTerminal(socket: DockgeSocket, serviceName: string, shell : string = "sh", index: number = 0) {
        const terminalName = getContainerExecTerminalName(socket.endpoint, this.name, serviceName, index);
        let terminal = Terminal.getTerminal(terminalName);

        if (!terminal) {
            terminal = new InteractiveTerminal(this.server, terminalName, "docker", this.getComposeOptions("exec", serviceName, shell), this.path);
            terminal.rows = TERMINAL_ROWS;
            log.debug("joinContainerTerminal", "Terminal created");
        }

        terminal.join(socket);
        terminal.start();
    }

    async getServiceStatusList() {
        let statusList = new Map<string, Array<{ status: string, name: string }>>();

        try {
            let res = await childProcessAsync.spawn("docker", this.getComposeOptions("ps", "--format", "json"), {
                cwd: this.path,
                encoding: "utf-8",
            });

            if (!res.stdout) {
                return statusList;
            }

            let lines = res.stdout?.toString().split("\n");

            const addLine = (obj: { Service: string, State: string, Name: string, Health: string, ExitCode?: number }) => {
                if (!statusList.has(obj.Service)) {
                    statusList.set(obj.Service, []);
                }
                let status = obj.Health || obj.State;
                // F1: suffix nonzero exit codes on crashed/restarting service badges.
                // Health precedence: a healthchecked container stays "unhealthy" (no
                // suffix). Missing ExitCode (old compose) or exit 0 → no suffix.
                if ((status === "exited" || status === "restarting") && typeof obj.ExitCode === "number" && obj.ExitCode !== 0) {
                    status = `${status} (${obj.ExitCode})`;
                }
                statusList.get(obj.Service)?.push({
                    status,
                    name: obj.Name
                });
            };

            for (let line of lines) {
                try {
                    let obj = JSON.parse(line);
                    if (obj instanceof Array) {
                        obj.forEach(addLine);
                    } else {
                        addLine(obj);
                    }
                } catch (e) {
                }
            }

            return statusList;
        } catch (e) {
            log.error("getServiceStatusList", e);
            return statusList;
        }
    }

    async startService(socket: DockgeSocket, serviceName: string) {
        const terminalName = getComposeTerminalName(socket.endpoint, this.name);
        const exitCode = await Terminal.exec(this.server, socket, terminalName, "docker", [ "compose", "up", "-d", serviceName ], this.path);
        if (exitCode !== 0) {
            throw new Error(`Failed to start service ${serviceName}, please check logs for more information.`);
        }

        return exitCode;
    }

    async stopService(socket: DockgeSocket, serviceName: string): Promise<number> {
        const terminalName = getComposeTerminalName(socket.endpoint, this.name);
        const exitCode = await Terminal.exec(this.server, socket, terminalName, "docker", [ "compose", "stop", serviceName ], this.path);
        if (exitCode !== 0) {
            throw new Error(`Failed to stop service ${serviceName}, please check logs for more information.`);
        }

        return exitCode;
    }

    async restartService(socket: DockgeSocket, serviceName: string): Promise<number> {
        const terminalName = getComposeTerminalName(socket.endpoint, this.name);
        const exitCode = await Terminal.exec(this.server, socket, terminalName, "docker", [ "compose", "restart", serviceName ], this.path);
        if (exitCode !== 0) {
            throw new Error(`Failed to restart service ${serviceName}, please check logs for more information.`);
        }

        return exitCode;
    }
}
