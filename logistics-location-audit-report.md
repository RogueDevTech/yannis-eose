# Logistics Location Overwrite Bug - Audit Report

**Date:** 23 July 2026
**Prepared by:** Engineering Team
**Period affected:** 23 May 2026 - 22 July 2026

## Summary

A code bug caused the logistics location on orders to be overwritten when CS/Logistics staff moved orders past the Agent Assignment step (e.g. to Dispatched, Delivered). The correct location set during Agent Assignment was replaced with stale form data.

- **131 orders** total had a location change in their history
- **88 were caused by the bug** (location overwritten during non-assignment transitions)
- **43 were intentional** re-assignments by CS/Logistics staff
- **Bug fixed in code** on 22 July 2026. No new cases will occur.

## Corrections Applied

- **59 orders** auto-corrected by engineering (restored to last assigned location)
- **~29 orders** previously corrected manually by Support (Kabir Mohammed)
- **127 timeline events** added to affected orders documenting the correction

## Orders That Were Auto-Corrected (Bug Location -> Correct Location)

| Order# | Customer | Status | Bug Location | Bug Provider | Corrected To | Provider | Delivered |
|--------|----------|--------|-------------|-------------|-------------|----------|-----------|
| 62473 | Owem Bashy | DELIVERED | lagos | Fomax logistics | Porthacourt | Fomax | 21 Jul 2026 |
| 47306 | Abubakar Aliu | REMITTED | Ilorin | Baystech | ONDO & EKITI | TEE EMM | 15 Jul 2026 |
| 46541 | muhammad waziri | REMITTED | Uyo, Porthacourt and Aba | Nomac | Porthacourt/Aba/owerri | Rite | 13 Jul 2026 |
| 43178 | Alex Mamudu Kpelle | REMITTED | Abuja | Fomax | lagos | Fomax logistics | 10 Jul 2026 |
| 41162 | Charles Peters | REMITTED | lagos | Fomax logistics | Lagos | Stevekayz | 06 Jul 2026 |
| 40726 | Okiemute Ogunsola | REMITTED | Abuja | Fomax | Porthacourt | Fomax | 06 Jul 2026 |
| 34435 | Jennifer woriji | DELIVERED | Imo | Arizz Imo | Onitsha,Anambra | Arizz Delivery | 29 Jun 2026 |
| 33321 | Oseni Zuliatu | REMITTED | Warri & Benin city | KOMITEX DELIVERES | Benin,Edo | Chuks | 27 Jun 2026 |
| 26446 | Immaculate ugbada | REMITTED | Lagos - Lagos outskirt | Oredola | Abeokuta,Ogun State | Funtosed | 17 Jun 2026 |
| 16459 | Martins Ukachukwu | REMITTED | Abuja & Northern states | De-Tabithas Logistics | Abuja Nassarawa | Disu | 16 Jun 2026 |
| 22107 | Kolade | REMITTED | Minna,Niger state | BAMS | Lagos - Lagos outskirt | Oredola | 15 Jun 2026 |
| 17719 | Akwaowo Etuk | REMITTED | Abuja | Fomax | Akwa Ibom | Makerfast | 13 Jun 2026 |
| 17416 | Umari Bakori | REMITTED | Awka,Anambra | JOWILLS | Kaduna | Hollan | 12 Jun 2026 |
| 17373 | Mrs wumi | REMITTED | lagos | Fomax logistics | Lagos | Stevekayz | 11 Jun 2026 |
| 16532 | Ugwu jecinta | REMITTED | Ebonyi | Sonic choice ebonyi | Enugu | Excellent | 10 Jun 2026 |
| 16490 | Obidike Uzu | REMITTED | Lagos | Stevekayz | Lagos | BAMS ISLAND | 09 Jun 2026 |
| 15890 | James Odubena | REMITTED | Lagos - Lagos outskirt | Oredola | lagos | Fomax logistics | 08 Jun 2026 |
| 15127 | Arthur Ify | REMITTED | Ebonyi | Sonic choice ebonyi | Enugu | Sonichoice | 06 Jun 2026 |
| 14972 | Oche | REMITTED | Abuja | Kareem | Abuja & Northern states | De-Tabithas Logistics | 06 Jun 2026 |
| 13922 | Helen | REMITTED | Abuja & Northern states | De-Tabithas Logistics | Asaba,Delta | Nomsky | 03 Jun 2026 |
| 13722 | Ede Ikechukwu | REMITTED | Onitsha,Anambra | Arizz Delivery | Enugu | Excellent | 02 Jun 2026 |
| 12243 | ABUFAROUQ ABUBAKAR | REMITTED | lagos | Fomax logistics | Abuja | Fomax | 30 May 2026 |
| 10646 | Gilbert Ebikela | REMITTED | Abeokuta, Ogun State | SendMe | Benin,Edo | Chuks | 28 May 2026 |
| 11456 | Okon ndah | REMITTED | Onitsha,Anambra | Arizz Delivery | Imo | Arizz Imo | 27 May 2026 |
| 11514 | Monica amaka | REMITTED | Enugu | Excellent | Onitsha,Anambra | Apple | 27 May 2026 |
| 11049 | Ayetan Moses Olugbenga | REMITTED | Ibadan | Oladigbo | Ibadan/osun | Ajiboye | 27 May 2026 |
| 11427 | Success | REMITTED | Lagos | Olaasiyah | Lagos - Lagos outskirt | Oredola | 27 May 2026 |
| 10648 | Mrs adegoke | REMITTED | Porthacourt | Fomax | lagos | Fomax logistics | 26 May 2026 |
| 12762 | VICTOR. ADEGBOYE | CS_ASSIGNED | Ibadan/osun | Ajiboye | Ibadan | Dunamis | - |
| 13174 | Edochie Rojane | CS_ENGAGED | Awka,Anambra | JOWILLS | Onitsha,Anambra | Arizz Delivery | - |

## Orders Previously Corrected by Support (Verified Correct)

These orders were manually corrected by Support before the automated fix. Current location matches the last CS assignment. No further action needed unless accounting disagrees with the current location.

| Order# | Customer | Status | Was Changed From | Current Location | Current Provider | Delivered |
|--------|----------|--------|-----------------|-----------------|-----------------|-----------|
| 63673 | Chiyenka onward Richard | DELIVERED | Imo | Imo | Arizz Imo | 21 Jul 2026 |
| 63140 | Ibigbemi olubunmi | DELIVERED | Kaduna | Ilorin | Baystech | 21 Jul 2026 |
| 62233 | Wali Collins chizike | DELIVERED | Kaduna | Porthacourt | Fomax | 21 Jul 2026 |
| 61962 | Samson Mshelbwala | DELIVERED | lagos | lagos | Fomax logistics | 21 Jul 2026 |
| 55717 | Sunny | DELIVERED | Awka,Anambra | Awka,Anambra | JOWILLS | 20 Jul 2026 |
| 61020 | Isaac kwaku Gamadi | DELIVERED | Kaduna | Abuja & Northern states | De-Tabithas Logistics | 20 Jul 2026 |
| 55900 | Adenuga | DELIVERED | Abeokuta,Ogun State | Abeokuta,Ogun State | Funtosed | 20 Jul 2026 |
| 39738 | Blessing Kelechi | DELIVERED | Owerri,Imo | Owerri,Imo | Blue Amazon | 18 Jul 2026 |
| 46544 | Mr larry Adeyemi | DELIVERED | Lagos | Lagos | Olaasiyah | 17 Jul 2026 |
| 50919 | Bobby Onyiriuka | DELIVERED | Agege | Abuja & Northern states | De-Tabithas Logistics | 15 Jul 2026 |
| 65887 | Ayomide | DELIVERED | Agege | Ikd,Lagos | Bukted | 15 Jul 2026 |
| 43974 | Ngozi Eze | REMITTED | Abeokuta,Ogun State | Abeokuta,Ogun State | Funtosed | 15 Jul 2026 |
| 65849 | Onyinye grace | DELIVERED | Agege | Awka,Anambra | JOWILLS | 14 Jul 2026 |
| 65878 | Nanbot Jonathan | DELIVERED | Agege | Jos | Isaac | 14 Jul 2026 |
| 49139 | Uwakwe Precious | DELIVERED | Agege | Owerri,Imo | Blue Amazon | 14 Jul 2026 |
| 65880 | Joy Idahosa | REMITTED | Agege | Warri & Benin city | KOMITEX DELIVERES | 13 Jul 2026 |
| 65846 | Nnaji Emmauel | DELIVERED | Agege | Lagos - Lagos outskirt | Oredola | 13 Jul 2026 |
| 41207 | Efe megbuwe | REMITTED | Kebbi | Kebbi | SHERIFF | 13 Jul 2026 |
| 41118 | Aliyu Abubakar | DELIVERED | Abuja | Abuja | Fomax | 09 Jul 2026 |
| 42190 | Habiba shittu | DELIVERED | Lagos | Lagos | BAMS ISLAND | 09 Jul 2026 |
| 39933 | Akintoye Augustine | REMITTED | lagos | lagos | Fomax logistics | 07 Jul 2026 |
| 41143 | Bolaji Muhammad | DELIVERED | Agege | Lagos | Stevekayz | 06 Jul 2026 |
| 41141 | Ben Monday | DELIVERED | Agege | Asaba,Delta | Nomsky | 06 Jul 2026 |
| 39741 | Adewunmi Ogunsanya | REMITTED | Lagos | Lagos | Olaasiyah | 06 Jul 2026 |
| 41019 | Monsuru Shoola | DELIVERED | Agege | Lagos - Lagos outskirt | Oredola | 06 Jul 2026 |
| 39703 | Alhaji | DELIVERED | lagos | lagos | Fomax logistics | 06 Jul 2026 |
| 36303 | Anthony | REMITTED | Lagos - Lagos outskirt | Lagos - Lagos outskirt | Oredola | 30 Jun 2026 |
| 36572 | Haj M Idris | DELIVERED | Agege | Abuja & Northern states | De-Tabithas Logistics | 30 Jun 2026 |
| 37635 | OLA LAWAL | DELIVERED | Agege | Ibadan | Oladigbo | 30 Jun 2026 |
| 31240 | Aniekwe Ngozi Regina | DELIVERED | Awka,Anambra | Awka,Anambra | JOWILLS | 30 Jun 2026 |
| 37354 | Dele Oderinde | DELIVERED | Agege | Abeokuta, Ogun State | SendMe | 30 Jun 2026 |
| 35836 | Mary edward | DELIVERED | Agege | Kano | John | 29 Jun 2026 |
| 35833 | Ehimen | DELIVERED | Agege | Benin,Edo | Chuks | 29 Jun 2026 |
| 35808 | Ogbe Robison | DELIVERED | Agege | Asaba,Delta | Nomsky | 29 Jun 2026 |
| 34833 | Mr Femi Akisanmi | REMITTED | Lagos - Lagos outskirt | Lagos - Lagos outskirt | Amaram | 29 Jun 2026 |
| 37608 | Moses Akpaibor | DELIVERED | Agege | Lagos - Lagos outskirt | Oredola | 25 Jun 2026 |
| 33278 | Nnakwuzie Daniel | REMITTED | Agege | Awka,Anambra | JOWILLS | 25 Jun 2026 |
| 27942 | Mustapha | REMITTED | lagos | lagos | Fomax logistics | 25 Jun 2026 |
| 30272 | Dada Ezekiel | REMITTED | Ijebu Ogun state | Ijebu Ogun state | SpeedyWay | 23 Jun 2026 |
| 31152 | Bayo Onamusi | REMITTED | Agege | Lagos - Lagos outskirt | Oredola | 22 Jun 2026 |
| 25247 | Blessing Eloho | REMITTED | Warri & Benin city | Warri & Benin city | KOMITEX DELIVERES | 22 Jun 2026 |
| 31016 | Joel Kareem are | REMITTED | Agege | Lagos - Lagos outskirt | Oredola | 22 Jun 2026 |
| 37626 | Waidi Falola | DELIVERED | Agege | Lagos - Lagos outskirt | Oredola | 20 Jun 2026 |
| 37600 | Obazee | DELIVERED | Agege | Warri & Benin city | KOMITEX DELIVERES | 20 Jun 2026 |
| 37613 | Omotoso | DELIVERED | Agege | kwara | Lily Logistics | 20 Jun 2026 |
| 37606 | Nduka vote monday | DELIVERED | Agege | Ilorin | Baystech | 20 Jun 2026 |
| 28341 | Lawrence | REMITTED | Agege | Asaba,Delta | Nomsky | 19 Jun 2026 |
| 37619 | Biggy Olasukanmi | DELIVERED | Agege | Lagos - Lagos outskirt | Oredola | 19 Jun 2026 |
| 28283 | Elizabeth Funke | REMITTED | Agege | ONDO & EKITI | TEE EMM | 19 Jun 2026 |
| 37630 | Adeboye Ramotalihi | DELIVERED | Agege | Ibadan/osun | Ajiboye | 19 Jun 2026 |
| 28279 | ismail uthman | REMITTED | Agege | Lagos - Lagos outskirt | Amaram | 19 Jun 2026 |
| 28091 | Ifeanyi Obulor | REMITTED | Agege | Portharcourt & Bayelsa | Babatunde | 18 Jun 2026 |
| 28088 | Isaiah JayJay | REMITTED | Agege | Portharcourt & Bayelsa | Babatunde | 18 Jun 2026 |
| 28085 | Babasola Ajayi | REMITTED | Agege | Ibadan | Dunamis | 18 Jun 2026 |
| 25305 | Ferdinand Okonkwo | REMITTED | Kaduna | Kaduna | Hollan | 18 Jun 2026 |
| 25487 | Jubilee | REMITTED | lagos | lagos | Fomax logistics | 17 Jun 2026 |
| 26664 | Promise elechi | REMITTED | Kano | Kano | John | 17 Jun 2026 |
| 25072 | Chris Chidi | REMITTED | Lagos - Lagos outskirt | Lagos - Lagos outskirt | Oredola | 17 Jun 2026 |
| 26444 | Ndukaku Jacob | REMITTED | Ebonyi | Ebonyi | Sonic choice ebonyi | 17 Jun 2026 |
| 25497 | Olukayode Oduniyi | REMITTED | Abuja | Abuja | Fomax | 17 Jun 2026 |
| 23291 | Margaret Samuel Opiti | REMITTED | Asaba,Delta | Asaba,Delta | Nomsky | 16 Jun 2026 |
| 17366 | Samuel GWOMNA | REMITTED | Lagos | Lagos | BAMS ISLAND | 12 Jun 2026 |
| 17365 | Kola Gboyega | REMITTED | Ikd,Lagos | Ikd,Lagos | Bukted | 11 Jun 2026 |
| 17290 | Mr okafor | REMITTED | Lagos | Lagos | BAMS ISLAND | 11 Jun 2026 |
| 16434 | Adebowale Adepoju | REMITTED | Benin,Edo | Benin,Edo | EMMY | 11 Jun 2026 |
| 16822 | Dr Veronica Ugeh | REMITTED | Warri & Benin city | Warri & Benin city | KOMITEX DELIVERES | 10 Jun 2026 |
| 16840 | Arthur mbadiugha | REMITTED | Lagos - Lagos outskirt | Lagos - Lagos outskirt | Oredola | 09 Jun 2026 |
| 15297 | Balogun Kafidipe | REMITTED | Abeokuta, Ogun State | Abeokuta, Ogun State | SendMe | 08 Jun 2026 |
| 15897 | Dr Leo Okey Akanador | REMITTED | Kano | Kano | John | 08 Jun 2026 |
| 15276 | Bamigbose olasunkanmi abidemi | REMITTED | Lagos | Lagos | BAMS ISLAND | 07 Jun 2026 |
| 13432 | Ahmed Hassan mijima | REMITTED | Lagos - Lagos outskirt | Lagos - Lagos outskirt | Amaram | 05 Jun 2026 |
| 14971 | Diyaolu Taoheed Kehinde | REMITTED | lagos | lagos | Fomax logistics | 05 Jun 2026 |
| 14718 | Oscar Dickson | REMITTED | lagos | lagos | Fomax logistics | 05 Jun 2026 |
| 14146 | Remmy Mobileworld | REMITTED | Ilorin | Ilorin | Baystech | 04 Jun 2026 |
| 14242 | Golden Tamuno | REMITTED | Portharcourt & Bayelsa | Portharcourt & Bayelsa | Babatunde | 03 Jun 2026 |
| 14009 | Gloria Hassan Barau | REMITTED | Minna,Niger state | Minna,Niger state | BAMS | 03 Jun 2026 |
| 13168 | Amuche | REMITTED | Uyo, Porthacourt and Aba | Uyo, Porthacourt and Aba | Nomac | 02 Jun 2026 |
| 11711 | Akinbowale oluwasayoo | REMITTED | Lagos - Lagos outskirt | Lagos - Lagos outskirt | Amaram | 31 May 2026 |
| 11891 | Umaru Lamidi Adegoke | REMITTED | Ibadan | Ibadan | Oladigbo | 29 May 2026 |
| 10403 | ALH YAKUBU MUSA | REMITTED | Kaduna | Kaduna | Hollan | 29 May 2026 |
| 11926 | Elozino | REMITTED | Abuja & Northern states | Abuja & Northern states | De-Tabithas Logistics | 29 May 2026 |
| 11781 | Juliet Joseph O | REMITTED | Abeokuta, Ogun State | Abeokuta, Ogun State | SendMe | 28 May 2026 |
| 10511 | Kingsley Atere | REMITTED | Abuja | Abuja | Kareem | 28 May 2026 |
| 11419 | CHUKWUDI INNOCENT | REMITTED | Lagos | Lagos | Olaasiyah | 27 May 2026 |
| 10516 | Prisca Solomon | REMITTED | Awka,Anambra | Awka,Anambra | JOWILLS | 27 May 2026 |
| 11363 | Chi nwagbo | REMITTED | Onitsha,Anambra | Onitsha,Anambra | Arizz Delivery | 27 May 2026 |
| 10942 | McManuel Uche | REMITTED | Lagos | Lagos | Stevekayz | 27 May 2026 |
| 10645 | Blessyn Edet | REMITTED | Abia & imo | Abia & imo | Uchenna | 27 May 2026 |
| 10659 | UGWUOKE, Chinonye | REMITTED | Asaba,Delta | Asaba,Delta | Nomsky | 27 May 2026 |
| 11192 | Olaniyi Akeem | REMITTED | Abuja | Abuja | Kareem | 27 May 2026 |
| 10486 | Godwin Ashikeni | REMITTED | Abuja & Northern states | Abuja & Northern states | De-Tabithas Logistics | 26 May 2026 |

## Root Cause

The `transition()` method in `orders.service.ts` applied `logisticsLocationId` from form metadata on every status change, not just during Agent Assignment. When CS marked an order as Dispatched or Delivered, the frontend sent stale location data from the form, overwriting the correct assigned location.

## Fix Applied

Code change deployed 22 July 2026: `logisticsLocationId` and `logisticsProviderId` are now ONLY written during `AGENT_ASSIGNED` transitions. All subsequent transitions (DISPATCHED, IN_TRANSIT, DELIVERED, REMITTED) preserve the assigned location.

## Action Required from Accounting

Please review the "Previously Corrected by Support" section above. These orders were manually corrected and should now show the correct location. If any location still looks wrong, flag the Order# and we will investigate the full history for that specific order.
