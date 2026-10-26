# Mars Oxygen and Rocket Propellant from Local Resources (ISRU), per NASA Data

Labels used below: **[DEMONSTRATED]** means measured on Mars or in hardware tests. **[PROJECTED]** means a design study or plan. **[INFERENCE]** means my own arithmetic from the cited numbers, not a figure from a source.

Citation note: the 2022 *Science Advances* MOXIE paper (doi:10.1126/sciadv.abp8636) lists **Jeffrey A. Hoffman as first author**, with Michael H. Hecht second. "Hecht et al." correctly refers to the 2021 *Space Science Reviews* instrument paper (Hecht et al. 2021, SSRv 217:9). Cite the 2022 paper as "Hoffman, Hecht et al. 2022".

## 1. MOXIE on Perseverance: how it works, what it produced, and what full scale would need

### Takeaway
MOXIE made **122 g of O2 over 16 runs on Mars (2021 to Aug 7, 2023)**. Its peak rate was **12 g/hr at ≥98% purity**, twice NASA's goal of 6 g/hr. It drew about **300 W**, had a mass of **17.1 kg**, and was microwave-oven sized. A crewed ascent vehicle needs about **2–3 kg/hr** of O2, roughly **200–500 times MOXIE's rate**, and about **25–31 t** of O2 in total.

### Cited Findings
- **[DEMONSTRATED] Total output and runs:** MOXIE generated O2 "for the 16th and final time". Total since the 2021 landing was **122 grams**, "about what a small dog breathes in 10 hours." — [NASA JPL, Sept 6, 2023](https://www.jpl.nasa.gov/news/nasas-oxygen-generating-experiment-moxie-completes-mars-mission/)
- **[DEMONSTRATED] Peak rate and purity:** "At its most efficient, MOXIE was able to produce **12 grams of oxygen an hour** – twice as much as NASA's original goals for the instrument – at **98% purity or better**." — [NASA JPL](https://www.jpl.nasa.gov/news/nasas-oxygen-generating-experiment-moxie-completes-mars-mission/)
- **[DEMONSTRATED] Final run:** The 16th run, on **Aug 7, 2023**, made **9.8 g** of O2. MOXIE "completed all of its technical requirements and was operated at a variety of conditions throughout a full Mars year." — [NASA JPL](https://www.jpl.nasa.gov/news/nasas-oxygen-generating-experiment-moxie-completes-mars-mission/)
- **[DEMONSTRATED] Requirement baseline:** MOXIE's development requirement was **>6 g/hr O2 at >98% purity** over 10 cycles. — [NASA PDS Atmospheres Node](https://pds-atmospheres.nmsu.edu/data_and_services/atmospheres_data/PERSEVERANCE/moxie.html)
- **[DEMONSTRATED] Early runs:** There were **seven** O2-producing runs between the February 2021 landing and the end of 2021 (flight-model cycles OC9–OC15). Each produced about **6–8 g/hr**, with runs of **59–96 minutes** yielding, for example, 5.4 g, 6.9 g and 8.9 g. Runs covered day and night and several seasons, at surface pressures of **~5–10 mbar**. — [Hoffman, Hecht et al. 2022, *Science Advances* (PMC full text)](https://pmc.ncbi.nlm.nih.gov/articles/PMC9432831/); [Science.org](https://www.science.org/doi/10.1126/sciadv.abp8636)
- **How it works (solid oxide electrolysis, SOXE):** Martian air enters through a dust-trapping **HEPA filter**. A **scroll pump** compresses it (max **3,500 rpm**, reference intake **55 g/hr** of CO2). The gas is heated to **800 °C**. CO2 flows over a **nickel-based cathode** and splits into oxide ions plus CO. A **scandia-stabilized zirconia** ceramic electrolyte passes only oxide ions to the anode, where they recombine as O2. About **6%** of the CO-rich cathode exhaust is recirculated to the intake so the nickel does not oxidize. — [Hoffman, Hecht et al. 2022](https://pmc.ncbi.nlm.nih.gov/articles/PMC9432831/)
- Plain-language version: MOXIE "separates one oxygen atom from each molecule of carbon dioxide pumped in from Mars' thin atmosphere." — [NASA JPL](https://www.jpl.nasa.gov/news/nasas-oxygen-generating-experiment-moxie-completes-mars-mission/)
- **Instrument specs:** Mass **17.1 kg** (37.7 lb on Earth, 14.14 lb on Mars). Power **300 W**. Volume **23.9 × 23.9 × 30.9 cm**. — [NASA Science, Perseverance instruments](https://science.nasa.gov/mission/mars-2020-perseverance/science-instruments/)
- **[PROJECTED] Full-scale needs:** A six-person O2/CH4 Mars Ascent Vehicle (MAV) would weigh about **50 t**, including **~31 t of oxygen** and **~9 t of methane**. A full-scale O2 plant would need to produce **2–3 kg/hr**. — [Hoffman, Hecht et al. 2022](https://pmc.ncbi.nlm.nih.gov/articles/PMC9432831/)
- **[PROJECTED]** Hoffman described the full-scale system as "a couple of hundred times bigger than MOXIE." He said MOXIE's design was constrained by power, heat, volume and mass on Perseverance, and that the O2 would also have to be **liquefied**, which MOXIE does not do. — [IEEE Spectrum](https://spectrum.ieee.org/making-oxygen-on-mars)
- **[PROJECTED]** MIT envisions a scaled-up MOXIE landed ahead of the crew, producing O2 continuously "at the rate of several hundred trees." That would be enough to sustain humans and fuel the return rocket. — [MIT AeroAstro news, Sept 2022](https://aeroastro.mit.edu/news-impact/mits-moxie-experiment-reliably-produces-oxygen-on-mars)
- **[PROJECTED] Next step:** Per NASA, the next step is not "MOXIE 2.0." It is a full-scale system that pairs a MOXIE-like generator with **O2 liquefaction and storage**. — [NASA JPL](https://www.jpl.nasa.gov/news/nasas-oxygen-generating-experiment-moxie-completes-mars-mission/)
- "A human return trip from Mars will require **more than 25 tons of oxygen**." — [NASA Ames lecture page (Hecht, Feb 2021)](https://www.nasa.gov/ames-ocs/mars-2020-series/the-mars-oxygen-isru-experiment-moxie/)
- A follow-up paper covers 18 months of MOXIE operations. — [Acta Astronautica 2023 (abstract)](https://www.sciencedirect.com/science/article/abs/pii/S0094576523002187)

### Inferences
- [INFERENCE] **Scale factor:** 2–3 kg/hr ÷ 12 g/hr peak = **~170–250×**. 2–3 kg/hr ÷ 6 g/hr nominal = **~330–500×**.
- [INFERENCE] **Time to make the MAV's oxygen:** 31 t at 2 kg/hr takes ~15,500 hr (~650 Earth days). At 3 kg/hr it takes ~10,300 hr (~430 days). Either way the plant must run more than a year before the crew arrives, and the gap between launch windows is ~26 months.
- [INFERENCE] **Energy intensity:** At 300 W and 6–12 g/hr, MOXIE used roughly **25–50 Wh per gram (25–50 kWh/kg O2)**. That figure includes heater overhead for a small, intermittently run unit. A large, continuously running plant should do much better per kg; compare the DRA 5.0 power figures in Section 3.
- [INFERENCE] MOXIE's lifetime total of 122 g is only about **3.5 hours** of one astronaut's breathing at 0.84 kg/day (35 g/hr).

### Gaps
- Exact purity statistics per run: the PMC text mentions a 99.6% figure, but I could not confirm from my extraction whether it is measured or a requirement. NASA's public figure is "98% or better."
- I did not find a NASA source giving the full-scale plant's mass and power for exactly 2–3 kg/hr. DRA 5.0 figures in Section 3 are the closest.
- Hecht et al. 2021 (*Space Science Reviews*) was not opened directly. Its abstract is at [ADS](https://ui.adsabs.harvard.edu/abs/2021SSRv..217....9H/abstract).

## 2. Mars atmosphere composition and surface pressure (Curiosity SAM)

### Takeaway
Curiosity's SAM instrument measured roughly **95% CO2, ~2.6% N2, ~1.9% Ar, ~0.16% O2 and ~0.06% CO** by volume at Gale Crater. Surface pressure is only **~5–10 mbar** and varies with season, so ISRU must compress very thin gas.

### Cited Findings
- **2013 first SAM result** (volume mixing ratios): CO2 **0.960 (±0.007)**; ⁴⁰Ar **0.0193 (±0.0001)**; N2 **0.0189 (±0.0003)**; O2 **1.45 (±0.09) × 10⁻³**. — [Mahaffy et al. 2013, *Science* 341:263 (ADS abstract)](https://ui.adsabs.harvard.edu/abs/2013Sci...341..263M/abstract)
- NASA JPL image release PIA16460: CO2 is **95.9%** of the atmosphere by volume. It lists argon, nitrogen, oxygen and CO as the next most abundant gases. — [NASA JPL PIA16460](https://www.jpl.nasa.gov/images/pia16460-the-five-most-abundant-gases-in-the-martian-atmosphere/)
- **Revised multi-year SAM average** (Trainer et al. 2019, *JGR Planets*, about 3 Mars years of data): **95% CO2, 2.59% N2, 1.94% Ar, 0.161% O2**, plus trace CO. — [Eos research spotlight](https://eos.org/research-spotlights/curiosity-rover-reveals-oxygen-mystery-in-martian-atmosphere)
- Coverage of the same study gives **0.06% CO**. O2 rose by **up to 30%** in spring and summer, then fell back, which remains an unexplained seasonal anomaly. — [Live Science](https://www.livescience.com/oxygen-levels-change-gale-crater-mars.html); [NASA feature](https://www.nasa.gov/?p=95912)
- Surface pressure across MOXIE's runs at Jezero ranged from **~5 to 10 mbar** (Earth is ~1,013 mbar). — [Hoffman, Hecht et al. 2022](https://pmc.ncbi.nlm.nih.gov/articles/PMC9432831/)
- Annual pressure varies about **25%** as CO2 freezes onto and sublimes from the polar caps. This is a secondary source citing Franz 2017 and others. — [Wikipedia: Atmosphere of Mars](https://en.wikipedia.org/wiki/Atmosphere_of_Mars)
- The CO2 share differs between the 2013 figure (96.0%) and the 2017–2019 figure (~95%). This reflects SAM recalibration (Franz et al. 2017), not a real change. Use ~95% as the current value. — [Mahaffy 2013](https://ui.adsabs.harvard.edu/abs/2013Sci...341..263M/abstract); [Eos/Trainer 2019](https://eos.org/research-spotlights/curiosity-rover-reveals-oxygen-mystery-in-martian-atmosphere)

### Inferences
- [INFERENCE] N2 plus Ar make up about **4.5%** of the atmosphere. That is the raw stock for a breathing-air "buffer gas"; DRA 5.0 plans to extract both (Section 4).
- [INFERENCE] The ~1–2% seasonal swing in total pressure, plus diurnal density changes, means plant output will vary by season. MOXIE tests at low- and high-density seasons covered this.

### Gaps
- I did not retrieve a NASA-primary water-vapor mixing ratio from SAM. It is trace, roughly hundreds of ppm and highly variable, but I have no citation.
- The mean surface pressure at Gale specifically (REMS data, about 7–9 mbar) was not verified here.

## 3. Ascent propellant: tonnages (DRA 5.0 and later), chemistry, water needs, power and duration

### Takeaway
For most NASA Mars architectures, ascent propellant is **the single largest category of mass landed on Mars**. NASA's DRA 5.0 (2009) chose LOX/LCH4 ascent with oxygen made from the atmosphere by solid-oxide CO2 electrolysis. The plan was **two ISRU units of ~566 kg and ~23.7 kWe each**, running continuously for **≥300 days** on a **30 kWe fission reactor (7.8 t)**, with methane brought from Earth. Making methane on Mars as well requires water. By stoichiometry, that is **~2.25 t water + 2.75 t CO2 per tonne of CH4**, which co-produces **4 t of O2**.

### Cited Findings
- **[PROJECTED] Ascent propellant dominates mass:** "For most proposed human Mars architectures, the single largest category of mass that must be delivered to the Mars surface is the propellant required for the crew's ascent." ISRU for this is "possibly the single most significant application" of ISRU. — [NASA 2024 Moon to Mars Architecture Concept Review white paper, "Mars Ascent Propellant Considerations"](https://www.lpi.usra.edu/lunar/strategies/resources/M2M_ACR2024_MarsAscentPropellantConsiderations.pdf)
- **[PROJECTED] DRA 5.0 (NASA SP-2009-566):**
  - Propellant: **LOX/LCH4**.
  - Ascent stage mass **~21.5 t** without LOX, with LCH4 brought from Earth. Stage 1 is **12,160 kg** and Stage 2 is **9,330 kg** (Table 5-1).
  - Each ISRU system: **565.52 kg** and **23.71 kWe** (Table 5-2). Total ISRU plant is **1,130 kg** across two units.
  - Operation: continuous at **25 kWe** (Sec. 5.4.1) or **26 kWe** (Sec. 6.6.1) for **at least 300 days**.
  - Process: CO2 is captured by a **micro-channel adsorption pump** and processed by **solid oxide CO2 electrolyzers (SOCEs)**. The plant produces O2 plus water and buffer gases (N2, Ar) for life support.
  - Rationale: ISRU O2 gives a net decrease in total mission mass and a significantly smaller lander.
  - — [NASA DRA 5.0, SP-2009-566](https://www.nasa.gov/wp-content/uploads/2015/09/373665main_nasa-sp-2009-566.pdf)
- **[PROJECTED] 2009 trade result:** The study compared four scenarios (no ISRU; two mixes of atmosphere and Earth-origin resources; atmosphere plus regolith water). "Using Martian oxygen for ascent offered the best balance between mass savings, total volume required, and power generation needs." NASA notes the study **predated the 2018 global dust storm** lessons. — [NASA ACR 2024 white paper](https://www.lpi.usra.edu/lunar/strategies/resources/M2M_ACR2024_MarsAscentPropellantConsiderations.pdf)
- **[PROJECTED] Later NASA studies:**
  - SAC21 (2021) examined architectures that land propellant without ISRU.
  - The **2024 Strategic Analysis Cycle** examined a 4-crew mission with 2 crew landing. It considered three ascent-propellant sources: water shipped from Earth, water from buried ice sheets, and water from regolith.
  - The most ISRU-intensive options "could require NASA to emplace and operate infrastructure **years before** a crewed mission."
  - — [NASA ACR 2024 white paper](https://www.lpi.usra.edu/lunar/strategies/resources/M2M_ACR2024_MarsAscentPropellantConsiderations.pdf)
- **[PROJECTED] Tonnage ranges:** ~31 t O2 + ~9 t CH4 for a 6-crew, ~50 t MAV ([Hoffman, Hecht et al. 2022](https://pmc.ncbi.nlm.nih.gov/articles/PMC9432831/)). "More than 25 tons of oxygen" ([NASA Ames](https://www.nasa.gov/ames-ocs/mars-2020-series/the-mars-oxygen-isru-experiment-moxie/)). A full ISRU system would weigh **1.7 t** while avoiding transport of **30 t of ascent propellant** from Earth; this is a UCF/AIAA 2017 paper, not NASA. ([AIAA 2017-0423](https://sciences.ucf.edu/class/wp-content/uploads/sites/23/2017/02/An-ISRU-propellant-production-system-for-a-fully-fueled-Mars-Ascent-Vehicle-AIAA-2017-0423.pdf))
- **[PROJECTED] NASA's water-based "kiloton-class" concept:** Scroll compressors pump CO2, and water comes from storage, delivered by a water-tanker pallet. A **solid oxide electrolysis (SOE) module co-electrolyzes CO2 and H2O**, producing an O2 stream that is cooled and liquefied plus a CO2/CO/H2 stream. That stream goes to **methanation (Sabatier) reactors** to make CH4. Water is condensed and recycled, leftover CO2 is scrubbed, and H2 is recovered by PEM separators. — [NASA NTRS 20230017069, "Kiloton Class ISRU Systems for LO2/LCH4 Propellant Production on the Mars Surface" (SciTech 2024)](https://ntrs.nasa.gov/api/citations/20230017069/downloads/SciTech%20Mars%20kiloton%20ISRU%20Final.pdf). The PDF's numeric tables did not parse, so only the process flow could be extracted.
- **[PROJECTED] Trade space options NASA lists:**
  - No ISRU: land fully fueled before the crew arrives.
  - Limited ISRU: Mars atmosphere plus Earth-origin CH4 or H2.
  - Comprehensive ISRU: atmosphere plus water from ice sheets or hydrated regolith.
  - Other uses of local resources: breathing gas (cabin, EVA, airlock make-up), water for drinking, radiation shielding and crops, and building materials.
  - — [NASA ACR 2024 white paper](https://www.lpi.usra.edu/lunar/strategies/resources/M2M_ACR2024_MarsAscentPropellantConsiderations.pdf)

### Inferences (stoichiometry; my arithmetic, using molar masses CO2 44, H2 2, CH4 16, H2O 18, O2 32)
- [INFERENCE] **O2 only (MOXIE/SOXE route), 2 CO2 → 2 CO + O2:** at least **2.75 kg CO2 per kg O2**. Real CO2 utilization is lower; MOXIE took in ~55 g/hr CO2 for 6–12 g/hr O2. For 31 t O2, that means processing at least ~85 t of CO2.
- [INFERENCE] **Sabatier, CO2 + 4 H2 → CH4 + 2 H2O:** 44 kg CO2 + 8 kg H2 → 16 kg CH4 + 36 kg H2O. Electrolyzing that water (2 H2O → 2 H2 + O2) returns 4 kg H2 and gives **32 kg O2**. The net reaction is **CO2 + 2 H2O → CH4 + 2 O2**.
  - Per **1 t CH4**: **2.75 t CO2 + 2.25 t water in → 4.0 t O2 out**. Equivalently, 0.25 t of net H2 is needed if hydrogen is imported instead of water.
  - O2:CH4 is **4:1** by mass. LOX/CH4 engines burn at about 3.4–3.6:1, so a full Sabatier-plus-electrolysis plant makes **surplus O2**. For Hoffman's 9 t CH4 / 31 t O2 case (ratio ~3.4), the methane-driven chemistry alone gives ~36 t O2 and needs **~20 t of water and ~25 t of CO2**.
- [INFERENCE] **Imported-hydrogen variant (classic "Mars Direct" logic):** 1 t of H2 brought from Earth makes 4 t CH4 + 16 t O2 (net) through Sabatier plus electrolysis. That is about **20 t of propellant per tonne of hydrogen landed**. Liquid H2 storage and boil-off is the penalty.
- [INFERENCE] **Reverse water-gas shift (RWGS), CO2 + H2 → CO + H2O:** electrolyzing the water and recycling the H2 gives net 2 CO2 → 2 CO + O2, the same chemistry as MOXIE but at lower temperature. It makes O2 with no net hydrogen use. No NASA quantitative source for RWGS was retrieved.
- [INFERENCE] **DRA 5.0 energy budget:** ~25 kWe × 300 days × 24 hr ≈ **180,000 kWh (180 MWh)** for the ascent O2 plus consumables.

### Gaps
- **The DRA 5.0 ISRU oxygen tonnage itself** (roughly 22–25 t of LOX is commonly quoted) was not extracted from the PDF in this session. Treat "25–33 t" as the cross-source range: NASA Ames ">25 t", Hoffman "~31 t".
- Quantitative kWe and water totals from the 2024 SAC and kiloton ISRU studies (NTRS 20230017069, 20230018535) were not parsed; the PDF text extraction failed and ntrs.nasa.gov was not reachable by direct fetch.
- **SpaceX Starship Mars propellant plans (NON-NASA):** not researched or verified in this session, so I have no sourced numbers.

## 4. Other ISRU products: buffer gases, hydrogen sources, plastics

### Takeaway
NASA's DRA 5.0 ISRU plant was designed to output **buffer gases (N2 and Ar)** and **water** for life support as well as O2. Hydrogen for methane or water would come from **buried ice sheets, icy regolith or hydrated minerals**. I found no NASA quantitative source on making plastics or ethylene from Martian CO2.

### Cited Findings
- The DRA 5.0 ISRU plant converts Mars atmosphere into **O2, H2O and buffer gases (N2 and Ar)** for ECLSS consumables, in addition to ascent oxygen. — [NASA DRA 5.0](https://www.nasa.gov/wp-content/uploads/2015/09/373665main_nasa-sp-2009-566.pdf)
- Martian resources NASA lists:
  - the atmosphere
  - regolith
  - water as "buried ice sheets, ice mixed with near-surface regolith, or minerals containing chemically bound water"
  - Applications: breathing gas (cabin, EVA, airlock losses), water (drinking, radiation protection, crops), and building materials (berms, shielding, habitat construction).
  - — [NASA ACR 2024 white paper](https://www.lpi.usra.edu/lunar/strategies/resources/M2M_ACR2024_MarsAscentPropellantConsiderations.pdf)
- N2 (~2.6%) and Ar (~1.9%) are present in the atmosphere as feedstock. — [Eos/Trainer 2019](https://eos.org/research-spotlights/curiosity-rover-reveals-oxygen-mystery-in-martian-atmosphere)
- Kilopower/fission power "opens up the full surface of Mars, including the northern latitudes where water may reside." — [NASA Kilopower: What's next (as indexed)](https://www.nasa.gov/directorates/spacetech/kilopower/Kilopower_whats_next)

### Inferences
- [INFERENCE] Hydrogen is the key limiting element for methane. Atmospheric water vapor is far too sparse, so practical sources are mined ice or hydrated regolith, or H2 shipped from Earth. This is why NASA's water-based options tie landing-site choice to ice deposits.
- [INFERENCE] Atmospheric N2 + Ar at ~4.5% means making 1 kg of buffer gas requires processing about 22 kg of atmosphere, before separation losses.

### Gaps
- No NASA source was retrieved on ethylene or plastics from CO2 (for example via CO plus H2 Fischer-Tropsch, or NASA's CO2 Conversion Challenge for sugars). This is not covered.
- No NASA quantitative buffer-gas production rate was found.

## 5. Breathing needs and MOXIE-equivalents

### Takeaway
NASA's average metabolic O2 use is **0.84 kg per person per day**, with a range of 0.49–1.25 kg depending on activity. That is about **35 g/hr per person**, or roughly **3 MOXIEs at peak rate, or ~6 at the nominal 6 g/hr, running non-stop** for each astronaut.

### Cited Findings
- Metabolic O2 consumption is **0.49–1.25 kg/person-day**, with **0.84 kg/person-day average**, depending on activity level. — [NASA NTRS 20120015343](https://ntrs.nasa.gov/api/citations/20120015343/downloads/20120015343.pdf)
- A secondary reference gives the same 0.84 kg/day O2, alongside 0.62 kg food and 3.54 kg water per crewmember per day (Sulzman & Genin 1994). — [Wikipedia: Life-support system](https://en.wikipedia.org/wiki/Life-support_system)
- MOXIE peak rate is **12 g/hr**; nominal requirement is **6 g/hr**. — [NASA JPL](https://www.jpl.nasa.gov/news/nasas-oxygen-generating-experiment-moxie-completes-mars-mission/); [PDS](https://pds-atmospheres.nmsu.edu/data_and_services/atmospheres_data/PERSEVERANCE/moxie.html)

### Inferences
- [INFERENCE] 0.84 kg/day ≈ **35 g/hr per person**.
  - 1 person: **~2.9 MOXIEs** at 12 g/hr, or **~5.8 MOXIEs** at 6 g/hr, running 24/7. That is about **0.9–1.75 kW** at 300 W each.
  - 4 crew: 3.36 kg/day ≈ 140 g/hr ≈ **12–23 MOXIEs**.
  - 6 crew: 5.04 kg/day ≈ 210 g/hr ≈ **18–35 MOXIEs**.
- [INFERENCE] **Breathing versus propellant:** a 4-person, 500-day surface stay uses ~1.7 t O2, compared with ~25–31 t for the ascent vehicle. **Propellant is about 15–20 times the breathing need**, which is why NASA frames ISRU around ascent propellant.
- [INFERENCE] A 2–3 kg/hr full-scale plant (48–72 kg/day) could supply breathing O2 for **~57–86 people**. Breathing O2 is a small add-on to a propellant plant.

### Gaps
- The NASA Baseline Values and Assumptions Document (BVAD) table itself was not opened; the 0.84 kg figure is cited from a NASA conference paper that matches it.

## 6. Power for ISRU: fission (Kilopower / Fission Surface Power) and solar at Mars

### Takeaway
DRA 5.0 sized a **30 kWe, 7.8 t fission reactor** to run ISRU. A solar alternative of **25 kWe would weigh ~22.5 t and need 4,300 m²** of arrays to ride out dust storms. In December 2024 NASA formally chose **fission as the primary power source** for crewed Mars surface missions, noting that Mars sunlight is **at most 45% of Earth's** and dust storms last weeks to months. NASA's Fission Surface Power program targets **≥40 kWe** on the Moon first. A July 2025 directive raised the lunar target to **100 kWe** for launch readiness by **late 2029 / FY2030 Q1**.

### Cited Findings
- **[PROJECTED] DRA 5.0 power:**
  - Fission: **30 kWe**, **7,800 kg** including 20% contingency, sized to support propellant ISRU.
  - Solar alternative: five **5 kWe** modules (25 kWe), **~22,500 kg** including contingency, **4,300 m²** for dust-storm backup.
  - — [NASA DRA 5.0](https://www.nasa.gov/wp-content/uploads/2015/09/373665main_nasa-sp-2009-566.pdf)
- **[PROJECTED] 2024 Mars surface power decision (NASA ACR 2024):**
  - Needs: at least **10 kW** for a modest 2-crew, ≤30-day mission. **Hundreds of kW to MW-class** for larger crews, longer stays and **propellant manufacturing**.
  - Solar irradiance at Mars is "at most **45 percent** of typical Earth values." Dust storms persist "for weeks or months."
  - Fission was chosen mainly to mitigate loss-of-mission risk, because it provides round-the-clock power through dust storms, with landed mass and volume advantages.
  - — [NASA ACR 2024: Mars Surface Power Decision](https://www.nasa.gov/wp-content/uploads/2024/12/acr24-mars-surface-power-decision.pdf)
- **[DEMONSTRATED, ground test] Kilopower/KRUSTY:** NASA and DOE tested heat transfer with highly enriched uranium fuel in **May 2018** at the Nevada National Security Site. The system "performed as expected under both normal and off-normal conditions." — [NASA Fission Surface Power page](https://www.nasa.gov/exploration-systems-development-mission-directorate/fission-surface-power/)
- **[PROJECTED] NASA trade study (Kilopower vs solar at Mars):** four **10 kW** Kilopower units weigh **~7,000 kg** and give full power in any dust condition. A solar-plus-battery system of **~9,800 kg** would provide only **22 kW keep-alive** through a dust storm of up to **120 days**. — [NASA NTRS 20160002628](https://ntrs.nasa.gov/citations/20160002628) (figures taken from a search summary; full PDF not opened)
- **Fission Surface Power program (NASA page, updated Sept 2025):**
  - Goal of "at least **40 kilowatts** … enough to continuously run 30 households for **ten years**."
  - Timeline: DOE study Mar 2020; NASA-DOE MOU Oct 2020; RFP 2021; **three design concepts selected June 2022**.
  - Lunar operation "early 2030s." "Moon first, then Mars."
  - — [NASA FSP](https://www.nasa.gov/exploration-systems-development-mission-directorate/fission-surface-power/)
- **[PROJECTED, 2025 directive]** Acting Administrator Sean Duffy's July/Aug 2025 directive:
  - Reactor of **100 kWe**, **≤15 t**, **closed Brayton cycle**.
  - Launch readiness **Q1 FY2030** (last quarter of calendar 2029).
  - Awards to two providers within six months of the RFP. A draft partnership announcement followed in late Aug 2025.
  - — [Payload Space](https://payloadspace.com/nasa-wants-to-hit-the-accelerator-on-lunar-atomics/); [ANS Nuclear Newswire](https://www.ans.org/news/article-7336/nuclear-power-on-the-moon-what-were-watching/); [NEI Magazine](https://www.neimagazine.com/news/nasa-fast-tracks-lunar-reactor-plan/)
- **2026:** NASA and DOE signed an MOU in **January 2026** aiming for a lunar reactor by **2030**. — [World Nuclear News](https://world-nuclear-news.org/articles/nasa-doe-join-together-for-lunar-reactor-by-2030)
- **Solar flux:** a non-NASA paper gives Mars irradiance as **~595 W/m²** (vs ~1,361 W/m² at Earth). — [arXiv 2112.06145](https://arxiv.org/pdf/2112.06145)

### Inferences
- [INFERENCE] 595/1,361 ≈ **44%**, consistent with the commonly quoted "~43%" and NASA's "at most 45%." I found no NASA document stating exactly 43%, so cite NASA's "≤45%."
- [INFERENCE] A DRA-5.0-class ISRU load of ~25 kWe fits one 40 kWe FSP unit or three 10 kW Kilopower units. A 100 kWe unit could power about four such plants, or one plant that also makes methane from water.

### Gaps
- Mass of the 40 kWe FSP design was not found as a number; NASA's page says only "roughly the same weight" for low-enriched designs.
- Dust-storm optical depths and the 2018 storm's measured effect on solar power were not retrieved.

## 7. Status of NASA Mars ISRU as of 2026

### Takeaway
As of late 2026 **no Mars ISRU flight follow-on to MOXIE is funded or flying**. NASA's architecture process still treats ISRU ascent propellant as an **open trade** with no decision found. NASA has decided **fission** as the Mars surface power source (Dec 2024) and is accelerating lunar fission (100 kWe, ~2030) as the precursor.

### Cited Findings
- MOXIE ended operations in Aug–Sept 2023. NASA's stated next step is a full-scale generator with liquefaction and storage, but no such mission was named. — [NASA JPL](https://www.jpl.nasa.gov/news/nasas-oxygen-generating-experiment-moxie-completes-mars-mission/)
- NASA's Moon to Mars Objectives call for demonstrating "Mars ISRU capabilities to support an initial human Mars exploration campaign." The 2024 ACR white paper concludes NASA "must thoroughly consider the ascent propellant trade space before selecting an approach." — [NASA ACR 2024 white paper](https://www.lpi.usra.edu/lunar/strategies/resources/M2M_ACR2024_MarsAscentPropellantConsiderations.pdf)
- 2024 ACR: fission was selected as the primary Mars surface power technology. The decision does not restrict funding for alternatives. — [NASA ACR 2024 Mars surface power decision](https://www.nasa.gov/wp-content/uploads/2024/12/acr24-mars-surface-power-decision.pdf)
- 2025 Architecture Update (Dec 2025): it narrowed the range of crew sent to the Mars surface, added a lunar nuclear power system and introduced "architecture-driven knowledge gaps." My search found **no ISRU propellant decision** in it. — [NASA 2025 Architecture Update](https://www.nasa.gov/wp-content/uploads/2025/12/2025-architecture-update-for-publication.pdf) (from search summary; document not fully read)
- March 2026: NASA announced a new Mars mission and reshaped Moon goals (an "SR-1 Freedom" nuclear mission and a Moon Base). ANS reported a plan for space nuclear propulsion by 2028. — [CNN, Mar 24, 2026](https://www.cnn.com/2026/03/24/science/nasa-ignition-mars-spacecraft-moon-base); [ANS, Mar 25, 2026](https://www.ans.org/news/2026-03-25/article-7879/nasa-announces-plan-for-space-nuclear-propulsion-by-2028/) (headline-level only; details not verified)

### Inferences
- [INFERENCE] The demonstrated state of the art is still MOXIE: about 12 g/hr peak, 122 g lifetime. Everything at tonne scale (25–31 t O2, methane from ice, 25–100 kWe reactors on Mars) remains projected.
- [INFERENCE] For a near-future story setting, NASA's own studies support plausible elements: a fission-powered ISRU plant landed one or two synods early, solid-oxide CO2 electrolysis for O2, and liquefaction.

### Gaps
- I did not verify any 2026 NASA budget line for Mars ISRU, the details of the March 2026 "SR-1 Freedom" announcement, or whether any 2026 Mars ISRU demonstration was proposed.
- NASA's STMD ISRU roadmap or shortfall-ranking documents for 2025–2026 were not retrieved.
