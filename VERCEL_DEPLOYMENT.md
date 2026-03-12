# מדריך פריסה ל-Vercel (TolePlay)

הפרויקט מורכב משני חלקים:
- **פרונט (Frontend)**: React + Vite – ייפרס ב-**Vercel**
- **בקאנד (Backend)**: Express + Socket.IO – ייפרס ב-**Railway** או **Render** (Vercel לא תומך ב-WebSockets ארוכי טווח)

---

## שלב 1: פריסת הבקאנד (Railway מומלץ)

### 1.1 יצירת חשבון Railway
1. היכנס ל-[railway.app](https://railway.app) והתחבר עם GitHub
2. לחץ על **"New Project"** → **"Deploy from GitHub repo"**
3. בחר את ריפו TolePlay

### 1.2 הגדרת הפרויקט
1. ב-Railway, בחר את הפרויקט שנוצר
2. עבור ל-**Variables** והוסף את המשתנים הבאים:

| משתנה | ערך | הערות |
|-------|-----|-------|
| `NODE_ENV` | `production` | חובה |
| `PORT` | (אוטומטי) | Railway מזין אוטומטית |
| `FIREBASE_DATABASE_URL` | `https://YOUR-PROJECT-default-rtdb.firebaseio.com` | מ-Firebase Console |
| `FIREBASE_SERVICE_ACCOUNT` | (ראה להלן) | JSON כמחרוזת |

### 1.3 Firebase Service Account
1. ב-Firebase Console → Project Settings → Service Accounts
2. לחץ **"Generate new private key"** והורד את קובץ ה-JSON
3. פתח את הקובץ, העתק את **כל התוכן** (מ-`{` עד `}`)
4. ב-Railway → **Variables** → **Add Variable**:
   - **Name**: `FIREBASE_SERVICE_ACCOUNT`
   - **Value**: הדבק את כל ה-JSON (מחרוזת אחת)

**הערה:** אם לא תגדיר Firebase – האפליקציה תעבוד בלי שמירת חדרים ל-DB (רק בזיכרון, החדרים ייעלמו כשהשרת יופעל מחדש).

### 1.4 הגדרת Build & Start
ב-Railway → **Settings**:
- **Build Command**: `npm run build`
- **Start Command**: `npm run start:prod`
- **Root Directory**: (השאר ריק – שורש הפרויקט)

### 1.5 קבלת כתובת הבקאנד
לאחר הפריסה, Railway יציג URL כמו: `https://toleplay-production-xxxx.up.railway.app`  
**שמור את הכתובת הזו** – תצטרך אותה ל-Vercel.

---

## שלב 2: פריסת הפרונט ב-Vercel

### 2.1 חיבור הריפו
1. היכנס ל-[vercel.com](https://vercel.com) והתחבר עם GitHub
2. לחץ **"Add New"** → **"Project"**
3. ייבא את ריפו TolePlay
4. Vercel יזהה אוטומטית את Vite – אשר את ההגדרות

### 2.2 משתני סביבה (Environment Variables)
ב-Vercel → **Settings** → **Environment Variables** הוסף:

| משתנה | ערך | הערות |
|-------|-----|-------|
| `VITE_SOCKET_URL` | `https://YOUR-RAILWAY-URL.up.railway.app` | כתובת הבקאנד מ-Railway (ללא סלאש בסוף) |
| `VITE_FIREBASE_API_KEY` | (מ-Firebase Console) | |
| `VITE_FIREBASE_AUTH_DOMAIN` | `YOUR-PROJECT.firebaseapp.com` | |
| `VITE_FIREBASE_DATABASE_URL` | `https://YOUR-PROJECT-default-rtdb.firebaseio.com` | |
| `VITE_FIREBASE_PROJECT_ID` | מזהה הפרויקט | |
| `VITE_FIREBASE_STORAGE_BUCKET` | `YOUR-PROJECT.appspot.com` | |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | מספר | |
| `VITE_FIREBASE_APP_ID` | מזהה האפליקציה | |

**איפה למצוא את ערכי Firebase?**  
Firebase Console → Project Settings → Your apps → בחר את האפליקציה (או צור חדשה) → העתק את הערכים.

### 2.3 פריסה
לחץ **Deploy**. Vercel יבנה את הפרויקט ויפרוס אותו.

---

## שלב 3: CORS ו-Firebase (אם נדרש)

אם יש בעיות חיבור:
1. **Firebase Console** → Authentication → Authorized domains → הוסף את דומיין ה-Vercel (למשל `toleplay.vercel.app`)
2. **Railway**: Socket.IO מוגדר עם `cors: { origin: "*" }` – אמור לעבוד מכל מקור

---

## סיכום – מה לעשות

1. **Railway**: פרוס את הבקאנד, שמור את ה-URL
2. **Vercel**: הוסף `VITE_SOCKET_URL` עם כתובת Railway, הוסף את משתני Firebase, ופרוס
3. **Firebase**: הוסף את דומיין Vercel ל-Authorized domains

---

## פיתוח מקומי עם פרונט ובקאנד נפרדים

אם אתה רוצה להריץ פרונט על Vercel preview ובקאנד על Railway:
- הגדר `VITE_SOCKET_URL` ב-Vercel Preview ל-URL של Railway
- בפיתוח מקומי (`npm run dev`) – הפרונט והבקאנד על אותו פורט, אין צורך ב-`VITE_SOCKET_URL`
