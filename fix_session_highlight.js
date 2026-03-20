const fs = require('fs');
const path = require('path');

const sessionListPath = path.join(__dirname, 'src/renderer/components/sidebar/SessionList.tsx');
let content = fs.readFileSync(sessionListPath, 'utf8');

// The logic is in renderSession, we need to make it consider `isSettingsOpen`
content = content.replace(
`      className={cn(
        "group relative flex items-center gap-2.5 rounded-[16px] border px-3 py-2.5 transition-all duration-200",
        currentSessionId === session.id
          ? cn(
              "border-stone-200/80 bg-white shadow-[0_2px_10px_rgba(28,25,23,0.05)]"
            )
          : cn(
              "border-transparent bg-transparent",
              "hover:border-stone-200/55 hover:bg-white/50"
            )
      )}`,
`      className={cn(
        "group relative flex items-center gap-2.5 rounded-[16px] border px-3 py-2.5 transition-all duration-200",
        currentSessionId === session.id && !isSettingsOpen
          ? cn(
              "border-stone-200/80 bg-white shadow-[0_2px_10px_rgba(28,25,23,0.05)]"
            )
          : cn(
              "border-transparent bg-transparent",
              "hover:border-stone-200/55 hover:bg-white/50"
            )
      )}`
);

content = content.replace(
`              <div
                className={cn(
                  "truncate text-[14px] leading-[1.3]",
                  currentSessionId === session.id
                    ? "font-medium text-stone-900"
                    : "font-normal text-stone-700 group-hover:text-stone-900"
                )}
              >`,
`              <div
                className={cn(
                  "truncate text-[14px] leading-[1.3]",
                  currentSessionId === session.id && !isSettingsOpen
                    ? "font-medium text-stone-900"
                    : "font-normal text-stone-700 group-hover:text-stone-900"
                )}
              >`
);

content = content.replace(
`  const [renameValue, setRenameValue] = useState("");`,
`  const [renameValue, setRenameValue] = useState("");
  const isSettingsOpen = useAtomValue(isSettingsOpenAtom);`
);

fs.writeFileSync(sessionListPath, content, 'utf8');
console.log('Session List highlight fixed.');
