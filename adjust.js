// ============================================================
// البيان للتسويق | تسوية المخزن
// لتصحيح الرصيد بعد جرد أو تلف أو فقد أو خطأ في إدخال شحنة.
// كل تسوية تُسجَّل في دفتر حركة المخزن وسجل العمليات بالسبب
// واسم المستخدم والوقت، ولا تُعدَّل بعد حفظها.
// ============================================================
import { db, serverTimestamp } from './firebase-init.js';
import { collection, getDocs, doc, runTransaction, query, where }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const esc = s => String(s ?? '').replace(/[&<>"']/g,
  c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const fmt = n => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
const num = v => { const n = parseFloat(v); return isNaN(n) ? NaN : n; };
const when = ts => ts?.toDate ? ts.toDate().toLocaleString('ar-u-nu-latn') : '—';

const REASONS = ['جرد فعلي', 'تلف', 'فقد أو سرقة', 'خطأ في إدخال شحنة', 'إرجاع للمورد', 'أخرى'];

function toast(msg, bad) {
  const t = document.createElement('div');
  t.className = 'toast' + (bad ? ' bad' : '');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

export async function renderAdjust({ container, user, currency }) {
  if (!['admin', 'manager'].includes(user.role)) {
    container.innerHTML = '<h2>تسوية المخزن</h2><div class="placeholder">هذه الصفحة للمدير والمشرف فقط.</div>';
    return;
  }
  const by = { userId: user.uid, userName: user.fullName || user.email };
  let products = [], units = [], history = [];
  const unitName = id => units.find(u => u.id === id)?.name || '';

  async function load() {
    container.innerHTML = '<div class="loading">جارٍ التحميل...</div>';
    const read = async n => (await getDocs(collection(db, n))).docs.map(d => ({ id: d.id, ...d.data() }));
    [products, units] = await Promise.all([read('products'), read('units')]);
    products = products.filter(p => p.isActive !== false).sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ar'));
    const h = await getDocs(query(collection(db, 'stockMovements'), where('movementType', '==', 'adjust')));
    history = h.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)).slice(0, 100);
    draw();
  }

  function draw() {
    container.innerHTML = `<h2>تسوية المخزن</h2>
      <form class="adj" id="af">
        <div class="error" id="perr"></div>
        <div class="field"><label>ابحث عن المنتج</label><input id="sq" placeholder="اكتب جزءاً من الاسم أو الباركود..."></div>
        <div class="field"><label>المنتج *</label><select id="ps" size="1"></select></div>
        <div class="grid2">
          <div class="field"><label>الرصيد الفعلي بعد العدّ *</label>
            <input id="nq" type="number" step="any" min="0" inputmode="decimal" placeholder="مثال: 48"></div>
          <div class="field"><label>سبب التسوية *</label>
            <select id="rs">${REASONS.map(r => `<option>${r}</option>`).join('')}</select></div>
        </div>
        <div class="adj-preview" id="pv">اختر منتجاً وأدخل الرصيد الفعلي لترى الفرق.</div>
        <div class="field"><label>ملاحظة <span class="muted" id="nh">(اختيارية)</span></label><input id="nt" placeholder="تفاصيل تساعد من يراجع السجل لاحقاً"></div>
        <button class="btn" type="submit" id="sv">حفظ التسوية</button>
      </form>
      <p class="muted">التسوية تغيّر الرصيد فقط، ولا تعدّل المبيعات ولا المشتريات المسجلة. للتصحيح بعد حفظ التسوية سجّل تسوية جديدة.</p>

      <h3 class="sec-title">آخر التسويات</h3>
      <div class="table-wrap"><table>
        <thead><tr><th>الوقت</th><th>المنتج</th><th>قبل</th><th>بعد</th><th>الفرق</th><th>السبب</th><th>بواسطة</th></tr></thead>
        <tbody>${history.map(h => `<tr><td style="white-space:nowrap">${when(h.createdAt)}</td><td><b>${esc(h.productName) || '—'}</b></td>
          <td>${fmt((h.balanceAfter ?? 0) - h.qty)}</td><td>${fmt(h.balanceAfter)}</td>
          <td><b class="${h.qty >= 0 ? 'pos' : 'neg'}" dir="ltr">${h.qty > 0 ? '+' : ''}${fmt(h.qty)}</b></td>
          <td>${esc(h.reason) || '—'}${h.note ? `<div class="muted">${esc(h.note)}</div>` : ''}</td><td>${esc(h.createdByName) || '—'}</td></tr>`).join('')
          || '<tr><td colspan="7" class="muted" style="text-align:center">لا توجد تسويات بعد</td></tr>'}</tbody></table></div>`;

    const $ = id => container.querySelector('#' + id);
    const fillProducts = () => {
      const q = $('sq').value.trim().toLowerCase();
      const list = products.filter(p => !q || (p.name || '').toLowerCase().includes(q) || (p.sku || '').toLowerCase().includes(q));
      const keep = $('ps').value;
      $('ps').innerHTML = '<option value="">اختر المنتج...</option>' + list.map(p =>
        `<option value="${p.id}" ${p.id === keep ? 'selected' : ''}>${esc(p.name)} — الرصيد: ${fmt(p.currentQty)} ${esc(unitName(p.unitId))}</option>`).join('');
      preview();
    };
    const preview = () => {
      const p = products.find(x => x.id === $('ps').value), n = num($('nq').value);
      if (!p || isNaN(n)) { $('pv').textContent = 'اختر منتجاً وأدخل الرصيد الفعلي لترى الفرق.'; return; }
      const d = n - (p.currentQty || 0), val = d * (p.avgCost || 0);
      $('pv').innerHTML = d === 0
        ? 'الرصيد مطابق، لا حاجة لتسوية.'
        : `الرصيد في النظام <b>${fmt(p.currentQty)}</b> ← الفعلي <b>${fmt(n)}</b> · الفرق
           <b class="${d > 0 ? 'pos' : 'neg'}" dir="ltr">${d > 0 ? '+' : ''}${fmt(d)}</b>
           · أثره على قيمة المخزون بالتكلفة <b class="${d > 0 ? 'pos' : 'neg'}" dir="ltr">${d > 0 ? '+' : ''}${fmt(val)} ${esc(currency)}</b>`;
    };
    $('sq').oninput = fillProducts; $('ps').onchange = preview; $('nq').oninput = preview;
    $('rs').onchange = () => $('nh').textContent = $('rs').value === 'أخرى' ? '(مطلوبة عند اختيار "أخرى")' : '(اختيارية)';
    fillProducts();

    $('af').onsubmit = async e => {
      e.preventDefault();
      const err = m => { $('perr').textContent = m; $('perr').style.display = 'block'; };
      $('perr').style.display = 'none';
      const p = products.find(x => x.id === $('ps').value), n = num($('nq').value);
      if (!p) return err('اختر المنتج أولاً.');
      if (isNaN(n) || n < 0) return err('أدخل الرصيد الفعلي (صفر أو أكثر).');
      const reason = $('rs').value, note = $('nt').value.trim();
      if (reason === 'أخرى' && !note) return err('اكتب ملاحظة توضّح السبب.');
      if (n === (p.currentQty || 0)) return err('الرصيد مطابق لما في النظام، لا حاجة لتسوية.');
      if (!confirm(`تسوية رصيد "${p.name}" إلى ${fmt(n)}؟ لا يمكن حذف التسوية بعد الحفظ.`)) return;
      $('sv').disabled = true; $('sv').textContent = 'جارٍ الحفظ...';
      try { await save(p, n, reason, note); toast('تم حفظ التسوية'); await load(); }
      catch (ex) { console.error(ex); err(ex.message || 'تعذّر حفظ التسوية.'); $('sv').disabled = false; $('sv').textContent = 'حفظ التسوية'; }
    };
  }

  async function save(p, newQty, reason, note) {
    await runTransaction(db, async tx => {
      const pref = doc(db, 'products', p.id);
      const s = await tx.get(pref);
      if (!s.exists()) throw new Error('المنتج لم يعد موجوداً');
      const cur = s.data().currentQty || 0;               // الرصيد الحالي وقت الحفظ (قد يكون تغيّر)
      const diff = newQty - cur;
      if (diff === 0) throw new Error('الرصيد تغيّر ويطابق الآن ما أدخلته، لا حاجة لتسوية.');
      const mref = doc(collection(db, 'stockMovements'));
      tx.update(pref, { currentQty: newQty, updatedAt: serverTimestamp() });
      tx.set(mref, { productId: p.id, productName: p.name, movementType: 'adjust', qty: diff, balanceAfter: newQty,
        refType: 'adjustment', refId: null, reason, note, createdBy: user.uid, createdByName: by.userName, createdAt: serverTimestamp() });
      tx.set(doc(collection(db, 'auditLog')), { ...by, action: 'adjust', entity: 'stock', entityId: p.id,
        oldValues: null, newValues: { product: p.name, before: cur, after: newQty, reason }, createdAt: serverTimestamp() });
    });
  }

  await load();
}
