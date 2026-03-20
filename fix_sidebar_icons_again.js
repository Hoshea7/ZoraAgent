const fs = require('fs');
const path = require('path');

const sidebarPath = path.join(__dirname, 'src/renderer/components/sidebar/SidebarFooter.tsx');
let content = fs.readFileSync(sidebarPath, 'utf8');

// The MCP icon in SidebarFooter is using the bolt icon (M13 10V3L4...). Let's change it back to the proper MCP icon (the one in SettingsPanel: M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4)
content = content.replace(
`<path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M13 10V3L4 14h7v7l9-11h-7z"
            />`,
`<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />`
);

// The MCP hover button styling
content = content.replace(
`className="flex items-center gap-1.5 hover:text-stone-800 transition-colors rounded px-1 -ml-1 py-0.5 hover:bg-stone-200/50"`,
`className="flex items-center gap-1.5 hover:text-stone-800 transition-colors rounded px-1.5 -ml-1.5 py-0.5 hover:bg-stone-200/50"`
);

// The Skills hover button styling
content = content.replace(
`className="flex items-center gap-1.5 hover:text-stone-800 transition-colors rounded px-1 -mr-1 py-0.5 hover:bg-stone-200/50"`,
`className="flex items-center gap-1.5 hover:text-stone-800 transition-colors rounded px-1.5 -mr-1.5 py-0.5 hover:bg-stone-200/50"`
);

fs.writeFileSync(sidebarPath, content, 'utf8');
console.log('Sidebar icons updated.');
