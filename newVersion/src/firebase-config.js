/**
 * Firebase 项目配置。
 * 1. 到 https://console.firebase.google.com 创建项目
 * 2. 开启 Realtime Database 与匿名登录(Authentication -> Anonymous)
 * 3. 把"项目设置 -> 常规 -> 你的应用"里的配置粘贴到下面
 * 4. 把仓库中的 database.rules.json 发布为数据库安全规则
 *
 * 留空(null)时,多人联机入口会禁用,单机模式不受影响。
 */
export const firebaseConfig = null;

/* 示例:
export const firebaseConfig = {
  apiKey: "AIza....",
  authDomain: "your-app.firebaseapp.com",
  databaseURL: "https://your-app-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "your-app",
  storageBucket: "your-app.appspot.com",
  messagingSenderId: "1234567890",
  appId: "1:1234567890:web:abcdef"
};
*/
