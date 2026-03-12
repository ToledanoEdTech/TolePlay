# מדריך פריסה ב-Render (TolePlay)

הפרויקט ייפרס **במקום אחד** – הפרונט והבקאנד יחד. אין צורך ב-VITE_SOCKET_URL כי הכל על אותו שרת.

---

## שלב 1: הכנה – דחיפה ל-GitHub

ודא שכל הקוד נמצא ב-GitHub:

```bash
git add .
git commit -m "Prepare for Render deployment"
git push origin main
```

---

## שלב 2: יצירת חשבון וחיבור הריפו

1. היכנס ל-[render.com](https://render.com)
2. לחץ **"Get Started for Free"** והתחבר עם **GitHub**
3. אשר גישה ל-Render לצפייה בריפוז שלך

---

## שלב 3: יצירת Web Service

1. בדשבורד, לחץ **"New +"** → **"Web Service"**
2. בחר את ריפו **TolePlay** (אם לא מופיע – לחץ "Configure account" וחבר את הריפו)
3. לחץ **"Connect"**

---

## שלב 4: הגדרות הפרויקט

מלא את השדות הבאים:

| שדה | ערך |
|-----|-----|
| **Name** | `toleplay` (או כל שם שתרצה) |
| **Region** | בחר את האזור הקרוב אליך |
| **Branch** | `main` |
| **Runtime** | `Node` |
| **Build Command** | `npm install && npm run build` |
| **Start Command** | `npm run start:prod` |
| **Instance Type** | **Free** |

---

## שלב 5: משתני סביבה (Environment Variables)

לחץ **"Advanced"** ואז **"Add Environment Variable"**. הוסף:

### חובה (להפעלת השרת)

| Key | Value |
|-----|-------|
| `NODE_ENV` | `production` |

**הערה:** `PORT` – Render מזין אוטומטית, אל תוסיף.

### אופציונלי – Firebase (לשמירת חדרים ותוצאות)

אם יש לך Firebase, הוסף:

| Key | Value |
|-----|-------|
| `FIREBASE_DATABASE_URL` | `https://YOUR-PROJECT-default-rtdb.firebaseio.com` |
| `FIREBASE_SERVICE_ACCOUNT` | כל תוכן קובץ ה-JSON של ה-Service Account |

**איך להשיג את FIREBASE_SERVICE_ACCOUNT:**
1. Firebase Console → Project Settings → Service Accounts
2. "Generate new private key" → הורד את הקובץ
3. פתח את הקובץ והעתק **את כל התוכן** (מ-`{` עד `}`)
4. הדבק בשדה Value

**אם לא תגדיר Firebase:** האתר יעבוד, אבל חדרים לא יישמרו ב-DB (רק בזיכרון).

### אופציונלי – Firebase Client (לאימות ושמירת קוויזים)

משתנים אלה נדרשים רק אם אתה משתמש ב-Firebase Auth או שמירת קוויזים בדפדפן.  
**חשוב:** משתנים שמתחילים ב-`VITE_` חייבים להיות מוגדרים **בזמן ה-build**. ב-Render, הוסף אותם כ-Environment Variables – הם יישמרו גם ל-build.

| Key | Value |
|-----|-------|
| `VITE_FIREBASE_API_KEY` | (מ-Firebase Console) |
| `VITE_FIREBASE_AUTH_DOMAIN` | `YOUR-PROJECT.firebaseapp.com` |
| `VITE_FIREBASE_DATABASE_URL` | `https://YOUR-PROJECT-default-rtdb.firebaseio.com` |
| `VITE_FIREBASE_PROJECT_ID` | מזהה הפרויקט |
| `VITE_FIREBASE_STORAGE_BUCKET` | `YOUR-PROJECT.appspot.com` |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | מספר |
| `VITE_FIREBASE_APP_ID` | מזהה האפליקציה |

**איפה למצוא:** Firebase Console → Project Settings → Your apps → העתק את הערכים.

---

## שלב 6: פריסה

1. לחץ **"Create Web Service"**
2. Render יתחיל לבנות את הפרויקט (כ־2–5 דקות)
3. בסיום תקבל כתובת כמו: `https://toleplay-xxxx.onrender.com`

---

## שלב 7: Firebase – דומיין מורשה (אם משתמש ב-Auth)

אם השתמשת ב-Firebase Authentication:

1. Firebase Console → Authentication → **Settings** → **Authorized domains**
2. לחץ **"Add domain"**
3. הוסף: `toleplay-xxxx.onrender.com` (ההחלף ב-URL האמיתי שלך)

---

## טיפים

### Cold Start
בתוכנית החינמית, השרת "נרדם" אחרי כ־15 דקות ללא גישה.  
בכניסה ראשונה אחרי זה הטעינה יכולה לקחת 30–60 שניות. זה התנהגות רגילה.

### עדכונים
כל `git push` ל-main יגרום ל-Render לפרוס גרסה חדשה אוטומטית.

### לוגים
ב-Render → **Logs** תוכל לראות את פלט השרת ולזהות שגיאות.

---

## סיכום – רשימת צ'ק

- [ ] קוד על GitHub
- [ ] Web Service חדש ב-Render
- [ ] Build Command: `npm install && npm run build`
- [ ] Start Command: `npm run start:prod`
- [ ] `NODE_ENV=production`
- [ ] (אופציונלי) משתני Firebase
- [ ] (אופציונלי) דומיין Render ב-Firebase Authorized domains
