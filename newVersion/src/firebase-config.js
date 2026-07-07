/**
 * Firebase 项目配置。
 * 1. 到 https://console.firebase.google.com 创建项目
 * 2. 开启 Realtime Database 与匿名登录(Authentication -> Anonymous)
 * 3. 把"项目设置 -> 常规 -> 你的应用"里的配置粘贴到下面
 * 4. 把仓库中的 database.rules.json 发布为数据库安全规则
 *
 * 留空(null)时,多人联机入口会禁用,单机模式不受影响。
 */

export const firebaseConfig = {
  apiKey: "AIzaSyB6CdxFUaIFWmAmX2bszPYrGY8m55gBTbY",
  authDomain: "xueranzhonglou-6b514.firebaseapp.com",
  databaseURL: "https://xueranzhonglou-6b514-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "xueranzhonglou-6b514",
  storageBucket: "xueranzhonglou-6b514.firebasestorage.app",
  messagingSenderId: "617687688469",
  appId: "1:617687688469:web:b269ad1f23ae0ae3ddf51c"
};

