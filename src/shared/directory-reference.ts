/** Paths in data/project references use '/' relative to their declared root. */
export type DirectoryReference =
  | { kind: "data"; path: string }
  | { kind: "project"; path: string }
  | { kind: "external"; path: string }
  | { kind: "unbound" };
