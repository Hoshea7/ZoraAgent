const fs = require('fs');
const path = require('path');

const sessionListPath = path.join(__dirname, 'src/renderer/components/sidebar/SessionList.tsx');
let content = fs.readFileSync(sessionListPath, 'utf8');

// The little orange dot should probably also not be highlighted if settings is open to match everything else
content = content.replace(
`            <div
              className={cn(
                "h-2 w-2 rounded-full border",
                currentSessionId === session.id
                  ? "border-orange-500 bg-orange-500"
                  : "border-stone-300/90 group-hover:border-stone-400/80"
              )}
            ></div>`,
`            <div
              className={cn(
                "h-2 w-2 rounded-full border",
                currentSessionId === session.id && !isSettingsOpen
                  ? "border-orange-500 bg-orange-500"
                  : "border-stone-300/90 group-hover:border-stone-400/80"
              )}
            ></div>`
);

fs.writeFileSync(sessionListPath, content, 'utf8');
console.log('Dot highlight fixed.');
