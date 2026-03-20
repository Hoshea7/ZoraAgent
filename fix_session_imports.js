const fs = require('fs');
const path = require('path');

const sessionListPath = path.join(__dirname, 'src/renderer/components/sidebar/SessionList.tsx');
let content = fs.readFileSync(sessionListPath, 'utf8');

// Make sure useAtomValue is imported from jotai
content = content.replace(
`import { useAtom, useSetAtom } from "jotai";`,
`import { useAtom, useSetAtom, useAtomValue } from "jotai";`
);

fs.writeFileSync(sessionListPath, content, 'utf8');
console.log('Imports fixed.');
