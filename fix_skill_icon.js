const fs = require('fs');
const path = require('path');

const sidebarPath = path.join(__dirname, 'src/renderer/components/sidebar/SidebarFooter.tsx');
let content = fs.readFileSync(sidebarPath, 'utf8');

// The original skill icon was: M13 10V3L4 14h7v7l9-11h-7z (the lightning bolt)
content = content.replace(
`<path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
            />`,
`<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />`
);

fs.writeFileSync(sidebarPath, content, 'utf8');
console.log('Sidebar Skill icon updated.');
