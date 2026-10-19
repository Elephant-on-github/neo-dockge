import { log } from "./log";
import packageJSON from "../package.json";
import { Settings } from "./settings";

// How much time in ms to wait between update checks
const UPDATE_CHECKER_INTERVAL_MS = 1000 * 60 * 60 * 48;
// Query this fork's own GitHub releases (upstream used https://dockge.kuma.pet/version)
const CHECK_URL = "https://api.github.com/repos/Elephant-on-github/neo-dockge/releases/latest";

class CheckVersion {
    version = packageJSON.version;
    latestVersion? : string;
    interval? : NodeJS.Timeout;

    async startInterval() {
        const check = async () => {
            if (await Settings.get("checkUpdate") === false) {
                return;
            }

            log.debug("update-checker", "Retrieving latest versions");

            try {
                const res = await fetch(CHECK_URL);
                const data = await res.json();

                // For debug
                if (process.env.TEST_CHECK_VERSION === "1") {
                    data.tag_name = "1000.0.0";
                }

                // /releases/latest yields { tag_name: "x.y.z" } and excludes
                // pre-releases, so the beta toggle stays quiet until this fork
                // publishes prerelease tags.
                if (data.tag_name) {
                    this.latestVersion = data.tag_name;
                }

            } catch (_) {
                log.info("update-checker", "Failed to check for new versions");
            }

        };

        await check();
        this.interval = setInterval(check, UPDATE_CHECKER_INTERVAL_MS);
    }
}

const checkVersion = new CheckVersion();
export default checkVersion;
