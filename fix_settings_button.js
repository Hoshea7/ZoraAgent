const fs = require('fs');
const path = require('path');

const sidebarPath = path.join(__dirname, 'src/renderer/components/sidebar/SidebarFooter.tsx');
let content = fs.readFileSync(sidebarPath, 'utf8');

// Instead of always having a background, we only add it on hover/active
content = content.replace(
`      <button
        type="button"
        onClick={() => setSettingsOpen(!isSettingsOpen)}
        className={\`flex w-full items-center justify-center gap-2.5 rounded-xl px-3 py-2.5 text-center text-[13px] transition \${
          isSettingsOpen
            ? "font-medium text-stone-900 hover:bg-white/70"
            : "text-stone-600 hover:bg-white/45 hover:text-stone-900"
        }\`}
      >`,
`      <button
        type="button"
        onClick={() => setSettingsOpen(!isSettingsOpen)}
        className={\`flex w-full items-center gap-2.5 rounded-[12px] px-3 py-2.5 text-left text-[13px] transition-colors \${
          isSettingsOpen
            ? "font-medium text-stone-900 bg-white/70 shadow-sm ring-1 ring-stone-200/50"
            : "text-stone-500 hover:bg-white/50 hover:text-stone-900"
        }\`}
      >`
);

content = content.replace(
`<span className="font-medium">设置</span>`,
`<span>设置</span>`
);

fs.writeFileSync(sidebarPath, content, 'utf8');
console.log('Settings button updated.');
