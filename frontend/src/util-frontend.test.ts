import { describe, expect, it } from "vitest";
import { timezoneList, getTimezoneOffset } from "./util-frontend";

describe("util-frontend", () => {
    it("timezoneList returns a non-empty sorted array and never throws", () => {
        const list = timezoneList();
        expect(Array.isArray(list)).toBe(true);
        expect(list.length).toBeGreaterThan(0);
        // sorted by offset (ascending)
        for (let i = 1; i < list.length; i++) {
            expect(list[i].time).toBeGreaterThanOrEqual(list[i - 1].time);
        }
        // each entry has the fields the UI relies on
        expect(list[0]).toHaveProperty("name");
        expect(list[0]).toHaveProperty("value");
        expect(list[0]).toHaveProperty("value");
    });

    it("timezoneList is robust to a broken/empty import (returns an array)", () => {
        // The function must never throw, even if the underlying package changes shape.
        expect(() => timezoneList()).not.toThrow();
        expect(Array.isArray(timezoneList())).toBe(true);
    });

    it("getTimezoneOffset returns a finite number", () => {
        const offset = getTimezoneOffset("UTC");
        expect(typeof offset).toBe("number");
        expect(Number.isFinite(offset)).toBe(true);
    });
});
