// ============================================================
// البيان للتسويق | الاتصال بـ Firebase
// استخدمه في صفحات HTML هكذا:
//   <script type="module">
//     import { db, auth, getCurrentUser } from './firebase-init.js';
//   </script>
// ============================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// إعدادات مشروع Firebase الخاص بـ البيان للتسويق (al-buan)
const firebaseConfig = {
  apiKey:            "AIzaSyArIbWoGUgpoqQ1gUGR3yCcAuVzAKU9CK4",
  authDomain:        "al-buan.firebaseapp.com",
  projectId:         "al-buan",
  storageBucket:     "al-buan.firebasestorage.app",
  messagingSenderId: "194813830749",
  appId:             "1:194813830749:web:b8f89cbd880680326f0fb4"
};

const app  = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db   = getFirestore(app);
export { serverTimestamp };

// ---------- تسجيل الدخول والخروج ----------
export const login  = (email, password) => signInWithEmailAndPassword(auth, email, password);
export const logout = () => signOut(auth);

// ---------- المستخدم الحالي مع دوره (admin / manager / cashier) ----------
export function getCurrentUser() {
  return new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      unsub();
      if (!user) return resolve(null);
      const snap = await getDoc(doc(db, "users", user.uid));
      if (!snap.exists() || snap.data().isActive !== true) return resolve(null);
      resolve({ uid: user.uid, email: user.email, ...snap.data() });
    });
  });
}

// ---------- تهيئة أولية (تُشغَّل مرة واحدة من حساب admin) ----------
export async function seedCompanySettings() {
  await setDoc(doc(db, "company_settings", "main"), {
    nameAr: "البيان للتسويق",
    logoUrl: "logo.jpg",       // ملف الشعار بجانب صفحات النظام
    phone: "",
    address: "",
    currency: "ج.س",
    invoiceFooter: "شكراً لتعاملكم معنا",
    updatedAt: serverTimestamp()
  }, { merge: true });
}

// ============================================================
// إنشاء أول مدير للنظام (يدوياً مرة واحدة):
// 1) Firebase Console > Authentication > Add user (بريد + كلمة سر)
// 2) انسخ الـ UID، ثم Firestore > Start collection "users"
//    Document ID = الـ UID، وبه الحقول:
//      fullName: "اسمك"   (string)
//      role: "admin"      (string)
//      isActive: true     (boolean)
// ============================================================
