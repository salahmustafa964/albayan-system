// ============================================================
// البيان للتسويق | صفحة المنتجات والمخزن
// ============================================================
import { db, serverTimestamp } from './firebase-init.js';
import {
  collection, getDocs, doc, writeBatch, addDoc, deleteDoc,
  query, where, orderBy, limit
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const esc = s => String(s ?? '').replace(/[&<>"']/g,
  c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const fmt = n => Number(n || 0).toLocaleString('ar-EG', { maximumFractionDigits: 2 });
const num = v => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
const when = ts => ts?.toDate ? ts.toDate().toLocaleString('ar-EG') : '—';

function toast(msg, bad) {
  const t = document.createElement('div');
  t.className = 'toast' + (bad ? ' bad' : '');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}
function modal(html) {
  const o = document.createElement('div');
  o.className = 'overlay';
  o.innerHTML = `<div class="modal">${html}</div>`;
  o.addEventListener('mousedown', e => { if (e.target === o) o.remove(); });
  document.body.appendChild(o);
  return o;
}

export async function renderProducts({ container, user, currency }) {
  const isMgr = ['admin', 'manager'].includes(user.role);
  const by = { userId: user.uid, userName: user.fullName || user.email };
  let cats = [], units = [], products = [];
  const catName = id => cats.find(c => c.id === id)?.name || '—';
  const unitName = id => units.find(u => u.id === id)?.name || '';

  async function load() {
    container.innerHTML = '<div class="loading">جارٍ تحميل المنتجات...</div>';
    const read = async n => (await getDocs(collection(db, n))).docs.map(d => ({ id: d.id, ...d.data() }));
    [cats, units, products] = await Promise.all([read('categories'), read('units'), read('products')]);
    products.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ar'));
    draw();
  }

  function draw() {
    container.innerHTML = `
      <h2>المنتجات والمخزن</h2>
      <div class="toolbar">
        <input id="q" placeholder="بحث بالاسم أو الباركود...">
        <select id="fc"><option value="">كل التصنيفات</option>
          ${cats.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select>
        <label class="chk"><input type="checkbox" id="fh"> المخفية</label>
        ${isMgr ? `<button class="btn" id="add">+ منتج جديد</button>
                   <button class="btn btn-light" id="lists">التصنيفات والوحدات</button>` : ''}
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>المنتج</th><th>الباركود</th><th>التصنيف</th>
          ${isMgr ? '<th>سعر الشراء</th>' : ''}<th>سعر البيع</th><th>الرصيد</th>${isMgr ? '<th></th>' : ''}</tr></thead>
        <tbody id="rows"></tbody></table></div>
      <p class="muted" id="count"></p>`;

    const rows = container.querySelector('#rows');
    const paint = () => {
      const q = container.querySelector('#q').value.trim().toLowerCase();
      const fc = container.querySelector('#fc').value;
      const hidden = container.querySelector('#fh').checked;
      const list = products.filter(p =>
        (hidden ? p.isActive === false : p.isActive !== false) &&
        (!fc || p.categoryId === fc) &&
        (!q || (p.name || '').toLowerCase().includes(q) || (p.sku || '').toLowerCase().includes(q)));
      rows.innerHTML = list.map(p => {
        const low = (p.currentQty || 0) <= (p.minQty || 0);
        return `<tr>
          <td><b>${esc(p.name)}</b></td><td dir="ltr">${esc(p.sku) || '—'}</td><td>${esc(catName(p.categoryId))}</td>
          ${isMgr ? `<td>${fmt(p.purchasePrice)}</td>` : ''}<td>${fmt(p.sellPrice)}</td>
          <td><span class="badge ${low ? 'low' : 'ok'}">${fmt(p.currentQty)} ${esc(unitName(p.unitId))}</span></td>
          ${isMgr ? `<td class="acts">
            <button class="lnk" data-a="edit" data-id="${p.id}">تعديل</button>
            <button class="lnk" data-a="hist" data-id="${p.id}">الأسعار</button>
            <button class="lnk" data-a="tog" data-id="${p.id}">${p.isActive === false ? 'إظهار' : 'إخفاء'}</button></td>` : ''}
        </tr>`;
      }).join('') || `<tr><td colspan="7" class="muted" style="text-align:center">لا توجد منتجات</td></tr>`;
      container.querySelector('#count').textContent = `العدد: ${list.length} (العملة: ${currency})`;
    };
    ['q', 'fc', 'fh'].forEach(id => container.querySelector('#' + id).addEventListener('input', paint));
    paint();

    if (isMgr) {
      container.querySelector('#add').onclick = () => openForm(null);
      container.querySelector('#lists').onclick = openLists;
      rows.addEventListener('click', e => {
        const b = e.target.closest('button[data-a]'); if (!b) return;
        const p = products.find(x => x.id === b.dataset.id);
        if (b.dataset.a === 'edit') openForm(p);
        if (b.dataset.a === 'hist') openHistory(p);
        if (b.dataset.a === 'tog') toggle(p);
      });
    }
  }

  // ---------- إضافة / تعديل ----------
  function openForm(p) {
    const opts = (arr, sel) => `<option value="">—</option>` +
      arr.map(x => `<option value="${x.id}" ${x.id === sel ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
    const m = modal(`<form id="pf"><h3>${p ? 'تعديل المنتج' : 'منتج جديد'}</h3>
      <div class="error" id="perr"></div>
      <div class="grid2">
        <div class="field"><label>اسم المنتج *</label><input name="name" required value="${esc(p?.name)}"></div>
        <div class="field"><label>الباركود / SKU</label><input name="sku" dir="ltr" value="${esc(p?.sku)}"></div>
        <div class="field"><label>التصنيف</label><select name="categoryId">${opts(cats, p?.categoryId)}</select></div>
        <div class="field"><label>الوحدة</label><select name="unitId">${opts(units, p?.unitId)}</select></div>
        <div class="field"><label>سعر الشراء</label><input name="purchasePrice" type="number" step="any" min="0" value="${p?.purchasePrice ?? 0}"></div>
        <div class="field"><label>سعر البيع</label><input name="sellPrice" type="number" step="any" min="0" value="${p?.sellPrice ?? 0}"></div>
        <div class="field"><label>حد التنبيه (أقل كمية)</label><input name="minQty" type="number" step="any" min="0" value="${p?.minQty ?? 0}"></div>
        ${p ? `<div class="field"><label>الكمية الحالية</label><input value="${fmt(p.currentQty)}" disabled></div>`
            : `<div class="field"><label>الكمية</label><input name="openingQty" type="number" step="any" min="0" value="0">
              <small class="muted">الكمية الموجودة عندك الآن، وتنقص تلقائياً مع كل بيع.</small></div>`}
      </div>
      <div class="modal-acts"><button class="btn" type="submit">حفظ</button>
        <button class="btn btn-light" type="button" id="cx">إلغاء</button></div></form>`);
    m.querySelector('#cx').onclick = () => m.remove();
    m.querySelector('#pf').onsubmit = async e => {
      e.preventDefault();
      const f = new FormData(e.target);
      const v = {
        name: f.get('name').trim(), sku: f.get('sku').trim(),
        categoryId: f.get('categoryId'), unitId: f.get('unitId'),
        purchasePrice: num(f.get('purchasePrice')), sellPrice: num(f.get('sellPrice')),
        minQty: num(f.get('minQty')), openingQty: num(f.get('openingQty'))
      };
      if (v.sellPrice < v.purchasePrice && !confirm('سعر البيع أقل من سعر الشراء، هل أنت متأكد؟')) return;
      const btn = e.target.querySelector('[type=submit]'); btn.disabled = true;
      try { await save(p, v); m.remove(); toast('تم الحفظ'); await load(); }
      catch (err) { const el = m.querySelector('#perr'); el.textContent = err.message || 'تعذّر الحفظ'; el.style.display = 'block'; btn.disabled = false; }
    };
  }

  async function save(p, v) {
    if (v.sku) {
      const dup = await getDocs(query(collection(db, 'products'), where('sku', '==', v.sku)));
      if (dup.docs.some(d => d.id !== p?.id)) throw new Error('هذا الباركود مستخدم لمنتج آخر');
    }
    const b = writeBatch(db);
    const base = { name: v.name, sku: v.sku, categoryId: v.categoryId, unitId: v.unitId,
      purchasePrice: v.purchasePrice, sellPrice: v.sellPrice, minQty: v.minQty };

    if (!p) {                                            // منتج جديد
      const ref = doc(collection(db, 'products'));
      b.set(ref, { ...base, avgCost: v.purchasePrice, currentQty: v.openingQty, isActive: true,
        createdBy: user.uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      if (v.openingQty > 0) b.set(doc(collection(db, 'stockMovements')), {
        productId: ref.id, movementType: 'in', qty: v.openingQty, balanceAfter: v.openingQty,
        refType: 'opening', refId: null, createdBy: user.uid, createdAt: serverTimestamp() });
      b.set(doc(collection(db, 'auditLog')), { ...by, action: 'create', entity: 'product', entityId: ref.id,
        oldValues: null, newValues: { ...base, openingQty: v.openingQty }, createdAt: serverTimestamp() });
    } else {                                             // تعديل
      const oldV = {}, newV = {};
      for (const k of Object.keys(base)) if (base[k] !== (p[k] ?? (typeof base[k] === 'number' ? 0 : ''))) { oldV[k] = p[k] ?? null; newV[k] = base[k]; }
      if (!Object.keys(newV).length) return;
      const upd = { ...base, updatedAt: serverTimestamp() };
      if ((p.currentQty || 0) === 0) upd.avgCost = v.purchasePrice;   // لا يوجد مخزون: التكلفة = سعر الشراء
      b.update(doc(db, 'products', p.id), upd);
      if ('purchasePrice' in newV || 'sellPrice' in newV) {
        b.set(doc(collection(db, 'products', p.id, 'priceHistory')), {
          oldPurchasePrice: p.purchasePrice ?? 0, newPurchasePrice: v.purchasePrice,
          oldSellPrice: p.sellPrice ?? 0, newSellPrice: v.sellPrice,
          changedBy: user.uid, changedByName: by.userName, changedAt: serverTimestamp() });
      }
      b.set(doc(collection(db, 'auditLog')), { ...by, action: 'update', entity: 'product', entityId: p.id,
        oldValues: oldV, newValues: newV, createdAt: serverTimestamp() });
    }
    await b.commit();
  }

  // ---------- إخفاء / إظهار ----------
  async function toggle(p) {
    const hide = p.isActive !== false;
    if (!confirm(hide ? `إخفاء المنتج "${p.name}"؟ (لن يظهر في المبيعات، وتبقى بياناته محفوظة)` : `إظهار المنتج "${p.name}"؟`)) return;
    const b = writeBatch(db);
    b.update(doc(db, 'products', p.id), { isActive: !hide, updatedAt: serverTimestamp() });
    b.set(doc(collection(db, 'auditLog')), { ...by, action: hide ? 'hide' : 'unhide', entity: 'product',
      entityId: p.id, oldValues: { isActive: !hide }, newValues: { isActive: hide }, createdAt: serverTimestamp() });
    try { await b.commit(); toast(hide ? 'تم الإخفاء' : 'تم الإظهار'); await load(); }
    catch (e) { toast('تعذّر التنفيذ', true); }
  }

  // ---------- سجل الأسعار ----------
  async function openHistory(p) {
    const m = modal(`<h3>سجل أسعار: ${esc(p.name)}</h3><div class="loading">جارٍ التحميل...</div>`);
    try {
      const s = await getDocs(query(collection(db, 'products', p.id, 'priceHistory'), orderBy('changedAt', 'desc'), limit(50)));
      const rows = s.docs.map(d => d.data()).map(h => `<tr><td>${when(h.changedAt)}</td>
        <td>${fmt(h.oldPurchasePrice)} ← ${fmt(h.newPurchasePrice)}</td>
        <td>${fmt(h.oldSellPrice)} ← ${fmt(h.newSellPrice)}</td><td>${esc(h.changedByName)}</td></tr>`).join('');
      m.querySelector('.modal').innerHTML = `<h3>سجل أسعار: ${esc(p.name)}</h3>
        <div class="table-wrap"><table><thead><tr><th>الوقت</th><th>سعر الشراء</th><th>سعر البيع</th><th>بواسطة</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="4" class="muted">لا توجد تعديلات على الأسعار بعد</td></tr>'}</tbody></table></div>
        <div class="modal-acts"><button class="btn btn-light" id="cx">إغلاق</button></div>`;
      m.querySelector('#cx').onclick = () => m.remove();
    } catch (e) { m.querySelector('.modal').innerHTML = '<div class="error" style="display:block">تعذّر تحميل السجل</div>'; }
  }

  // ---------- التصنيفات والوحدات ----------
  function openLists() {
    const m = modal(`<h3>التصنيفات والوحدات</h3><div class="grid2" id="lg"></div>
      <div class="modal-acts"><button class="btn btn-light" id="cx">إغلاق</button></div>`);
    const paint = () => {
      const block = (title, col, arr) => `<div><b>${title}</b>
        <ul class="plain">${arr.map(x => `<li>${esc(x.name)} <button class="lnk del" data-c="${col}" data-id="${x.id}">حذف</button></li>`).join('') || '<li class="muted">لا يوجد</li>'}</ul>
        <div class="inline"><input placeholder="إضافة..." data-in="${col}"><button class="btn btn-light" data-add="${col}">+</button></div></div>`;
      m.querySelector('#lg').innerHTML = block('التصنيفات', 'categories', cats) + block('الوحدات (قطعة، كرتون...)', 'units', units);
    };
    paint();
    m.querySelector('#cx').onclick = async () => { m.remove(); draw(); };
    m.addEventListener('click', async e => {
      const add = e.target.closest('[data-add]'), del = e.target.closest('.del');
      try {
        if (add) {
          const col = add.dataset.add, inp = m.querySelector(`[data-in="${col}"]`), name = inp.value.trim();
          if (!name) return;
          const ref = await addDoc(collection(db, col), { name, createdAt: serverTimestamp() });
          (col === 'categories' ? cats : units).push({ id: ref.id, name }); paint();
        }
        if (del && confirm('حذف هذا العنصر؟ (المنتجات المرتبطة به تبقى بدون تصنيف/وحدة)')) {
          await deleteDoc(doc(db, del.dataset.c, del.dataset.id));
          if (del.dataset.c === 'categories') cats = cats.filter(x => x.id !== del.dataset.id);
          else units = units.filter(x => x.id !== del.dataset.id);
          paint();
        }
      } catch (err) { toast('تعذّر التنفيذ', true); }
    });
  }

  await load();
}
