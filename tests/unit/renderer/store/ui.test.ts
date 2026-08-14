import { createStore } from "jotai";
import {
  activeMainViewAtom,
  closeSettingsAtom,
  isSettingsOpenAtom,
  openSettingsAtom,
} from "@/renderer/store/ui";

describe("main view navigation", () => {
  it("returns from settings to the view that opened it", () => {
    const store = createStore();
    store.set(activeMainViewAtom, "schedule");

    store.set(openSettingsAtom);
    expect(store.get(activeMainViewAtom)).toBe("settings");
    expect(store.get(isSettingsOpenAtom)).toBe(true);

    store.set(closeSettingsAtom);
    expect(store.get(activeMainViewAtom)).toBe("schedule");
    expect(store.get(isSettingsOpenAtom)).toBe(false);
  });

  it("ignores duplicate open and close actions", () => {
    const store = createStore();

    store.set(openSettingsAtom);
    store.set(openSettingsAtom);
    store.set(closeSettingsAtom);
    store.set(closeSettingsAtom);

    expect(store.get(activeMainViewAtom)).toBe("chat");
  });
});
