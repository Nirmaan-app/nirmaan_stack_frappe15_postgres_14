"""VRF-1 (2026-11-03) -- HVAC v55 = v54 + THE VRF CATALOGUE, FOUR SHARED MISC ITEMS AND TWO CONVERSION INPUTS.

Minted by `scripts/_instruments/mint_hvac_v55_vrf.py` from the 2 Nov workbook (owner R-SRC: "HVAC_BOQ_BCS PRICING_
Nitesh Edits - 2 nov 2026.xlsx", sha256 30588ddb...); DATA ONLY -- nothing prices until VRF-2 / VRF-4.

What these tests protect, in plain English (file-only, no database):

  01  ONE SKU PER SHEET ROW: 152 hvac_vrf_item SKUs, VRF sheet rows 2..153 each exactly once (Blue Star 122, Daikin 30);
      4 hvac_misc_item SKUs, Misc rows 20 / 22 / 24 / 25; 2 VRF Pricing Inputs; nothing else is new. NEGATIVE: no row
      twice, no row outside 2..153, no uid shared with v54.
  02  THE TEAM'S SHEET CORRECTIONS are present: VSD-132A / VSD-216A / VSD-240A absent (NEGATIVE); DSD-72 6 TR, DSD-96
      8 TR; Daikin Top Heat Pump 6 HP 199,191 and 8 HP 211,452.
  03  OUTDOOR INSTALL (owner R-INSTALL "follow the sheet"): BOQ install = HP x 1,000 on the 44 Blue Star outdoor units
      and HP x 1,600 on the 10 Daikin; machine-install cost HP x 2,200 on all 54; commissioning HP x 500 Daikin, 0
      Blue Star. NEGATIVE: no indoor SKU carries a machine-install or commissioning cost.
  04  EVERY STORED FIGURE = THE SHEET (the table below, written from the sheet independently of the mint): cost,
      markup, BOQ install, machine install, commissioning; and BOQ supply = cost x (1 + markup) = the sheet's BOQ
      SUPPLY on all 152, before any round-up (R-ROUND: the mint stores as-is).
  05  THE FOUR MISC ITEMS: unit, cost, both markups as the Misc sheet; ROUNDUP(cost x (1 + markup)) = the sheet's BoQ
      Supply AND BoQ Install on each; the gas row stores its TYPED BOQ install 350 and no install markup (NEGATIVE:
      the other three carry no typed install).
  06  BRAND on all 152 (the item column, "Blue Star" / "Daikin"); the four Misc items carry none.
  07  ATTRIBUTES AS THE SHEET (VRF-D0 D2): item_name = the sheet's Item verbatim (R-ITEMNAME); family, cooling (HEAT
      PUMP and Heat Pump one value), discharge, compressor (D-6), way (trailing space trimmed), remote type, capacity
      + unit + label ("12.5 / 15.0TR" stocks at 15; Daikin "18HP+16HP" one SKU at 34 HP; "16HP " trimmed), model
      ("NA" / blank absent). NEGATIVE: an outdoor-only attribute never on an indoor SKU, and the reverse.
  08  NOTHING ELSE MOVED: every v54 item and config is in v55 byte-for-byte; every other top-level key is v54's
      (R-IGNORE: the 2 Nov file's Insulation / Piping changes are NOT taken).
  09  THE TWO INPUTS: "VRF conversion - HP per TR" factor 1.25 and "VRF conversion - kW per TR" factor 3.517, shared
      by vrf, with the worked examples in their remarks; stored as `factor`, which the Pricing Inputs grid and file
      show as a plain number (never a percentage).
  10  NO PRICING BLOCK, NOT ELIGIBLE: hvac_vrf has two kinds, pipelines {}, no list_spec; config_is_eligible is
      false; the eligible set is v54's; every item-list category's extraction request is byte-identical on v54
      and v55 (no model question changes). v55 validates (the loader's validators + the config validator).
      NEGATIVE: the same config with a runnable pipeline WOULD be eligible (the predicate is live).
  11  THE REGISTRY: exactly one hvac_vrf entry, label "VRF", under HVAC, holding items, after Piping.
  12  v55 is the newest HVAC asset; the series is 1..55 with no gap; v54 stays on disk.
"""
import json
import math
import os
import re

from frappe.tests.utils import FrappeTestCase

from nirmaan_stack.services.boq_rate_master import loader

V54 = "rate_master_hvac_all_v54.json"
V55 = "rate_master_hvac_all_v55.json"
VRF_KIND, MISC_KIND, INPUT_KIND, CATEGORY = "hvac_vrf_item", "hvac_misc_item", "hvac_pricing_input", "hvac_vrf"

# THE VRF SHEET, rows 2..153, as the 2 Nov workbook holds them (cached values): row, BRAND, Category, Item, Type, Model,
# Capacity, BCS SUPPLY (G), BCS machine Installation (H), BCS Commissioning (I), Supply Markup (K), BOQ SUPPLY (M),
# BOQ INSTALLATION (N).
VRF_SHEET = [
    (2, 'BLUE STAR', 'Outdoor Unit', 'Top Discharge', 'Cool Only', 'IVRFB-28TCN', '28HP', 474100.0, 61600, 0.0, 0.2, 568920, 28000),
    (3, 'BLUE STAR', 'Outdoor Unit', 'Top Discharge', 'Cool Only', 'IVRFB-26TCN', '26HP', 456200.0, 57200, 0.0, 0.2, 547440, 26000),
    (4, 'BLUE STAR', 'Outdoor Unit', 'Top Discharge', 'Cool Only', 'IVRFB-24TCN', '24HP', 426300.0, 52800, 0.0, 0.2, 511560, 24000),
    (5, 'BLUE STAR', 'Outdoor Unit', 'Top Discharge', 'Cool Only', 'IVRFB-22TC / TCN', '22HP', 405100.0, 48400, 0.0, 0.2, 486120, 22000),
    (6, 'BLUE STAR', 'Outdoor Unit', 'Top Discharge', 'Cool Only', 'IVRFB-20TC / TCN', '20HP', 396700.0, 44000, 0.0, 0.2, 476040, 20000),
    (7, 'BLUE STAR', 'Outdoor Unit', 'Top Discharge', 'Cool Only', 'IVRFB-18TC / TCN', '18HP', 376700.0, 39600, 0.0, 0.2, 452040, 18000),
    (8, 'BLUE STAR', 'Outdoor Unit', 'Top Discharge', 'Cool Only (Single Compressor)', 'IVRFB-16TCN', '16HP', 318000.0, 35200, 0.0, 0.2, 381600, 16000),
    (9, 'BLUE STAR', 'Outdoor Unit', 'Top Discharge', 'Cool Only', 'IVRFB-16TC', '16HP', 364100.0, 35200, 0.0, 0.2, 436920, 16000),
    (10, 'BLUE STAR', 'Outdoor Unit', 'Top Discharge', 'Cool Only (Single Compressor)', 'IVRFB-14TCN', '14HP', 302800.0, 30800, 0.0, 0.2, 363360, 14000),
    (11, 'BLUE STAR', 'Outdoor Unit', 'Top Discharge', 'Cool Only', 'IVRFB-14TC', '14HP', 337700.0, 30800, 0.0, 0.2, 405240, 14000),
    (12, 'BLUE STAR', 'Outdoor Unit', 'Top Discharge', 'Cool Only', 'IVRFB-12TC / TCN', '12HP', 260400.0, 26400, 0.0, 0.2, 312480, 12000),
    (13, 'BLUE STAR', 'Outdoor Unit', 'Top Discharge', 'Cool Only', 'IVRFB-10TC / TCN', '10HP', 251300.0, 22000, 0.0, 0.2, 301560, 10000),
    (14, 'BLUE STAR', 'Outdoor Unit', 'Top Discharge', 'Cool Only', 'IVRFB-08TC / TCN', '08HP', 241500.0, 17600, 0.0, 0.2, 289800, 8000),
    (15, 'BLUE STAR', 'Outdoor Unit', 'Top Discharge', 'Cool Only', 'IVRFB-07TC', '07HP', 220200.0, 15400, 0.0, 0.2, 264240, 7000),
    (16, 'BLUE STAR', 'Outdoor Unit', 'Top Discharge', 'HEAT PUMP', 'IVRFB-28THN', '28HP', 493000.0, 61600, 0.0, 0.2, 591600, 28000),
    (17, 'BLUE STAR', 'Outdoor Unit', 'Top Discharge', 'HEAT PUMP', 'IVRFB-26THN', '26HP', 472800.0, 57200, 0.0, 0.2, 567360, 26000),
    (18, 'BLUE STAR', 'Outdoor Unit', 'Top Discharge', 'HEAT PUMP', 'IVRFB-24THN', '24HP', 447500.0, 52800, 0.0, 0.2, 537000, 24000),
    (19, 'BLUE STAR', 'Outdoor Unit', 'Top Discharge', 'HEAT PUMP', 'IVRFB-22TH / THN', '22HP', 424700.0, 48400, 0.0, 0.2, 509640, 22000),
    (20, 'BLUE STAR', 'Outdoor Unit', 'Top Discharge', 'HEAT PUMP', 'IVRFB-20TH / THN', '20HP', 418700.0, 44000, 0.0, 0.2, 502440, 20000),
    (21, 'BLUE STAR', 'Outdoor Unit', 'Top Discharge', 'HEAT PUMP', 'IVRFB-18TH / THN', '18HP', 403000.0, 39600, 0.0, 0.2, 483600, 18000),
    (22, 'BLUE STAR', 'Outdoor Unit', 'Top Discharge', 'HEAT PUMP (Single Compressor)', 'IVRFB-16THN', '16HP ', 334500.0, 35200, 0.0, 0.2, 401400, 16000),
    (23, 'BLUE STAR', 'Outdoor Unit', 'Top Discharge', 'HEAT PUMP', 'IVRFB-16TH', '16HP', 377600.0, 35200, 0.0, 0.2, 453120, 16000),
    (24, 'BLUE STAR', 'Outdoor Unit', 'Top Discharge', 'HEAT PUMP (Single Compressor)', 'IVRFB-14THN', '14HP ', 318000.0, 30800, 0.0, 0.2, 381600, 14000),
    (25, 'BLUE STAR', 'Outdoor Unit', 'Top Discharge', 'HEAT PUMP', 'IVRFB-14TH', '14HP', 352900.0, 30800, 0.0, 0.2, 423480, 14000),
    (26, 'BLUE STAR', 'Outdoor Unit', 'Top Discharge', 'HEAT PUMP', 'IVRFB-12TH / THN', '12HP', 270000.0, 26400, 0.0, 0.2, 324000, 12000),
    (27, 'BLUE STAR', 'Outdoor Unit', 'Top Discharge', 'HEAT PUMP', 'IVRFB-10TH / THN', '10HP', 257200.0, 22000, 0.0, 0.2, 308640, 10000),
    (28, 'BLUE STAR', 'Outdoor Unit', 'Top Discharge', 'HEAT PUMP', 'IVRFB-08TH / THN', '08HP', 254400.0, 17600, 0.0, 0.2, 305280, 8000),
    (29, 'BLUE STAR', 'Outdoor Unit', 'Top Discharge', 'HEAT PUMP', 'IVRFB-07TH', '07HP', 238400.0, 15400, 0.0, 0.2, 286080, 7000),
    (30, 'BLUE STAR', 'Outdoor Unit', 'Side Discharge', 'Cool Only', 'IVRFB-04SC', '04HP', 95100.0, 8800, 0.0, 0.2, 114120, 4000),
    (31, 'BLUE STAR', 'Outdoor Unit', 'Side Discharge', 'Cool Only', 'IVRFB-05SC', '05HP', 104720.0, 11000, 0.0, 0.2, 125664, 5000),
    (32, 'BLUE STAR', 'Outdoor Unit', 'Side Discharge', 'Cool Only', 'IVRFB-06SC', '06HP', 127270.0, 13200, 0.0, 0.2, 152724, 6000),
    (33, 'BLUE STAR', 'Outdoor Unit', 'Side Discharge', 'Cool Only', 'IVRFB-08SC', '08HP', 154990.0, 17600, 0.0, 0.2, 185988, 8000),
    (34, 'BLUE STAR', 'Outdoor Unit', 'Side Discharge', 'Cool Only', 'IVRFB-10SC', '10HP', 174680.0, 22000, 0.0, 0.2, 209616, 10000),
    (35, 'BLUE STAR', 'Outdoor Unit', 'Side Discharge', 'Cool Only', 'IVRFB-12SC', '12HP', 187550.0, 26400, 0.0, 0.2, 225060, 12000),
    (36, 'BLUE STAR', 'Outdoor Unit', 'Side Discharge', 'Cool Only', 'IVRFB-14SC', '14HP', 248720.0, 30800, 0.0, 0.2, 298464, 14000),
    (37, 'BLUE STAR', 'Outdoor Unit', 'Side Discharge', 'Cool Only', 'IVRFB-16SC', '16HP', 254430.0, 35200, 0.0, 0.2, 305316, 16000),
    (38, 'BLUE STAR', 'Outdoor Unit', 'Side Discharge', 'HEAT PUMP', 'IVRFB-04SH', '04HP', 104830.0, 8800, 0.0, 0.2, 125796, 4000),
    (39, 'BLUE STAR', 'Outdoor Unit', 'Side Discharge', 'HEAT PUMP', 'IVRFB-05SH', '05HP', 113300.0, 11000, 0.0, 0.2, 135960, 5000),
    (40, 'BLUE STAR', 'Outdoor Unit', 'Side Discharge', 'HEAT PUMP', 'IVRFB-06SH', '06HP', 126500.0, 13200, 0.0, 0.2, 151800, 6000),
    (41, 'BLUE STAR', 'Outdoor Unit', 'Side Discharge', 'HEAT PUMP', 'IVRFB-08SH', '08HP', 163790.0, 17600, 0.0, 0.2, 196548, 8000),
    (42, 'BLUE STAR', 'Outdoor Unit', 'Side Discharge', 'HEAT PUMP', 'IVRFB-10SH', '10HP', 185000.0, 22000, 0.0, 0.2, 222000, 10000),
    (43, 'BLUE STAR', 'Outdoor Unit', 'Side Discharge', 'HEAT PUMP', 'IVRFB-12SH', '12HP', 203520.0, 26400, 0.0, 0.2, 244224, 12000),
    (44, 'BLUE STAR', 'Outdoor Unit', 'Side Discharge', 'HEAT PUMP', 'IVRFB-14SH', '14HP', 260920.0, 30800, 0.0, 0.2, 313104, 14000),
    (45, 'BLUE STAR', 'Outdoor Unit', 'Side Discharge', 'HEAT PUMP', 'IVRFB-16SH', '16HP', 268500.0, 35200, 0.0, 0.2, 322200, 16000),
    (46, 'BLUE STAR', 'Indoor Unit', 'Hi-Wall', 'NA', 'VHW-10A', '0.8TR', 15200.0, 0.0, 0.0, 0.2, 18240, 1800.0),
    (47, 'BLUE STAR', 'Indoor Unit', 'Hi-Wall', 'NA', 'VHW-12A', '1.0TR', 15300.0, 0.0, 0.0, 0.2, 18360, 1800.0),
    (48, 'BLUE STAR', 'Indoor Unit', 'Hi-Wall', 'NA', 'VHW-16A', '1.3TR', 17200.0, 0.0, 0.0, 0.2, 20640, 1800.0),
    (49, 'BLUE STAR', 'Indoor Unit', 'Hi-Wall', 'NA', 'VHW-18A', '1.5TR', 17300.0, 0.0, 0.0, 0.2, 20760, 1800.0),
    (50, 'BLUE STAR', 'Indoor Unit', 'Hi-Wall', 'NA', 'VHW-20A', '1.7TR', 19300.0, 0.0, 0.0, 0.2, 23160, 1800.0),
    (51, 'BLUE STAR', 'Indoor Unit', 'Hi-Wall', 'NA', 'VHW-24A', '2.0TR', 19600.0, 0.0, 0.0, 0.2, 23520, 1800.0),
    (52, 'BLUE STAR', 'Indoor Unit', 'Hi-Wall', 'NA', 'VHW-30', '2.5TR', 25700.0, 0.0, 0.0, 0.2, 30840, 1800.0),
    (53, 'BLUE STAR', 'Indoor Unit', 'Hi-Wall', 'NA', 'VHW-34', '2.8TR', 26600.0, 0.0, 0.0, 0.2, 31920, 1800.0),
    (54, 'BLUE STAR', 'Indoor Unit', 'Cassette', 'FOUR-WAY ', 'VLC-12', '1.0TR', 30800.0, 0.0, 0.0, 0.2, 36960, 3500.0),
    (55, 'BLUE STAR', 'Indoor Unit', 'Cassette', 'FOUR-WAY ', 'VLC-16', '1.3TR', 30900.0, 0.0, 0.0, 0.2, 37080, 3500.0),
    (56, 'BLUE STAR', 'Indoor Unit', 'Cassette', 'FOUR-WAY ', 'VLC-18', '1.5TR', 31100.0, 0.0, 0.0, 0.2, 37320, 3500.0),
    (57, 'BLUE STAR', 'Indoor Unit', 'Cassette', 'FOUR-WAY ', 'VLC-20', '1.7TR', 32000.0, 0.0, 0.0, 0.2, 38400, 3500.0),
    (58, 'BLUE STAR', 'Indoor Unit', 'Cassette', 'FOUR-WAY ', 'VLC-24', '2.0TR', 32800.0, 0.0, 0.0, 0.2, 39360, 3500.0),
    (59, 'BLUE STAR', 'Indoor Unit', 'Cassette', 'FOUR-WAY ', 'VLC-27', '2.3TR', 33300.0, 0.0, 0.0, 0.2, 39960, 3500.0),
    (60, 'BLUE STAR', 'Indoor Unit', 'Cassette', 'FOUR-WAY ', 'VLC-34', '2.8TR', 36000.0, 0.0, 0.0, 0.2, 43200, 3500.0),
    (61, 'BLUE STAR', 'Indoor Unit', 'Cassette', 'FOUR-WAY ', 'VLC-38', '3.2TR', 36400.0, 0.0, 0.0, 0.2, 43680, 3500.0),
    (62, 'BLUE STAR', 'Indoor Unit', 'Cassette', 'FOUR-WAY ', 'VLC-48', '4.0TR', 36700.0, 0.0, 0.0, 0.2, 44040, 3500.0),
    (63, 'BLUE STAR', 'Indoor Unit', 'Cassette', 'FOUR-WAY ', 'VLC-60A', '5.0TR', 51400.0, 0.0, 0.0, 0.2, 61680, 3500.0),
    (64, 'BLUE STAR', 'Indoor Unit', 'Cassette', 'FOUR-WAY COMPACT', 'VCC-08', '0.6TR', 25400.0, 0.0, 0.0, 0.2, 30480, 3500.0),
    (65, 'BLUE STAR', 'Indoor Unit', 'Cassette', 'FOUR-WAY COMPACT', 'VCC-10', '0.8TR', 25800.0, 0.0, 0.0, 0.2, 30960, 3500.0),
    (66, 'BLUE STAR', 'Indoor Unit', 'Cassette', 'FOUR-WAY COMPACT', 'VCC-12', '1.0TR', 26100.0, 0.0, 0.0, 0.2, 31320, 3500.0),
    (67, 'BLUE STAR', 'Indoor Unit', 'Cassette', 'FOUR-WAY COMPACT', 'VCC-16', '1.3TR', 27000.0, 0.0, 0.0, 0.2, 32400, 3500.0),
    (68, 'BLUE STAR', 'Indoor Unit', 'Cassette', 'FOUR-WAY COMPACT', 'VCC-18', '1.5TR', 27400.0, 0.0, 0.0, 0.2, 32880, 3500.0),
    (69, 'BLUE STAR', 'Indoor Unit', 'Cassette', 'ONE-WAY', 'VOC-08', '0.6TR', 40800.0, 0.0, 0.0, 0.2, 48960, 3500.0),
    (70, 'BLUE STAR', 'Indoor Unit', 'Cassette', 'ONE-WAY', 'VOC-10', '0.8TR', 41900.0, 0.0, 0.0, 0.2, 50280, 3500.0),
    (71, 'BLUE STAR', 'Indoor Unit', 'Cassette', 'ONE-WAY', 'VOC-12', '1.0TR', 42900.0, 0.0, 0.0, 0.2, 51480, 3500.0),
    (72, 'BLUE STAR', 'Indoor Unit', 'Cassette', 'ONE-WAY', 'VOC-16', '1.3TR', 55600.0, 0.0, 0.0, 0.2, 66720, 3500.0),
    (73, 'BLUE STAR', 'Indoor Unit', 'Cassette', 'ONE-WAY', 'VOC-19', '1.6TR', 57600.0, 0.0, 0.0, 0.2, 69120, 3500.0),
    (74, 'BLUE STAR', 'Indoor Unit', 'Cassette', 'ONE-WAY', 'VOC-24', '2.0TR', 63000.0, 0.0, 0.0, 0.2, 75600, 3500.0),
    (75, 'BLUE STAR', 'Indoor Unit', 'Cassette', 'TWO-WAY', 'VTC-08', '0.6TR', 38700.0, 0.0, 0.0, 0.2, 46440, 3500.0),
    (76, 'BLUE STAR', 'Indoor Unit', 'Cassette', 'TWO-WAY', 'VTC-10', '0.8TR', 39800.0, 0.0, 0.0, 0.2, 47760, 3500.0),
    (77, 'BLUE STAR', 'Indoor Unit', 'Cassette', 'TWO-WAY', 'VTC-12', '1.0TR', 40400.0, 0.0, 0.0, 0.2, 48480, 3500.0),
    (78, 'BLUE STAR', 'Indoor Unit', 'Cassette', 'TWO-WAY', 'VTC-16', '1.3TR', 47000.0, 0.0, 0.0, 0.2, 56400, 3500.0),
    (79, 'BLUE STAR', 'Indoor Unit', 'Cassette', 'TWO-WAY', 'VTC-18', '1.6TR', 48100.0, 0.0, 0.0, 0.2, 57720, 3500.0),
    (80, 'BLUE STAR', 'Indoor Unit', 'Cassette', 'TWO-WAY', 'VTC-20', '1.7TR', 49300.0, 0.0, 0.0, 0.2, 59160, 3500.0),
    (81, 'BLUE STAR', 'Indoor Unit', 'Cassette', 'TWO-WAY', 'VTC-24', '2.0TR', 65000.0, 0.0, 0.0, 0.2, 78000, 3500.0),
    (82, 'BLUE STAR', 'Indoor Unit', 'Floor-cum-Ceiling Mounted', 'NA', 'VFC-18', '1.5TR', 35000.0, 0.0, 0.0, 0.2, 42000, 3500.0),
    (83, 'BLUE STAR', 'Indoor Unit', 'Floor-cum-Ceiling Mounted', 'NA', 'VFC-24', '2.0TR', 36300.0, 0.0, 0.0, 0.2, 43560, 3500.0),
    (84, 'BLUE STAR', 'Indoor Unit', 'Floor-cum-Ceiling Mounted', 'NA', 'VFC-36', '3.2TR', 40400.0, 0.0, 0.0, 0.2, 48480, 3500.0),
    (85, 'BLUE STAR', 'Indoor Unit', 'Floor-cum-Ceiling Mounted', 'NA', 'VFC-48', '4.0TR', 43400.0, 0.0, 0.0, 0.2, 52080, 3500.0),
    (86, 'BLUE STAR', 'Indoor Unit', 'Floor-cum-Ceiling Mounted', 'NA', 'VFC-60', '5.0TR', 45300.0, 0.0, 0.0, 0.2, 54360, 3500.0),
    (87, 'BLUE STAR', 'Indoor Unit', 'Verticool', 'NA', 'VVC-24B', '2.0TR', 34200.0, 0.0, 0.0, 0.2, 41040, 3500.0),
    (88, 'BLUE STAR', 'Indoor Unit', 'Verticool', 'NA', 'VVC-27B', '2.3TR', 34900.0, 0.0, 0.0, 0.2, 41880, 3500.0),
    (89, 'BLUE STAR', 'Indoor Unit', 'Verticool', 'NA', 'VVC-34B', '2.8TR', 41300.0, 0.0, 0.0, 0.2, 49560, 3500.0),
    (90, 'BLUE STAR', 'Indoor Unit', 'Verticool', 'NA', 'VVC-38B', '3.2TR', 42500.0, 0.0, 0.0, 0.2, 51000, 3500.0),
    (91, 'BLUE STAR', 'Indoor Unit', 'Verticool', 'NA', 'VVC-48B', '4.0TR', 42700.0, 0.0, 0.0, 0.2, 51240, 3500.0),
    (92, 'BLUE STAR', 'Indoor Unit', 'Concealed Split', 'NA', 'DCS-10', '0.8TR', 19700.0, 0.0, 0.0, 0.2, 23640, 1800.0),
    (93, 'BLUE STAR', 'Indoor Unit', 'Concealed Split', 'NA', 'DCS-12', '1.0TR', 20600.0, 0.0, 0.0, 0.2, 24720, 1800.0),
    (94, 'BLUE STAR', 'Indoor Unit', 'Concealed Split', 'NA', 'DCS-16', '1.3TR', 20900.0, 0.0, 0.0, 0.2, 25080, 1800.0),
    (95, 'BLUE STAR', 'Indoor Unit', 'Concealed Split', 'NA', 'DCS-18', '1.5TR', 21200.0, 0.0, 0.0, 0.2, 25440, 1800.0),
    (96, 'BLUE STAR', 'Indoor Unit', 'Concealed Split', 'NA', 'DCS-24', '2.0TR', 22400.0, 0.0, 0.0, 0.2, 26880, 1800.0),
    (97, 'BLUE STAR', 'Indoor Unit', 'Ductable', 'NA', 'DSD-18', '1.5TR', 20700.0, 0.0, 0.0, 0.2, 24840, 5500.0),
    (98, 'BLUE STAR', 'Indoor Unit', 'Ductable', 'NA', 'DSD-24', '2.0TR', 21400.0, 0.0, 0.0, 0.2, 25680, 5500.0),
    (99, 'BLUE STAR', 'Indoor Unit', 'Ductable', 'NA', 'DSD-30', '2.5TR', 26300.0, 0.0, 0.0, 0.2, 31560, 5500.0),
    (100, 'BLUE STAR', 'Indoor Unit', 'Ductable', 'NA', 'DSD-36', '3.0TR', 29100.0, 0.0, 0.0, 0.2, 34920, 5500.0),
    (101, 'BLUE STAR', 'Indoor Unit', 'Ductable', 'NA', 'DSD-48', '4.0TR', 33800.0, 0.0, 0.0, 0.2, 40560, 5500.0),
    (102, 'BLUE STAR', 'Indoor Unit', 'Ductable', 'NA', 'DSD-60', '5.0TR', 46000.0, 0.0, 0.0, 0.2, 55200, 7500.0),
    (103, 'BLUE STAR', 'Indoor Unit', 'Ductable', 'NA', 'DSD-72', '6.0TR', 48400.0, 0.0, 0.0, 0.2, 58080, 7500.0),
    (104, 'BLUE STAR', 'Indoor Unit', 'Ductable', 'NA', 'DSD-96', '8.0TR', 51900.0, 0.0, 0.0, 0.2, 62280, 7500.0),
    (105, 'BLUE STAR', 'Indoor Unit', 'Ductable', 'NA', 'VFM-264A', '22.0TR', 122000.0, 0.0, 0.0, 0.2, 146400, 7500.0),
    (106, 'BLUE STAR', 'Indoor Unit', 'Ductable', 'NA', 'VFM-216A', '18.0TR', 105100.0, 0.0, 0.0, 0.2, 126120, 7500.0),
    (107, 'BLUE STAR', 'Indoor Unit', 'Packaged Unit', 'NA', 'DFM-60', '5.0TR', 61500.0, 0.0, 0.0, 0.2, 73800, 7500.0),
    (108, 'BLUE STAR', 'Indoor Unit', 'Packaged Unit', 'NA', 'DFM-96', '8.0TR', 78900.0, 0.0, 0.0, 0.2, 94680, 7500.0),
    (109, 'BLUE STAR', 'Indoor Unit', 'Packaged Unit', 'NA', 'DFM-120', '10.0TR', 83300.0, 0.0, 0.0, 0.2, 99960, 11000.0),
    (110, 'BLUE STAR', 'Indoor Unit', 'Single Skin Treated Fresh Air', 'NA', 'DTFA-42', '3.5TR', 41300.0, 0.0, 0.0, 0.2, 49560, 7500.0),
    (111, 'BLUE STAR', 'Indoor Unit', 'Single Skin Treated Fresh Air', 'NA', 'DTFA-66', '5.5TR', 50700.0, 0.0, 0.0, 0.2, 60840, 7500.0),
    (112, 'BLUE STAR', 'Indoor Unit', 'Single Skin Treated Fresh Air', 'NA', 'DTFA-82', '6.8TR', 59800.0, 0.0, 0.0, 0.2, 71760, 7500.0),
    (113, 'BLUE STAR', 'Refnet/Y-Joint', 'Refnet/Y-Joint', 'NA', 'NA', 'NA', 3500.0, 0.0, 0.0, 0.2, 4200, 800.0),
    (114, 'BLUE STAR', 'Accessories', 'AHU EXPANSION KIT', 'NA', 'DAEKIT-050', '5.0TR', 34100.0, 0.0, 0.0, 0.2, 40920, 1000.0),
    (115, 'BLUE STAR', 'Accessories', 'AHU EXPANSION KIT', 'NA', 'DAEKIT-065', '6.5TR', 35100.0, 0.0, 0.0, 0.2, 42120, 1000.0),
    (116, 'BLUE STAR', 'Accessories', 'AHU EXPANSION KIT', 'NA', 'DAEKIT-080', '8.0TR', 36100.0, 0.0, 0.0, 0.2, 43320, 1000.0),
    (117, 'BLUE STAR', 'Accessories', 'AHU EXPANSION KIT', 'NA', 'DAEKIT-100', '10.0TR', 36600.0, 0.0, 0.0, 0.2, 43920, 1000.0),
    (118, 'BLUE STAR', 'Accessories', 'AHU EXPANSION KIT', 'NA', 'DAEKIT-150', '12.5 / 15.0TR', 36700.0, 0.0, 0.0, 0.2, 44040, 1000.0),
    (119, 'BLUE STAR', 'Accessories', 'AHU EXPANSION KIT', 'NA', 'DAEKIT-200', '20.0TR', 37700.0, 0.0, 0.0, 0.2, 45240, 1000.0),
    (120, 'BLUE STAR', 'Accessories', 'AHU EXPANSION KIT', 'NA', 'DAEKIT-300', '30.0TR', 42900.0, 0.0, 0.0, 0.2, 51480, 1000.0),
    (121, 'BLUE STAR', 'Accessories', 'Cordless Remote Controller', 'NA', 'CDCO-D171-00', 'NA', 1000.0, 0.0, 0.0, 0.2, 1200, 200.0),
    (122, 'BLUE STAR', 'Accessories', 'Wired Remote Controller', 'NA', 'CDCO-D170-00', 'NA', 2400.0, 0.0, 0.0, 0.2, 2880, 200.0),
    (123, 'BLUE STAR', 'Accessories', 'Touch Screen Central controller', 'NA', None, 'NA', 35000.0, 0.0, 0.0, 0.2, 42000, 1500.0),
    (124, 'DAIKIN', 'Outdoor Unit', 'Top Discharge', 'Cool Only', 'RXQ20BRY16 ', '20HP', 354737.0, 44000, 10000, 0.2, 425684.4, 32000),
    (125, 'DAIKIN', 'Outdoor Unit', 'Top Discharge', 'Cool Only', 'RXQ16BRY16 ', '16HP', 293106.0, 35200, 8000, 0.2, 351727.2, 25600),
    (126, 'DAIKIN', 'Outdoor Unit', 'Top Discharge', 'Cool Only', 'RXQ12BRY16', '12HP', 220191.0, 26400, 6000, 0.2, 264229.2, 19200),
    (127, 'DAIKIN', 'Outdoor Unit', 'Top Discharge', 'Cool Only', 'RXQ6BRY16', '06HP', 166216.0, 13200, 3000, 0.2, 199459.2, 9600),
    (128, 'DAIKIN', 'Outdoor Unit', 'Top Discharge', 'Heat Pump', '18HP+16HP', '34HP', 786096.0, 74800, 17000, 0.2, 943315.2, 54400),
    (129, 'DAIKIN', 'Outdoor Unit', 'Top Discharge', 'Heat Pump', 'RXYQ20BRY11', '20HP', 447336.0, 44000, 10000, 0.2, 536803.2, 32000),
    (130, 'DAIKIN', 'Outdoor Unit', 'Top Discharge', 'Heat Pump', 'RXYQ8BRY16', '08HP', 211452.0, 17600, 4000, 0.2, 253742.4, 12800),
    (131, 'DAIKIN', 'Outdoor Unit', 'Top Discharge', 'Heat Pump', 'RXYQ6BRY16', '06HP', 199191.0, 13200, 3000, 0.2, 239029.2, 9600),
    (132, 'DAIKIN', 'Outdoor Unit', 'Side Discharge', 'Cool Only', 'NA', '05HP', 104908.0, 11000, 2500, 0.2, 125889.6, 8000),
    (133, 'DAIKIN', 'Outdoor Unit', 'Side Discharge', 'Cool Only', 'NA', '06HP', 118007.0, 13200, 3000, 0.2, 141608.4, 9600),
    (134, 'DAIKIN', 'Indoor Unit', 'Ductable', 'NA', 'NA', '4.0TR', 55300.0, 0.0, 0.0, 0.2, 66360, 7500.0),
    (135, 'DAIKIN', 'Indoor Unit', 'Ductable', 'NA', 'NA', '6.6TR', 84700.0, 0.0, 0.0, 0.2, 101640, 7500.0),
    (136, 'DAIKIN', 'Indoor Unit', 'Ductable', 'NA', 'NA', '8.0TR', 89300.0, 0.0, 0.0, 0.2, 107160, 7500.0),
    (137, 'DAIKIN', 'Indoor Unit', 'Cassette', 'FOUR-WAY ', 'NA', '1.0TR', 38106.0, 0.0, 0.0, 0.2, 45727.2, 3500.0),
    (138, 'DAIKIN', 'Indoor Unit', 'Cassette', 'FOUR-WAY ', 'NA', '1.6TR', 40500.0, 0.0, 0.0, 0.2, 48600, 3500.0),
    (139, 'DAIKIN', 'Indoor Unit', 'Cassette', 'FOUR-WAY ', 'NA', '2.0TR', 42200.0, 0.0, 0.0, 0.2, 50640, 3500.0),
    (140, 'DAIKIN', 'Indoor Unit', 'Cassette', 'FOUR-WAY ', 'NA', '2.6TR', 47800.0, 0.0, 0.0, 0.2, 57360, 3500.0),
    (141, 'DAIKIN', 'Indoor Unit', 'Cassette', 'FOUR-WAY ', 'NA', '2.8TR', 48700.0, 0.0, 0.0, 0.2, 58440, 3500.0),
    (142, 'DAIKIN', 'Indoor Unit', 'Cassette', 'FOUR-WAY ', 'NA', '3.2TR', 55796.0, 0.0, 0.0, 0.2, 66955.2, 3500.0),
    (143, 'DAIKIN', 'Indoor Unit', 'Cassette', 'FOUR-WAY COMPACT', 'NA', '0.6TR', 42600.0, 0.0, 0.0, 0.2, 51120, 3500.0),
    (144, 'DAIKIN', 'Indoor Unit', 'Cassette', 'FOUR-WAY COMPACT', 'NA', '0.8TR', 45600.0, 0.0, 0.0, 0.2, 54720, 3500.0),
    (145, 'DAIKIN', 'Indoor Unit', 'Cassette', 'FOUR-WAY COMPACT', 'NA', '1.0TR', 47200.0, 0.0, 0.0, 0.2, 56640, 3500.0),
    (146, 'DAIKIN', 'Indoor Unit', 'Cassette', 'FOUR-WAY COMPACT', 'NA', '1.2TR', 49800.0, 0.0, 0.0, 0.2, 59760, 3500.0),
    (147, 'DAIKIN', 'Indoor Unit', 'Cassette', 'FOUR-WAY COMPACT', 'NA', '1.6TR', 51700.0, 0.0, 0.0, 0.2, 62040, 3500.0),
    (148, 'DAIKIN', 'Indoor Unit', 'Hi-Wall', 'NA', 'NA', '1.0TR', 23500.0, 0.0, 0.0, 0.2, 28200, 1800.0),
    (149, 'DAIKIN', 'Indoor Unit', 'Hi-Wall', 'NA', 'NA', '1.6TR', 26300.0, 0.0, 0.0, 0.2, 31560, 1800.0),
    (150, 'DAIKIN', 'Indoor Unit', 'Hi-Wall', 'NA', 'NA', '2.0TR', 27300.0, 0.0, 0.0, 0.2, 32760, 1800.0),
    (151, 'DAIKIN', 'Refnet/Y-Joint', 'Refnet/Y-Joint', 'NA', 'NA', 'NA', 3500.0, 0.0, 0.0, 0.2, 4200, 800.0),
    (152, 'DAIKIN', 'Accessories', 'Cordless Remote Controller', 'NA', 'NA', 'NA', 1800.0, 0.0, 0.0, 0.2, 2160, 200.0),
    (153, 'DAIKIN', 'Accessories', 'Wired Remote Controller', 'NA', 'NA', 'NA', 2800.0, 0.0, 0.0, 0.2, 3360, 200.0),
]

# THE FOUR MISC ROWS: row, ITEM, ITEM DETAIL, UNIT, Supply Markup, Install Markup, BCS Supply, BCS Installation,
# BoQ Supply, BoQ Install.
MISC_SHEET = [
    (20, 'BACnet Integration Controller for VRF Units', None, 'Nos', 1.0, 2.0, 25000.0, 1500.0, 50000, 4500),
    (22, 'MS Angle Base Frame Structure', None, 'Kg', 0.4, 1.0, 100.0, 20.0, 140, 40),
    (24, 'Refrigerant Gas Filling (R-410)', None, 'Kg', 0.2, 'NA', 850.0, 0.0, 1020, 350.0),
    (25, 'Drain Pump', 'Hiwall units', 'Nos', 0.4, 2.0, 2500.0, 250.0, 3500, 750),
]


def _asset_path(filename):
    return os.path.join(os.path.dirname(loader.__file__), "data", filename)


def _read(filename):
    with open(_asset_path(filename), "r", encoding="utf-8") as fh:
        return json.load(fh)


def _norm(obj):
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), default=str)


def _roundup(x):
    return math.ceil(round(x, 9))


def _cap(text):
    m = re.match(r"^(?:\d+(?:\.\d+)?\s*/\s*)?(\d+(?:\.\d+)?)\s*(HP|TR)$", str(text).strip())
    return (float(m.group(1)), m.group(2)) if m else None


class TestVrf1AssetV55(FrappeTestCase):
    ASSET = V55   # the asset under test (a vacuity run in scratch points this at a scratch copy)

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.v54 = _read(V54)
        with open(cls.ASSET if os.path.isabs(cls.ASSET) else _asset_path(cls.ASSET), "r", encoding="utf-8") as fh:
            cls.v55 = json.load(fh)
        cls.vrf = [it for it in cls.v55["items"] if it["kind"] == VRF_KIND]
        cls.misc = [it for it in cls.v55["items"] if it["kind"] == MISC_KIND]
        cls.inputs = [it for it in cls.v55["items"] if it["kind"] == INPUT_KIND and it["attributes"].get("shared_by") == "vrf"]
        cls.by_row = {it["source"]["row"]: it for it in cls.vrf}
        cls.cfg = next((c for c in cls.v55["category_configs"] if c["category_id"] == CATEGORY), None)

    def test_01_one_sku_per_sheet_row(self):
        self.assertEqual(len(self.vrf), 152)
        rows = [it["source"]["row"] for it in self.vrf]
        self.assertEqual(sorted(rows), list(range(2, 154)), "each VRF sheet row 2..153 exactly once")
        self.assertEqual(len(set(rows)), len(rows))
        self.assertTrue(all(it["source"]["sheet"] == "VRF" for it in self.vrf))
        self.assertEqual(sorted(r[0] for r in VRF_SHEET), list(range(2, 154)))
        self.assertEqual({b: sum(1 for it in self.vrf if it["brand"] == b) for b in ("Blue Star", "Daikin")},
                         {"Blue Star": 122, "Daikin": 30})
        self.assertEqual(sorted((it["source"]["sheet"], it["source"]["row"]) for it in self.misc),
                         [("Misc", 20), ("Misc", 22), ("Misc", 24), ("Misc", 25)])
        self.assertEqual(sorted(it["attributes"]["item"] for it in self.inputs), ["vrf_hp_per_tr", "vrf_kw_per_tr"])
        # nothing else is new, and no uid is re-used
        u54 = {it["item_uid"] for it in self.v54["items"]}
        new = [it for it in self.v55["items"] if it["item_uid"] not in u54]
        self.assertEqual(len(new), 158)
        self.assertEqual(sorted(it["kind"] for it in new), sorted([VRF_KIND] * 152 + [MISC_KIND] * 4 + [INPUT_KIND] * 2))
        self.assertEqual(len({it["item_uid"] for it in self.v55["items"]}), len(self.v55["items"]))
        self.assertTrue(all(re.fullmatch(r"rmi-[0-9a-f]{12}", it["item_uid"]) for it in new))

    def test_02_the_teams_corrections(self):
        models = {it["attributes"].get("model") for it in self.vrf}
        for gone in ("VSD-132A", "VSD-216A", "VSD-240A"):
            self.assertNotIn(gone, models)
        by_model = {it["attributes"].get("model"): it for it in self.vrf}
        self.assertEqual((by_model["DSD-72"]["attributes"]["capacity"], by_model["DSD-72"]["attributes"]["capacity_unit"]), (6.0, "TR"))
        self.assertEqual((by_model["DSD-96"]["attributes"]["capacity"], by_model["DSD-96"]["attributes"]["capacity_unit"]), (8.0, "TR"))
        heat_top = {it["attributes"]["capacity"]: it["rates"]["cost_supply"] for it in self.vrf
                    if it["brand"] == "Daikin" and it["attributes"]["item"] == "Outdoor Unit"
                    and it["attributes"]["discharge"] == "Top" and it["attributes"]["cooling"] == "Heat Pump"}
        self.assertEqual(heat_top[6.0], 199191.0)
        self.assertEqual(heat_top[8.0], 211452.0)
        self.assertEqual(sorted(heat_top), [6.0, 8.0, 20.0, 34.0])

    def test_03_outdoor_install_follows_the_sheet(self):
        out = [it for it in self.vrf if it["attributes"]["item"] == "Outdoor Unit"]
        self.assertEqual(sum(1 for it in out if it["brand"] == "Blue Star"), 44)
        self.assertEqual(sum(1 for it in out if it["brand"] == "Daikin"), 10)
        for it in out:
            hp, rt = it["attributes"]["capacity"], it["rates"]
            self.assertEqual(it["attributes"]["capacity_unit"], "HP")
            self.assertEqual(rt["boq_install"], hp * (1000.0 if it["brand"] == "Blue Star" else 1600.0), it["source"])
            self.assertEqual(rt["cost_machine_install"], hp * 2200.0, it["source"])
            self.assertEqual(rt["cost_commissioning"], hp * 500.0 if it["brand"] == "Daikin" else 0.0, it["source"])
        # NEGATIVE: no indoor / accessory SKU carries a machine-install or commissioning cost
        for it in self.vrf:
            if it["attributes"]["item"] != "Outdoor Unit":
                self.assertEqual((it["rates"]["cost_machine_install"], it["rates"]["cost_commissioning"]), (0.0, 0.0), it["source"])

    def test_04_every_figure_is_the_sheets(self):
        for r in VRF_SHEET:
            row, G, H, I, K, M, N = r[0], r[7], r[8], r[9], r[10], r[11], r[12]
            it = self.by_row[row]
            self.assertEqual(it["rates"], {"cost_supply": float(G), "supply_markup": float(K), "boq_install": float(N),
                                           "cost_machine_install": float(H), "cost_commissioning": float(I)}, row)
            supply = it["rates"]["cost_supply"] * (1 + it["rates"]["supply_markup"])
            self.assertAlmostEqual(supply, float(M), places=6, msg="row %d BOQ supply" % row)
            self.assertEqual(it["unit"], "Nos")
        # the sheet's own Daikin fractions survive (no rounding in the mint, R-ROUND)
        self.assertEqual(sum(1 for r in VRF_SHEET if float(r[11]) != int(float(r[11]))), 12)
        fractions = [it for it in self.vrf if abs(it["rates"]["cost_supply"] * (1 + it["rates"]["supply_markup"]) - round(it["rates"]["cost_supply"] * (1 + it["rates"]["supply_markup"]))) > 1e-6]
        self.assertEqual(len(fractions), 12)

    def test_05_the_four_misc_items(self):
        by_row = {it["source"]["row"]: it for it in self.misc}
        for row, item, detail, unit, sm, im, cs, ci, boq_s, boq_i in MISC_SHEET:
            it = by_row[row]
            self.assertEqual(it["unit"], unit)
            self.assertEqual(it["attributes"]["item_name"], item)
            self.assertEqual(it["attributes"].get("item_detail"), detail)
            rt = it["rates"]
            self.assertEqual((rt["cost_supply"], rt["supply_markup"], rt["cost_install"]), (float(cs), float(sm), float(ci)), row)
            self.assertEqual(_roundup(rt["cost_supply"] * (1 + rt["supply_markup"])), float(boq_s), row)
            if im == "NA":
                self.assertEqual(rt["boq_install"], float(boq_i))
                self.assertNotIn("install_markup", rt)
            else:
                self.assertEqual(rt["install_markup"], float(im))
                self.assertEqual(_roundup(rt["cost_install"] * (1 + rt["install_markup"])), float(boq_i), row)
                self.assertNotIn("boq_install", rt, "only the gas row's install is typed")
        self.assertEqual(by_row[24]["rates"]["boq_install"], 350.0)
        self.assertTrue(all(it["attributes"]["group"] == "Misc" for it in self.misc))

    def test_06_brand_on_every_vrf_sku(self):
        sheet_brand = {r[0]: {"BLUE STAR": "Blue Star", "DAIKIN": "Daikin"}[r[1]] for r in VRF_SHEET}
        for it in self.vrf:
            self.assertEqual(it["brand"], sheet_brand[it["source"]["row"]])
            self.assertNotIn("brand", it["attributes"], "brand is the item column, projected at read time")
        self.assertTrue(all(it["brand"] is None for it in self.misc + self.inputs))

    def test_07_attributes_as_the_sheet(self):
        outdoor_only, indoor_only = {"cooling", "discharge", "compressor"}, {"way"}
        for r in VRF_SHEET:
            row, cat, item, typ, model, cap = r[0], r[2], r[3], r[4], r[5], r[6]
            a = self.by_row[row]["attributes"]
            self.assertEqual(a["item_name"], item.strip(), row)
            self.assertEqual(a["group"], {"Outdoor Unit": "Outdoor", "Indoor Unit": "Indoor", "Refnet/Y-Joint": "Refnet", "Accessories": "Accessories"}[cat])
            if cat == "Outdoor Unit":
                self.assertEqual(a["item"], "Outdoor Unit")
                self.assertEqual(a["discharge"], item.split()[0])
                self.assertEqual(a["cooling"], "Cool Only" if typ.upper().startswith("COOL ONLY") else "Heat Pump")
                self.assertEqual(a["compressor"], "Single Compressor" if "(Single Compressor)" in typ else "Standard")
                self.assertFalse(indoor_only & set(a), row)
            else:
                self.assertFalse(outdoor_only & set(a), row)
                if item == "Cassette":
                    self.assertEqual(a["way"], typ.strip())
                else:
                    self.assertNotIn("way", a)
            if "Remote Controller" in item:
                self.assertEqual((a["item"], a["remote_type"]), ("Remote Controller", item.split()[0]))
            c = _cap(cap)
            if c is None:
                self.assertEqual(str(cap).strip(), "NA")
                self.assertFalse({"capacity", "capacity_unit", "capacity_label"} & set(a), row)
            else:
                self.assertEqual((a["capacity"], a["capacity_unit"], a["capacity_label"]), (c[0], c[1], str(cap).strip()), row)
            if model is None or str(model).strip().upper() in ("", "NA"):
                self.assertNotIn("model", a, row)
            else:
                self.assertEqual(a["model"], str(model).strip(), row)
        # the sheet's quirks, named
        self.assertEqual(self.by_row[118]["attributes"]["capacity"], 15.0)            # "12.5 / 15.0TR"
        self.assertEqual(self.by_row[118]["attributes"]["capacity_label"], "12.5 / 15.0TR")
        self.assertEqual((self.by_row[128]["attributes"]["model"], self.by_row[128]["attributes"]["capacity"]), ("18HP+16HP", 34.0))
        self.assertEqual(self.by_row[22]["attributes"]["capacity_label"], "16HP")       # "16HP " on the sheet
        self.assertEqual(self.by_row[54]["attributes"]["way"], "FOUR-WAY")              # "FOUR-WAY " on the sheet
        self.assertEqual(self.by_row[124]["attributes"]["model"], "RXQ20BRY16")         # "RXQ20BRY16 " on the sheet
        self.assertEqual(self.by_row[16]["attributes"]["cooling"], self.by_row[129]["attributes"]["cooling"])  # HEAT PUMP / Heat Pump
        self.assertNotIn("model", self.by_row[123]["attributes"])                       # blank model
        no_model = sum(1 for r in VRF_SHEET if r[5] is None or str(r[5]).strip().upper() in ("", "NA"))
        self.assertEqual(sum(1 for it in self.vrf if "model" not in it["attributes"]), no_model)
        defs = {d["id"]: d for d in self.cfg["attribute_definitions"]}
        self.assertEqual(defs["item"]["values"], ["Outdoor Unit", "Hi-Wall", "Cassette", "Floor-cum-Ceiling Mounted", "Verticool",
                                                  "Concealed Split", "Ductable", "Packaged Unit", "Single Skin Treated Fresh Air",
                                                  "Refnet/Y-Joint", "AHU Expansion Kit", "Remote Controller",
                                                  "Touch Screen Central Controller", "BACnet Integration Controller for VRF Units",
                                                  "MS Angle Base Frame Structure", "Refrigerant Gas Filling (R-410)", "Drain Pump"])
        self.assertEqual(defs["cooling"]["values"], ["Cool Only", "Heat Pump"])
        self.assertEqual(defs["compressor"]["values"], ["Standard", "Single Compressor"])
        self.assertEqual(defs["way"]["values"], ["FOUR-WAY", "FOUR-WAY COMPACT", "ONE-WAY", "TWO-WAY"])
        # every attribute an item carries is declared, and every declared choice value is carried by an item
        for it in self.vrf + self.misc:
            self.assertFalse(set(it["attributes"]) - set(defs), it["source"])
        for d in defs.values():
            if d["type"] == "choice" and d["id"] != "brand":
                carried = {it["attributes"].get(d["id"]) for it in self.vrf + self.misc}
                self.assertEqual(set(d["values"]) - carried, set(), d["id"])

    def test_08_nothing_else_moved(self):
        a = {it["item_uid"]: _norm(it) for it in self.v54["items"]}
        b = {it["item_uid"]: _norm(it) for it in self.v55["items"]}
        self.assertEqual({u: b.get(u) for u in a}, a, "every v54 item is in v55 unchanged")
        c54 = [_norm(c) for c in self.v54["category_configs"]]
        self.assertEqual([_norm(c) for c in self.v55["category_configs"]][:-1], c54)
        self.assertEqual([c["category_id"] for c in self.v55["category_configs"]][-1], CATEGORY)
        self.assertEqual({k: v for k, v in self.v55.items() if k not in ("items", "category_configs")},
                         {k: v for k, v in self.v54.items() if k not in ("items", "category_configs")})
        self.assertEqual([it["item_uid"] for it in self.v55["items"]], sorted(it["item_uid"] for it in self.v55["items"]))

    def test_09_the_two_inputs(self):
        by = {it["attributes"]["item"]: it for it in self.inputs}
        hp, kw = by["vrf_hp_per_tr"], by["vrf_kw_per_tr"]
        self.assertEqual((hp["attributes"]["name"], hp["rates"], hp["unit"]), ("VRF conversion - HP per TR", {"factor": 1.25}, "HP per TR"))
        self.assertEqual((kw["attributes"]["name"], kw["rates"], kw["unit"]), ("VRF conversion - kW per TR", {"factor": 3.517}, "kW per TR"))
        self.assertIn("16 TR x 1.25 = 20 HP", hp["attributes"]["remarks"])
        self.assertIn("10 TR x 3.517 = 35.17 kW", kw["attributes"]["remarks"])
        for it in (hp, kw):
            self.assertIn("VRF-2", it["attributes"]["remarks"])
            self.assertEqual(it["source"], {"sheet": "Pricing Inputs", "row": 0})
        # `factor` is a plain multiplier on the grid and in the file -- never a percentage (owner ruling, slice 12c)
        from nirmaan_stack.services.boq_rate_master import csv_exporter
        self.assertIn("factor", csv_exporter.PRICING_INPUT_NON_PERCENT_COLUMNS)
        self.assertNotIn("factor", csv_exporter.PRICING_INPUT_PERCENT_COLUMNS)

    def test_10_no_pricing_block_not_eligible_no_request_moves(self):
        from nirmaan_stack.services.boq_rate_master import config_validation, extraction
        self.assertEqual(self.cfg["item_kinds"], [VRF_KIND, MISC_KIND])
        self.assertEqual(self.cfg["pipelines"], {})
        self.assertNotIn("list_spec", self.cfg)
        self.assertEqual(self.cfg["category_display"], "VRF")
        self.assertFalse(extraction.has_runnable_pricing_rules(self.cfg))
        loader._validate_items(self.v55["items"])
        req, elig = {}, {}
        for name, payload in (("v54", self.v54), ("v55", self.v55)):
            cfgs = {(payload["discipline"], c["category_id"]): dict(c, discipline=payload["discipline"]) for c in payload["category_configs"]}
            for c in cfgs.values():
                loader._validate_one_config(c, c["category_id"])
                config_validation._validate_config(c)
            elig[name] = sorted(cid for (_d, cid), c in cfgs.items() if extraction.config_is_eligible(c, cfgs))
            req[name] = {cid: json.dumps(extraction.build_items_spec(c, cfgs, payload["discipline"]), sort_keys=True)
                         for (_d, cid), c in cfgs.items() if c.get("list_spec")}
        self.assertNotIn(CATEGORY, elig["v55"])
        self.assertEqual(elig["v54"], elig["v55"])
        self.assertEqual(sorted(req["v55"]), ["hvac_adp", "hvac_insulation", "hvac_piping"])
        self.assertEqual(req["v54"], req["v55"])
        # NEGATIVE: the same config WITH a runnable pipeline would be eligible -- the predicate is live, not vacuous
        live = dict(self.cfg, discipline="HVAC", pipelines={"supply": {"steps": [{"step": "match_master_row", "params": {"kind": VRF_KIND}}]}})
        self.assertTrue(extraction.config_is_eligible(live))

    def test_11_the_registry_entry(self):
        path = os.path.join(os.path.dirname(loader.__file__), "..", "..", "..", "frontend", "src", "pages", "pricing",
                            "rate-master", "rateMasterRegistry.ts")
        with open(os.path.normpath(path), "r", encoding="utf-8") as fh:
            src = fh.read()
        entries = re.findall(r"\{\s*category_id:\s*\"hvac_vrf\"([^}]*)\}", src)
        self.assertEqual(len(entries), 1)
        self.assertIn('label: "VRF"', entries[0])
        self.assertNotIn("holds_items", entries[0], "VRF holds items: it is listed on the Rate Master page")
        self.assertLess(src.index('"hvac_piping"'), src.index('"hvac_vrf"'))
        self.assertLess(src.index('"hvac_vrf"'), src.index('"hvac_pricing_inputs"'))

    def test_12_v55_is_the_newest_and_v54_stays(self):
        d = os.path.dirname(_asset_path(V55))
        ns = [int(m.group(1)) for f in os.listdir(d) for m in [re.match(r"rate_master_hvac_all_v(\d+)\.json$", f)] if m]
        # INVERTED at VRF-2a (HVAC v56; a test failing solely because it names the current HVAC asset) by mechanical authority: BEFORE `self.assertEqual(max(ns), 55)`
        # INVERTED at VRF-2b (HVAC v57; a test failing solely because it names the current HVAC asset) by mechanical authority: BEFORE `self.assertEqual(max(ns), 56)`
        # INVERTED at VRF-3a (HVAC v58; a test failing solely because it names the current HVAC asset) by mechanical authority: BEFORE `self.assertEqual(max(ns), 57)`
        self.assertEqual(max(ns), 64)   # VRF-8: v64 (BEFORE: 63, VRF-7)
        # INVERTED at VRF-2a (HVAC v56; a test failing solely because it names the current HVAC asset) by mechanical authority: BEFORE `self.assertEqual(sorted(ns), list(range(1, 56)))`
        # INVERTED at VRF-2b (HVAC v57; a test failing solely because it names the current HVAC asset) by mechanical authority: BEFORE `self.assertEqual(sorted(ns), list(range(1, 57)))`
        # INVERTED at VRF-3a (HVAC v58; a test failing solely because it names the current HVAC asset) by mechanical authority: BEFORE `self.assertEqual(sorted(ns), list(range(1, 58)))`
        # INVERTED at VRF-3b (HVAC v59; a test failing solely because it names the current HVAC asset) by mechanical authority: BEFORE `self.assertEqual(sorted(ns), list(range(1, 59)))`
        # INVERTED at VRF-4 (HVAC v60; a test failing solely because it names the current HVAC asset) by mechanical authority: BEFORE `self.assertEqual(sorted(ns), list(range(1, 60)))`
        # INVERTED at VRF-5 (HVAC v61 minted + LOADED; mechanical authority -- fails solely because it reads the current HVAC asset): BEFORE `list(range(1, 61))`
        self.assertEqual(sorted(ns), list(range(1, 65)))  # VRF-8 (HVAC v64 minted + loaded; mechanical authority): BEFORE list(range(1, 64))
        self.assertTrue(os.path.exists(_asset_path(V54)))
        # INVERTED at VRF-2a (HVAC v56; a test failing solely because it names the current HVAC asset) by mechanical authority: BEFORE `self.assertFalse(os.path.exists(_asset_path("rate_master_hvac_all_v56.json")))`
        self.assertTrue(os.path.exists(_asset_path("rate_master_hvac_all_v56.json")))
        # INVERTED at VRF-2b (HVAC v57; a test failing solely because it names the current HVAC asset) by mechanical authority: BEFORE `self.assertFalse(os.path.exists(_asset_path("rate_master_hvac_all_v57.json")))`
        self.assertTrue(os.path.exists(_asset_path("rate_master_hvac_all_v57.json")))
        # INVERTED at VRF-3a (HVAC v58; a test failing solely because it names the current HVAC asset) by mechanical authority: BEFORE `self.assertFalse(os.path.exists(_asset_path("rate_master_hvac_all_v58.json")))`
        self.assertTrue(os.path.exists(_asset_path("rate_master_hvac_all_v58.json")))
        self.assertFalse(os.path.exists(_asset_path("rate_master_hvac_all_v65.json")))   # VRF-8 (BEFORE: v64, VRF-7)
