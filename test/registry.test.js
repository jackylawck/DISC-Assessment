import { PROFILE_REGISTRY } from '../js/profiles.js';

console.log('--- 正在執行 DISC Profile Registry 完整性檢驗 ---');

const expectedKeys = [
  'D', 'I', 'S', 'C',
  'DI', 'DS', 'DC',
  'ID', 'IS', 'IC',
  'SD', 'SI', 'SC',
  'CD', 'CI', 'CS'
];

const registeredKeys = Object.keys(PROFILE_REGISTRY);
console.log(`已註冊風格數量: ${registeredKeys.length} / 16`);

const missingKeys = expectedKeys.filter(k => !registeredKeys.includes(k));

if (missingKeys.length > 0) {
  console.error('❌ 缺失以下風格配置鍵:', missingKeys);
  process.exit(1);
}

expectedKeys.forEach(k => {
  const profile = PROFILE_REGISTRY[k];
  if (!profile.titleZh || !profile.descZh || !Array.isArray(profile.dos) || !Array.isArray(profile.donts)) {
    console.error(`❌ 風格 [${k}] 配置結構不完整！`);
    process.exit(1);
  }
});

console.log('✅ 所有 16 種 DISC 風格（4 純單一 + 12 有序複合）結構校驗完全通過！');
process.exit(0);
