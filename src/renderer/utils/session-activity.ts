import type { Session, Workspace } from "../types";

export type ActivitySessionStatus =
  | "needs-input"
  | "running"
  | "current"
  | "idle";

export interface ActivitySessionItem {
  session: Session;
  workspace: Workspace;
  status: ActivitySessionStatus;
}

export interface ActivitySessionPlacement {
  status: ActivitySessionStatus;
  updatedAt: string;
}

export interface ActivityLayoutSnapshot {
  referenceTime: Date;
  placements: ReadonlyMap<string, ActivitySessionPlacement>;
}

export interface ActivityDateSection {
  key: string;
  label: string;
  items: ActivitySessionItem[];
}

export interface ActivitySections {
  priority: ActivitySessionItem[];
  dates: ActivityDateSection[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

function isPriorityStatus(status: ActivitySessionStatus): boolean {
  return status === "needs-input" || status === "running";
}

function normalizePlacementStatus(
  status: ActivitySessionStatus,
): ActivitySessionStatus {
  return status === "current" ? "idle" : status;
}

function placementFromItem(
  item: ActivitySessionItem,
): ActivitySessionPlacement {
  return {
    status: normalizePlacementStatus(item.status),
    updatedAt: item.session.updatedAt,
  };
}

function placementFromNewItem(
  item: ActivitySessionItem,
): ActivitySessionPlacement {
  const placement = placementFromItem(item);
  return item.status === "current"
    ? { ...placement, status: "running" }
    : placement;
}

export function createActivityLayoutSnapshot(
  items: ActivitySessionItem[],
  referenceTime = new Date(),
): ActivityLayoutSnapshot {
  return {
    referenceTime,
    placements: new Map(
      items.map((item) => [item.session.id, placementFromItem(item)]),
    ),
  };
}

export function reconcileActivityLayoutSnapshot(
  snapshot: ActivityLayoutSnapshot,
  items: ActivitySessionItem[],
): ActivityLayoutSnapshot {
  let nextPlacements: Map<string, ActivitySessionPlacement> | null = null;
  const liveSessionIds = new Set<string>();

  const setPlacement = (
    sessionId: string,
    placement: ActivitySessionPlacement,
  ) => {
    nextPlacements ??= new Map(snapshot.placements);
    nextPlacements.set(sessionId, placement);
  };

  for (const item of items) {
    liveSessionIds.add(item.session.id);
    const livePlacement = placementFromItem(item);
    const currentPlacement = snapshot.placements.get(item.session.id);

    if (!currentPlacement) {
      setPlacement(item.session.id, placementFromNewItem(item));
      continue;
    }

    if (
      !isPriorityStatus(currentPlacement.status) &&
      isPriorityStatus(livePlacement.status)
    ) {
      setPlacement(item.session.id, livePlacement);
      continue;
    }
  }

  for (const sessionId of snapshot.placements.keys()) {
    if (!liveSessionIds.has(sessionId)) {
      nextPlacements ??= new Map(snapshot.placements);
      nextPlacements.delete(sessionId);
    }
  }

  if (!nextPlacements) {
    return snapshot;
  }

  return {
    ...snapshot,
    placements: nextPlacements,
  };
}

function getTimestamp(value: string): number {
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function getLocalDaySerial(date: Date): number {
  return Math.floor(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS,
  );
}

function getLocalDayKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

interface PlacedActivitySessionItem {
  item: ActivitySessionItem;
  placement: ActivitySessionPlacement;
}

function compareByFreshness(
  left: PlacedActivitySessionItem,
  right: PlacedActivitySessionItem,
): number {
  const timeDifference =
    getTimestamp(right.placement.updatedAt) -
    getTimestamp(left.placement.updatedAt);
  if (timeDifference !== 0) {
    return timeDifference;
  }

  return left.item.session.id.localeCompare(right.item.session.id);
}

function comparePriorityItems(
  left: PlacedActivitySessionItem,
  right: PlacedActivitySessionItem,
): number {
  const leftOrder = left.placement.status === "needs-input" ? 0 : 1;
  const rightOrder = right.placement.status === "needs-input" ? 0 : 1;
  const statusDifference = leftOrder - rightOrder;

  return statusDifference || compareByFreshness(left, right);
}

export function formatActivityDateLabel(value: string, now: Date): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return "更早";
  }

  const dayDifference = getLocalDaySerial(now) - getLocalDaySerial(date);
  if (dayDifference === 0) {
    return "今天";
  }
  if (dayDifference === 1) {
    return "昨天";
  }
  if (dayDifference >= 2 && dayDifference <= 6) {
    return date.toLocaleDateString("zh-CN", { weekday: "long" });
  }
  if (date.getFullYear() === now.getFullYear()) {
    return `${date.getMonth() + 1}月${date.getDate()}日`;
  }
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

export function buildActivitySections(
  items: ActivitySessionItem[],
  now = new Date(),
  placements?: ReadonlyMap<string, ActivitySessionPlacement>,
): ActivitySections {
  const placedItems = items.map<PlacedActivitySessionItem>((item) => ({
    item,
    placement:
      placements?.get(item.session.id) ??
      (placements ? placementFromNewItem(item) : placementFromItem(item)),
  }));
  const priority = placedItems
    .filter(({ placement }) => isPriorityStatus(placement.status))
    .sort(comparePriorityItems)
    .map(({ item }) => item);
  const dateGroups = new Map<
    string,
    { serial: number; label: string; items: PlacedActivitySessionItem[] }
  >();

  for (const placedItem of placedItems) {
    const { item, placement } = placedItem;
    if (isPriorityStatus(placement.status)) {
      continue;
    }

    const date = new Date(placement.updatedAt);
    const isValidDate = Number.isFinite(date.getTime());
    const key = isValidDate ? getLocalDayKey(date) : "invalid";
    const existing = dateGroups.get(key);

    if (existing) {
      existing.items.push(placedItem);
      continue;
    }

    dateGroups.set(key, {
      serial: isValidDate ? getLocalDaySerial(date) : Number.NEGATIVE_INFINITY,
      label: formatActivityDateLabel(placement.updatedAt, now),
      items: [placedItem],
    });
  }

  const dates = [...dateGroups.entries()]
    .sort(([, left], [, right]) => right.serial - left.serial)
    .map(([key, group]) => ({
      key,
      label: group.label,
      items: group.items.sort(compareByFreshness).map(({ item }) => item),
    }));

  return { priority, dates };
}
