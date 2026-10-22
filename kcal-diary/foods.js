// 內建常見食物資料（每份的約略值，僅供參考）
// 欄位：name 名稱、unit 份量描述、kcal 熱量、p 蛋白質(g)、c 碳水(g)、f 脂肪(g)、cat 分類、kw 搜尋關鍵字
// 這裡放「一份」為單位的常見外食；以每 100g 計的完整食材資料在 foods-tfda.js（衛福部資料集）。
const FOODS = [
  // 主食
  { name: '白飯', unit: '1 碗（160g）', kcal: 290, p: 5, c: 66, f: 0.5, cat: '主食', kw: 'fan rice 米飯' },
  { name: '糙米飯', unit: '1 碗（160g）', kcal: 290, p: 6, c: 61, f: 2, cat: '主食', kw: 'rice 五穀' },
  { name: '地瓜', unit: '1 條（150g）', kcal: 130, p: 1.5, c: 31, f: 0.2, cat: '主食', kw: '番薯' },
  { name: '饅頭', unit: '1 個（100g）', kcal: 280, p: 8, c: 56, f: 2, cat: '主食', kw: '' },
  { name: '白吐司', unit: '1 片（35g）', kcal: 95, p: 3, c: 17, f: 1.5, cat: '主食', kw: '麵包 土司' },
  { name: '燕麥片', unit: '40g', kcal: 150, p: 5, c: 27, f: 3, cat: '主食', kw: '燕麥 oat' },
  { name: '超商御飯糰', unit: '1 個', kcal: 200, p: 5, c: 40, f: 2, cat: '主食', kw: '飯糰 三角' },

  // 台灣小吃 / 外食
  { name: '滷肉飯', unit: '1 小碗', kcal: 400, p: 12, c: 55, f: 15, cat: '外食', kw: '魯肉飯' },
  { name: '雞腿便當', unit: '1 個', kcal: 850, p: 38, c: 100, f: 32, cat: '外食', kw: '便當' },
  { name: '排骨便當', unit: '1 個', kcal: 900, p: 35, c: 105, f: 36, cat: '外食', kw: '便當' },
  { name: '牛肉麵', unit: '1 碗', kcal: 650, p: 35, c: 75, f: 22, cat: '外食', kw: '紅燒 清燉' },
  { name: '陽春麵', unit: '1 碗', kcal: 350, p: 11, c: 60, f: 7, cat: '外食', kw: '湯麵' },
  { name: '乾麵', unit: '1 碗', kcal: 420, p: 12, c: 62, f: 13, cat: '外食', kw: '麻醬麵 炸醬' },
  { name: '炒飯', unit: '1 盤', kcal: 650, p: 18, c: 85, f: 25, cat: '外食', kw: '蛋炒飯' },
  { name: '炒麵', unit: '1 盤', kcal: 600, p: 16, c: 80, f: 23, cat: '外食', kw: '' },
  { name: '水餃', unit: '1 顆', kcal: 48, p: 2, c: 5, f: 2, cat: '外食', kw: '餃子' },
  { name: '鍋貼', unit: '1 顆', kcal: 60, p: 2, c: 6, f: 3, cat: '外食', kw: '煎餃' },
  { name: '小籠包', unit: '1 顆', kcal: 45, p: 2, c: 4, f: 2.5, cat: '外食', kw: '湯包' },
  { name: '肉圓', unit: '1 顆', kcal: 270, p: 7, c: 40, f: 9, cat: '外食', kw: '' },
  { name: '蚵仔煎', unit: '1 份', kcal: 450, p: 12, c: 50, f: 22, cat: '外食', kw: '蚵仔' },
  { name: '大腸麵線', unit: '1 碗', kcal: 300, p: 9, c: 48, f: 8, cat: '外食', kw: '麵線' },
  { name: '炸雞排', unit: '1 塊', kcal: 620, p: 40, c: 35, f: 35, cat: '外食', kw: '雞排' },
  { name: '鹹酥雞', unit: '1 份（約 150g）', kcal: 500, p: 28, c: 25, f: 32, cat: '外食', kw: '鹽酥雞' },
  { name: '炸臭豆腐', unit: '1 份', kcal: 450, p: 18, c: 25, f: 30, cat: '外食', kw: '臭豆腐' },

  // 早餐
  { name: '蛋餅', unit: '1 份', kcal: 250, p: 9, c: 28, f: 11, cat: '早餐', kw: '' },
  { name: '傳統飯糰', unit: '1 個', kcal: 450, p: 12, c: 65, f: 15, cat: '早餐', kw: '飯糰' },
  { name: '蘿蔔糕', unit: '2 片', kcal: 220, p: 4, c: 30, f: 9, cat: '早餐', kw: '' },
  { name: '燒餅油條', unit: '1 份', kcal: 450, p: 10, c: 50, f: 23, cat: '早餐', kw: '燒餅 油條' },
  { name: '鮪魚蛋三明治', unit: '1 份', kcal: 330, p: 14, c: 32, f: 16, cat: '早餐', kw: '三明治' },
  { name: '漢堡（豬肉蛋）', unit: '1 個', kcal: 420, p: 17, c: 35, f: 23, cat: '早餐', kw: '漢堡' },

  // 蛋白質
  { name: '水煮蛋', unit: '1 顆', kcal: 70, p: 6.5, c: 0.5, f: 5, cat: '蛋白質', kw: '雞蛋 蛋' },
  { name: '茶葉蛋', unit: '1 顆', kcal: 75, p: 7, c: 1, f: 5, cat: '蛋白質', kw: '雞蛋 蛋' },
  { name: '荷包蛋', unit: '1 顆', kcal: 100, p: 6.5, c: 0.5, f: 8, cat: '蛋白質', kw: '煎蛋 雞蛋 蛋' },
  { name: '雞胸肉（熟）', unit: '100g', kcal: 165, p: 31, c: 0, f: 3.6, cat: '蛋白質', kw: '雞肉 舒肥' },
  { name: '鮭魚（熟）', unit: '100g', kcal: 200, p: 22, c: 0, f: 12, cat: '蛋白質', kw: '魚' },
  { name: '板豆腐', unit: '100g', kcal: 85, p: 8, c: 2, f: 5, cat: '蛋白質', kw: '豆腐' },
  { name: '無糖豆漿', unit: '1 杯（400ml）', kcal: 140, p: 13, c: 6, f: 7, cat: '蛋白質', kw: '豆漿' },
  { name: '鮮奶', unit: '1 杯（240ml）', kcal: 150, p: 8, c: 11, f: 8, cat: '蛋白質', kw: '牛奶 全脂' },
  { name: '無糖優格', unit: '100g', kcal: 65, p: 4, c: 5, f: 3, cat: '蛋白質', kw: '優酪 yogurt' },

  // 蔬果
  { name: '燙青菜', unit: '1 份（100g，含油）', kcal: 60, p: 2, c: 4, f: 4, cat: '蔬果', kw: '青菜 蔬菜' },
  { name: '香蕉', unit: '1 根（100g）', kcal: 90, p: 1, c: 23, f: 0.3, cat: '蔬果', kw: '水果' },
  { name: '蘋果', unit: '1 顆（200g）', kcal: 104, p: 0.5, c: 28, f: 0.3, cat: '蔬果', kw: '水果' },
  { name: '芭樂', unit: '半顆（150g）', kcal: 60, p: 1, c: 14, f: 0.3, cat: '蔬果', kw: '水果 番石榴' },

  // 飲料
  { name: '珍珠奶茶（全糖）', unit: '大杯 700ml', kcal: 650, p: 6, c: 110, f: 20, cat: '飲料', kw: '珍奶 手搖' },
  { name: '珍珠奶茶（半糖）', unit: '大杯 700ml', kcal: 500, p: 6, c: 75, f: 20, cat: '飲料', kw: '珍奶 手搖' },
  { name: '無糖綠茶', unit: '1 杯', kcal: 0, p: 0, c: 0, f: 0, cat: '飲料', kw: '茶 手搖' },
  { name: '美式咖啡', unit: '中杯', kcal: 10, p: 0.5, c: 1, f: 0, cat: '飲料', kw: '咖啡 黑咖啡' },
  { name: '拿鐵', unit: '中杯', kcal: 180, p: 9, c: 14, f: 9, cat: '飲料', kw: '咖啡 latte' },
  { name: '可樂', unit: '1 罐（330ml）', kcal: 140, p: 0, c: 35, f: 0, cat: '飲料', kw: '汽水' },
  { name: '啤酒', unit: '1 罐（330ml）', kcal: 140, p: 1, c: 11, f: 0, cat: '飲料', kw: '酒' },

  // 點心
  { name: '綜合堅果', unit: '1 小把（30g）', kcal: 180, p: 5, c: 6, f: 15, cat: '點心', kw: '堅果 杏仁 腰果' },
  { name: '洋芋片', unit: '1 小包（50g）', kcal: 270, p: 3, c: 25, f: 18, cat: '點心', kw: '零食' },
  { name: '黑巧克力', unit: '2 小塊（20g）', kcal: 110, p: 1.5, c: 9, f: 8, cat: '點心', kw: '巧克力' },
];
