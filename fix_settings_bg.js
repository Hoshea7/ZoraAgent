const fs = require('fs');
const path = require('path');

const sidebarPath = path.join(__dirname, 'src/renderer/components/sidebar/SidebarFooter.tsx');
let content = fs.readFileSync(sidebarPath, 'utf8');

// Instead of maintaining active styling, it just acts as a regular hover button 
// no matter if settings is open or not. So no `isSettingsOpen ? ... : ...`.
content = content.replace(
`      <button
        type="button"
        onClick={() => setSettingsOpen(!isSettingsOpen)}
        className={\`flex w-full items-center gap-2.5 rounded-[12px] px-3 py-2.5 text-left text-[13px] transition-colors \${
          isSettingsOpen
            ? "font-medium text-stone-900 bg-white/70 shadow-sm ring-1 ring-stone-200/50"
            : "text-stone-500 hover:bg-white/50 hover:text-stone-900"
        }\`}
      >`,
`      <button
        type="button"
        onClick={() => setSettingsOpen(!isSettingsOpen)}
        className="flex w-full items-center gap-2.5 rounded-[12px] px-3 py-2.5 text-left text-[13px] text-stone-500 transition-colors hover:bg-white/50 hover:text-stone-900"
      >`
);

content = content.replace(
`        <svg
          className={\`h-4 w-4 \${isSettingsOpen ? "text-stone-700" : "text-stone-500"}\`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >`,
`        <svg
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >`
);

fs.writeFileSync(sidebarPath, content, 'utf8');
console.log('Settings button background fixed.');
