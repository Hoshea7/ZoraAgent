const fs = require('fs');
const path = require('path');

const sidebarPath = path.join(__dirname, 'src/renderer/components/sidebar/SidebarFooter.tsx');
let content = fs.readFileSync(sidebarPath, 'utf8');

// Center align MCP and Skills status
content = content.replace(
`<div className="flex items-center gap-3 px-1 text-[12px] text-stone-500">`,
`<div className="flex items-center justify-center gap-3 px-1 text-[12px] text-stone-500">`
);

// Remove persistent bubble from settings
content = content.replace(
`className={\`flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-[13px] transition \${
          isSettingsOpen
            ? "bg-white/70 font-medium text-stone-900 shadow-[0_2px_8px_rgba(28,25,23,0.04)] ring-1 ring-stone-200/70"
            : "text-stone-600 hover:bg-white/45 hover:text-stone-900"
        }\`}`,
`className={\`flex w-full items-center justify-center gap-2.5 rounded-xl px-3 py-2.5 text-center text-[13px] transition \${
          isSettingsOpen
            ? "font-medium text-stone-900 hover:bg-white/70"
            : "text-stone-600 hover:bg-white/45 hover:text-stone-900"
        }\`}`
);

// Just remove the bubble, center text and icon
content = content.replace(
`<span>设置</span>`,
`<span className="font-medium">设置</span>`
);

fs.writeFileSync(sidebarPath, content, 'utf8');
console.log('Sidebar Footer updated.');
