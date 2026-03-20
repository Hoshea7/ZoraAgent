const fs = require('fs');
const path = require('path');

const sidebarPath = path.join(__dirname, 'src/renderer/components/sidebar/SidebarFooter.tsx');
let content = fs.readFileSync(sidebarPath, 'utf8');

// Change alignment from center to left, and align the icon correctly using px-3
// The Settings button uses "px-3"
// Our MCP button has "px-1.5 -ml-1.5" which offsets the left side by -6px.
// If the parent container has "px-3" (12px padding), the left edge of the button hover state starts at 6px, and the SVG starts at 12px.
// This perfectly aligns the MCP SVG with the Settings SVG!
content = content.replace(
  'className="flex items-center justify-center gap-3 px-1 text-[12px] text-stone-500"',
  'className="flex items-center gap-3 px-3 text-[12px] text-stone-500"'
);

fs.writeFileSync(sidebarPath, content, 'utf8');
console.log('SidebarFooter alignment fixed.');
