// Shared helpers for mounting Vue components in tests.
import { mount } from "@vue/test-utils";
import { vi } from "vitest";
import type { Component } from "vue";

export interface RootMockOptions {
    info?: Record<string, unknown>;
    isMobile?: boolean;
    loggedIn?: boolean;
    username?: string;
    usernameFirstChar?: string;
    completeStackList?: Record<string, unknown>;
    agentList?: Record<string, unknown>;
    agentStatusList?: Record<string, unknown>;
    endpointDisplayFunction?: (endpoint: string) => string;
    emitAgent?: (...args: unknown[]) => void;
    getSocket?: () => unknown;
    toastRes?: (...args: unknown[]) => void;
    toastSuccess?: (...args: unknown[]) => void;
    toastError?: (...args: unknown[]) => void;
    socketIO?: Record<string, unknown>;
    userTimezone?: string;
    settings?: Record<string, unknown>;
    saveSettings?: () => void;
    settingsLoaded?: boolean;
    dockerStats?: Record<string, unknown>;
}

export function makeRootMock(overrides: RootMockOptions = {}) {
    const socket = {
        emit: vi.fn(),
        on: vi.fn(),
        token: "autoLogin",
        connected: true,
        ...overrides.getSocket?.(),
    };
    const root = {
        info: { version: "1.6.5", latestVersion: null, isContainer: false, ...(overrides.info || {}) },
        isMobile: overrides.isMobile ?? false,
        loggedIn: overrides.loggedIn ?? true,
        username: overrides.username ?? "admin",
        usernameFirstChar: overrides.usernameFirstChar ?? "A",
        completeStackList: overrides.completeStackList ?? {},
        agentList: overrides.agentList ?? {},
        agentStatusList: overrides.agentStatusList ?? {},
        dockerStats: overrides.dockerStats ?? {},
        endpointDisplayFunction: overrides.endpointDisplayFunction ?? ((e: string) => e || "local"),
        emitAgent: overrides.emitAgent ?? vi.fn(),
        getSocket: overrides.getSocket ?? (() => socket),
        toastRes: overrides.toastRes ?? vi.fn(),
        toastSuccess: overrides.toastSuccess ?? vi.fn(),
        toastError: overrides.toastError ?? vi.fn(),
        socketIO: overrides.socketIO ?? { connected: true, firstConnect: true, connectionErrorMsg: "", showReverseProxyGuide: false },
        socket: overrides.socketIO ?? { token: "autoLogin", connected: true },
        userTimezone: overrides.userTimezone ?? "auto",
        settings: overrides.settings,
        saveSettings: overrides.saveSettings,
        settingsLoaded: overrides.settingsLoaded,
    };
    return root;
}

export function mountWithRoot(component: Component, options: Record<string, unknown> = {}) {
    const root = makeRootMock((options.rootOverrides as RootMockOptions) || {});
    const route = (options.route as any) || { params: {}, path: "/", name: "DashboardHome", fullPath: "/" };
    const router = (options.router as any) || { push: vi.fn(), currentRoute: { value: route } };
    const wrapper = mount(component, {
        ...options,
        global: {
            ...(options.global || {}),
            mixins: [
                {
                    beforeCreate() {
                        try {
                            try {
                                const rootInstance = (this as any).$?.root;
                                if (rootInstance) {
                                    Object.assign(rootInstance, root);
                                }
                            } catch (e) {
                                /* ignore */
                            }
                            // Fallback: also assign onto self for components that read this.X directly
                            try {
                                const props = (this.$options && this.$options.props) ? Object.keys(this.$options.props) : [];
                                const safe: Record<string, unknown> = {};
                                for (const [k, v] of Object.entries(root)) {
                                    if (!props.includes(k)) safe[k] = v;
                                }
                                Object.assign(this, safe);
                            } catch (e) {
                                /* ignore */
                            }
                        } catch (e) {
                            /* ignore */
                        }
                    },
                    created() {
                        try {
                            const inst = (this as any).$;
                            if (inst && inst.proxy) {
                                inst.proxy = new Proxy(inst.proxy, {
                                    get(target, key) {
                                        if (key === "$root") return root;
                                        return target[key];
                                    },
                                });
                            }
                        } catch (e) {
                            /* ignore */
                        }
                    },
                },
                ...((options.global as any)?.mixins || []),
            ],
            mocks: {
                $t: (key: string) => key,
                $tc: (key: string) => key,
                $route: route,
                $router: router,
                ...(options.global as any)?.mocks,
            },
            stubs: {
                FontAwesomeIcon: { template: "<span />" },
                "router-link": { template: "<a><slot /></a>" },
                "router-view": { template: "<div><slot /></div>" },
                ...((options.global as any)?.stubs || {}),
            },
        },
    });
    return wrapper;
}
