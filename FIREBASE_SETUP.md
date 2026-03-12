# הגדרת Firebase עבור TolePlay

מדריך זה מסביר מה צריך להגדיר ב-Firebase Console כדי שהתכונות הבאות יעבדו:
- **התחברות** – Google + אימייל/סיסמה
- **שמירת חידונים** – שמירה וטעינה של חידונים למשתמשים מחוברים

---

## 1. יצירת פרויקט Firebase (אם עדיין לא קיים)

1. היכנס ל-[Firebase Console](https://console.firebase.google.com/)
2. לחץ **Add project** (או בחר פרויקט קיים)
3. עקוב אחרי השלבים ליצירת הפרויקט

---

## 2. הפעלת Authentication

1. בתפריט הצד: **Build** → **Authentication**
2. לחץ **Get started**
3. בכרטיסייה **Sign-in method**:
   - **Google** – לחץ Enable והגדר את ה-Project support email
   - **Email/Password** – לחץ Enable (סמן את שני התיבות)

---

## 3. הגדרת Realtime Database

1. בתפריט הצד: **Build** → **Realtime Database**
2. אם עדיין לא נוצר – לחץ **Create Database**
3. בחר מיקום (למשל `europe-west1`)
4. בחר **Start in test mode** (או **locked mode** – ואז הגדר Rules ידנית)

### כללי אבטחה (Rules)

עבור שמירת חידונים, יש להגדיר Rules כך שמשתמש מחובר יוכל לקרוא ולכתוב רק את הנתונים שלו:

1. עבור ל-**Rules**
2. החלף את התוכן ב:

```json
{
  "rules": {
    "rooms": {
      ".read": true,
      ".write": true
    },
    "gameHistory": {
      ".read": true,
      ".write": true
    },
    "users": {
      "$uid": {
        ".read": "auth != null && auth.uid == $uid",
        ".write": "auth != null && auth.uid == $uid"
      }
    }
  }
}
```

- `rooms` ו-`gameHistory` – לשימוש השרת (כבר קיים בפרויקט)
- `users/{uid}` – כל משתמש יכול לקרוא/לכתוב רק את הנתונים שלו

3. לחץ **Publish**

---

## 4. הוספת אפליקציית Web

1. בתפריט הצד: **Project settings** (גלגל השיניים)
2. בגלילה למטה: **Your apps** → לחץ על אייקון **</>** (Web)
3. הזן שם אפליקציה (למשל `TolePlay`) ולחץ **Register app**
4. העתק את ערכי `firebaseConfig` – תצטרך אותם לקובץ `.env`

---

## 5. משתני סביבה (.env)

צור קובץ `.env` בשורש הפרויקט (או עדכן את `.env.example` והעתק ל-`.env`):

```env
# Firebase - שרת (כבר קיים)
FIREBASE_DATABASE_URL="https://YOUR-PROJECT-ID-default-rtdb.firebaseio.com"
FIREBASE_SERVICE_ACCOUNT_PATH="./firebase-service-account.json"

# Firebase - לקוח (חדש - להתחברות ושמירת חידונים)
VITE_FIREBASE_API_KEY="AIza..."
VITE_FIREBASE_AUTH_DOMAIN="YOUR-PROJECT-ID.firebaseapp.com"
VITE_FIREBASE_DATABASE_URL="https://YOUR-PROJECT-ID-default-rtdb.firebaseio.com"
VITE_FIREBASE_PROJECT_ID="YOUR-PROJECT-ID"
VITE_FIREBASE_STORAGE_BUCKET="YOUR-PROJECT-ID.appspot.com"
VITE_FIREBASE_MESSAGING_SENDER_ID="123456789"
VITE_FIREBASE_APP_ID="1:123456789:web:abc123"
```

הערכים נמצאים ב-**Project settings** → **Your apps** → **SDK setup and configuration** → **Config**.

---

## 6. הוספת דומיין מורשה ל-Google Sign-In

1. ב-**Authentication** → **Sign-in method** → **Google**
2. ב-**Authorized domains** וודא שמופיעים:
   - `localhost` (לפיתוח)
   - הדומיין של האתר (לפרודקשן, למשל `your-app.vercel.app`)

---

## 7. קובץ Service Account (לשרת)

לשמירת חדרים והיסטוריה בשרת:

1. **Project settings** → **Service accounts**
2. לחץ **Generate new private key**
3. שמור את הקובץ כ-`firebase-service-account.json` בשורש הפרויקט
4. הוסף ל-`.gitignore` (כבר קיים) – **אל תעלה את הקובץ ל-Git**

---

## סיכום – מה חייב להיות מוגדר

| רכיב | נדרש ל |
|------|--------|
| Authentication – Google | התחברות עם Google |
| Authentication – Email/Password | הרשמה והתחברות באימייל |
| Realtime Database | שמירת חידונים |
| Rules – `users` | גישה מאובטחת לנתוני המשתמש |
| `VITE_FIREBASE_*` ב-.env | התחברות ושמירה בצד הלקוח |
| `firebase-service-account.json` | שמירת חדרים והיסטוריה בצד השרת |

אם חסר אחד מהדברים – התכונה הרלוונטית לא תעבוד, אבל שאר האפליקציה תמשיך לעבוד (למשל בלי התחברות – עדיין אפשר להעלות CSV ולשחק).
