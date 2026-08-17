import type { RfqDetail } from "../../services/rfqService";
import type { CompanySettings } from "../PrintDoc/DocHead";

// Builds the self-contained supplier reply form — ported from the prototype's
// rfqVendorFormHTML(r, v).
//
// It is a single standalone HTML file with no external dependencies, so it
// works on a supplier's phone or PC with no login and no internet: they fill in
// rates, GST% and transport, and the page produces a small JSON file they send
// back. Nothing is transmitted automatically, exactly as in the prototype.

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const slug = (s: string) => s.replace(/[^\w-]+/g, "-");

export function supplierFormFileName(rfqNo: string, vendorName: string): string {
  return `RateInquiry-${slug(rfqNo)}-${slug(vendorName)}.html`;
}

export function buildSupplierFormHtml(
  rfq: RfqDetail,
  vendor: { id: string; name: string; contact: string | null },
  settings: CompanySettings,
  dfmt: (d: string) => string
): string {
  const payload = { rfqId: rfq.id, rfqNo: rfq.no, vendorId: vendor.id, vendor: vendor.name };
  const replyName = `quotation-${slug(rfq.no)}-${slug(vendor.name)}.json`;

  const rows = rfq.rows
    .map(
      (l, i) => `<tr data-id="${esc(l.lineId)}">
<td>${i + 1}</td><td>${esc(l.name)}</td><td>${esc(l.make || "—")}</td><td>${esc(l.unit)}</td>
<td class="r qty">${l.qty}</td>
<td><input type="number" class="rate" min="0" step="0.01"></td>
<td><input type="number" class="gst" min="0" value="18"></td>
<td class="r amt">—</td>
<td><input type="text" class="rem" placeholder="e.g. 7 days delivery"></td></tr>`
    )
    .join("");

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Rate Inquiry ${esc(rfq.no)} — ${esc(vendor.name)}</title>
<style>
body{font-family:Arial,Helvetica,sans-serif;margin:0;background:#f4f6f7;color:#12262E}
.wrap{max-width:900px;margin:0 auto;padding:16px}
.card{background:#fff;border:1px solid #d6dfe1;border-radius:10px;padding:16px;margin-bottom:14px}
h1{font-size:18px;margin:0 0 4px}h2{font-size:14px;margin:0 0 8px}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{border:1px solid #d6dfe1;padding:6px;text-align:left}
th{background:#EFF3F4;font-size:11px;text-transform:uppercase}
td.r,th.r{text-align:right}
input,textarea{width:100%;box-sizing:border-box;padding:7px;border:1px solid #cfd8da;border-radius:6px;font-size:13px}
input[type=number]{text-align:right}
.btn{background:#0E6E7A;color:#fff;border:none;border-radius:8px;padding:12px 18px;font-size:15px;font-weight:700;cursor:pointer;width:100%}
.note{font-size:12px;color:#5B6E74}
.tot{font-weight:700;background:#EFF3F4}
.hdr{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px}
@media(max-width:600px){th,td{padding:4px;font-size:12px}.grid{grid-template-columns:1fr}}
</style></head><body><div class="wrap">

<div class="card"><div class="hdr">
<div><b style="font-size:17px">${esc(settings.companyName)}</b>
<div class="note">${esc(settings.address)}${settings.phone ? " · " + esc(settings.phone) : ""}${settings.email ? " · " + esc(settings.email) : ""}</div></div>
<div style="text-align:right"><h1>Rate Inquiry ${esc(rfq.no)}</h1>
<div class="note">Date ${esc(dfmt(rfq.date))}${rfq.due ? ` · Rates required by <b>${esc(dfmt(rfq.due))}</b>` : ""}</div></div>
</div></div>

<div class="card"><h2>To: ${esc(vendor.name)}${vendor.contact ? " — " + esc(vendor.contact) : ""}</h2>
<div class="note">Delivery to: ${esc(rfq.deliverTo || settings.address)}</div>
${rfq.note ? `<div class="note" style="margin-top:6px">${esc(rfq.note)}</div>` : ""}
<div class="grid">
<label>Your name<input id="f_name" placeholder="Person quoting"></label>
<label>Phone / email<input id="f_contact"></label>
<label>Your reference no.<input id="f_ref"></label>
<label>Validity (days)<input id="f_valid" type="number" value="30"></label>
</div></div>

<div class="card"><h2>Please fill your rates</h2>
<p class="note">Rate = per unit, exclusive of GST. Give GST % per item. Enter transport as a lump sum for the whole order. Leave the rate blank for items you cannot supply.</p>
<table><thead><tr><th>#</th><th>Item</th><th>Make</th><th>Unit</th><th class="r">Qty</th><th class="r">Rate (₹)</th><th class="r">GST %</th><th class="r">Amount</th><th>Remark</th></tr></thead>
<tbody>${rows}</tbody>
<tfoot>
<tr class="tot"><td colspan="7" class="r">Basic total</td><td class="r" id="t_basic">—</td><td></td></tr>
<tr class="tot"><td colspan="7" class="r">GST total</td><td class="r" id="t_gst">—</td><td></td></tr>
<tr><td colspan="7" class="r">Transport / freight (₹, lump sum)</td><td><input type="number" id="f_transport" min="0" value="0"></td><td><input type="text" id="f_transportNote" placeholder="e.g. included / extra at actuals"></td></tr>
<tr><td colspan="7" class="r">GST on transport %</td><td><input type="number" id="f_transportGst" min="0" value="18"></td><td></td></tr>
<tr class="tot"><td colspan="7" class="r">GRAND TOTAL</td><td class="r" id="t_grand">—</td><td></td></tr>
</tfoot></table>
<div class="grid">
<label>Delivery period<input id="f_delivery" placeholder="e.g. 7-10 days"></label>
<label>Payment terms<input id="f_payment" placeholder="e.g. 50% advance, balance on delivery"></label>
</div>
<label style="display:block;margin-top:10px">Other remarks<textarea id="f_remarks" rows="2"></textarea></label>
</div>

<div class="card">
<button class="btn" id="btnSend">Download my quotation to send back to ${esc(settings.companyName)}</button>
<p class="note" style="margin-top:8px">A small file <b>${esc(replyName)}</b> will download. Please send it back on WhatsApp / email. Nothing is sent automatically.</p>
<p class="note" id="msg"></p>
</div>

</div><script>
var P = ${JSON.stringify(payload)};
function n(x){return (Number(x)||0).toLocaleString('en-IN',{minimumFractionDigits:2});}
function calc(){
  var b=0,g=0;
  document.querySelectorAll('tbody tr').forEach(function(tr){
    var q=Number(tr.querySelector('.qty').textContent)||0;
    var rt=Number(tr.querySelector('.rate').value)||0;
    var gs=Number(tr.querySelector('.gst').value)||0;
    var a=q*rt;
    tr.querySelector('.amt').textContent = tr.querySelector('.rate').value===''?'—':n(a);
    b+=a; g+=a*gs/100;
  });
  var tr2=Number(document.getElementById('f_transport').value)||0;
  var tg=tr2*(Number(document.getElementById('f_transportGst').value)||0)/100;
  document.getElementById('t_basic').textContent=n(b);
  document.getElementById('t_gst').textContent=n(g);
  document.getElementById('t_grand').textContent=n(b+g+tr2+tg);
}
document.addEventListener('input',calc);calc();
document.getElementById('btnSend').onclick=function(){
  var items=[];
  document.querySelectorAll('tbody tr').forEach(function(tr){
    var raw=tr.querySelector('.rate').value;
    items.push({id:tr.dataset.id,rate:raw===''?null:Number(raw)||0,gst:Number(tr.querySelector('.gst').value)||0,remark:tr.querySelector('.rem').value});
  });
  var out=Object.assign({},P,{
    quotedBy:document.getElementById('f_name').value,
    contact:document.getElementById('f_contact').value,
    ref:document.getElementById('f_ref').value,
    validity:document.getElementById('f_valid').value,
    transport:Number(document.getElementById('f_transport').value)||0,
    transportNote:document.getElementById('f_transportNote').value,
    transportGst:Number(document.getElementById('f_transportGst').value)||0,
    delivery:document.getElementById('f_delivery').value,
    payment:document.getElementById('f_payment').value,
    remarks:document.getElementById('f_remarks').value,
    items:items,filledAt:new Date().toISOString()
  });
  if(!out.quotedBy){document.getElementById('msg').textContent='Please enter your name first.';return;}
  var blob=new Blob([JSON.stringify(out,null,1)],{type:'application/json'});
  var a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=${JSON.stringify(replyName)};
  document.body.appendChild(a);a.click();a.remove();
  document.getElementById('msg').textContent='Thank you — the file has downloaded. Please send it back.';
};
</script></body></html>`;
}

/** Triggers a browser download of a generated text file. */
export function downloadText(name: string, text: string, type = "text/html"): void {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
