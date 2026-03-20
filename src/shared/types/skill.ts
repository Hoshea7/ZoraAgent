/** 导入方式 */
export type ImportMethod = "symlink" | "copy";

/** Skill 元数据 */
export interface SkillMeta {
  name: string;
  description: string;
  dirName: string;
  path: string;
}

/** Skill 来源 */
export type SkillSource =
  | { type: "bundled" }
  | { type: "local" }
  | { type: "imported"; fromTool: string; method: ImportMethod; originalPath: string };

/** 已安装 Skill 的注册信息 */
export interface SkillRegistryEntry {
  source: SkillSource;
  installedAt: number;
}

/** Skill 注册表数据 */
export interface SkillRegistryData {
  version: 1;
  skills: Record<string, SkillRegistryEntry>;
}

/** 外部工具配置 */
export interface ExternalToolConfig {
  id: string;
  name: string;
  skillsDirs: string[];
  icon: string;
}

/** 发现的外部 Skill */
export interface DiscoveredSkill {
  name: string;
  description: string;
  dirName: string;
  sourcePath: string;
  sourceTool: string;
  sourceToolName: string;
  alreadyInZora: boolean;
}

/** 发现结果 */
export interface DiscoveryResult {
  tools: Array<{
    tool: ExternalToolConfig;
    exists: boolean;
    skills: DiscoveredSkill[];
  }>;
  totalNew: number;
}

/** 导入选择 */
export interface ImportSelection {
  dirName: string;
  sourcePath: string;
  sourceTool: string;
  method: ImportMethod;
}

/** 导入结果 */
export interface ImportResult {
  dirName: string;
  success: boolean;
  method?: ImportMethod;
  error?: string;
}
