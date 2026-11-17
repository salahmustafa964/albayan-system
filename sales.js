// ============================================================
// البيان للتسويق | صفحة المبيعات والفواتير
// كل فاتورة تُحفظ داخل Transaction واحدة: تتحقق من الرصيد، تخصم
// الكميات، تثبّت سعر البيع وتكلفة الشراء وقت العملية لحساب الربح،
// تحدّث ملخص اليوم، وتكتب حركة المخزن وسجل المراجعة.
// ============================================================
import { db, serverTimestamp } from './firebase-init.js';
import {
  collection, getDocs, getDoc, doc, addDoc, runTransaction, increment, query, where
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const esc = s => String(s ?? '').replace(/[&<>"']/g,
  c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const fmt = n => Number(n || 0).toLocaleString('ar-EG', { maximumFractionDigits: 2 });
const num = v => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
const r2 = n => Math.round(n * 100) / 100;
const pad = n => String(n).padStart(2, '0');
const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const when = ts => ts?.toDate ? ts.toDate().toLocaleString('ar-EG') : '—';
const timeOnly = ts => ts?.toDate ? ts.toDate().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }) : '';
const newInvoiceNo = () => {
  const d = new Date();
  return `INV-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}${Math.floor(Math.random() * 90 + 10)}`;
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

export async function renderSales({ container, user, currency }) {
  const isMgr = ['admin', 'manager'].includes(user.role);
  const by = { userId: user.uid, userName: user.fullName || user.email };
  let products = [], customers = [], sales = [], company = {};
  let date = dayKey();

  async function loadBase() {
    const read = async n => (await getDocs(collection(db, n))).docs.map(d => ({ id: d.id, ...d.data() }));
    [products, customers] = await Promise.all([read('products'), read('customers')]);
    products = products.filter(p => p.isActive !== false).sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ar'));
    customers.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ar'));
    try { const c = await getDoc(doc(db, 'company_settings', 'main')); company = c.exists() ? c.data() : {}; } catch (e) { company = {}; }
  }
  async function loadSales() {
    const s = await getDocs(query(collection(db, 'sales'), where('saleDate', '==', date)));
    sales = s.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
  }

  async function start() {
    container.innerHTML = '<div class="loading">جارٍ تحميل المبيعات...</div>';
    await loadBase(); await loadSales(); draw();
  }

  function draw() {
    const ok = sales.filter(s => s.status !== 'cancelled');
    const tSales = ok.reduce((a, s) => a + (s.totalSales || 0), 0);
    const tProfit = ok.reduce((a, s) => a + (s.totalProfit || 0), 0);
    container.innerHTML = `<h2>المبيعات</h2>
      <div class="toolbar">
        <button class="btn" id="new">+ فاتورة بيع جديدة</button>
        <label class="chk">فواتير يوم: <input type="date" id="day" value="${date}" style="flex:none"></label>
      </div>
      <div class="cards" style="margin-bottom:1rem">
        <div class="stat"><small>عدد الفواتير</small><b>${fmt(ok.length)}</b></div>
        <div class="stat"><small>إجمالي المبيعات</small><b>${fmt(tSales)} <small>${esc(currency)}</small></b></div>
        ${isMgr ? `<div class="stat profit"><small>صافي الربح</small><b>${fmt(tProfit)} <small>${esc(currency)}</small></b></div>` : ''}
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>رقم الفاتورة</th><th>الوقت</th><th>العميل</th><th>الإجمالي</th>${isMgr ? '<th>الربح</th>' : ''}<th>الحالة</th><th></th></tr></thead>
        <tbody>${sales.map(s => `<tr style="${s.status === 'cancelled' ? 'opacity:.5' : ''}">
          <td dir="ltr">${esc(s.invoiceNo)}</td><td>${timeOnly(s.createdAt)}</td><td>${esc(s.customerName) || 'عميل نقدي'}</td>
          <td><b>${fmt(s.totalSales)}</b></td>${isMgr ? `<td>${fmt(s.totalProfit)}</td>` : ''}
          <td>${s.status === 'cancelled' ? '<span class="badge low">ملغاة</span>' : '<span class="badge ok">مكتملة</span>'}</td>
          <td class="acts"><button class="lnk" data-a="view" data-id="${s.id}">عرض</button>
            <button class="lnk" data-a="print" data-id="${s.id}">طباعة</button>
            ${isMgr && s.status !== 'cancelled' ? `<button class="lnk del" data-a="cancel" data-id="${s.id}">إلغاء</button>` : ''}</td></tr>`).join('')
          || `<tr><td colspan="7" class="muted" style="text-align:center">لا توجد فواتير في هذا اليوم</td></tr>`}</tbody></table></div>`;
    container.querySelector('#new').onclick = openForm;
    container.querySelector('#day').onchange = async e => { date = e.target.value || dayKey(); await loadSales(); draw(); };
    container.querySelector('tbody').addEventListener('click', e => {
      const b = e.target.closest('button[data-a]'); if (!b) return;
      const s = sales.find(x => x.id === b.dataset.id);
      if (b.dataset.a === 'view') openInvoice(s);
      if (b.dataset.a === 'print') printInvoice(s);
      if (b.dataset.a === 'cancel') cancelSale(s);
    });
  }

  // ---------- الفاتورة ----------
  function invoiceHTML(s, forPrint) {
    const logo = new URL(company.logoUrl || 'logo.jpg', location.href).href;
    const rows = (s.items || []).map((i, n) => `<tr><td>${n + 1}</td><td>${esc(i.name)}</td><td>${fmt(i.qty)}</td><td>${fmt(i.unitPrice)}</td><td>${fmt(i.lineTotal)}</td></tr>`).join('');
    return `<div class="inv">
      <div class="inv-head"><img src="${logo}" alt=""><div><h1>${esc(company.nameAr || 'البيان للتسويق')}</h1>
        <div>${esc(company.phone || '')} ${esc(company.address || '')}</div></div></div>
      <div class="inv-meta"><div>فاتورة بيع رقم: <b dir="ltr">${esc(s.invoiceNo)}</b></div>
        <div>التاريخ: ${when(s.createdAt)}</div><div>العميل: ${esc(s.customerName) || 'عميل نقدي'}</div>
        ${s.status === 'cancelled' ? '<div style="color:#d64545;font-weight:700">** فاتورة ملغاة **</div>' : ''}</div>
      <table><thead><tr><th>#</th><th>الصنف</th><th>الكمية</th><th>السعر</th><th>الإجمالي</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="inv-tot">
        ${s.discount ? `<div>المجموع: ${fmt(s.subtotal)} ${esc(currency)}</div><div>الخصم: ${fmt(s.discount)} ${esc(currency)}</div>` : ''}
        <div class="grand">الإجمالي: ${fmt(s.totalSales)} ${esc(currency)}</div></div>
      ${s.notes ? `<p>ملاحظات: ${esc(s.notes)}</p>` : ''}
      <p class="inv-foot">${esc(company.invoiceFooter || 'شكراً لتعاملكم معنا')}</p></div>`;
  }
  const invCSS = `.inv{font-family:Tahoma,Arial,sans-serif;direction:rtl;color:#1d2b2e}
    .inv .inv-head{display:flex;align-items:center;gap:14px;border-bottom:2px solid #1f9aa3;padding-bottom:10px}
    .inv .inv-head img{height:80px}.inv .inv-head h1{margin:0;color:#157a82;font-size:22px}
    .inv .inv-meta{display:flex;flex-wrap:wrap;gap:6px 24px;margin:12px 0;font-size:14px}
    .inv table{width:100%;border-collapse:collapse;font-size:14px;min-width:0}
    .inv th,.inv td{border:1px solid #ccd;padding:6px 8px;text-align:right}
    .inv th{background:#e3f4f5}.inv .inv-tot{margin-top:10px;text-align:left;font-size:14px}
    .inv .grand{font-size:18px;font-weight:700;color:#157a82}
    .inv .inv-foot{text-align:center;color:#6b7b80;margin-top:24px}`;

  function openInvoice(s) {
    const m = modal(`<style>${invCSS}</style>${invoiceHTML(s)}
      <div class="modal-acts"><button class="btn" id="pr">طباعة</button><button class="btn btn-light" id="cx">إغلاق</button></div>`, true);
    m.querySelector('#pr').onclick = () => printInvoice(s);
    m.querySelector('#cx').onclick = () => m.remove();
  }
  function printInvoice(s) {
    const f = document.createElement('iframe');
    f.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0';
    document.body.appendChild(f);
    f.contentDocument.write(`<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><title>${esc(s.invoiceNo)}</title><style>body{margin:0;padding:16px}${invCSS}</style></head><body>${invoiceHTML(s)}</body></html>`);
    f.contentDocument.close();
    setTimeout(() => { f.contentWindow.focus(); f.contentWindow.print(); setTimeout(() => f.remove(), 1500); }, 600);
  }

  // ---------- عميل جديد ----------
  function openCustomer(after) {
    const m = modal(`<form id="cf"><h3>عميل جديد</h3>
      <div class="field"><label>اسم العميل *</label><input name="name" required></div>
      <div class="field"><label>الهاتف</label><input name="phone" dir="ltr"></div>
      <div class="modal-acts"><button class="btn" type="submit">حفظ</button><button class="btn btn-light" type="button" id="cx">إلغاء</button></div></form>`);
    m.querySelector('#cx').onclick = () => m.remove();
    m.querySelector('#cf').onsubmit = async e => {
      e.preventDefault();
      const f = new FormData(e.target);
      try {
        const data = { name: f.get('name').trim(), phone: f.get('phone').trim(), createdAt: serverTimestamp() };
        const ref = await addDoc(collection(db, 'customers'), data);
        customers.push({ id: ref.id, ...data });
        m.remove(); after(ref.id);
      } catch (x) { toast('تعذّر الحفظ', true); }
    };
  }

  // ---------- فاتورة بيع جديدة ----------
  function openForm() {
    const avail = products.filter(p => (p.currentQty || 0) > 0);
    if (!avail.length) return toast('لا توجد منتجات بها رصيد متاح للبيع', true);
    const m = modal(`<form id="sf"><h3>فاتورة بيع جديدة</h3><div class="error" id="perr"></div>
      <div class="field"><label>العميل</label><select name="customerId" id="cs"></select></div>
      <div id="items"></div>
      <button class="btn btn-light" type="button" id="addRow">+ إضافة صنف</button>
      <div class="grid2" style="margin-top:.8rem">
        <div class="field"><label>الخصم (${esc(currency)})</label><input name="discount" id="disc" type="number" step="any" min="0" value="0"></div>
        <div class="field"><label>ملاحظات</label><input name="notes"></div></div>
      <p style="margin:.6rem 0"><b>الإجمالي: <span id="tot">0</span> ${esc(currency)}</b></p>
      <div class="modal-acts"><button class="btn" type="submit">حفظ الفاتورة</button>
      <button class="btn btn-light" type="button" id="cx">إلغاء</button></div></form>`, true);

    const cs = m.querySelector('#cs');
    const fillCs = sel => cs.innerHTML = '<option value="">عميل نقدي</option>' +
      customers.map(c => `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${esc(c.name)}</option>`).join('') +
      '<option value="__new">+ عميل جديد...</option>';
    fillCs();
    cs.onchange = () => { if (cs.value === '__new') { cs.value = ''; openCustomer(id => fillCs(id)); } };

    const itemsEl = m.querySelector('#items');
    const opts = '<option value="">اختر المنتج...</option>' +
      avail.map(p => `<option value="${p.id}">${esc(p.name)} — الرصيد: ${fmt(p.currentQty)}</option>`).join('');
    const calc = () => {
      let sub = 0;
      itemsEl.querySelectorAll('.irow').forEach(r => {
        const l = num(r.querySelector('[name=qty]').value) * num(r.querySelector('[name=price]').value);
        r.querySelector('.lt').textContent = fmt(l); sub += l;
      });
      m.querySelector('#tot').textContent = fmt(Math.max(0, sub - num(m.querySelector('#disc').value)));
    };
    const addRow = () => {
      const r = document.createElement('div');
      r.className = 'irow';
      r.innerHTML = `<select name="pid">${opts}</select>
        <input name="qty" type="number" step="any" min="0" placeholder="الكمية">
        <input name="price" type="number" step="any" min="0" placeholder="سعر البيع" ${isMgr ? '' : 'readonly'}>
        <span class="lt">0</span><button type="button" class="lnk del">✕</button>`;
      r.querySelector('[name=pid]').onchange = e => {
        const p = products.find(x => x.id === e.target.value);
        if (p) { r.querySelector('[name=price]').value = p.sellPrice || 0; r.querySelector('[name=qty]').value ||= 1; }
        calc();
      };
      r.querySelector('.del').onclick = () => { r.remove(); calc(); };
      r.addEventListener('input', calc);
      itemsEl.appendChild(r);
    };
    addRow();
    m.querySelector('#addRow').onclick = addRow;
    m.querySelector('#cx').onclick = () => m.remove();

    m.querySelector('#sf').onsubmit = async e => {
      e.preventDefault();
      const err = msg => { const el = m.querySelector('#perr'); el.textContent = msg; el.style.display = 'block'; };
      const f = new FormData(e.target);
      const items = [];
      for (const r of itemsEl.querySelectorAll('.irow')) {
        const pid = r.querySelector('[name=pid]').value;
        const qty = num(r.querySelector('[name=qty]').value), price = num(r.querySelector('[name=price]').value);
        if (!pid && !qty) continue;
        if (!pid || qty <= 0) return err('أكمل بيانات كل صنف (المنتج والكمية أكبر من صفر).');
        items.push({ productId: pid, qty, unitPrice: price });
      }
      if (!items.length) return err('أضف صنفاً واحداً على الأقل.');
      if (items.length > 100) return err('الحد الأقصى 100 صنف في الفاتورة.');
      const sub = items.reduce((a, i) => a + i.qty * i.unitPrice, 0), discount = num(f.get('discount'));
      if (discount > sub) return err('الخصم أكبر من إجمالي الفاتورة.');
      if (isMgr) {
        const below = items.filter(i => i.unitPrice < (products.find(p => p.id === i.productId)?.avgCost || 0));
        if (below.length && !confirm('بعض الأصناف سعر بيعها أقل من التكلفة، هل تريد المتابعة؟')) return;
      }
      const cust = customers.find(c => c.id === f.get('customerId'));
      const btn = e.target.querySelector('[type=submit]'); btn.disabled = true; btn.textContent = 'جارٍ الحفظ...';
      try {
        const sale = await saveSale({ items, discount, notes: f.get('notes').trim(), customerId: cust?.id || '', customerName: cust?.name || '' });
        m.remove(); toast('تم حفظ الفاتورة');
        await loadBase(); date = dayKey(); await loadSales(); draw();
        if (confirm('هل تريد طباعة الفاتورة؟')) printInvoice(sale);
      } catch (ex) { console.error(ex); err(ex.message || 'تعذّر الحفظ'); btn.disabled = false; btn.textContent = 'حفظ الفاتورة'; }
    };
  }

  // ---------- الحفظ الذري ----------
  async function saveSale(v) {
    const sref = doc(collection(db, 'sales'));
    const invoiceNo = newInvoiceNo(), day = dayKey();
    let result;
    await runTransaction(db, async tx => {
      const ids = [...new Set(v.items.map(i => i.productId))];
      const st = {};
      for (const id of ids) {                                  // كل القراءات أولاً
        const s = await tx.get(doc(db, 'products', id));
        if (!s.exists()) throw new Error('أحد المنتجات لم يعد موجوداً');
        const d = s.data();
        if (d.isActive === false) throw new Error(`المنتج "${d.name}" مخفي ولا يمكن بيعه`);
        st[id] = { qty: d.currentQty || 0, avg: d.avgCost || 0, name: d.name };
      }
      const lines = [];
      for (const it of v.items) {
        const s = st[it.productId];
        if (s.qty < it.qty) throw new Error(`الرصيد غير كافٍ للمنتج "${s.name}" (المتاح ${fmt(s.qty)})`);
        s.qty -= it.qty;
        const lineTotal = r2(it.qty * it.unitPrice), lineCost = r2(it.qty * s.avg);
        lines.push({ productId: it.productId, name: s.name, qty: it.qty, unitPrice: it.unitPrice, unitCost: s.avg,
          lineTotal, lineCost, lineProfit: r2(lineTotal - lineCost), balanceAfter: s.qty });
      }
      const subtotal = r2(lines.reduce((a, l) => a + l.lineTotal, 0));
      const totalSales = r2(subtotal - v.discount);
      const totalCost = r2(lines.reduce((a, l) => a + l.lineCost, 0));
      const totalProfit = r2(totalSales - totalCost);

      for (const l of lines) tx.set(doc(collection(db, 'stockMovements')), {
        productId: l.productId, movementType: 'out', qty: -l.qty, balanceAfter: l.balanceAfter,
        refType: 'sale', refId: sref.id, createdBy: user.uid, createdAt: serverTimestamp() });
      for (const id of ids) tx.update(doc(db, 'products', id), { currentQty: st[id].qty, updatedAt: serverTimestamp() });

      const items = lines.map(({ balanceAfter, ...rest }) => rest);
      const data = { invoiceNo, saleDate: day, customerId: v.customerId, customerName: v.customerName,
        items, subtotal, discount: v.discount, totalSales, totalCost, totalProfit, status: 'completed',
        notes: v.notes, createdBy: user.uid, createdByName: by.userName, createdAt: serverTimestamp() };
      tx.set(sref, data);
      tx.set(doc(db, 'dailyStats', day), { totalSales: increment(totalSales), totalCost: increment(totalCost),
        netProfit: increment(totalProfit), invoicesCount: increment(1), updatedAt: serverTimestamp() }, { merge: true });
      tx.set(doc(collection(db, 'auditLog')), { ...by, action: 'create', entity: 'sale', entityId: sref.id,
        oldValues: null, newValues: { invoiceNo, items: items.length, totalSales }, createdAt: serverTimestamp() });
      result = { ...data, id: sref.id, createdAt: { toDate: () => new Date() } };
    });
    return result;
  }

  // ---------- إلغاء فاتورة (للمشرف) ----------
  async function cancelSale(s) {
    if (!confirm(`إلغاء الفاتورة ${s.invoiceNo}؟ ستعود الكميات للمخزن ويُخصم المبلغ من تقرير اليوم.`)) return;
    try {
      await runTransaction(db, async tx => {
        const sref = doc(db, 'sales', s.id);
        const cur = await tx.get(sref);
        if (!cur.exists() || cur.data().status !== 'completed') throw new Error('الفاتورة ملغاة مسبقاً');
        const ids = [...new Set(s.items.map(i => i.productId))];
        const st = {};
        for (const id of ids) {
          const p = await tx.get(doc(db, 'products', id));
          st[id] = p.exists() ? (p.data().currentQty || 0) : null;
        }
        for (const it of s.items) {
          if (st[it.productId] === null) continue;
          st[it.productId] += it.qty;
          tx.set(doc(collection(db, 'stockMovements')), { productId: it.productId, movementType: 'return_in', qty: it.qty,
            balanceAfter: st[it.productId], refType: 'sale', refId: s.id, createdBy: user.uid, createdAt: serverTimestamp() });
        }
        for (const id of ids) if (st[id] !== null) tx.update(doc(db, 'products', id), { currentQty: st[id], updatedAt: serverTimestamp() });
        tx.update(sref, { status: 'cancelled', cancelledAt: serverTimestamp(), cancelledBy: user.uid });
        tx.set(doc(db, 'dailyStats', s.saleDate), { totalSales: increment(-s.totalSales), totalCost: increment(-s.totalCost),
          netProfit: increment(-s.totalProfit), invoicesCount: increment(-1), updatedAt: serverTimestamp() }, { merge: true });
        tx.set(doc(collection(db, 'auditLog')), { ...by, action: 'cancel', entity: 'sale', entityId: s.id,
          oldValues: { status: 'completed' }, newValues: { status: 'cancelled', invoiceNo: s.invoiceNo }, createdAt: serverTimestamp() });
      });
      toast('تم إلغاء الفاتورة وإرجاع الكميات');
      await loadBase(); await loadSales(); draw();
    } catch (e) { console.error(e); toast(e.message || 'تعذّر الإلغاء', true); }
  }

  await start();
}
