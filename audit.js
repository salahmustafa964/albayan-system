// ============================================================
// البيان للتسويق | سجل العمليات (المراجعة)
// يعرض كل إدخال أو تعديل أو إلغاء بالتاريخ والوقت واسم المستخدم.
// السجل للقراءة فقط، ولا أحد يقدر يعدّله أو يحذفه (قواعد الأمان).
// ============================================================
import { db } from './firebase-init.js';
import { collection, getDocs, query, where, orderBy, limit, Timestamp }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const esc = s => String(s ?? '').replace(/[&<>"']/g,
  c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const key = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const when = ts => ts?.toDate ? ts.toDate().toLocaleString('ar-u-nu-latn') : '—';

const ACTIONS = { create: 'إضافة', update: 'تعديل', hide: 'إخفاء', unhide: 'إظهار', cancel: 'إلغاء', adjust: 'تسوية', delete: 'حذف', login: 'دخول' };
const ENTITIES = { product: 'منتج', purchase: 'شحنة شراء', sale: 'فاتورة بيع', user: 'مستخدم', stock: 'تسوية مخزون' };
const FIELDS = {
  name: 'الاسم', sku: 'الباركود', categoryId: 'التصنيف', unitId: 'الوحدة', purchasePrice: 'سعر الشراء',
  sellPrice: 'سعر البيع', minQty: 'حد التنبيه', openingQty: 'رصيد افتتاحي', isActive: 'مفعّل', status: 'الحالة',
  role: 'الدور', fullName: 'الاسم الكامل', email: 'البريد', items: 'عدد الأصناف', total: 'الإجمالي',
  totalSales: 'إجمالي البيع', invoiceNo: 'رقم الفاتورة', supplier: 'المورد', refNo: 'رقم الفاتورة',
  qty: 'الكمية', before: 'قبل', after: 'بعد', reason: 'السبب', product: 'المنتج'
};
const ROLES = { admin: 'مدير النظام', manager: 'مشرف', cashier: 'بائع' };

function val(v) {
  if (v === null || v === undefined || v === '') return '—';
  if (v === true) return 'نعم';
  if (v === false) return 'لا';
  if (typeof v === 'object') return JSON.stringify(v);
  if (typeof v === 'string' && ROLES[v]) return ROLES[v];
  return String(v);
}
function details(a) {
  const nv = a.newValues || {}, ov = a.oldValues || {};
  const keys = Object.keys(nv);
  if (!keys.length) return '—';
  return keys.map(k => {
    const lbl = FIELDS[k] || k;
    return (a.oldValues && k in ov)
      ? `<div><b>${esc(lbl)}:</b> ${esc(val(ov[k]))} ← ${esc(val(nv[k]))}</div>`
      : `<div><b>${esc(lbl)}:</b> ${esc(val(nv[k]))}</div>`;
  }).join('');
}

export async function renderAudit({ container, user }) {
  if (user.role !== 'admin') {
    container.innerHTML = '<h2>سجل العمليات</h2><div class="placeholder">هذه الصفحة لمدير النظام فقط.</div>';
    return;
  }
  const t = new Date(), f = new Date(t); f.setDate(f.getDate() - 6);
  let rows = [];

  container.innerHTML = `<h2>سجل العمليات</h2>
    <div class="toolbar">
      <label class="chk">من <input type="date" id="from" value="${key(f)}" style="flex:none"></label>
      <label class="chk">إلى <input type="date" id="to" value="${key(t)}" style="flex:none"></label>
      <select id="fe"><option value="">كل الأنواع</option>
        ${Object.entries(ENTITIES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
      <select id="fa"><option value="">كل العمليات</option>
        ${Object.entries(ACTIONS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
      <input id="fu" placeholder="اسم المستخدم...">
      <button class="btn" id="go">عرض</button>
    </div>
    <div id="out"><div class="loading">جارٍ التحميل...</div></div>`;
  const $ = id => container.querySelector('#' + id);

  async function load() {
    $('out').innerHTML = '<div class="loading">جارٍ التحميل...</div>';
    const from = $('from').value, to = $('to').value;
    if (!from || !to || from > to) { $('out').innerHTML = '<div class="error" style="display:block">تأكد من التواريخ.</div>'; return; }
    const start = Timestamp.fromDate(new Date(from + 'T00:00:00'));
    const end = Timestamp.fromDate(new Date(to + 'T23:59:59.999'));
    try {
      const s = await getDocs(query(collection(db, 'auditLog'),
        where('createdAt', '>=', start), where('createdAt', '<=', end), orderBy('createdAt', 'desc'), limit(500)));
      rows = s.docs.map(d => ({ id: d.id, ...d.data() }));
      paint();
    } catch (e) {
      console.error(e);
      $('out').innerHTML = '<div class="error" style="display:block">تعذّر تحميل السجل.</div>';
    }
  }

  function paint() {
    const fe = $('fe').value, fa = $('fa').value, fu = $('fu').value.trim().toLowerCase();
    const list = rows.filter(a => (!fe || a.entity === fe) && (!fa || a.action === fa) &&
      (!fu || (a.userName || '').toLowerCase().includes(fu)));
    $('out').innerHTML = `<div class="table-wrap"><table>
      <thead><tr><th>الوقت</th><th>المستخدم</th><th>العملية</th><th>النوع</th><th>التفاصيل</th></tr></thead>
      <tbody>${list.map(a => `<tr><td style="white-space:nowrap">${when(a.createdAt)}</td><td>${esc(a.userName) || '—'}</td>
        <td><span class="badge ${['cancel', 'delete', 'hide'].includes(a.action) ? 'low' : 'ok'}">${esc(ACTIONS[a.action] || a.action)}</span></td>
        <td>${esc(ENTITIES[a.entity] || a.entity)}</td><td class="det">${details(a)}</td></tr>`).join('')
        || '<tr><td colspan="5" class="muted" style="text-align:center">لا توجد عمليات في هذه الفترة</td></tr>'}</tbody></table></div>
      <p class="muted">${list.length} عملية${rows.length >= 500 ? ' (أحدث 500 عملية في الفترة، ضيّق الفترة لرؤية الباقي)' : ''}</p>`;
  }

  $('go').onclick = load;
  ['fe', 'fa'].forEach(id => $(id).onchange = paint);
  $('fu').oninput = paint;
  await load();
}
