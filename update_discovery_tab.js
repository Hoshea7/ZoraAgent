const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/renderer/components/settings/SkillManagerPanel.tsx');
let content = fs.readFileSync(filePath, 'utf8');

// Update 3: Always trigger discovery on load and show the number in the tab immediately
// We need to modify SkillManagerPanel to load discovery results on mount
content = content.replace(
`  useEffect(() => {
    void refreshInstalled();
  }, [refreshInstalled]);

  const handleScan = useCallback(async () => {`,
`  const handleScan = useCallback(async () => {
    setLoadingDiscovery(true);
    try {
      const result = await window.zora.discoverSkills();
      setDiscoveryResult(result);
    } catch (error) {
      setNotice({ tone: "error", message: getErrorMessage(error) });
    } finally {
      setLoadingDiscovery(false);
    }
  }, []);

  useEffect(() => {
    void refreshInstalled();
    void handleScan();
  }, [refreshInstalled, handleScan]);`
);

// We need to remove the old handleScan that was below the useEffect
content = content.replace(
`  const handleScan = useCallback(async () => {
    setLoadingDiscovery(true);
    try {
      const result = await window.zora.discoverSkills();
      setDiscoveryResult(result);
    } catch (error) {
      setNotice({ tone: "error", message: getErrorMessage(error) });
    } finally {
      setLoadingDiscovery(false);
    }
  }, []);

  const handleOpenDir = useCallback(async (dirName: string) => {`,
`  const handleOpenDir = useCallback(async (dirName: string) => {`
);


// Update the tab title to always show loading or result
content = content.replace(
`        <button
          type="button"
          onClick={() => {
            setTab("discover");
            if (!discoveryResult && !loadingDiscovery) {
              void handleScan();
            }
          }}
          className={cn(
            "rounded-[14px] px-4 py-2 text-[13px] font-medium transition",
            tab === "discover"
              ? "bg-white text-stone-900 shadow-sm ring-1 ring-stone-200"
              : "text-stone-500 hover:text-stone-800"
          )}
        >
          发现 {discoveryResult ? \`(\${discoveryResult.totalNew})\` : ""}
        </button>`,
`        <button
          type="button"
          onClick={() => {
            setTab("discover");
            if (!discoveryResult && !loadingDiscovery) {
              void handleScan();
            }
          }}
          className={cn(
            "rounded-[14px] px-4 py-2 text-[13px] font-medium transition",
            tab === "discover"
              ? "bg-white text-stone-900 shadow-sm ring-1 ring-stone-200"
              : "text-stone-500 hover:text-stone-800"
          )}
        >
          发现 {loadingDiscovery ? "(...)" : discoveryResult ? \`(\${discoveryResult.totalNew})\` : ""}
        </button>`
);

fs.writeFileSync(filePath, content, 'utf8');
console.log('Update script 2 completed.');
