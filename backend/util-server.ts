import { Socket } from "socket.io";
import { Terminal } from "./terminal";
import { randomBytes } from "crypto";
import { log } from "./log";
import { ERROR_TYPE_VALIDATION } from "../common/util-common";
import { R } from "redbean-node";
import { verifyPassword } from "./password-hash";
import fs from "fs";
import { AgentManager } from "./agent-manager";

/**
 * The docker binary to call. Not every host has "docker" on the PATH:
 * rootless docker, podman, or a custom install prefix all break the
 * default, and the only symptom was an opaque ENOENT (#424, #361).
 * @returns {string} The binary path to use
 */
export function getDockerBinary() : string {
    return process.env.DOCKGE_DOCKER_PATH || process.env.DOCKER_PATH || "docker";
}

/**
 * The docker API version to request, if the operator pinned one. An old
 * daemon refuses a newer client ("client version 1.53 is too new, maximum
 * supported API version is 1.41"), so the version can be capped here
 * (#935).
 * @returns {string|undefined} The API version, or undefined to let the CLI negotiate
 */
export function getDockerApiVersion() : string | undefined {
    return process.env.DOCKGE_DOCKER_API_VERSION || process.env.DOCKER_API_VERSION || undefined;
}

/**
 * Environment for a docker child process: inherits the parent env and adds
 * the pinned API version, if any.
 * @returns {object} The env for the child process
 */
export function getDockerEnv() : NodeJS.ProcessEnv {
    const apiVersion = getDockerApiVersion();
    if (!apiVersion) {
        return process.env;
    }
    return { ...process.env, DOCKER_API_VERSION: apiVersion };
}

export interface JWTDecoded {
    username : string;
    h? : string;
}

export interface DockgeSocket extends Socket {
    userID: number;
    consoleTerminal? : Terminal;
    instanceManager : AgentManager;
    endpoint : string;
    emitAgent : (eventName : string, ...args : unknown[]) => void;
}

// For command line arguments, so they are nullable
export interface Arguments {
    sslKey? : string;
    sslCert? : string;
    sslKeyPassphrase? : string;
    port? : number;
    hostname? : string;
    dataDir? : string;
    stacksDir? : string;
    enableConsole? : boolean;
}

// Some config values are required
export interface Config extends Arguments {
    dataDir : string;
    stacksDir : string;
}

export function checkLogin(socket : DockgeSocket) {
    if (!socket.userID) {
        throw new Error("You are not logged in.");
    }
}

export class ValidationError extends Error {
    constructor(message : string) {
        super(message);
    }
}

export function callbackError(error : unknown, callback : unknown) {
    if (typeof(callback) !== "function") {
        log.error("console", "Callback is not a function");
        return;
    }

    if (error instanceof Error) {
        callback({
            ok: false,
            msg: error.message,
            msgi18n: true,
        });
    } else if (error instanceof ValidationError) {
        callback({
            ok: false,
            type: ERROR_TYPE_VALIDATION,
            msg: error.message,
            msgi18n: true,
        });
    } else {
        log.debug("console", "Unknown error: " + error);
    }
}

export function callbackResult(result : unknown, callback : unknown) {
    if (typeof(callback) !== "function") {
        log.error("console", "Callback is not a function");
        return;
    }
    callback(result);
}

export async function doubleCheckPassword(socket : DockgeSocket, currentPassword : unknown) {
    if (typeof currentPassword !== "string") {
        throw new Error("Wrong data type?");
    }

    let user = await R.findOne("user", " id = ? AND active = 1 ", [
        socket.userID,
    ]);

    if (!user || !verifyPassword(currentPassword, user.password)) {
        throw new Error("Incorrect current password");
    }

    return user;
}

export function fileExists(file : string) {
    return fs.promises.access(file, fs.constants.F_OK)
        .then(() => true)
        .catch(() => false);
}
