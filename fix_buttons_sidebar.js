const fs = require('fs');
const path = require('path');

const sidebarPath = path.join(__dirname, 'src/renderer/components/sidebar/SidebarFooter.tsx');
let sidebarContent = fs.readFileSync(sidebarPath, 'utf8');

// Restore original Sidebar MCP layout
sidebarContent = sidebarContent.replace(
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
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M13 10V3L4 14h7v7l9-11h-7z"
            />
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
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <span>{skills.length} {skills.length === 1 ? "Skill" : "Skills"}</span>
        </button>
      </div>`
);

fs.writeFileSync(sidebarPath, sidebarContent, 'utf8');
console.log('Sidebar Footer updated.');
