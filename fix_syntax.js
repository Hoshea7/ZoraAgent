const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/renderer/components/settings/SkillManagerPanel.tsx');
let content = fs.readFileSync(filePath, 'utf8');

content = content.replace(
`  useEffect(() => {
    void refreshInstalled();
    void handleScan();
  }, [refreshInstalled, handleScan]);
    setLoadingDiscovery(true);
    try {
      const result = await window.zora.discoverSkills();
      setDiscoveryResult(result);
    } catch (error) {
      setNotice({ tone: "error", message: getErrorMessage(error) });
    } finally {
      setLoadingDiscovery(false);
    }
  }, []);`,
`  useEffect(() => {
    void refreshInstalled();
    void handleScan();
  }, [refreshInstalled, handleScan]);`
);

fs.writeFileSync(filePath, content, 'utf8');
console.log('Fixed syntax error.');
