<template>
    <div class="container-fluid">
        <div class="row">
            <div v-if="!$root.isMobile" class="col-12 col-md-4 col-xl-3">
                <div>
                    <router-link to="/compose" class="btn btn-primary mb-3"><font-awesome-icon icon="plus" /> {{ $t("compose") }}</router-link>
                </div>
                <StackList :scrollbar="true" />
            </div>

            <div ref="container" class="col-12 col-md-8 col-xl-9 mb-3">
                <!-- Add :key to disable vue router re-use the same component -->
                <router-view :key="$route.fullPath" :calculatedHeight="height" />
            </div>
        </div>
    </div>
</template>

<script>

import StackList from "../components/StackList.vue";

export default {
    components: {
        StackList,
    },
    data() {
        return {
            height: 0
        };
    },
    watch: {
        // The content height changes with the page (home vs settings vs a
        // stack detail). It was measured once on mount, so every navigation
        // kept a stale height and the layout shifted.
        "$route"() {
            this.updateHeight();
        },
    },
    mounted() {
        window.addEventListener("resize", this.updateHeight);
        this.updateHeight();
    },
    beforeUnmount() {
        window.removeEventListener("resize", this.updateHeight);
    },
    methods: {
        /**
         * Measure the content column and hand the height to the child page
         * @returns {void}
         */
        updateHeight() {
            this.$nextTick(() => {
                if (this.$refs.container) {
                    this.height = this.$refs.container.offsetHeight;
                }
            });
        },
    },
};
</script>

<style lang="scss" scoped>
.container-fluid {
    width: 98%;
}
</style>
