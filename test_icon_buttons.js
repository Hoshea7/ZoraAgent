const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/renderer/components/settings/SkillManagerPanel.tsx');
let content = fs.readFileSync(filePath, 'utf8');

// Note: I already updated the texts in fix_texts_and_icons.js, let me verify the strings:
// "已安装技能" was changed from "全部已安装技能"
// "未导入的新技能" was changed from "展开未导入的新技能"
// "已在本地的重复技能" was changed from "展开已在本地的重复技能"
// "打开目录" and "卸载" were already changed to icon buttons in fix_texts_and_icons.js.
// "导入" was already changed to icon button in fix_texts_and_icons.js.
// Let's verify by regex matching the new strings.
console.log('Texts:');
console.log(content.match(/<SkillGroup title="已安装技能"/g));
console.log(content.match(/<SkillGroup title="未导入的新技能"/g));
console.log(content.match(/<SkillGroup title="已在本地的重复技能"/g));

console.log('Icons:');
console.log(content.match(/title="打开技能目录"/g));
console.log(content.match(/title={uninstalling \? "卸载中..." : "卸载技能"}/g));
console.log(content.match(/title={importing \? "导入中..." : "导入技能"}/g));
