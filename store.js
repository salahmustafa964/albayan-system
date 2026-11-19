// ============================================================
// البيان للتسويق | ذاكرة مؤقتة للبيانات المشتركة
// المنتجات والتصنيفات والوحدات والعملاء والموردون تُجلب مرة واحدة
// وتُعاد استخدامها بين الصفحات، فينتقل المستخدم بين الشاشات فوراً.
// بعد أي حفظ نستدعي invalidate فتُجلب البيانات الجديدة عند الحاجة.
// ============================================================
import { db } from './firebase-init.js';
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-lite.js";

const TTL = { products: 45000 };          // المنتجات أكثر تغيّراً (مبيعات من أكثر من جهاز)
const DEFAULT_TTL = 180000;
const cache = new Map(), inflight = new Map();
const ttl = n => TTL[n] || DEFAULT_TTL;
const fresh = n => { const c = cache.get(n); return !!c && Date.now() - c.t < ttl(n); };

export const has = (...names) => names.every(fresh);

export function load(name) {
  if (fresh(name)) return Promise.resolve(cache.get(name).data.slice());
  if (inflight.has(name)) return inflight.get(name).then(d => d.slice());
  const p = getDocs(collection(db, name))
    .then(s => { const data = s.docs.map(d => ({ id: d.id, ...d.data() })); cache.set(name, { data, t: Date.now() }); return data; })
    .finally(() => inflight.delete(name));
  inflight.set(name, p);
  return p.then(d => d.slice());
}
export const invalidate = (...names) => names.forEach(n => { cache.delete(n); inflight.delete(n); });
export const prefetch = (...names) => names.forEach(n => load(n).catch(() => {}));
