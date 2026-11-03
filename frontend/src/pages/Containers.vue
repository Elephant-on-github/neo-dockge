<template>
    <div>
        <h1 class="mb-3">{{ $t("containers") }}</h1>

        <div class="shadow-box mb-3">
            <div class="d-flex align-items-center mb-3">
                <div class="form-check me-3">
                    <input id="auto-refresh" v-model="autoRefresh" class="form-check-input" type="checkbox" />
                    <label class="form-check-label" for="auto-refresh">{{ $t("autoRefresh") }}</label>
                </div>
                <div class="placeholder"></div>
                <button class="btn btn-sm btn-secondary" @click="refresh">
                    <font-awesome-icon icon="sync-alt" /> {{ $t("refresh") }}
                </button>
            </div>

            <div v-if="loading" class="text-center py-4">
                <div class="spinner-border" role="status"></div>
            </div>

            <div v-else-if="containerList.length === 0" class="text-center py-4">
                <h4>{{ $t("noContainers") }}</h4>
            </div>

            <div v-else class="table-responsive">
                <div class="d-flex align-items-center mb-3 gap-2 flex-wrap">
                    <input v-model="filterText" type="text" class="form-control form-control-sm" style="max-width: 240px" :placeholder="$t('search')" />
                    <select v-model="sortBy" class="form-select form-select-sm" style="max-width: 160px">
                        <option value="name">{{ $t('containerName') }}</option>
                        <option value="state">{{ $t('containerState') }}</option>
                        <option value="cpu">{{ $t('CPU') }}</option>
                    </select>
                    <button class="btn btn-sm btn-outline-secondary" @click="sortDir = sortDir === 'asc' ? 'desc' : 'asc'">
                        {{ sortDir === 'asc' ? '↑' : '↓' }}
                    </button>
                </div>
                <table class="table table-hover align-middle">
                    <thead>
                        <tr>
                            <th>{{ $t("containerName") }}</th>
                            <th>{{ $t("containerImage") }}</th>
                            <th>{{ $t("containerState") }}</th>
                            <th>{{ $t("managed") }}</th>
                            <th>{{ $t("CPU") }}</th>
                            <th>{{ $t("memory") }}</th>
                            <th>{{ $t("memPerc") }}</th>
                            <th>{{ $t("netIO") }}</th>
                            <th>{{ $t("blockIO") }}</th>
                            <th>{{ $t("pids") }}</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="container in filteredContainers" :key="container.id + container.name">
                            <td>{{ container.name }}</td>
                            <td>{{ container.image }}</td>
                            <td>
                                <span class="badge" :class="stateBadgeClass(container)">{{ container.state }}</span>
                                <span v-if="container.status" class="ms-1 small text-muted">{{ container.status }}</span>
                            </td>
                            <td>
                                <span v-if="container.managed" class="badge bg-primary">{{ $t("managed") }}</span>
                                <span v-else class="badge bg-secondary">{{ $t("external") }}</span>
                            </td>
                            <td>{{ container.cpu }}</td>
                            <td>{{ container.memUsage }}</td>
                            <td>{{ container.memPerc }}</td>
                            <td>{{ container.netIO }}</td>
                            <td>{{ container.blockIO }}</td>
                            <td>{{ container.pids }}</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
    </div>
</template>

<script>
export default {
    data() {
        return {
            containerList: [],
            loading: true,
            autoRefresh: true,
            refreshTimer: null,
            filterText: "",
            sortBy: "name",
            sortDir: "asc",
        };
    },
    computed: {
        endpoint() {
            return this.$route.params.endpoint || "";
        },
        filteredContainers() {
            const q = (this.filterText || "").toLowerCase();
            let list = this.containerList.filter((c) =>
                !q || (c.name || "").toLowerCase().includes(q) || (c.image || "").toLowerCase().includes(q),
            );
            const dir = this.sortDir === "asc" ? 1 : -1;
            list = list.slice().sort((a, b) => {
                const va = a[this.sortBy] ?? "";
                const vb = b[this.sortBy] ?? "";
                if (va < vb) {
                    return -1 * dir;
                }
                if (va > vb) {
                    return 1 * dir;
                }
                return 0;
            });
            return list;
        },
    },
    mounted() {
        this.refresh();
    },
    beforeUnmount() {
        this.stopTimer();
    },
    methods: {
        refresh() {
            this.$root.emitAgent(this.endpoint, "requestContainerList", (res) => {
                if (res.ok) {
                    this.containerList = res.containerList;
                }
                this.loading = false;
                this.scheduleRefresh();
            });
        },
        scheduleRefresh() {
            this.stopTimer();
            if (this.autoRefresh) {
                this.refreshTimer = setTimeout(() => {
                    this.refresh();
                }, 5000);
            }
        },
        stopTimer() {
            if (this.refreshTimer) {
                clearTimeout(this.refreshTimer);
                this.refreshTimer = null;
            }
        },
        stateBadgeClass(container) {
            if (container.state === "running") {
                return "bg-primary";
            }
            if (container.state === "exited" || container.state === "dead") {
                return "bg-danger";
            }
            if (container.state === "restarting" || container.state === "paused") {
                return "bg-warning";
            }
            return "bg-secondary";
        },
    },
};
</script>
