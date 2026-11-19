// ============================================================
// البيان للتسويق | إدارة المستخدمين (لمدير النظام فقط)
// إنشاء الحساب يتم عبر نسخة Firebase ثانوية حتى لا يخرج المدير من حسابه.
// ============================================================
import { db, auth, firebaseConfig, serverTimestamp } from './firebase-init.js';
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signOut, sendPasswordResetEmail }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { collection, getDocs, doc, setDoc, writeBatch }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const esc = s => String(s ?? '').replace(/[&<>"']/g,
  c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const when = ts => ts?.toDate ? ts.toDate().toLocaleDateString('ar-u-nu-latn') : '—';
const ROLES = { admin: 'مدير النظام', manager: 'مشرف', cashier: 'بائع' };
const ROLE_HELP = {
  admin: 'كل الصلاحيات، منها المستخدمون وسجل العمليات',
  manager: 'المنتجات والمشتريات والمبيعات والتقارير وإلغاء الفواتير',
  cashier: 'تسجيل المبيعات وعرض المنتجات فقط'
};

function toast(msg, bad) {
  const t = document.createElement('div');
  t.className = 'toast' + (bad ? ' bad' : '');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 4000);
}
function modal(html) {
  const o = document.createElement('div');
  o.className = 'overlay';
  o.innerHTML = `<div class="modal">${html}</div>`;
  o.addEventListener('mousedown', e => { if (e.target === o) o.remove(); });
  document.body.appendChild(o);
  return o;
}

let secApp;
const secondaryAuth = () => getAuth(secApp ||= initializeApp(firebaseConfig, 'secondary'));

export async function renderUsers({ container, user }) {
  if (user.role !== 'admin') {
    container.innerHTML = '<h2>المستخدمون</h2><div class="placeholder">هذه الصفحة لمدير النظام فقط.</div>';
    return;
  }
  const by = { userId: user.uid, userName: user.fullName || user.email };
  let users = [];

  async function load() {
    container.innerHTML = '<div class="loading">جارٍ تحميل المستخدمين...</div>';
    const s = await getDocs(collection(db, 'users'));
    users = s.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.fullName || '').localeCompare(b.fullName || '', 'ar'));
    draw();
  }

  function draw() {
    container.innerHTML = `<h2>المستخدمون والصلاحيات</h2>
      <div class="toolbar"><button class="btn" id="add">+ مستخدم جديد</button></div>
      <div class="table-wrap"><table>
        <thead><tr><th>الاسم</th><th>البريد</th><th>الدور</th><th>الحالة</th><th>أُنشئ</th><th></th></tr></thead>
        <tbody>${users.map(u => `<tr>
          <td><b>${esc(u.fullName) || '—'}</b>${u.id === user.uid ? ' <small class="muted">(أنت)</small>' : ''}</td>
          <td dir="ltr">${esc(u.email) || '—'}</td><td>${esc(ROLES[u.role] || u.role)}</td>
          <td>${u.isActive ? '<span class="badge ok">مفعّل</span>' : '<span class="badge low">موقوف</span>'}</td>
          <td>${when(u.createdAt)}</td>
          <td class="acts"><button class="lnk" data-a="edit" data-id="${u.id}">تعديل</button>
            ${u.email ? `<button class="lnk" data-a="reset" data-id="${u.id}">كلمة المرور</button>` : ''}</td></tr>`).join('')}
        </tbody></table></div>
      <p class="muted">الإيقاف يمنع المستخدم من الدخول فوراً دون حذف سجلاته القديمة. لا يمكنك تعديل دورك أو إيقاف حسابك.</p>`;
    container.querySelector('#add').onclick = openAdd;
    container.querySelector('tbody').addEventListener('click', e => {
      const b = e.target.closest('button[data-a]'); if (!b) return;
      const u = users.find(x => x.id === b.dataset.id);
      if (b.dataset.a === 'edit') openEdit(u);
      if (b.dataset.a === 'reset') resetPw(u);
    });
  }

  const roleOptions = sel => Object.entries(ROLES)
    .map(([k, v]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${v}</option>`).join('');

  // ---------- مستخدم جديد ----------
  function openAdd() {
    const m = modal(`<form id="uf"><h3>مستخدم جديد</h3><div class="error" id="perr"></div>
      <div class="field"><label>الاسم الكامل *</label><input name="fullName" required></div>
      <div class="field"><label>البريد الإلكتروني *</label><input name="email" type="email" required dir="ltr"></div>
      <div class="field"><label>كلمة المرور * (6 أحرف على الأقل)</label><input name="password" type="text" minlength="6" required dir="ltr" autocomplete="off"></div>
      <div class="field"><label>الدور</label><select name="role" id="rs">${roleOptions('cashier')}</select>
        <small class="muted" id="rh">${ROLE_HELP.cashier}</small></div>
      <div class="modal-acts"><button class="btn" type="submit">إنشاء الحساب</button>
      <button class="btn btn-light" type="button" id="cx">إلغاء</button></div></form>`);
    m.querySelector('#rs').onchange = e => m.querySelector('#rh').textContent = ROLE_HELP[e.target.value];
    m.querySelector('#cx').onclick = () => m.remove();
    m.querySelector('#uf').onsubmit = async e => {
      e.preventDefault();
      const f = new FormData(e.target);
      const v = { fullName: f.get('fullName').trim(), email: f.get('email').trim(), password: f.get('password'), role: f.get('role') };
      const err = msg => { const el = m.querySelector('#perr'); el.textContent = msg; el.style.display = 'block'; };
      const btn = e.target.querySelector('[type=submit]'); btn.disabled = true; btn.textContent = 'جارٍ الإنشاء...';
      try {
        const sa = secondaryAuth();
        const cred = await createUserWithEmailAndPassword(sa, v.email, v.password);
        await signOut(sa);                                       // لا نترك حساب الموظف مسجّلاً في هذه النسخة
        const b = writeBatch(db);
        b.set(doc(db, 'users', cred.user.uid), { fullName: v.fullName, email: v.email, role: v.role, isActive: true,
          createdBy: user.uid, createdAt: serverTimestamp() });
        b.set(doc(collection(db, 'auditLog')), { ...by, action: 'create', entity: 'user', entityId: cred.user.uid,
          oldValues: null, newValues: { fullName: v.fullName, email: v.email, role: v.role }, createdAt: serverTimestamp() });
        await b.commit();
        m.remove(); toast('تم إنشاء الحساب. أعطِ الموظف البريد وكلمة المرور.'); await load();
      } catch (ex) {
        const map = { 'auth/email-already-in-use': 'هذا البريد مستخدم لحساب آخر.', 'auth/weak-password': 'كلمة المرور ضعيفة (6 أحرف على الأقل).',
          'auth/invalid-email': 'صيغة البريد غير صحيحة.', 'auth/network-request-failed': 'تعذّر الاتصال بالإنترنت.' };
        console.error(ex); err(map[ex.code] || 'تعذّر إنشاء الحساب.');
        btn.disabled = false; btn.textContent = 'إنشاء الحساب';
      }
    };
  }

  // ---------- تعديل ----------
  function openEdit(u) {
    const self = u.id === user.uid;
    const m = modal(`<form id="ef"><h3>تعديل المستخدم</h3><div class="error" id="perr"></div>
      <div class="field"><label>الاسم الكامل *</label><input name="fullName" required value="${esc(u.fullName)}"></div>
      <div class="field"><label>الدور</label><select name="role" ${self ? 'disabled' : ''}>${roleOptions(u.role)}</select></div>
      <div class="field"><label class="chk"><input type="checkbox" name="isActive" ${u.isActive ? 'checked' : ''} ${self ? 'disabled' : ''}> الحساب مفعّل</label></div>
      <div class="modal-acts"><button class="btn" type="submit">حفظ</button>
      <button class="btn btn-light" type="button" id="cx">إلغاء</button></div></form>`);
    m.querySelector('#cx').onclick = () => m.remove();
    m.querySelector('#ef').onsubmit = async e => {
      e.preventDefault();
      const f = new FormData(e.target);
      const nv = { fullName: f.get('fullName').trim(), role: self ? u.role : f.get('role'), isActive: self ? u.isActive : f.get('isActive') === 'on' };
      const ov = {}, ch = {};
      for (const k of Object.keys(nv)) if (nv[k] !== u[k]) { ov[k] = u[k] ?? null; ch[k] = nv[k]; }
      if (!Object.keys(ch).length) return m.remove();
      try {
        const b = writeBatch(db);
        b.update(doc(db, 'users', u.id), nv);
        b.set(doc(collection(db, 'auditLog')), { ...by, action: 'update', entity: 'user', entityId: u.id,
          oldValues: ov, newValues: ch, createdAt: serverTimestamp() });
        await b.commit();
        m.remove(); toast('تم الحفظ'); await load();
      } catch (ex) { console.error(ex); const el = m.querySelector('#perr'); el.textContent = 'تعذّر الحفظ'; el.style.display = 'block'; }
    };
  }

  // ---------- إعادة تعيين كلمة المرور ----------
  async function resetPw(u) {
    if (!confirm(`إرسال رابط إعادة تعيين كلمة المرور إلى ${u.email}؟`)) return;
    try { await sendPasswordResetEmail(auth, u.email); toast('تم إرسال الرابط إلى بريد المستخدم'); }
    catch (e) { console.error(e); toast('تعذّر الإرسال، تأكد أن البريد صحيح', true); }
  }

  await load();
}
