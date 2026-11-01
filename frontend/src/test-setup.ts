// Global test setup for the frontend suite.
import { config } from "@vue/test-utils";
import { library } from "@fortawesome/fontawesome-svg-core";
import * as solidIcons from "@fortawesome/free-solid-svg-icons";
import FontAwesomeIcon from "./icon";

// Register every free solid icon the app uses (the same set as icon.ts).
library.add(
    ...Object.values(solidIcons).filter(
        (value) => typeof value === "object" && value !== null && "iconName" in value,
    ),
);
config.global.components = { FontAwesomeIcon };

// jsdom does not implement matchMedia; the theme mixin reads it on init.
if (typeof window.matchMedia !== "function") {
    window.matchMedia = (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
    });
}

// Silence the noisy "Could not find icon" warnings during tests; they are
// expected for icons we deliberately do not register.
const originalWarn = console.warn;
console.warn = (...args: unknown[]) => {
    if (typeof args[0] === "string" && args[0].includes("Could not find one or more icon")) {
        return;
    }
    originalWarn(...args);
};
