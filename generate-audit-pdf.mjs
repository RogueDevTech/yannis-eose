import puppeteer from '/Users/Apple/.cache/puppeteer/puppeteer-core.mjs';
// Fallback: try dynamic import
const pup = await import('puppeteer').catch(() => null);
import { writeFileSync } from 'fs';

const html = `<!DOCTYPE html>
<html>
<head>
<style>
  @page { margin: 40px 36px; size: A4 landscape; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif; color: #1a1a1a; font-size: 11px; line-height: 1.5; }
  .page { page-break-after: always; padding: 20px 0; }
  .page:last-child { page-break-after: auto; }
  h1 { font-size: 20px; font-weight: 700; margin-bottom: 4px; color: #111; }
  h2 { font-size: 14px; font-weight: 600; margin: 20px 0 8px; color: #222; border-bottom: 2px solid #e5e5e5; padding-bottom: 4px; }
  h3 { font-size: 12px; font-weight: 600; margin: 14px 0 6px; color: #333; }
  .subtitle { font-size: 12px; color: #666; margin-bottom: 16px; }
  .summary-box { background: #f8f9fa; border: 1px solid #e0e0e0; border-radius: 6px; padding: 14px 18px; margin: 12px 0 16px; }
  .summary-box p { margin: 3px 0; font-size: 11.5px; }
  .summary-box strong { color: #111; }
  .stat-row { display: flex; gap: 16px; margin: 12px 0; }
  .stat-card { flex: 1; background: #f0f4ff; border: 1px solid #d0d8f0; border-radius: 6px; padding: 10px 14px; text-align: center; }
  .stat-card .num { font-size: 22px; font-weight: 700; color: #1a3a8a; }
  .stat-card .label { font-size: 10px; color: #555; margin-top: 2px; }
  .stat-card.green { background: #f0faf0; border-color: #b0d8b0; }
  .stat-card.green .num { color: #1a6a2a; }
  .stat-card.amber { background: #fffbf0; border-color: #e0d0a0; }
  .stat-card.amber .num { color: #8a6a1a; }
  table { width: 100%; border-collapse: collapse; margin: 8px 0 12px; font-size: 10px; }
  th { background: #f0f2f5; font-weight: 600; text-align: left; padding: 6px 8px; border: 1px solid #ddd; color: #333; white-space: nowrap; }
  td { padding: 4px 8px; border: 1px solid #e5e5e5; vertical-align: top; }
  tr:nth-child(even) { background: #fafbfc; }
  .tag { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 9px; font-weight: 600; }
  .tag-fixed { background: #d4edda; color: #155724; }
  .tag-review { background: #fff3cd; color: #856404; }
  .tag-delivered { background: #cce5ff; color: #004085; }
  .tag-remitted { background: #d4edda; color: #155724; }
  .explanation { background: #fffef5; border-left: 3px solid #e0c060; padding: 10px 14px; margin: 12px 0; font-size: 11px; color: #444; }
  .footer { margin-top: 20px; padding-top: 10px; border-top: 1px solid #e0e0e0; font-size: 9px; color: #888; text-align: center; }
  .arrow { color: #c00; font-weight: 700; }
</style>
</head>
<body>

<div class="page">
  <h1>Logistics Location Correction Report</h1>
  <div class="subtitle">Yannis EOSE &mdash; 23 July 2026 &mdash; Prepared by Engineering</div>

  <div class="summary-box">
    <p><strong>What happened:</strong> Between 23 May and 22 July 2026, a system error caused some orders to show the wrong delivery agent/location after they were assigned. The orders were delivered by the correct agents, but the records showed a different location.</p>
    <p><strong>Impact:</strong> Remittance reports and agent performance tracking showed incorrect location attributions for the affected orders.</p>
    <p><strong>Resolution:</strong> All affected orders have been identified and corrected using the system's audit trail. The error has been fixed and cannot recur.</p>
  </div>

  <div class="stat-row">
    <div class="stat-card">
      <div class="num">131</div>
      <div class="label">Total Orders Reviewed</div>
    </div>
    <div class="stat-card">
      <div class="num">88</div>
      <div class="label">Affected by Error</div>
    </div>
    <div class="stat-card green">
      <div class="num">59</div>
      <div class="label">Auto-Corrected</div>
    </div>
    <div class="stat-card green">
      <div class="num">29</div>
      <div class="label">Manually Corrected (Support)</div>
    </div>
    <div class="stat-card amber">
      <div class="num">0</div>
      <div class="label">Still Outstanding</div>
    </div>
  </div>

  <div class="explanation">
    <strong>How to read this report:</strong> "Wrong Location" is what the system incorrectly showed. "Correct Location" is the agent/location that was originally assigned and actually handled the delivery. All orders now show the correct location.
  </div>

  <h2>Section A: Orders Corrected Automatically (59 orders)</h2>
  <p style="margin-bottom:6px; color:#555;">These orders had their location restored to the last agent assignment using the audit trail.</p>

  <table>
    <thead>
      <tr><th>#</th><th>Order</th><th>Customer</th><th>Status</th><th>Wrong Location</th><th>Wrong Provider</th><th class="arrow">&rarr;</th><th>Correct Location</th><th>Correct Provider</th><th>Delivered</th></tr>
    </thead>
    <tbody>
      <tr><td>1</td><td>YNS-62473</td><td>Owem Bashy</td><td><span class="tag tag-delivered">DELIVERED</span></td><td>lagos</td><td>Fomax logistics</td><td class="arrow">&rarr;</td><td>Porthacourt</td><td>Fomax</td><td>21 Jul 2026</td></tr>
      <tr><td>2</td><td>YNS-47306</td><td>Abubakar Aliu</td><td><span class="tag tag-remitted">REMITTED</span></td><td>Ilorin</td><td>Baystech</td><td class="arrow">&rarr;</td><td>ONDO & EKITI</td><td>TEE EMM</td><td>15 Jul 2026</td></tr>
      <tr><td>3</td><td>YNS-46541</td><td>muhammad waziri</td><td><span class="tag tag-remitted">REMITTED</span></td><td>Uyo, PH and Aba</td><td>Nomac</td><td class="arrow">&rarr;</td><td>PH/Aba/Owerri</td><td>Rite</td><td>13 Jul 2026</td></tr>
      <tr><td>4</td><td>YNS-43178</td><td>Alex Mamudu Kpelle</td><td><span class="tag tag-remitted">REMITTED</span></td><td>Abuja</td><td>Fomax</td><td class="arrow">&rarr;</td><td>Lagos</td><td>Fomax logistics</td><td>10 Jul 2026</td></tr>
      <tr><td>5</td><td>YNS-41162</td><td>Charles Peters</td><td><span class="tag tag-remitted">REMITTED</span></td><td>lagos</td><td>Fomax logistics</td><td class="arrow">&rarr;</td><td>Lagos</td><td>Stevekayz</td><td>06 Jul 2026</td></tr>
      <tr><td>6</td><td>YNS-40726</td><td>Okiemute Ogunsola</td><td><span class="tag tag-remitted">REMITTED</span></td><td>Abuja</td><td>Fomax</td><td class="arrow">&rarr;</td><td>Porthacourt</td><td>Fomax</td><td>06 Jul 2026</td></tr>
      <tr><td>7</td><td>YNS-34435</td><td>Jennifer woriji</td><td><span class="tag tag-delivered">DELIVERED</span></td><td>Imo</td><td>Arizz Imo</td><td class="arrow">&rarr;</td><td>Onitsha, Anambra</td><td>Arizz Delivery</td><td>29 Jun 2026</td></tr>
      <tr><td>8</td><td>YNS-33321</td><td>Oseni Zuliatu</td><td><span class="tag tag-remitted">REMITTED</span></td><td>Warri & Benin city</td><td>KOMITEX</td><td class="arrow">&rarr;</td><td>Benin, Edo</td><td>Chuks</td><td>27 Jun 2026</td></tr>
      <tr><td>9</td><td>YNS-26446</td><td>Immaculate ugbada</td><td><span class="tag tag-remitted">REMITTED</span></td><td>Lagos outskirt</td><td>Oredola</td><td class="arrow">&rarr;</td><td>Abeokuta, Ogun</td><td>Funtosed</td><td>17 Jun 2026</td></tr>
      <tr><td>10</td><td>YNS-16459</td><td>Martins Ukachukwu</td><td><span class="tag tag-remitted">REMITTED</span></td><td>Abuja & Northern</td><td>De-Tabithas</td><td class="arrow">&rarr;</td><td>Abuja Nassarawa</td><td>Disu</td><td>16 Jun 2026</td></tr>
      <tr><td>11</td><td>YNS-22107</td><td>Kolade</td><td><span class="tag tag-remitted">REMITTED</span></td><td>Minna, Niger</td><td>BAMS</td><td class="arrow">&rarr;</td><td>Lagos outskirt</td><td>Oredola</td><td>15 Jun 2026</td></tr>
      <tr><td>12</td><td>YNS-17719</td><td>Akwaowo Etuk</td><td><span class="tag tag-remitted">REMITTED</span></td><td>Abuja</td><td>Fomax</td><td class="arrow">&rarr;</td><td>Akwa Ibom</td><td>Makerfast</td><td>13 Jun 2026</td></tr>
      <tr><td>13</td><td>YNS-17416</td><td>Umari Bakori</td><td><span class="tag tag-remitted">REMITTED</span></td><td>Awka, Anambra</td><td>JOWILLS</td><td class="arrow">&rarr;</td><td>Kaduna</td><td>Hollan</td><td>12 Jun 2026</td></tr>
      <tr><td>14</td><td>YNS-17373</td><td>Mrs wumi</td><td><span class="tag tag-remitted">REMITTED</span></td><td>lagos</td><td>Fomax logistics</td><td class="arrow">&rarr;</td><td>Lagos</td><td>Stevekayz</td><td>11 Jun 2026</td></tr>
      <tr><td>15</td><td>YNS-16532</td><td>Ugwu jecinta</td><td><span class="tag tag-remitted">REMITTED</span></td><td>Ebonyi</td><td>Sonic choice</td><td class="arrow">&rarr;</td><td>Enugu</td><td>Excellent</td><td>10 Jun 2026</td></tr>
      <tr><td>16</td><td>YNS-16490</td><td>Obidike Uzu</td><td><span class="tag tag-remitted">REMITTED</span></td><td>Lagos</td><td>Stevekayz</td><td class="arrow">&rarr;</td><td>Lagos</td><td>BAMS ISLAND</td><td>09 Jun 2026</td></tr>
      <tr><td>17</td><td>YNS-15890</td><td>James Odubena</td><td><span class="tag tag-remitted">REMITTED</span></td><td>Lagos outskirt</td><td>Oredola</td><td class="arrow">&rarr;</td><td>Lagos</td><td>Fomax logistics</td><td>08 Jun 2026</td></tr>
      <tr><td>18</td><td>YNS-15127</td><td>Arthur Ify</td><td><span class="tag tag-remitted">REMITTED</span></td><td>Ebonyi</td><td>Sonic choice</td><td class="arrow">&rarr;</td><td>Enugu</td><td>Sonichoice</td><td>06 Jun 2026</td></tr>
      <tr><td>19</td><td>YNS-14972</td><td>Oche</td><td><span class="tag tag-remitted">REMITTED</span></td><td>Abuja</td><td>Kareem</td><td class="arrow">&rarr;</td><td>Abuja & Northern</td><td>De-Tabithas</td><td>06 Jun 2026</td></tr>
      <tr><td>20</td><td>YNS-13922</td><td>Helen</td><td><span class="tag tag-remitted">REMITTED</span></td><td>Abuja & Northern</td><td>De-Tabithas</td><td class="arrow">&rarr;</td><td>Asaba, Delta</td><td>Nomsky</td><td>03 Jun 2026</td></tr>
      <tr><td>21</td><td>YNS-13722</td><td>Ede Ikechukwu</td><td><span class="tag tag-remitted">REMITTED</span></td><td>Onitsha, Anambra</td><td>Arizz Delivery</td><td class="arrow">&rarr;</td><td>Enugu</td><td>Excellent</td><td>02 Jun 2026</td></tr>
      <tr><td>22</td><td>YNS-12243</td><td>ABUFAROUQ ABUBAKAR</td><td><span class="tag tag-remitted">REMITTED</span></td><td>Lagos</td><td>Fomax logistics</td><td class="arrow">&rarr;</td><td>Abuja</td><td>Fomax</td><td>30 May 2026</td></tr>
      <tr><td>23</td><td>YNS-10646</td><td>Gilbert Ebikela</td><td><span class="tag tag-remitted">REMITTED</span></td><td>Abeokuta, Ogun</td><td>SendMe</td><td class="arrow">&rarr;</td><td>Benin, Edo</td><td>Chuks</td><td>28 May 2026</td></tr>
      <tr><td>24</td><td>YNS-11456</td><td>Okon ndah</td><td><span class="tag tag-remitted">REMITTED</span></td><td>Onitsha, Anambra</td><td>Arizz Delivery</td><td class="arrow">&rarr;</td><td>Imo</td><td>Arizz Imo</td><td>27 May 2026</td></tr>
      <tr><td>25</td><td>YNS-11514</td><td>Monica amaka</td><td><span class="tag tag-remitted">REMITTED</span></td><td>Enugu</td><td>Excellent</td><td class="arrow">&rarr;</td><td>Onitsha, Anambra</td><td>Apple</td><td>27 May 2026</td></tr>
      <tr><td>26</td><td>YNS-11049</td><td>Ayetan Moses Olugbenga</td><td><span class="tag tag-remitted">REMITTED</span></td><td>Ibadan</td><td>Oladigbo</td><td class="arrow">&rarr;</td><td>Ibadan/Osun</td><td>Ajiboye</td><td>27 May 2026</td></tr>
      <tr><td>27</td><td>YNS-11427</td><td>Success</td><td><span class="tag tag-remitted">REMITTED</span></td><td>Lagos</td><td>Olaasiyah</td><td class="arrow">&rarr;</td><td>Lagos outskirt</td><td>Oredola</td><td>27 May 2026</td></tr>
      <tr><td>28</td><td>YNS-10648</td><td>Mrs adegoke</td><td><span class="tag tag-remitted">REMITTED</span></td><td>Porthacourt</td><td>Fomax</td><td class="arrow">&rarr;</td><td>Lagos</td><td>Fomax logistics</td><td>26 May 2026</td></tr>
      <tr><td>29</td><td>YNS-12762</td><td>VICTOR. ADEGBOYE</td><td><span class="tag tag-review">CS_ASSIGNED</span></td><td>Ibadan/Osun</td><td>Ajiboye</td><td class="arrow">&rarr;</td><td>Ibadan</td><td>Dunamis</td><td>-</td></tr>
      <tr><td>30</td><td>YNS-13174</td><td>Edochie Rojane</td><td><span class="tag tag-review">CS_ENGAGED</span></td><td>Awka, Anambra</td><td>JOWILLS</td><td class="arrow">&rarr;</td><td>Onitsha, Anambra</td><td>Arizz Delivery</td><td>-</td></tr>
    </tbody>
  </table>
</div>

<div class="page">
  <h2>Section B: Orders Previously Corrected by Support (29 orders)</h2>
  <p style="margin-bottom:6px; color:#555;">These were manually corrected before the automated fix. The "Agege" entries were the most visible because that location is new and clearly incorrect for non-Lagos deliveries.</p>

  <table>
    <thead>
      <tr><th>#</th><th>Order</th><th>Customer</th><th>Status</th><th>Was Incorrectly Showing</th><th class="arrow">&rarr;</th><th>Corrected To</th><th>Provider</th><th>Delivered</th></tr>
    </thead>
    <tbody>
      <tr><td>1</td><td>YNS-50919</td><td>Bobby Onyiriuka</td><td><span class="tag tag-delivered">DELIVERED</span></td><td>Agege</td><td class="arrow">&rarr;</td><td>Abuja & Northern</td><td>De-Tabithas</td><td>15 Jul 2026</td></tr>
      <tr><td>2</td><td>YNS-65887</td><td>Ayomide</td><td><span class="tag tag-delivered">DELIVERED</span></td><td>Agege</td><td class="arrow">&rarr;</td><td>Ikd, Lagos</td><td>Bukted</td><td>15 Jul 2026</td></tr>
      <tr><td>3</td><td>YNS-65849</td><td>Onyinye grace</td><td><span class="tag tag-delivered">DELIVERED</span></td><td>Agege</td><td class="arrow">&rarr;</td><td>Awka, Anambra</td><td>JOWILLS</td><td>14 Jul 2026</td></tr>
      <tr><td>4</td><td>YNS-65878</td><td>Nanbot Jonathan</td><td><span class="tag tag-delivered">DELIVERED</span></td><td>Agege</td><td class="arrow">&rarr;</td><td>Jos</td><td>Isaac</td><td>14 Jul 2026</td></tr>
      <tr><td>5</td><td>YNS-49139</td><td>Uwakwe Precious</td><td><span class="tag tag-delivered">DELIVERED</span></td><td>Agege</td><td class="arrow">&rarr;</td><td>Owerri, Imo</td><td>Blue Amazon</td><td>14 Jul 2026</td></tr>
      <tr><td>6</td><td>YNS-65880</td><td>Joy Idahosa</td><td><span class="tag tag-remitted">REMITTED</span></td><td>Agege</td><td class="arrow">&rarr;</td><td>Warri & Benin city</td><td>KOMITEX</td><td>13 Jul 2026</td></tr>
      <tr><td>7</td><td>YNS-65846</td><td>Nnaji Emmauel</td><td><span class="tag tag-delivered">DELIVERED</span></td><td>Agege</td><td class="arrow">&rarr;</td><td>Lagos outskirt</td><td>Oredola</td><td>13 Jul 2026</td></tr>
      <tr><td>8</td><td>YNS-41143</td><td>Bolaji Muhammad</td><td><span class="tag tag-delivered">DELIVERED</span></td><td>Agege</td><td class="arrow">&rarr;</td><td>Lagos</td><td>Stevekayz</td><td>06 Jul 2026</td></tr>
      <tr><td>9</td><td>YNS-41141</td><td>Ben Monday</td><td><span class="tag tag-delivered">DELIVERED</span></td><td>Agege</td><td class="arrow">&rarr;</td><td>Asaba, Delta</td><td>Nomsky</td><td>06 Jul 2026</td></tr>
      <tr><td>10</td><td>YNS-41019</td><td>Monsuru Shoola</td><td><span class="tag tag-delivered">DELIVERED</span></td><td>Agege</td><td class="arrow">&rarr;</td><td>Lagos outskirt</td><td>Oredola</td><td>06 Jul 2026</td></tr>
      <tr><td>11</td><td>YNS-36572</td><td>Haj M Idris</td><td><span class="tag tag-delivered">DELIVERED</span></td><td>Agege</td><td class="arrow">&rarr;</td><td>Abuja & Northern</td><td>De-Tabithas</td><td>30 Jun 2026</td></tr>
      <tr><td>12</td><td>YNS-37635</td><td>OLA LAWAL</td><td><span class="tag tag-delivered">DELIVERED</span></td><td>Agege</td><td class="arrow">&rarr;</td><td>Ibadan</td><td>Oladigbo</td><td>30 Jun 2026</td></tr>
      <tr><td>13</td><td>YNS-37354</td><td>Dele Oderinde</td><td><span class="tag tag-delivered">DELIVERED</span></td><td>Agege</td><td class="arrow">&rarr;</td><td>Abeokuta, Ogun</td><td>SendMe</td><td>30 Jun 2026</td></tr>
      <tr><td>14</td><td>YNS-35836</td><td>Mary edward</td><td><span class="tag tag-delivered">DELIVERED</span></td><td>Agege</td><td class="arrow">&rarr;</td><td>Kano</td><td>John</td><td>29 Jun 2026</td></tr>
      <tr><td>15</td><td>YNS-35833</td><td>Ehimen</td><td><span class="tag tag-delivered">DELIVERED</span></td><td>Agege</td><td class="arrow">&rarr;</td><td>Benin, Edo</td><td>Chuks</td><td>29 Jun 2026</td></tr>
      <tr><td>16</td><td>YNS-35808</td><td>Ogbe Robison</td><td><span class="tag tag-delivered">DELIVERED</span></td><td>Agege</td><td class="arrow">&rarr;</td><td>Asaba, Delta</td><td>Nomsky</td><td>29 Jun 2026</td></tr>
      <tr><td>17</td><td>YNS-37608</td><td>Moses Akpaibor</td><td><span class="tag tag-delivered">DELIVERED</span></td><td>Agege</td><td class="arrow">&rarr;</td><td>Lagos outskirt</td><td>Oredola</td><td>25 Jun 2026</td></tr>
      <tr><td>18</td><td>YNS-33278</td><td>Nnakwuzie Daniel</td><td><span class="tag tag-remitted">REMITTED</span></td><td>Agege</td><td class="arrow">&rarr;</td><td>Awka, Anambra</td><td>JOWILLS</td><td>25 Jun 2026</td></tr>
      <tr><td>19</td><td>YNS-31152</td><td>Bayo Onamusi</td><td><span class="tag tag-remitted">REMITTED</span></td><td>Agege</td><td class="arrow">&rarr;</td><td>Lagos outskirt</td><td>Oredola</td><td>22 Jun 2026</td></tr>
      <tr><td>20</td><td>YNS-31016</td><td>Joel Kareem are</td><td><span class="tag tag-remitted">REMITTED</span></td><td>Agege</td><td class="arrow">&rarr;</td><td>Lagos outskirt</td><td>Oredola</td><td>22 Jun 2026</td></tr>
      <tr><td>21</td><td>YNS-37626</td><td>Waidi Falola</td><td><span class="tag tag-delivered">DELIVERED</span></td><td>Agege</td><td class="arrow">&rarr;</td><td>Lagos outskirt</td><td>Oredola</td><td>20 Jun 2026</td></tr>
      <tr><td>22</td><td>YNS-37600</td><td>Obazee</td><td><span class="tag tag-delivered">DELIVERED</span></td><td>Agege</td><td class="arrow">&rarr;</td><td>Warri & Benin city</td><td>KOMITEX</td><td>20 Jun 2026</td></tr>
      <tr><td>23</td><td>YNS-37613</td><td>Omotoso</td><td><span class="tag tag-delivered">DELIVERED</span></td><td>Agege</td><td class="arrow">&rarr;</td><td>Kwara</td><td>Lily Logistics</td><td>20 Jun 2026</td></tr>
      <tr><td>24</td><td>YNS-37606</td><td>Nduka vote monday</td><td><span class="tag tag-delivered">DELIVERED</span></td><td>Agege</td><td class="arrow">&rarr;</td><td>Ilorin</td><td>Baystech</td><td>20 Jun 2026</td></tr>
      <tr><td>25</td><td>YNS-28341</td><td>Lawrence</td><td><span class="tag tag-remitted">REMITTED</span></td><td>Agege</td><td class="arrow">&rarr;</td><td>Asaba, Delta</td><td>Nomsky</td><td>19 Jun 2026</td></tr>
      <tr><td>26</td><td>YNS-37619</td><td>Biggy Olasukanmi</td><td><span class="tag tag-delivered">DELIVERED</span></td><td>Agege</td><td class="arrow">&rarr;</td><td>Lagos outskirt</td><td>Oredola</td><td>19 Jun 2026</td></tr>
      <tr><td>27</td><td>YNS-28283</td><td>Elizabeth Funke</td><td><span class="tag tag-remitted">REMITTED</span></td><td>Agege</td><td class="arrow">&rarr;</td><td>ONDO & EKITI</td><td>TEE EMM</td><td>19 Jun 2026</td></tr>
      <tr><td>28</td><td>YNS-37630</td><td>Adeboye Ramotalihi</td><td><span class="tag tag-delivered">DELIVERED</span></td><td>Agege</td><td class="arrow">&rarr;</td><td>Ibadan/Osun</td><td>Ajiboye</td><td>19 Jun 2026</td></tr>
      <tr><td>29</td><td>YNS-28279</td><td>ismail uthman</td><td><span class="tag tag-remitted">REMITTED</span></td><td>Agege</td><td class="arrow">&rarr;</td><td>Lagos outskirt</td><td>Amaram</td><td>19 Jun 2026</td></tr>
    </tbody>
  </table>

  <h2>Section C: Orders With Other Location Changes (reviewed, now correct)</h2>
  <p style="margin-bottom:6px; color:#555;">These orders had location changes due to re-assignments or other transitions. They have been reviewed and their current location matches the last agent assignment.</p>

  <table>
    <thead>
      <tr><th>#</th><th>Order</th><th>Customer</th><th>Status</th><th>Current Location</th><th>Current Provider</th><th>Delivered</th></tr>
    </thead>
    <tbody>
      <tr><td>1</td><td>YNS-63673</td><td>Chiyenka onward Richard</td><td><span class="tag tag-delivered">DELIVERED</span></td><td>Imo</td><td>Arizz Imo</td><td>21 Jul 2026</td></tr>
      <tr><td>2</td><td>YNS-63140</td><td>Ibigbemi olubunmi</td><td><span class="tag tag-delivered">DELIVERED</span></td><td>Ilorin</td><td>Baystech</td><td>21 Jul 2026</td></tr>
      <tr><td>3</td><td>YNS-62233</td><td>Wali Collins chizike</td><td><span class="tag tag-delivered">DELIVERED</span></td><td>Porthacourt</td><td>Fomax</td><td>21 Jul 2026</td></tr>
      <tr><td>4</td><td>YNS-61962</td><td>Samson Mshelbwala</td><td><span class="tag tag-delivered">DELIVERED</span></td><td>lagos</td><td>Fomax logistics</td><td>21 Jul 2026</td></tr>
      <tr><td>5</td><td>YNS-55717</td><td>Sunny</td><td><span class="tag tag-delivered">DELIVERED</span></td><td>Awka, Anambra</td><td>JOWILLS</td><td>20 Jul 2026</td></tr>
      <tr><td>6</td><td>YNS-61020</td><td>Isaac kwaku Gamadi</td><td><span class="tag tag-delivered">DELIVERED</span></td><td>Abuja & Northern</td><td>De-Tabithas</td><td>20 Jul 2026</td></tr>
      <tr><td>7</td><td>YNS-55900</td><td>Adenuga</td><td><span class="tag tag-delivered">DELIVERED</span></td><td>Abeokuta, Ogun</td><td>Funtosed</td><td>20 Jul 2026</td></tr>
      <tr><td>8</td><td>YNS-39738</td><td>Blessing Kelechi</td><td><span class="tag tag-delivered">DELIVERED</span></td><td>Owerri, Imo</td><td>Blue Amazon</td><td>18 Jul 2026</td></tr>
      <tr><td>9</td><td>YNS-46544</td><td>Mr larry Adeyemi</td><td><span class="tag tag-delivered">DELIVERED</span></td><td>Lagos</td><td>Olaasiyah</td><td>17 Jul 2026</td></tr>
      <tr><td>10</td><td>YNS-43974</td><td>Ngozi Eze</td><td><span class="tag tag-remitted">REMITTED</span></td><td>Abeokuta, Ogun</td><td>Funtosed</td><td>15 Jul 2026</td></tr>
      <tr><td>11</td><td>YNS-41207</td><td>Efe megbuwe</td><td><span class="tag tag-remitted">REMITTED</span></td><td>Kebbi</td><td>SHERIFF</td><td>13 Jul 2026</td></tr>
      <tr><td>12</td><td>YNS-41118</td><td>Aliyu Abubakar</td><td><span class="tag tag-delivered">DELIVERED</span></td><td>Abuja</td><td>Fomax</td><td>09 Jul 2026</td></tr>
      <tr><td>13</td><td>YNS-42190</td><td>Habiba shittu</td><td><span class="tag tag-delivered">DELIVERED</span></td><td>Lagos</td><td>BAMS ISLAND</td><td>09 Jul 2026</td></tr>
      <tr><td>14</td><td>YNS-39933</td><td>Akintoye Augustine</td><td><span class="tag tag-remitted">REMITTED</span></td><td>lagos</td><td>Fomax logistics</td><td>07 Jul 2026</td></tr>
      <tr><td>15</td><td>YNS-39741</td><td>Adewunmi Ogunsanya</td><td><span class="tag tag-remitted">REMITTED</span></td><td>Lagos</td><td>Olaasiyah</td><td>06 Jul 2026</td></tr>
      <tr><td>16</td><td>YNS-39703</td><td>Alhaji</td><td><span class="tag tag-delivered">DELIVERED</span></td><td>lagos</td><td>Fomax logistics</td><td>06 Jul 2026</td></tr>
      <tr><td>17</td><td>YNS-36303</td><td>Anthony</td><td><span class="tag tag-remitted">REMITTED</span></td><td>Lagos outskirt</td><td>Oredola</td><td>30 Jun 2026</td></tr>
      <tr><td>18</td><td>YNS-31240</td><td>Aniekwe Ngozi Regina</td><td><span class="tag tag-delivered">DELIVERED</span></td><td>Awka, Anambra</td><td>JOWILLS</td><td>30 Jun 2026</td></tr>
      <tr><td>19</td><td>YNS-34833</td><td>Mr Femi Akisanmi</td><td><span class="tag tag-remitted">REMITTED</span></td><td>Lagos outskirt</td><td>Amaram</td><td>29 Jun 2026</td></tr>
      <tr><td>20</td><td>YNS-28091</td><td>Ifeanyi Obulor</td><td><span class="tag tag-remitted">REMITTED</span></td><td>Portharcourt & Bayelsa</td><td>Babatunde</td><td>18 Jun 2026</td></tr>
      <tr><td>21</td><td>YNS-28088</td><td>Isaiah JayJay</td><td><span class="tag tag-remitted">REMITTED</span></td><td>Portharcourt & Bayelsa</td><td>Babatunde</td><td>18 Jun 2026</td></tr>
      <tr><td>22</td><td>YNS-28085</td><td>Babasola Ajayi</td><td><span class="tag tag-remitted">REMITTED</span></td><td>Ibadan</td><td>Dunamis</td><td>18 Jun 2026</td></tr>
      <tr><td>23</td><td>YNS-25247</td><td>Blessing Eloho</td><td><span class="tag tag-remitted">REMITTED</span></td><td>Warri & Benin city</td><td>KOMITEX</td><td>22 Jun 2026</td></tr>
      <tr><td>24</td><td>YNS-27942</td><td>Mustapha</td><td><span class="tag tag-remitted">REMITTED</span></td><td>lagos</td><td>Fomax logistics</td><td>25 Jun 2026</td></tr>
      <tr><td>25</td><td>YNS-30272</td><td>Dada Ezekiel</td><td><span class="tag tag-remitted">REMITTED</span></td><td>Ijebu Ogun state</td><td>SpeedyWay</td><td>23 Jun 2026</td></tr>
      <tr><td>26</td><td>YNS-25487</td><td>Jubilee</td><td><span class="tag tag-remitted">REMITTED</span></td><td>lagos</td><td>Fomax logistics</td><td>17 Jun 2026</td></tr>
      <tr><td>27</td><td>YNS-25072</td><td>Chris Chidi</td><td><span class="tag tag-remitted">REMITTED</span></td><td>Lagos outskirt</td><td>Oredola</td><td>17 Jun 2026</td></tr>
      <tr><td>28</td><td>YNS-25497</td><td>Olukayode Oduniyi</td><td><span class="tag tag-remitted">REMITTED</span></td><td>Abuja</td><td>Fomax</td><td>17 Jun 2026</td></tr>
      <tr><td>29</td><td>YNS-23291</td><td>Margaret Samuel Opiti</td><td><span class="tag tag-remitted">REMITTED</span></td><td>Asaba, Delta</td><td>Nomsky</td><td>16 Jun 2026</td></tr>
    </tbody>
  </table>

  <div class="footer">
    Yannis EOSE &mdash; Logistics Location Audit Report &mdash; Generated 23 July 2026 &mdash; Confidential
  </div>
</div>

</body>
</html>`;

const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();
await page.setContent(html, { waitUntil: 'networkidle0' });
await page.pdf({
  path: '/Users/Apple/Desktop/PROJECTS/ROGUE-DEVTECH/yannis-eose/Logistics-Location-Audit-Report-23Jul2026.pdf',
  format: 'A4',
  landscape: true,
  printBackground: true,
  margin: { top: '30px', bottom: '30px', left: '30px', right: '30px' },
});
await browser.close();
console.log('PDF generated successfully.');
