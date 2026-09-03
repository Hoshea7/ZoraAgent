import type { SessionMeta, WorkspaceMeta } from "@/shared/zora";
import {
  buildActivitySections,
  createActivityLayoutSnapshot,
  formatActivityDateLabel,
  reconcileActivityLayoutSnapshot,
  type ActivitySessionItem,
  type ActivitySessionStatus,
} from "@/renderer/utils/session-activity";

const WORKSPACE: WorkspaceMeta = {
  id: "activity-project",
  name: "活动项目",
  path: "/tmp/activity-project",
  createdAt: "2026-09-03T00:00:00.000Z",
  updatedAt: "2026-09-03T00:00:00.000Z",
};

function item(
  id: string,
  updatedAt: Date,
  status: ActivitySessionStatus,
): ActivitySessionItem {
  const session: SessionMeta = {
    id,
    title: id,
    createdAt: updatedAt.toISOString(),
    updatedAt: updatedAt.toISOString(),
    permissionMode: "ask",
  };

  return { session, workspace: WORKSPACE, status };
}

describe("session activity grouping", () => {
  const now = new Date(2026, 8, 3, 15, 0, 0);

  it("places actionable sessions in priority order and removes them from date groups", () => {
    const result = buildActivitySections(
      [
        item("running-newer", new Date(2026, 8, 3, 14, 30), "running"),
        item("needs-input-older", new Date(2026, 8, 2, 10, 0), "needs-input"),
        item("today-idle", new Date(2026, 8, 3, 14, 45), "idle"),
      ],
      now,
    );

    expect(result.priority.map(({ session }) => session.id)).toEqual([
      "needs-input-older",
      "running-newer",
    ]);
    expect(result.dates).toHaveLength(1);
    expect(result.dates[0].label).toBe("今天");
    expect(result.dates[0].items.map(({ session }) => session.id)).toEqual([
      "today-idle",
    ]);
  });

  it("sorts date groups and sessions by freshness without promoting the current session", () => {
    const result = buildActivitySections(
      [
        item("yesterday", new Date(2026, 8, 2, 22, 0), "idle"),
        item("current-older", new Date(2026, 8, 3, 9, 0), "current"),
        item("idle-newer", new Date(2026, 8, 3, 14, 0), "idle"),
        item("monday", new Date(2026, 7, 31, 12, 0), "idle"),
      ],
      now,
    );

    expect(result.dates.map((section) => section.label)).toEqual([
      "今天",
      "昨天",
      "星期一",
    ]);
    expect(result.dates[0].items.map(({ session }) => session.id)).toEqual([
      "idle-newer",
      "current-older",
    ]);
  });

  it("keeps completed priority sessions in place for the current activity visit", () => {
    const running = item(
      "sticky-priority",
      new Date(2026, 8, 3, 14, 0),
      "running",
    );
    const initial = createActivityLayoutSnapshot([running], now);
    const completed = item(
      "sticky-priority",
      new Date(2026, 8, 3, 14, 30),
      "idle",
    );
    const reconciled = reconcileActivityLayoutSnapshot(initial, [completed]);

    expect(
      buildActivitySections(
        [completed],
        reconciled.referenceTime,
        reconciled.placements,
      ).priority.map(({ session }) => session.id),
    ).toEqual([completed.session.id]);

    const reopened = createActivityLayoutSnapshot([completed], now);
    const sections = buildActivitySections(
      [completed],
      reopened.referenceTime,
      reopened.placements,
    );
    expect(sections.priority).toHaveLength(0);
    expect(sections.dates[0].items[0].session.id).toBe(completed.session.id);
  });

  it("promotes newly actionable sessions without treating selection as a layout change", () => {
    const idle = item("promoted-session", new Date(2026, 8, 3, 13, 0), "idle");
    const initial = createActivityLayoutSnapshot([idle], now);
    const selected = item(
      "promoted-session",
      new Date(2026, 8, 3, 13, 0),
      "current",
    );

    expect(reconcileActivityLayoutSnapshot(initial, [selected])).toBe(initial);

    const running = item(
      "promoted-session",
      new Date(2026, 8, 3, 13, 5),
      "running",
    );
    const promoted = reconcileActivityLayoutSnapshot(initial, [running]);
    expect(
      buildActivitySections(
        [running],
        promoted.referenceTime,
        promoted.placements,
      ).priority.map(({ session }) => session.id),
    ).toEqual([running.session.id]);
  });

  it("places a newly created current session directly in priority", () => {
    const initial = createActivityLayoutSnapshot([], now);
    const created = item(
      "new-current-session",
      new Date(2026, 8, 3, 15, 1),
      "current",
    );

    const firstFrame = buildActivitySections(
      [created],
      initial.referenceTime,
      initial.placements,
    );
    expect(firstFrame.priority.map(({ session }) => session.id)).toEqual([
      created.session.id,
    ]);
    expect(firstFrame.dates).toHaveLength(0);

    const reconciled = reconcileActivityLayoutSnapshot(initial, [created]);
    expect(
      buildActivitySections(
        [created],
        reconciled.referenceTime,
        reconciled.placements,
      ).priority.map(({ session }) => session.id),
    ).toEqual([created.session.id]);
  });

  it("uses explicit dates outside the recent six-day window", () => {
    expect(
      formatActivityDateLabel(new Date(2026, 7, 20, 10).toISOString(), now),
    ).toBe("8月20日");
    expect(
      formatActivityDateLabel(new Date(2025, 11, 31, 10).toISOString(), now),
    ).toBe("2025年12月31日");
    expect(formatActivityDateLabel("invalid", now)).toBe("更早");
  });
});
