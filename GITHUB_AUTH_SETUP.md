# התחברות ל-GitHub – פעם אחת, ואז Cursor יוכל לדחוף בעצמו

כדי שאפשר יהיה להריץ `git push` מהסביבה (כולל כשתבקש "תעדכן בעצמך בגיטהב"), צריך שהמחשב שלך יהיה מחובר ל-GitHub **פעם אחת**. אחרי זה ההתחברות נשמרת.

---

## אפשרות 1: GitHub CLI (מומלץ – הכי פשוט)

1. **התקנת GitHub CLI ב-Windows**  
   - פתח PowerShell **כ־מנהל** והרץ:
   ```powershell
   winget install GitHub.cli
   ```
   - או הורד מהאתר: https://cli.github.com/

2. **התחברות ל-GitHub**  
   - סגור ופתח מחדש את הטרמינל (או את Cursor).  
   - הרץ:
   ```powershell
   gh auth login
   ```
   - בחר: **GitHub.com** → **HTTPS** → **Yes** (authenticate Git with GitHub credentials) → **Login with a web browser**.  
   - העתק את הקוד שמופיע, לחץ Enter, ובדפדפן היכנס לחשבון GitHub ואישר.

3. **סיום**  
   - אחרי שההתחברות הצליחה, כל `git push` (כולל מהסביבה של Cursor) ישתמש באותן credentials ולא יבקש שוב.

---

## אפשרות 2: Personal Access Token (בלי להתקין כלים)

1. **יצירת Token ב-GitHub**  
   - גלוש ל: https://github.com/settings/tokens  
   - **Generate new token** → **Generate new token (classic)**  
   - תן שם (למשל "TolePlay"), סמן scope: **repo**  
   - **Generate token** והעתק את ה-token (מופיע פעם אחת בלבד).

2. **דחיפה ראשונה עם ה-Token**  
   - בטרמינל (PowerShell או Cursor):
   ```powershell
   cd "c:\Users\matan\Desktop\TolePlay\TolePlay"
   git push origin main
   ```
   - כשיתבקש **Username**: הכנס את שם המשתמש ב-GitHub.  
   - כשיתבקש **Password**: הדבק את ה-**Token** (לא את סיסמת החשבון).

3. **שמירה**  
   - Windows ישמור את ההתחברות ב-Credential Manager. מהפעם הבאה `git push` יעבוד בלי להקליד שוב.

---

## איך בודקים שזה עובד

אחרי שעשית **אחת** מהאפשרויות, הרץ בטרמינל:

```powershell
cd "c:\Users\matan\Desktop\TolePlay\TolePlay"
git push origin main
```

אם הדחיפה מצליחה – ההתקנה תקינה, ומכאן ואילך אפשר לבקש "תעדכן בעצמך בגיטהב" והפקודה תצליח.

---

**הערה:** ה-remote של הפרויקט הוגדר ל-HTTPS (`https://github.com/...`) כדי שההתחברות תעבוד עם שני המנגנונים האלה.
