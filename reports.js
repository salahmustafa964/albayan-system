// ============================================================
// البيان للتسويق | التقارير المالية والأرباح
// تُحسب من الفواتير المكتملة نفسها (وليس من ملخصات مخزّنة)، فالأرقام
// دقيقة دائماً حتى بعد الإلغاء. الصفحة للمدير والمشرف فقط.
// ============================================================
import { db } from './firebase-init.js';
import * as store from './store.js';
import { collection, getDocs, getDoc, doc, query, where }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-lite.js";

const esc = s => String(s ?? '').replace(/[&<>"']/g,
  c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const fmt = n => '\u200E' + Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });   // LRM: يمنع انقلاب علامة السالب في الجمل العربية
const pct = (a, b) => b > 0 ? '\u200E' + (a / b * 100).toLocaleString('en-US', { maximumFractionDigits: 1 }) + '%' : '—';
const pad = n => String(n).padStart(2, '0');
const key = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const dateAr = s => parse(s).toLocaleDateString('ar-u-nu-latn', { weekday: 'short', year: 'numeric', month: 'numeric', day: 'numeric' });

function toast(msg, bad) {
  const t = document.createElement('div');
  t.className = 'toast' + (bad ? ' bad' : '');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

// بداية الأسبوع السبت (الأسبوع السوداني)
const weekStart = d => { const x = new Date(d); x.setDate(x.getDate() - ((x.getDay() + 1) % 7)); return x; };

function rangeFor(preset) {
  const t = new Date(), to = key(t);
  if (preset === 'today') return [to, to];
  if (preset === '7') { const f = new Date(t); f.setDate(f.getDate() - 6); return [key(f), to]; }
  if (preset === '30') { const f = new Date(t); f.setDate(f.getDate() - 29); return [key(f), to]; }
  if (preset === 'month') return [key(new Date(t.getFullYear(), t.getMonth(), 1)), to];
  if (preset === 'lastmonth') return [key(new Date(t.getFullYear(), t.getMonth() - 1, 1)), key(new Date(t.getFullYear(), t.getMonth(), 0))];
  return [to, to];
}

export async function renderReports({ container, user, currency }) {
  if (!['admin', 'manager'].includes(user.role)) {
    container.innerHTML = '<h2>التقارير</h2><div class="placeholder">هذه الصفحة للمدير والمشرف فقط.</div>';
    return;
  }
  let company = {};
  try { const c = await getDoc(doc(db, 'company_settings', 'main')); company = c.exists() ? c.data() : {}; } catch (e) { /* افتراضي */ }

  let preset = '7', group = 'day';
  let [from, to] = rangeFor(preset);
  let data = null;

  container.innerHTML = `<h2>التقارير والأرباح</h2>
    <div class="print-only prt-head"><img src="${esc(company.logoUrl || 'logo.jpg')}" alt=""><div>
      <h1>${esc(company.nameAr || 'البيان للتسويق')}</h1><div id="prtRange"></div></div></div>
    <div class="toolbar noprint">
      <select id="preset">
        <option value="today">اليوم</option><option value="7">آخر 7 أيام</option>
        <option value="month">هذا الشهر</option><option value="lastmonth">الشهر الماضي</option>
        <option value="30">آخر 30 يوماً</option><option value="custom">فترة مخصصة</option></select>
      <label class="chk">من <input type="date" id="from" style="flex:none"></label>
      <label class="chk">إلى <input type="date" id="to" style="flex:none"></label>
      <select id="group"><option value="day">تجميع يومي</option><option value="week">تجميع أسبوعي</option><option value="month">تجميع شهري</option></select>
      <button class="btn" id="go">عرض التقرير</button>
    </div>
    <div id="out"><div class="loading">جارٍ إعداد التقرير...</div></div>`;

  const $ = id => container.querySelector('#' + id);
  $('preset').value = preset; $('group').value = group; $('from').value = from; $('to').value = to;

  $('preset').onchange = () => {
    preset = $('preset').value;
    if (preset !== 'custom') { [from, to] = rangeFor(preset); $('from').value = from; $('to').value = to; run(); }
  };
  $('from').onchange = $('to').onchange = () => { $('preset').value = 'custom'; };
  $('group').onchange = () => { group = $('group').value; if (data) paint(); };
  $('go').onclick = () => { from = $('from').value; to = $('to').value; group = $('group').value; run(); };

  async function run() {
    if (!from || !to || from > to) return toast('تأكد من تواريخ الفترة (من أقل من أو يساوي إلى)', true);
    $('out').innerHTML = '<div class="loading">جارٍ إعداد التقرير...</div>';
    try {
      const [sSnap, pSnap, prodSnap] = await Promise.all([
        getDocs(query(collection(db, 'sales'), where('saleDate', '>=', from), where('saleDate', '<=', to))),
        getDocs(query(collection(db, 'purchases'), where('purchaseDate', '>=', from), where('purchaseDate', '<=', to))),
        store.load('products')
      ]);
      data = {
        sales: sSnap.docs.map(d => d.data()).filter(s => s.status !== 'cancelled'),
        cancelled: sSnap.docs.filter(d => d.data().status === 'cancelled').length,
        purchases: pSnap.docs.map(d => d.data()),
        products: prodSnap.filter(p => p.isActive !== false)
      };
      paint();
    } catch (e) { console.error(e); $('out').innerHTML = '<div class="error" style="display:block">تعذّر تحميل التقرير. تأكد من اتصالك وصلاحياتك.</div>'; }
  }

  function groupKey(saleDate) {
    if (group === 'day') return [saleDate, dateAr(saleDate)];
    if (group === 'week') { const w = key(weekStart(parse(saleDate))); return [w, 'أسبوع يبدأ ' + dateAr(w)]; }
    const [y, m] = saleDate.split('-');
    return [`${y}-${m}`, new Date(+y, +m - 1, 1).toLocaleDateString('ar-u-nu-latn', { month: 'long', year: 'numeric' })];
  }

  function paint() {
    const { sales, purchases, products, cancelled } = data;
    const tot = { sales: 0, cost: 0, profit: 0, discount: 0 };
    const groups = new Map(), prods = new Map();
    for (const s of sales) {
      tot.sales += s.totalSales || 0; tot.cost += s.totalCost || 0; tot.profit += s.totalProfit || 0; tot.discount += s.discount || 0;
      const [k, label] = groupKey(s.saleDate);
      const g = groups.get(k) || { k, label, n: 0, sales: 0, cost: 0, profit: 0 };
      g.n++; g.sales += s.totalSales || 0; g.cost += s.totalCost || 0; g.profit += s.totalProfit || 0; groups.set(k, g);
      for (const i of s.items || []) {
        const p = prods.get(i.productId) || { name: i.name, qty: 0, sales: 0, cost: 0, profit: 0 };
        p.qty += i.qty; p.sales += i.lineTotal || 0; p.cost += i.lineCost || 0; p.profit += i.lineProfit || 0; prods.set(i.productId, p);
      }
    }
    const gl = [...groups.values()].sort((a, b) => a.k.localeCompare(b.k));
    const pl = [...prods.values()].sort((a, b) => b.profit - a.profit);
    const bought = purchases.reduce((a, p) => a + (p.total || 0), 0);
    const stockCost = products.reduce((a, p) => a + (p.currentQty || 0) * (p.avgCost || 0), 0);
    const stockSell = products.reduce((a, p) => a + (p.currentQty || 0) * (p.sellPrice || 0), 0);
    const maxS = Math.max(1, ...gl.map(g => g.sales));
    const cur = `<small>${esc(currency)}</small>`;

    $('prtRange').textContent = `تقرير من ${dateAr(from)} إلى ${dateAr(to)}`;
    $('out').innerHTML = `
      <p class="muted noprint">الفترة: ${dateAr(from)} ← ${dateAr(to)} · الفواتير الملغاة (${fmt(cancelled)}) غير محسوبة.</p>
      <div class="cards">
        <div class="stat"><small>إجمالي المبيعات</small><b>${fmt(tot.sales)} ${cur}</b></div>
        <div class="stat"><small>إجمالي التكاليف (تكلفة المباع)</small><b>${fmt(tot.cost)} ${cur}</b></div>
        <div class="stat profit"><small>صافي الربح</small><b>${fmt(tot.profit)} ${cur}</b></div>
        <div class="stat"><small>هامش الربح</small><b>${pct(tot.profit, tot.sales)}</b></div>
        <div class="stat"><small>عدد الفواتير</small><b>${fmt(sales.length)}</b></div>
        <div class="stat"><small>إجمالي الخصومات</small><b>${fmt(tot.discount)} ${cur}</b></div>
        <div class="stat"><small>مشتريات الفترة (الوارد)</small><b>${fmt(bought)} ${cur}</b></div>
        <div class="stat"><small>قيمة المخزون الحالي (بالتكلفة)</small><b>${fmt(stockCost)} ${cur}</b></div>
        <div class="stat"><small>قيمة المخزون الحالي (بسعر البيع)</small><b>${fmt(stockSell)} ${cur}</b></div>
      </div>

      <div class="rep-head"><h3>${group === 'day' ? 'التقرير اليومي' : group === 'week' ? 'التقرير الأسبوعي' : 'التقرير الشهري'}</h3>
        <span class="noprint"><button class="btn btn-light" id="csv1">تصدير Excel</button></span></div>
      <div class="table-wrap"><table><thead><tr><th>الفترة</th><th>الفواتير</th><th>المبيعات</th><th>التكلفة</th><th>صافي الربح</th><th>الهامش</th><th class="noprint">الرسم</th></tr></thead>
        <tbody>${gl.map(g => `<tr><td>${esc(g.label)}</td><td>${fmt(g.n)}</td><td>${fmt(g.sales)}</td><td>${fmt(g.cost)}</td>
          <td><b style="color:${g.profit < 0 ? 'var(--danger)' : 'var(--ok)'}">${fmt(g.profit)}</b></td><td>${pct(g.profit, g.sales)}</td>
          <td class="noprint"><div class="bar"><i style="width:${g.sales / maxS * 100}%"></i><b style="width:${Math.max(0, g.profit) / maxS * 100}%"></b></div></td></tr>`).join('')
          || '<tr><td colspan="7" class="muted" style="text-align:center">لا توجد مبيعات في هذه الفترة</td></tr>'}
        ${gl.length ? `<tr class="sum"><td>الإجمالي</td><td>${fmt(sales.length)}</td><td>${fmt(tot.sales)}</td><td>${fmt(tot.cost)}</td><td>${fmt(tot.profit)}</td><td>${pct(tot.profit, tot.sales)}</td><td class="noprint"></td></tr>` : ''}
        </tbody></table></div>

      <div class="rep-head"><h3>الربح حسب المنتج</h3>
        <span class="noprint"><button class="btn btn-light" id="csv2">تصدير Excel</button> <button class="btn" id="prt">طباعة التقرير</button></span></div>
      <div class="table-wrap"><table><thead><tr><th>المنتج</th><th>الكمية المباعة</th><th>المبيعات</th><th>التكلفة</th><th>الربح</th><th>الهامش</th></tr></thead>
        <tbody>${pl.map(p => `<tr><td><b>${esc(p.name)}</b></td><td>${fmt(p.qty)}</td><td>${fmt(p.sales)}</td><td>${fmt(p.cost)}</td>
          <td><b style="color:${p.profit < 0 ? 'var(--danger)' : 'var(--ok)'}">${fmt(p.profit)}</b></td><td>${pct(p.profit, p.sales)}</td></tr>`).join('')
          || '<tr><td colspan="6" class="muted" style="text-align:center">لا توجد بيانات</td></tr>'}</tbody></table></div>
      <p class="muted">ملاحظة: ربح المنتجات قبل خصم الفاتورة، وصافي الربح الإجمالي بعد خصم الفواتير.</p>`;

    $('prt').onclick = () => window.print();
    $('csv1').onclick = () => csv(`تقرير-${group}-${from}_${to}.csv`,
      [['الفترة', 'الفواتير', 'المبيعات', 'التكلفة', 'صافي الربح'], ...gl.map(g => [g.label, g.n, g.sales, g.cost, g.profit]),
       ['الإجمالي', sales.length, tot.sales, tot.cost, tot.profit]]);
    $('csv2').onclick = () => csv(`ربح-المنتجات-${from}_${to}.csv`,
      [['المنتج', 'الكمية المباعة', 'المبيعات', 'التكلفة', 'الربح'], ...pl.map(p => [p.name, p.qty, p.sales, p.cost, p.profit])]);
  }

  function csv(name, rows) {
    const body = rows.map(r => r.map(c => `"${String(typeof c === 'number' ? Math.round(c * 100) / 100 : c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['\uFEFF' + body], { type: 'text/csv;charset=utf-8' }));
    a.download = name; document.body.appendChild(a); a.click(); a.remove();
  }

  await run();
}
