const fs = require('fs');
const path = require('path');

const sidebarPath = path.join(__dirname, 'src/renderer/components/sidebar/SidebarFooter.tsx');
let sidebarContent = fs.readFileSync(sidebarPath, 'utf8');

// Update to ensure the button behaves exactly like the previous non-button, but has cursor pointer and hover background/text
sidebarContent = sidebarContent.replace(
`<button
          onClick={() => {
            setSettingsTab("mcp");
            setSettingsOpen(true);
          }}
          className="flex items-center gap-1.5 hover:text-stone-800 transition-colors"
        >`,
`<button
          onClick={() => {
            setSettingsTab("mcp");
            setSettingsOpen(true);
          }}
          className="flex items-center gap-1.5 hover:text-stone-800 transition-colors rounded px-1 -ml-1 py-0.5 hover:bg-stone-200/50"
        >`
);

sidebarContent = sidebarContent.replace(
`<button
          onClick={() => {
            setSettingsTab("skills");
            setSettingsOpen(true);
          }}
          className="flex items-center gap-1.5 hover:text-stone-800 transition-colors"
        >`,
`<button
          onClick={() => {
            setSettingsTab("skills");
            setSettingsOpen(true);
          }}
          className="flex items-center gap-1.5 hover:text-stone-800 transition-colors rounded px-1 -mr-1 py-0.5 hover:bg-stone-200/50"
        >`
);

fs.writeFileSync(sidebarPath, sidebarContent, 'utf8');
console.log('Sidebar footer hover states updated.');
