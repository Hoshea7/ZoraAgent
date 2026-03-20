const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/renderer/components/sidebar/SidebarFooter.tsx');
let content = fs.readFileSync(filePath, 'utf8');

content = content.replace(
`import { isSettingsOpenAtom } from "../../store/ui";

/**
 * 侧边栏底部组件
 * 显示 MCP 和 Skills 状态，以及设置按钮
 */
export function SidebarFooter() {
  const skills = useAtomValue(skillsAtom);
  const loadSkills = useSetAtom(loadSkillsAtom);
  const isSettingsOpen = useAtomValue(isSettingsOpenAtom);
  const setSettingsOpen = useSetAtom(isSettingsOpenAtom);`,
`import { isSettingsOpenAtom, settingsTabAtom } from "../../store/ui";

/**
 * 侧边栏底部组件
 * 显示 MCP 和 Skills 状态，以及设置按钮
 */
export function SidebarFooter() {
  const skills = useAtomValue(skillsAtom);
  const loadSkills = useSetAtom(loadSkillsAtom);
  const isSettingsOpen = useAtomValue(isSettingsOpenAtom);
  const setSettingsOpen = useSetAtom(isSettingsOpenAtom);
  const setSettingsTab = useSetAtom(settingsTabAtom);`
);

content = content.replace(
`      <div className="flex items-center gap-1.5 px-1 text-[12px] text-stone-500 font-medium">
        <svg
          className="h-3.5 w-3.5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M13 10V3L4 14h7v7l9-11h-7z"
          />
        </svg>
        <span>0 MCP &middot; {skills.length} Skills</span>
      </div>`,
`      <div className="flex items-center gap-3 px-1 text-[12px] text-stone-500">
        <button
          onClick={() => {
            setSettingsTab("mcp");
            setSettingsOpen(true);
          }}
          className="flex items-center gap-1.5 hover:text-stone-800 transition-colors"
        >
          <svg
            className="h-3.5 w-3.5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
          </svg>
          <span>0 MCP</span>
        </button>
        
        <span className="h-1 w-1 rounded-full bg-stone-300"></span>
        
        <button
          onClick={() => {
            setSettingsTab("skills");
            setSettingsOpen(true);
          }}
          className="flex items-center gap-1.5 hover:text-stone-800 transition-colors"
        >
          <svg
            className="h-3.5 w-3.5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          <span>{skills.length} {skills.length === 1 ? "Skill" : "Skills"}</span>
        </button>
      </div>`
);

fs.writeFileSync(filePath, content, 'utf8');
console.log('Sidebar footer updated.');
