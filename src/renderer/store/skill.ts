import { atom } from "jotai";
import type { SkillMeta } from "../../shared/zora";

export const skillsAtom = atom<SkillMeta[]>([]);

export const loadSkillsAtom = atom(null, async (_get, set) => {
  const skills = await window.zora.listSkills();
  set(skillsAtom, skills);
});
