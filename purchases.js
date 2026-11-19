// ============================================================
// البيان للتسويق | صفحة المشتريات (الوارد)
// كل شحنة تُحفظ داخل Transaction واحدة: تزيد الرصيد، تحسب متوسط
// التكلفة، تسجّل حركة المخزن وتغيّر سعر الشراء، وتكتب سجل المراجعة.
// ============================================================
import { db, serverTimestamp } from './firebase-init.js';
import {
  collection, getDocs, doc, addDoc, runTransaction, query, orderBy, limit
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const esc = s => String(s ?? '').replace(/[&<>"']/g,
  c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const fmt = n => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
const num = v => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
const round4 = n => Math.round(n * 10000) / 10000;
const when = ts => ts?.toDate ? ts.toDate().toLocaleString('ar-u-nu-latn') : '—';
const dateAr = s => s ? new Date(s + 'T00:00:00').toLocaleDateString('ar-u-nu-latn') : '—';
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function toast(msg, bad) {
  const t = document.createElement('div');
  t.className = 'toast' + (bad ? ' bad' : '');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}
function modal(html, wide) {
  const o = document.createElement('div');
  o.className = 'overlay';
  o.innerHTML = `<div class="modal" ${wide ? 'style="max-width:760px"' : ''}>${html}</div>`;
  o.addEventListener('mousedown', e => { if (e.target === o) o.remove(); });
  document.body.appendChild(o);
  return o;
}

export async function renderPurchases({ container, user, currency }) {
  const by = { userId: user.uid, userName: user.fullName || user.email };
  let products = [], units = [], suppliers = [], purchases = [];
  const unitName = id => units.find(u => u.id === id)?.name || '';

  async function load() {
    container.innerHTML = '<div class="loading">جارٍ تحميل المشتريات...</div>';
    const read = async n => (await getDocs(collection(db, n))).docs.map(d => ({ id: d.id, ...d.data() }));
    [products, units, suppliers] = await Promise.all([read('products'), read('units'), read('suppliers')]);
    products = products.filter(p => p.isActive !== false).sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ar'));
    suppliers.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ar'));
    const s = await getDocs(query(collection(db, 'purchases'), orderBy('createdAt', 'desc'), limit(50)));
    purchases = s.docs.map(d => ({ id: d.id, ...d.data() }));
    draw();
  }

  function draw() {
    container.innerHTML = `<h2>المشتريات (الوارد)</h2>
      <div class="toolbar">
        <button class="btn" id="new">+ شحنة جديدة</button>
        <button class="btn btn-light" id="sup">+ مورد جديد</button>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>التاريخ</th><th>رقم الفاتورة</th><th>المورد</th><th>الأصناف</th><th>الإجمالي (${esc(currency)})</th><th>سجّلها</th><th></th></tr></thead>
        <tbody>${purchases.map(p => `<tr>
          <td>${dateAr(p.purchaseDate)}</td><td dir="ltr">${esc(p.refNo) || '—'}</td><td>${esc(p.supplierName) || '—'}</td>
          <td>${fmt((p.items || []).length)}</td><td><b>${fmt(p.total)}</b></td><td>${esc(p.createdByName)}</td>
          <td><button class="lnk" data-id="${p.id}">عرض</button></td></tr>`).join('')
          || '<tr><td colspan="7" class="muted" style="text-align:center">لا توجد شحنات مسجّلة بعد</td></tr>'}
        </tbody></table></div>
      <p class="muted">آخر 50 شحنة. الشحنة بعد حفظها لا تُعدَّل ولا تُحذف حفاظاً على دقة المخزون والأرباح.</p>`;
    container.querySelector('#new').onclick = openForm;
    container.querySelector('#sup').onclick = () => openSupplier();
    container.querySelector('tbody').addEventListener('click', e => {
      const b = e.target.closest('button[data-id]');
      if (b) openDetails(purchases.find(p => p.id === b.dataset.id));
    });
  }

  // ---------- تفاصيل شحنة ----------
  function openDetails(p) {
    const m = modal(`<h3>شحنة ${esc(p.refNo) || ''} — ${dateAr(p.purchaseDate)}</h3>
      <p>المورد: <b>${esc(p.supplierName) || '—'}</b> · سجّلها: ${esc(p.createdByName)} · ${when(p.createdAt)}</p>
      <div class="table-wrap" style="margin-top:.8rem"><table><thead><tr><th>المنتج</th><th>الكمية</th><th>سعر الشراء</th><th>الإجمالي</th></tr></thead>
      <tbody>${(p.items || []).map(i => `<tr><td>${esc(i.name)}</td><td>${fmt(i.qty)}</td><td>${fmt(i.unitCost)}</td><td>${fmt(i.lineTotal)}</td></tr>`).join('')}
      </tbody></table></div>
      <p style="margin-top:.8rem"><b>الإجمالي: ${fmt(p.total)} ${esc(currency)}</b></p>
      ${p.notes ? `<p class="muted">ملاحظات: ${esc(p.notes)}</p>` : ''}
      <div class="modal-acts"><button class="btn btn-light" id="cx">إغلاق</button></div>`, true);
    m.querySelector('#cx').onclick = () => m.remove();
  }

  // ---------- مورد جديد ----------
  function openSupplier(afterSave) {
    const m = modal(`<form id="sf"><h3>مورد جديد</h3>
      <div class="field"><label>اسم المورد *</label><input name="name" required></div>
      <div class="field"><label>الهاتف</label><input name="phone" dir="ltr"></div>
      <div class="field"><label>العنوان</label><input name="address"></div>
      <div class="modal-acts"><button class="btn" type="submit">حفظ</button>
      <button class="btn btn-light" type="button" id="cx">إلغاء</button></div></form>`);
    m.querySelector('#cx').onclick = () => m.remove();
    m.querySelector('#sf').onsubmit = async e => {
      e.preventDefault();
      const f = new FormData(e.target);
      try {
        const data = { name: f.get('name').trim(), phone: f.get('phone').trim(), address: f.get('address').trim(), createdAt: serverTimestamp() };
        const ref = await addDoc(collection(db, 'suppliers'), data);
        suppliers.push({ id: ref.id, ...data });
        suppliers.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ar'));
        m.remove(); toast('تمت إضافة المورد');
        if (afterSave) afterSave(ref.id);
      } catch (err) { toast('تعذّر الحفظ', true); }
    };
  }

  // ---------- شحنة جديدة ----------
  function openForm() {
    if (!products.length) return toast('أضف منتجات أولاً من صفحة المنتجات', true);
    const m = modal(`<form id="pf"><h3>شحنة جديدة</h3><div class="error" id="perr"></div>
      <div class="grid2">
        <div class="field"><label>تاريخ الشراء *</label><input type="date" name="date" required value="${todayStr()}"></div>
        <div class="field"><label>رقم فاتورة المورد</label><input name="refNo" dir="ltr"></div>
        <div class="field"><label>المورد</label><select name="supplierId" id="supSel"></select></div>
      </div>
      <div id="items"></div>
      <button class="btn btn-light" type="button" id="addRow">+ إضافة صنف</button>
      <div class="field" style="margin-top:.8rem"><label>ملاحظات</label><input name="notes"></div>
      <p style="margin:.6rem 0"><b>الإجمالي: <span id="tot">0</span> ${esc(currency)}</b></p>
      <div class="modal-acts"><button class="btn" type="submit">حفظ الشحنة</button>
      <button class="btn btn-light" type="button" id="cx">إلغاء</button></div></form>`, true);

    const supSel = m.querySelector('#supSel');
    const fillSup = sel => supSel.innerHTML = '<option value="">— بدون مورد —</option>' +
      suppliers.map(s => `<option value="${s.id}" ${s.id === sel ? 'selected' : ''}>${esc(s.name)}</option>`).join('') +
      '<option value="__new">+ مورد جديد...</option>';
    fillSup();
    supSel.onchange = () => { if (supSel.value === '__new') { supSel.value = ''; openSupplier(id => fillSup(id)); } };

    const itemsEl = m.querySelector('#items');
    const prodOpts = '<option value="">اختر المنتج...</option>' +
      products.map(p => `<option value="${p.id}">${esc(p.name)}${p.unitId ? ' (' + esc(unitName(p.unitId)) + ')' : ''}</option>`).join('');
    const calc = () => {
      let t = 0;
      itemsEl.querySelectorAll('.irow').forEach(r => {
        const l = num(r.querySelector('[name=qty]').value) * num(r.querySelector('[name=cost]').value);
        r.querySelector('.lt').textContent = fmt(l); t += l;
      });
      m.querySelector('#tot').textContent = fmt(t);
    };
    const addRow = () => {
      const r = document.createElement('div');
      r.className = 'irow';
      r.innerHTML = `<select name="pid">${prodOpts}</select>
        <input name="qty" type="number" step="any" min="0" placeholder="الكمية">
        <input name="cost" type="number" step="any" min="0" placeholder="سعر الشراء">
        <span class="lt">0</span><button type="button" class="lnk del">✕</button>`;
      r.querySelector('[name=pid]').onchange = e => {
        const p = products.find(x => x.id === e.target.value);
        if (p) r.querySelector('[name=cost]').value = p.purchasePrice || 0;
        calc();
      };
      r.querySelector('.del').onclick = () => { r.remove(); calc(); };
      r.addEventListener('input', calc);
      itemsEl.appendChild(r);
    };
    addRow();
    m.querySelector('#addRow').onclick = addRow;
    m.querySelector('#cx').onclick = () => m.remove();

    m.querySelector('#pf').onsubmit = async e => {
      e.preventDefault();
      const err = msg => { const el = m.querySelector('#perr'); el.textContent = msg; el.style.display = 'block'; };
      const f = new FormData(e.target);
      const items = [];
      for (const r of itemsEl.querySelectorAll('.irow')) {
        const pid = r.querySelector('[name=pid]').value;
        const qty = num(r.querySelector('[name=qty]').value), cost = num(r.querySelector('[name=cost]').value);
        if (!pid && !qty) continue;                       // صف فاضي
        if (!pid || qty <= 0) return err('أكمل بيانات كل صنف (المنتج والكمية أكبر من صفر).');
        const p = products.find(x => x.id === pid);
        items.push({ productId: pid, name: p.name, qty, unitCost: cost, lineTotal: qty * cost });
      }
      if (!items.length) return err('أضف صنفاً واحداً على الأقل.');
      if (items.length > 100) return err('الحد الأقصى 100 صنف في الشحنة الواحدة.');
      const sup = suppliers.find(s => s.id === f.get('supplierId'));
      const btn = e.target.querySelector('[type=submit]'); btn.disabled = true; btn.textContent = 'جارٍ الحفظ...';
      try {
        await savePurchase({
          date: f.get('date'), refNo: f.get('refNo').trim(), notes: f.get('notes').trim(),
          supplierId: sup?.id || '', supplierName: sup?.name || '', items
        });
        m.remove(); toast('تم تسجيل الشحنة وتحديث المخزون'); await load();
      } catch (ex) { console.error(ex); err(ex.message || 'تعذّر الحفظ'); btn.disabled = false; btn.textContent = 'حفظ الشحنة'; }
    };
  }

  // ---------- الحفظ الذري ----------
  async function savePurchase(v) {
    await runTransaction(db, async tx => {
      const ids = [...new Set(v.items.map(i => i.productId))];
      const st = {};
      for (const id of ids) {                              // كل القراءات أولاً
        const s = await tx.get(doc(db, 'products', id));
        if (!s.exists()) throw new Error('أحد المنتجات لم يعد موجوداً');
        const d = s.data();
        st[id] = { qty: d.currentQty || 0, avg: d.avgCost || 0, oldBuy: d.purchasePrice || 0, sell: d.sellPrice || 0, cost: d.purchasePrice || 0 };
      }
      const pref = doc(collection(db, 'purchases'));
      for (const it of v.items) {
        const s = st[it.productId], total = s.qty + it.qty;
        s.avg = total > 0 ? (s.qty * s.avg + it.qty * it.unitCost) / total : it.unitCost;
        s.qty = total; s.cost = it.unitCost;
        tx.set(doc(collection(db, 'stockMovements')), {
          productId: it.productId, movementType: 'in', qty: it.qty, balanceAfter: s.qty,
          refType: 'purchase', refId: pref.id, createdBy: user.uid, createdAt: serverTimestamp() });
      }
      for (const id of ids) {
        const s = st[id];
        tx.update(doc(db, 'products', id), { avgCost: round4(s.avg), currentQty: s.qty, purchasePrice: s.cost, updatedAt: serverTimestamp() });
        if (s.cost !== s.oldBuy) tx.set(doc(collection(db, 'products', id, 'priceHistory')), {
          oldPurchasePrice: s.oldBuy, newPurchasePrice: s.cost, oldSellPrice: s.sell, newSellPrice: s.sell,
          reason: 'purchase', changedBy: user.uid, changedByName: by.userName, changedAt: serverTimestamp() });
      }
      const total = v.items.reduce((a, i) => a + i.lineTotal, 0);
      tx.set(pref, { refNo: v.refNo, supplierId: v.supplierId, supplierName: v.supplierName, purchaseDate: v.date,
        items: v.items, total, notes: v.notes, createdBy: user.uid, createdByName: by.userName, createdAt: serverTimestamp() });
      tx.set(doc(collection(db, 'auditLog')), { ...by, action: 'create', entity: 'purchase', entityId: pref.id,
        oldValues: null, newValues: { refNo: v.refNo, supplier: v.supplierName, items: v.items.length, total }, createdAt: serverTimestamp() });
    });
  }

  await load();
}
